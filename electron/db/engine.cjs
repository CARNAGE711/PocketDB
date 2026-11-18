/**
 * PocketDB — Database Engine (the "MongoDB-like" API surface).
 *
 * A thin, well-defined layer over FileStorage + the query engine:
 *   namespaces:  create/drop databases & collections, list with stats
 *   documents:   insertOne/insertMany, find/findOne, updateOne/updateMany,
 *                deleteOne/deleteMany, count, aggregate
 *   indexes:     createIndex/dropIndex/listIndexes (sidecar maps used to
 *                prune candidate documents on equality/$in predicates)
 *   schema:      per-collection validation rules enforced on writes
 *   history:     automatic per-collection revision log (restore revisions)
 *   watch:       change feed subscription (fs.watch based)
 *   files:       GridFS-style binary store in a hidden _files collection
 *
 * Documents are plain JSON objects; `_id` is auto-assigned using the
 * ObjectId simulation unless the caller supplies one.
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { FileStorage } = require('./storage.cjs');
const { objectId, isValidObjectId } = require('./objectId.cjs');
const {
  matches, makeComparator, projectDoc, aggregate, setPath, unsetPath,
  getPath, cmp, fallbackCmp, deepEqual,
} = require('./query.cjs');

const DEMO_DB = 'pocketdb-demo';
const HISTORY_LIMIT = 200; // revisions kept per collection
const SCHEMA_TYPES = ['string', 'number', 'boolean', 'object', 'array', 'null'];

/* ---------------------------------------------------------------- */
/* File storage (GridFS-style, images & any binary content)           */
/* ---------------------------------------------------------------- */

// Files live in a hidden per-database collection as base64 NDJSON lines.
const FILES_COLLECTION = '_files';
const MAX_FILE_BYTES =
  Number(process.env.POCKETDB_MAX_FILE_MB || 16) * 1024 * 1024;

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
  csv: 'text/csv', json: 'application/json',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm',
  zip: 'application/zip', gz: 'application/gzip',
};

/** Best-effort MIME type from a filename extension. */
function guessContentType(filename) {
  const ext = String(filename).split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/* ---------------------------------------------------------------- */
/* Index helpers                                                      */
/* ---------------------------------------------------------------- */

/** Type-tagged key so values like 1, "1" and true never collide. */
function indexKey(v) {
  const type = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  return `${type}:${JSON.stringify(v) ?? ''}`;
}

/**
 * Build sorted index entries [{ v, ids }] for a field. Array fields are
 * indexed per element (multikey), Mongo-style. Missing values are not
 * indexed (Mongo behavior).
 */
function buildIndexEntries(docs, field) {
  const map = new Map();
  for (const d of docs) {
    const v = getPath(d, field);
    if (v === undefined) continue;
    for (const val of Array.isArray(v) ? v : [v]) {
      const k = indexKey(val);
      if (!map.has(k)) map.set(k, { v: val, ids: [] });
      map.get(k).ids.push(d._id);
    }
  }
  return [...map.values()].sort((a, b) => {
    const c = cmp(a.v, b.v);
    return (c === null ? fallbackCmp(a.v, b.v) : c);
  });
}

/**
 * Pick a usable index for a top-level equality / $in / $eq predicate.
 * Returns { field, ids:Set } or null (fall back to a full scan).
 * Operators that can't prune safely ($ne, $regex, $exists, $not, ...) are skipped.
 */
function pickIndexFilter(filter, indexes) {
  for (const [field, idx] of Object.entries(indexes || {})) {
    if (!(field in filter)) continue;
    const cond = filter[field];
    let wanted = null;
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) {
      wanted = [cond];
    } else if (Object.keys(cond).every((k) => k === '$eq' || k === '$options')) {
      wanted = [cond.$eq];
    } else if (Object.keys(cond).every((k) => k === '$in')) {
      if (!Array.isArray(cond.$in)) continue;
      wanted = cond.$in;
    } else {
      continue;
    }
    if (wanted.some((v) => v !== null && typeof v === 'object')) continue; // scalar pruning only
    const byKey = new Map(idx.entries.map((e) => [indexKey(e.v), e.ids]));
    const ids = new Set();
    for (const v of wanted) {
      const hit = byKey.get(indexKey(v));
      if (hit) for (const id of hit) ids.add(id);
    }
    return { field, ids };
  }
  return null;
}

class PocketEngine {
  constructor(dataDir, { passphrase } = {}) {
    this.storage = new FileStorage(dataDir, { passphrase });
    this.dataDir = dataDir;
    this.seedDemoData();
  }

  /* ---------------------------------------------------------------- */
  /* First-run demo seed so the studio never opens empty               */
  /* ---------------------------------------------------------------- */

  seedDemoData() {
    if (this.storage.listDatabases().length > 0) return;
    this.createDatabase(DEMO_DB);
    this.createCollection(DEMO_DB, 'users');
    this.insertMany(DEMO_DB, 'users', [
      { name: 'Ada Lovelace', email: 'ada@pocket.db', status: 'active', profile: { age: 36, city: 'London' }, tags: ['math', 'pioneer'], createdAt: '2024-01-02T09:00:00Z' },
      { name: 'Alan Turing', email: 'alan@pocket.db', status: 'active', profile: { age: 41, city: 'Manchester' }, tags: ['crypto', 'pioneer'], createdAt: '2024-02-14T10:30:00Z' },
      { name: 'Grace Hopper', email: 'grace@pocket.db', status: 'invited', profile: { age: 85, city: 'Arlington' }, tags: ['compiler', 'navy'], createdAt: '2024-03-21T14:00:00Z' },
      { name: 'Linus Torvalds', email: 'linus@pocket.db', status: 'inactive', profile: { age: 55, city: 'Portland' }, tags: ['kernel', 'git'], createdAt: '2024-05-06T08:15:00Z' },
      { name: 'Margaret Hamilton', email: 'margaret@pocket.db', status: 'active', profile: { age: 87, city: 'Boston' }, tags: ['apollo', 'sre'], createdAt: '2024-07-20T20:17:00Z' },
    ]);
    this.createCollection(DEMO_DB, 'tasks');
    this.insertMany(DEMO_DB, 'tasks', [
      { title: 'Design NDJSON layout', done: true, priority: 1, assignee: 'Ada Lovelace' },
      { title: 'Write query engine', done: true, priority: 2, assignee: 'Alan Turing' },
      { title: 'Build aggregation UI', done: false, priority: 3, assignee: 'Grace Hopper' },
    ]);
  }

  /** Create an optional sample collection for a freshly created database. */
  seedSample(db) {
    this.createCollection(db, 'sample-users');
    return this.insertMany(db, 'sample-users', [
      { name: 'Sample User', email: 'sample@pocket.db', status: 'active', profile: { age: 30, city: 'Localhost' }, createdAt: new Date().toISOString() },
      { name: 'Another User', email: 'another@pocket.db', status: 'invited', profile: { age: 25, city: 'Loopback' }, createdAt: new Date().toISOString() },
      { name: 'Third User', email: 'third@pocket.db', status: 'inactive', profile: { age: 41, city: 'Datadir' }, createdAt: new Date().toISOString() },
    ]);
  }

  /* ---------------------------------------------------------------- */
  /* Namespace management (databases & collections)                    */
  /* ---------------------------------------------------------------- */

  /** All databases with their collections and per-collection stats. */
  listDatabases() {
    return this.storage.listDatabases().map((name) => ({
      name,
      collections: this.listCollections(name, { includeSystem: false }),
    }));
  }

  createDatabase(name) {
    this.storage.createDatabase(name);
    return { ok: true };
  }

  dropDatabase(name) {
    this.storage.dropDatabase(name);
    return { ok: true };
  }

  listCollections(db, { includeSystem = true } = {}) {
    let names = this.storage.listCollections(db);
    if (!includeSystem) {
      // Hidden engine collections (e.g. the `_files` file store).
      names = names.filter((coll) => !coll.startsWith('_'));
    }
    return names.map((coll) => ({
      name: coll,
      count: this.storage.readDocuments(db, coll).length,
      size: this.storage.collectionSize(db, coll),
    }));
  }

  createCollection(db, coll) {
    this.storage.createCollection(db, coll);
    return { ok: true };
  }

  dropCollection(db, coll) {
    this.storage.dropCollection(db, coll);
    // Remove the collection's engine sidecars too.
    this.storage.removeSidecar(db, `${coll}.ndjson.idx.json`);
    this.storage.removeSidecar(db, `${coll}.ndjson.schema.json`);
    this.storage.removeSidecar(db, `${coll}.ndjson.hist.json`);
    return { ok: true };
  }

  /* ---------------------------------------------------------------- */
  /* Documents: CRUD                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Query documents.
   * opts: { filter, sort, limit, skip, projection }
   * Returns { documents, total } — total counts matches BEFORE skip/limit.
   * An index on a filter field narrows the scanned set automatically.
   */
  find(db, coll, opts = {}) {
    const all = this.storage.readDocuments(db, coll);
    const filter = opts.filter || {};
    let source = all;
    if (filter && typeof filter === 'object' && !Array.isArray(filter)) {
      const pick = pickIndexFilter(filter, this.loadIndexes(db, coll));
      if (pick) source = all.filter((d) => pick.ids.has(d._id));
    }
    const matched = source.filter((d) => matches(d, filter));
    let docs = matched;
    if (opts.sort) docs = [...docs].sort(makeComparator(opts.sort));
    const skip = Number.isInteger(opts.skip) && opts.skip > 0 ? opts.skip : 0;
    docs = docs.slice(skip);
    if (Number.isInteger(opts.limit) && opts.limit >= 0) docs = docs.slice(0, opts.limit);
    if (opts.projection) docs = docs.map((d) => projectDoc(d, opts.projection));
    return { documents: docs, total: matched.length };
  }

  findOne(db, coll, opts = {}) {
    const { documents } = this.find(db, coll, { ...opts, limit: 1 });
    return documents[0] || null;
  }

  /** Ensure every document has a usable `_id`. */
  prepareDocument(doc) {
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new Error('A document must be a JSON object.');
    }
    const out = JSON.parse(JSON.stringify(doc)); // clone + strip undefined
    if (out._id === undefined || out._id === null || out._id === '') {
      out._id = objectId();
    } else if (!isValidObjectId(out._id) && typeof out._id !== 'string') {
      out._id = String(out._id);
    }
    return out;
  }

  insertOne(db, coll, doc) {
    const prepared = this.prepareDocument(doc);
    this.assertSchema(db, coll, prepared);
    const docs = this.storage.readDocuments(db, coll);
    if (docs.some((d) => d._id === prepared._id)) {
      throw new Error(`Duplicate _id "${prepared._id}" already exists in "${coll}".`);
    }
    docs.push(prepared);
    this.storage.writeDocuments(db, coll, docs);
    this.afterWrite(db, coll, docs);
    return { insertedId: prepared._id };
  }

  insertMany(db, coll, documents) {
    if (!Array.isArray(documents)) throw new Error('insertMany expects an array of documents.');
    const docs = this.storage.readDocuments(db, coll);
    const ids = [];
    for (const raw of documents) {
      const prepared = this.prepareDocument(raw);
      this.assertSchema(db, coll, prepared);
      if (docs.some((d) => d._id === prepared._id)) {
        throw new Error(`Duplicate _id "${prepared._id}" already exists in "${coll}".`);
      }
      docs.push(prepared);
      ids.push(prepared._id);
    }
    this.storage.writeDocuments(db, coll, docs);
    this.afterWrite(db, coll, docs);
    return { insertedIds: ids, insertedCount: ids.length };
  }

  /**
   * Apply an update spec to a document (mutates a fresh clone).
   * Supports operator updates { $set: {...}, $unset: [...] } as well as
   * whole-document replacement (keys other than _id are replaced).
   */
  applyUpdate(original, update) {
    if (update === null || typeof update !== 'object' || Array.isArray(update)) {
      throw new Error('Update must be a JSON object.');
    }
    const keys = Object.keys(update);
    const isOperatorUpdate = keys.length > 0 && keys.every((k) => k.startsWith('$'));

    if (isOperatorUpdate) {
      const next = JSON.parse(JSON.stringify(original));
      for (const [op, spec] of Object.entries(update)) {
        if (op === '$set') {
          if (typeof spec !== 'object' || spec === null) throw new Error('$set expects an object.');
          for (const [path, value] of Object.entries(spec)) setPath(next, path.split('.'), value);
        } else if (op === '$unset') {
          const paths = Array.isArray(spec) ? spec : Object.keys(spec || {});
          for (const path of paths) unsetPath(next, path.split('.'));
        } else {
          throw new Error(`Unsupported update operator "${op}". Supported: $set, $unset.`);
        }
      }
      return next;
    }

    // Replacement update: swap everything except _id.
    const next = JSON.parse(JSON.stringify(update));
    next._id = original._id;
    return next;
  }

  /**
   * updateOne / updateMany.
   * Returns { matched, modified }.
   * Pre-images of every modified document are written to the history log
   * before the collection file changes, so revisions can be restored.
   */
  update(db, coll, filter, update, { many = false } = {}) {
    const docs = this.storage.readDocuments(db, coll);
    let matched = 0;
    let modified = 0;
    const preImages = [];
    const updated = docs.map((doc) => {
      if (!matches(doc, filter)) return doc;
      matched++;
      if (!many && modified >= 1) return doc; // updateOne: only first match changes
      modified++;
      const next = this.applyUpdate(doc, update);
      this.assertSchema(db, coll, next); // throws before anything is written
      preImages.push(doc);
      return next;
    });
    if (modified > 0) {
      this.pushHistory(db, coll, 'update', preImages);
      this.storage.writeDocuments(db, coll, updated);
      this.afterWrite(db, coll, updated);
    }
    return { matched, modified };
  }

  updateOne(db, coll, filter, update) {
    return this.update(db, coll, filter, update, { many: false });
  }

  updateMany(db, coll, filter, update) {
    return this.update(db, coll, filter, update, { many: true });
  }

  /**
   * deleteOne / deleteMany.
   * Returns { deleted }. Removed documents go to the history log first.
   */
  delete(db, coll, filter, { many = false } = {}) {
    const docs = this.storage.readDocuments(db, coll);
    const kept = [];
    const removed = [];
    let deleted = 0;
    for (const doc of docs) {
      const hit = matches(doc, filter);
      if (hit && (many || deleted === 0)) {
        deleted++;
        removed.push(doc);
        continue;
      }
      kept.push(doc);
    }
    if (deleted > 0) {
      this.pushHistory(db, coll, 'delete', removed);
      this.storage.writeDocuments(db, coll, kept);
      this.afterWrite(db, coll, kept);
    }
    return { deleted };
  }

  deleteOne(db, coll, filter) {
    return this.delete(db, coll, filter, { many: false });
  }

  deleteMany(db, coll, filter) {
    return this.delete(db, coll, filter, { many: true });
  }

  count(db, coll, filter = {}) {
    const docs = this.storage.readDocuments(db, coll);
    return { count: docs.filter((d) => matches(d, filter)).length };
  }

  /** Run an aggregation pipeline (see query.aggregate for supported stages). */
  aggregate(db, coll, pipeline) {
    const docs = this.storage.readDocuments(db, coll);
    const result = aggregate(docs, pipeline, {
      // $lookup needs to read the joined collection from the same engine.
      loadColl: (name) => this.storage.readDocuments(db, name),
    });
    return { documents: result, total: docs.length };
  }

  /* ---------------------------------------------------------------- */
  /* Indexes (sidecar value→ids maps used to prune scans)              */
  /* ---------------------------------------------------------------- */

  idxFile(db, coll) {
    return `${coll}.ndjson.idx.json`;
  }

  loadIndexes(db, coll) {
    const store = this.storage.readSidecar(db, this.idxFile(db, coll));
    return store && typeof store === 'object' ? store.indexes || {} : {};
  }

  /** All indexes on a collection: [{ field, entryCount, createdAt }]. */
  listIndexes(db, coll) {
    return Object.values(this.loadIndexes(db, coll)).map((idx) => ({
      field: idx.field,
      entryCount: Array.isArray(idx.entries) ? idx.entries.length : 0,
      createdAt: idx.createdAt,
    }));
  }

  createIndex(db, coll, field) {
    if (typeof field !== 'string' || !/^[\w.-]{1,128}$/.test(field)) {
      throw new Error(`Invalid index field "${field}". Use letters, digits, _ . or - .`);
    }
    const docs = this.storage.readDocuments(db, coll);
    const entries = buildIndexEntries(docs, field);
    const store = { indexes: this.loadIndexes(db, coll) };
    store.indexes[field] = { field, entries, createdAt: new Date().toISOString() };
    this.storage.writeSidecar(db, this.idxFile(db, coll), store);
    return { field, entries: entries.length, documents: docs.length };
  }

  dropIndex(db, coll, field) {
    const store = { indexes: this.loadIndexes(db, coll) };
    delete store.indexes[field];
    this.storage.writeSidecar(db, this.idxFile(db, coll), store);
    return { ok: true };
  }

  /** Rebuild every persisted index after a collection write. */
  afterWrite(db, coll, docs) {
    const indexes = this.loadIndexes(db, coll);
    const fields = Object.keys(indexes);
    if (fields.length === 0) return;
    const store = { indexes: {} };
    for (const field of fields) {
      store.indexes[field] = {
        field,
        entries: buildIndexEntries(docs, field),
        createdAt: indexes[field].createdAt,
      };
    }
    this.storage.writeSidecar(db, this.idxFile(db, coll), store);
  }

  /* ---------------------------------------------------------------- */
  /* Schema validation (per-collection rules)                          */
  /* ---------------------------------------------------------------- */

  schemaFile(db, coll) {
    return `${coll}.ndjson.schema.json`;
  }

  /** Current rules or null: { required: [field...], properties: { field: { type, enum } } }. */
  getSchema(db, coll) {
    return this.storage.readSidecar(db, this.schemaFile(db, coll));
  }

  setSchema(db, coll, rules) {
    const clean = validateSchemaRules(rules);
    this.storage.writeSidecar(db, this.schemaFile(db, coll), clean);
    // Immediately surface existing documents that already violate the rules.
    const violations = [];
    const docs = this.storage.readDocuments(db, coll);
    for (const doc of docs) {
      try {
        this.assertSchema(db, coll, doc);
      } catch (err) {
        violations.push(err.message);
        if (violations.length >= 5) break;
      }
    }
    return { rules: clean, violations };
  }

  clearSchema(db, coll) {
    this.storage.removeSidecar(db, this.schemaFile(db, coll));
    return { ok: true };
  }

  /** Throw a descriptive error when a document violates the collection rules. */
  assertSchema(db, coll, doc) {
    const rules = this.getSchema(db, coll);
    if (!rules) return;
    for (const field of rules.required || []) {
      if (getPath(doc, field) === undefined) {
        throw new Error(`Schema validation failed for "${coll}": "${field}" is required.`);
      }
    }
    for (const [field, def] of Object.entries(rules.properties || {})) {
      const val = getPath(doc, field);
      if (val === undefined) continue;
      if (def.type) {
        const t = val === null ? 'null' : Array.isArray(val) ? 'array' : typeof val;
        if (t !== def.type) {
          throw new Error(
            `Schema validation failed for "${coll}": "${field}" must be ${def.type} (got ${t}).`
          );
        }
      }
      if (Array.isArray(def.enum) && !def.enum.some((e) => deepEqual(e, val))) {
        throw new Error(
          `Schema validation failed for "${coll}": "${field}" must be one of ${JSON.stringify(def.enum)}.`
        );
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* History (automatic revision log)                                  */
  /* ---------------------------------------------------------------- */

  histFile(db, coll) {
    return `${coll}.ndjson.hist.json`;
  }

  readHistory(db, coll) {
    const store = this.storage.readSidecar(db, this.histFile(db, coll));
    return store && Array.isArray(store.entries) ? store : { entries: [] };
  }

  /** Record pre-images of documents about to change (update/delete). */
  pushHistory(db, coll, op, docs) {
    if (!docs || docs.length === 0) return;
    const store = this.readHistory(db, coll);
    const stamp = new Date().toISOString();
    for (const doc of docs) {
      store.entries.push({ revId: crypto.randomUUID(), at: stamp, op, doc });
    }
    while (store.entries.length > HISTORY_LIMIT) store.entries.shift();
    this.storage.writeSidecar(db, this.histFile(db, coll), store);
  }

  /** Revisions, newest first; narrow to one document with id. */
  listHistory(db, coll, { id, limit = 50 } = {}) {
    let entries = this.readHistory(db, coll).entries;
    if (id) entries = entries.filter((e) => e.doc && e.doc._id === id);
    return entries.slice(-limit).reverse();
  }

  /** Reinsert/replace a document from a recorded revision (keeps its _id). */
  restoreRevision(db, coll, revId) {
    const entry = this.readHistory(db, coll).entries.find((e) => e.revId === revId);
    if (!entry) throw new Error(`Revision "${revId}" not found in "${coll}".`);
    const doc = JSON.parse(JSON.stringify(entry.doc));
    const docs = this.storage.readDocuments(db, coll);
    const i = docs.findIndex((d) => d._id === doc._id);
    if (i >= 0) docs[i] = doc;
    else docs.push(doc);
    this.storage.writeDocuments(db, coll, docs);
    this.afterWrite(db, coll, docs);
    return { restoredId: doc._id, op: entry.op };
  }

  /* ---------------------------------------------------------------- */
  /* Watch (change feed for the HTTP bridge & integrations)            */
  /* ---------------------------------------------------------------- */

  /**
   * Subscribe to writes in a database. coll === null watches every
   * collection in db. Returns an unsubscribe function. Emits
   * { db, coll, at } after a 150 ms write-burst debounce.
   */
  watch(db, coll, listener) {
    if (!this._watchState) this._watchState = { watcher: null, listeners: new Set() };
    const state = this._watchState;
    const entry = { db, coll: coll || null, listener, timer: null };
    state.listeners.add(entry);

    if (!state.watcher) {
      try {
        state.watcher = fs.watch(this.dataDir, { recursive: true }, (_event, filename) => {
          const rel = String(filename || '').replace(/\\/g, '/');
          const parts = rel.split('/');
          const fdb = parts[0];
          const fname = parts[1] || '';
          const fcoll = fname.endsWith('.ndjson') ? fname.slice(0, -'.ndjson'.length) : null;
          if (!fcoll) return;
          for (const l of state.listeners) {
            if (l.db !== fdb) continue;
            if (l.coll && l.coll !== fcoll) continue;
            this.scheduleWatchEmit(l);
          }
        });
        state.watcher.on('error', () => {
          try { state.watcher.close(); } catch { /* already closed */ }
          state.watcher = null;
        });
      } catch (err) {
        state.listeners.delete(entry);
        throw new Error(`Watch unavailable on this platform: ${err.message}`);
      }
    }

    return () => {
      clearTimeout(entry.timer);
      state.listeners.delete(entry);
      if (state.listeners.size === 0 && state.watcher) {
        try { state.watcher.close(); } catch { /* already closed */ }
        state.watcher = null;
      }
    };
  }

  scheduleWatchEmit(entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      try {
        entry.listener({ db: entry.db, coll: entry.coll, at: Date.now() });
      } catch {
        /* listener errors never break the watcher */
      }
    }, 150);
  }

  /* ---------------------------------------------------------------- */
  /* Files: GridFS-style binary storage inside the database            */
  /* ---------------------------------------------------------------- */

  /**
   * Store a binary file (image, PDF, audio, ...) inside the database.
   * Bytes are base64-encoded into a document of the hidden `_files`
   * collection, so they persist in the same NDJSON file hierarchy.
   * opts: { filename, data (Buffer), contentType, metadata }
   */
  putFile(db, opts = {}) {
    const { filename, data } = opts;
    if (typeof filename !== 'string' || !filename.trim() || filename.length > 200) {
      throw new Error('A file name (max 200 chars) is required.');
    }
    if (!Buffer.isBuffer(data) || data.length === 0) {
      throw new Error('File content is empty.');
    }
    if (data.length > MAX_FILE_BYTES) {
      throw new Error(
        `File exceeds the ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB limit ` +
        `(${(data.length / 1024 / 1024).toFixed(1)} MB). Set POCKETDB_MAX_FILE_MB to raise it.`
      );
    }
    const doc = {
      _id: objectId(),
      filename: filename.trim(),
      contentType: opts.contentType || guessContentType(filename),
      size: data.length,
      data: data.toString('base64'),
      metadata: opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {},
      uploadedAt: new Date().toISOString(),
    };
    this.insertOne(db, FILES_COLLECTION, doc);
    const { data: _omit, ...meta } = doc;
    return meta;
  }

  /** Fetch one file: metadata plus base64 payload. */
  getFile(db, id) {
    const doc = this.findOne(db, FILES_COLLECTION, { filter: { _id: id } });
    if (!doc) return null;
    const { data, ...meta } = doc;
    return { ...meta, base64: data };
  }

  /** List file metadata (payload omitted), newest first. */
  listFiles(db) {
    const { documents } = this.find(db, FILES_COLLECTION, { sort: { uploadedAt: -1 } });
    return documents.map(({ data, ...meta }) => meta);
  }

  deleteFile(db, id) {
    return this.deleteOne(db, FILES_COLLECTION, { _id: id });
  }

  /** Static info about the engine (shown in the studio status bar). */
  info() {
    return {
      name: 'PocketDB Engine',
      version: '1.2.0',
      dataDir: this.dataDir,
      format: 'NDJSON (one JSON document per line)',
      encrypted: this.storage.codec.enabled,
    };
  }
}

/** Validate user-supplied schema rules before persisting them. */
function validateSchemaRules(rules) {
  if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) {
    throw new Error(
      'Schema rules must be an object like { "required": ["field"], "properties": { "field": { "type": "string", "enum": [...] } } }.'
    );
  }
  const clean = {};
  if (rules.required !== undefined && rules.required !== null) {
    if (!Array.isArray(rules.required) || rules.required.some((f) => typeof f !== 'string')) {
      throw new Error('"required" must be an array of field names.');
    }
    clean.required = rules.required;
  }
  if (rules.properties !== undefined && rules.properties !== null) {
    if (typeof rules.properties !== 'object' || Array.isArray(rules.properties)) {
      throw new Error('"properties" must be an object of field rules.');
    }
    clean.properties = {};
    for (const [field, def] of Object.entries(rules.properties)) {
      if (def === null || def === undefined) continue;
      if (typeof def !== 'object' || Array.isArray(def)) {
        throw new Error(`Property "${field}" must be an object like { "type": "string" }.`);
      }
      const d = {};
      if (def.type !== undefined) {
        if (!SCHEMA_TYPES.includes(def.type)) {
          throw new Error(`Property "${field}": unknown type "${def.type}". Types: ${SCHEMA_TYPES.join(', ')}.`);
        }
        d.type = def.type;
      }
      if (def.enum !== undefined) {
        if (!Array.isArray(def.enum)) throw new Error(`Property "${field}": "enum" must be an array.`);
        d.enum = def.enum;
      }
      if (Object.keys(d).length > 0) clean.properties[field] = d;
    }
    if (Object.keys(clean.properties).length === 0) delete clean.properties;
  }
  if (Object.keys(clean).length === 0) {
    throw new Error('Schema rules need at least "required" or "properties".');
  }
  return clean;
}

module.exports = { PocketEngine };
