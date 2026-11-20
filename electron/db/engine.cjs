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
const TRASH_LIMIT = 500; // deleted documents kept per database
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

/** Type-tagged key for a tuple of values (compound index). */
function compoundKey(vals) {
  return JSON.stringify(vals.map(indexKey));
}

/** Scalar values only — compound pruning stays safe and predictable. */
function isScalar(v) {
  return v === null || (typeof v !== 'object' && typeof v !== 'function');
}

/**
 * Build sorted index entries [{ v, ids }] for one or more fields. Array
 * fields are indexed per element (multikey, single-field only). Missing
 * values are not indexed (Mongo behavior).
 */
function buildIndexEntries(docs, fields) {
  const list = Array.isArray(fields) ? fields : [fields];
  const map = new Map();
  for (const d of docs) {
    if (list.length === 1) {
      const v = getPath(d, list[0]);
      if (v === undefined) continue;
      for (const val of Array.isArray(v) ? v : [v]) {
        const k = indexKey(val);
        if (!map.has(k)) map.set(k, { v: val, ids: [] });
        map.get(k).ids.push(d._id);
      }
    } else {
      const vals = list.map((f) => getPath(d, f));
      if (vals.some((v) => v === undefined)) continue;
      const k = compoundKey(vals);
      if (!map.has(k)) map.set(k, { v: vals, ids: [] });
      map.get(k).ids.push(d._id);
    }
  }
  return [...map.values()].sort((a, b) => {
    const av = Array.isArray(a.v) ? a.v[0] : a.v;
    const bv = Array.isArray(b.v) ? b.v[0] : b.v;
    const c = cmp(av, bv);
    return (c === null ? fallbackCmp(av, bv) : c);
  });
}

/** Equality / $in values a predicate can prune with, or null. */
function equalityValues(cond) {
  if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) return [cond];
  if (Object.keys(cond).every((k) => k === '$eq' || k === '$options')) return [cond.$eq];
  if (Object.keys(cond).every((k) => k === '$in')) {
    return Array.isArray(cond.$in) ? cond.$in : null;
  }
  return null;
}

/**
 * Pick a usable index for equality / $in / $eq predicates — single-field
 * or compound (every indexed field must be constrained). Returns
 * { field, ids:Set } or null (fall back to a full scan). Operators that
 * can't prune safely ($ne, $regex, $exists, $not, ...) are skipped.
 */
function pickIndexFilter(filter, indexes) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return null;
  for (const [label, idx] of Object.entries(indexes || {})) {
    const fields = Array.isArray(idx.fields) ? idx.fields : [idx.field];
    if (!fields.every((f) => f in filter)) continue;
    const perField = [];
    let usable = true;
    for (const f of fields) {
      const wanted = equalityValues(filter[f]);
      if (!wanted || wanted.some((v) => !isScalar(v))) {
        usable = false;
        break;
      }
      perField.push(wanted);
    }
    if (!usable) continue;

    // Cartesian product of per-field candidates (usually just one each).
    let combos = [[]];
    for (const wanted of perField) {
      const next = [];
      for (const combo of combos) for (const v of wanted) next.push([...combo, v]);
      combos = next;
      if (combos.length > 256) break; // runaway $in guard
    }
    if (combos.length > 256) continue;

    const byKey = new Map(
      (idx.entries || []).map((e) => [compoundKey(Array.isArray(e.v) ? e.v : [e.v]), e.ids])
    );
    const ids = new Set();
    for (const combo of combos) {
      const hit = byKey.get(compoundKey(combo));
      if (hit) for (const id of hit) ids.add(id);
    }
    return { field: label, ids };
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
      collections: this.listCollections(name, { includeSystem: false, includeViews: true }),
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

  listCollections(db, { includeSystem = true, includeViews = true } = {}) {
    let names = this.storage.listCollections(db);
    if (!includeSystem) {
      // Hidden engine collections (e.g. the `_files` file store).
      names = names.filter((coll) => !coll.startsWith('_'));
    }
    const collections = names.map((coll) => ({
      name: coll,
      count: this.storage.readDocuments(db, coll).length,
      size: this.storage.collectionSize(db, coll),
    }));
    if (includeViews) {
      // Saved views behave like read-only collections. Counting runs the
      // pipeline, so a broken view reports `count: null` instead of throwing.
      for (const view of this.listViews(db)) {
        let count = null;
        try {
          count = this.findView(db, view, {}).total;
        } catch {
          count = null;
        }
        collections.push({
          name: view.name,
          count,
          size: 0,
          view: true,
          source: view.coll,
          viewId: view.id,
        });
      }
    }
    return collections;
  }

  createCollection(db, coll) {
    if (this.getView(db, coll)) {
      throw new Error(`"${coll}" is already the name of a saved view in "${db}".`);
    }
    this.storage.createCollection(db, coll);
    return { ok: true };
  }

  dropCollection(db, coll) {
    const view = this.getView(db, coll);
    if (view) {
      this.deleteView(db, view.id);
      return { ok: true, view: true };
    }
    // Keep dropped documents restorable from the trash (bounded).
    try {
      const docs = this.storage.readDocuments(db, coll);
      if (docs.length > 0) this.pushTrash(db, coll, docs);
    } catch {
      /* best effort — never block the drop on the trash sidecar */
    }
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
   * A saved view name runs its pipeline first (read-only results).
   */
  find(db, coll, opts = {}) {
    const view = this.getView(db, coll);
    if (view) return this.findView(db, view, opts);
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

  /** Run a saved view's pipeline, then apply filter/sort/paging in memory. */
  findView(db, view, opts = {}) {
    const base = this.storage.readDocuments(db, view.coll);
    let docs = aggregate(base, view.pipeline || [], {
      loadColl: (name) => this.storage.readDocuments(db, name),
    });
    const filter = opts.filter || {};
    if (filter && typeof filter === 'object' && !Array.isArray(filter) && Object.keys(filter).length > 0) {
      docs = docs.filter((d) => matches(d, filter));
    }
    const total = docs.length;
    if (opts.sort) docs = [...docs].sort(makeComparator(opts.sort));
    const skip = Number.isInteger(opts.skip) && opts.skip > 0 ? opts.skip : 0;
    docs = docs.slice(skip);
    if (Number.isInteger(opts.limit) && opts.limit >= 0) docs = docs.slice(0, opts.limit);
    if (opts.projection) docs = docs.map((d) => projectDoc(d, opts.projection));
    return { documents: docs, total, view: true, source: view.coll };
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

  /** Saved views are read-only projections of a source collection. */
  assertWritable(db, coll) {
    const view = this.getView(db, coll);
    if (view) {
      throw new Error(
        `"${coll}" is a read-only view of "${view.coll}". Edit the source collection instead.`
      );
    }
  }

  /**
   * Enforce every unique index on a collection over the resulting document
   * set. Throws with the offending field/key before anything is written.
   */
  assertUnique(db, coll, docs) {
    const indexes = this.loadIndexes(db, coll);
    for (const idx of Object.values(indexes)) {
      if (!idx.unique) continue;
      const fields = Array.isArray(idx.fields) ? idx.fields : [idx.field];
      const seen = new Map();
      const check = (vals, id) => {
        const k = compoundKey(vals);
        if (seen.has(k)) {
          throw new Error(
            `Unique index violation on "${idx.field}" in "${coll}": duplicate value ${JSON.stringify(
              vals.length === 1 ? vals[0] : vals
            )}.`
          );
        }
        seen.set(k, id);
      };
      for (const doc of docs) {
        const vals = fields.map((f) => getPath(doc, f));
        if (vals.some((v) => v === undefined || v === null)) continue; // sparse, Mongo-style
        // Single-field multikey indexes enforce uniqueness per array element.
        if (fields.length === 1 && Array.isArray(vals[0])) {
          for (const el of vals[0]) {
            if (el === undefined || el === null) continue;
            check([el], doc._id);
          }
        } else {
          check(vals, doc._id);
        }
      }
    }
  }

  insertOne(db, coll, doc) {
    this.assertWritable(db, coll);
    const prepared = this.prepareDocument(doc);
    this.assertSchema(db, coll, prepared);
    const docs = this.storage.readDocuments(db, coll);
    if (docs.some((d) => d._id === prepared._id)) {
      throw new Error(`Duplicate _id "${prepared._id}" already exists in "${coll}".`);
    }
    docs.push(prepared);
    this.assertUnique(db, coll, docs);
    this.storage.writeDocuments(db, coll, docs);
    this.afterWrite(db, coll, docs);
    return { insertedId: prepared._id };
  }

  insertMany(db, coll, documents) {
    if (!Array.isArray(documents)) throw new Error('insertMany expects an array of documents.');
    this.assertWritable(db, coll);
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
    this.assertUnique(db, coll, docs);
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
    this.assertWritable(db, coll);
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
      this.assertUnique(db, coll, updated);
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
    this.assertWritable(db, coll);
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
      this.pushTrash(db, coll, removed);
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
    const view = this.getView(db, coll);
    if (view) return { count: this.findView(db, view, { filter }).total };
    const docs = this.storage.readDocuments(db, coll);
    return { count: docs.filter((d) => matches(d, filter)).length };
  }

  /** Run an aggregation pipeline (see query.aggregate for supported stages). */
  aggregate(db, coll, pipeline) {
    const view = this.getView(db, coll);
    const loadColl = (name) => this.storage.readDocuments(db, name);
    const source = view
      ? aggregate(this.storage.readDocuments(db, view.coll), view.pipeline || [], { loadColl })
      : this.storage.readDocuments(db, coll);
    const result = aggregate(source, pipeline, {
      // $lookup needs to read the joined collection from the same engine.
      loadColl,
    });
    return { documents: result, total: source.length, view: Boolean(view) };
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

  /** All indexes on a collection: [{ field, fields, unique, entryCount, createdAt }]. */
  listIndexes(db, coll) {
    return Object.values(this.loadIndexes(db, coll)).map((idx) => ({
      field: idx.field,
      fields: Array.isArray(idx.fields) ? idx.fields : [idx.field],
      unique: Boolean(idx.unique),
      entryCount: Array.isArray(idx.entries) ? idx.entries.length : 0,
      createdAt: idx.createdAt,
    }));
  }

  /**
   * Create a single-field or compound ("a+b") index. Unique indexes reject
   * duplicate values on insert/update (sparse: missing/null values are skipped).
   */
  createIndex(db, coll, field, { unique = false } = {}) {
    this.assertWritable(db, coll);
    if (typeof field !== 'string' || !/^[\w.-]{1,128}(\+[\w.-]{1,128})*$/.test(field)) {
      throw new Error(`Invalid index field "${field}". Use letters, digits, _ . - and + for compound fields.`);
    }
    const fields = field.split('+');
    const docs = this.storage.readDocuments(db, coll);
    const entries = buildIndexEntries(docs, fields);
    if (unique) {
      const seen = new Map();
      for (const e of entries) {
        if (e.ids.length > 1) {
          throw new Error(
            `Cannot create unique index on "${field}": value ${JSON.stringify(
              Array.isArray(e.v) && fields.length === 1 ? e.v[0] : e.v
            )} appears in ${e.ids.length} documents.`
          );
        }
        seen.set(compoundKey(Array.isArray(e.v) ? e.v : [e.v]), true);
      }
    }
    const store = { indexes: this.loadIndexes(db, coll) };
    store.indexes[field] = {
      field,
      fields,
      unique: Boolean(unique),
      entries,
      createdAt: new Date().toISOString(),
    };
    this.storage.writeSidecar(db, this.idxFile(db, coll), store);
    return { field, fields, unique: Boolean(unique), entries: entries.length, documents: docs.length };
  }

  dropIndex(db, coll, field) {
    this.assertWritable(db, coll);
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
    for (const label of fields) {
      const idx = indexes[label];
      const idxFields = Array.isArray(idx.fields) ? idx.fields : [idx.field];
      store.indexes[label] = {
        field: idx.field,
        fields: idxFields,
        unique: Boolean(idx.unique),
        entries: buildIndexEntries(docs, idxFields),
        createdAt: idx.createdAt,
      };
    }
    this.storage.writeSidecar(db, this.idxFile(db, coll), store);
  }

  /* ---------------------------------------------------------------- */
  /* Explain (query plan without executing the full result)            */
  /* ---------------------------------------------------------------- */

  /**
   * Report how find() would satisfy a filter: which index prunes the scan,
   * how many documents are examined, and where the time goes.
   */
  explain(db, coll, { filter = {}, sort = null } = {}) {
    const view = this.getView(db, coll);
    if (view) {
      const t0 = process.hrtime.bigint();
      const res = this.findView(db, view, { filter });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      return {
        collection: coll,
        view: true,
        source: view.coll,
        documents: null,
        indexUsed: null,
        scanned: null,
        matched: res.total,
        sort: sort ? { fields: Object.keys(sort), inMemory: true } : null,
        timeMs: Math.round(ms * 100) / 100,
        plan: [
          { stage: 'VIEW', pipelineStages: (view.pipeline || []).length },
          { stage: 'MATCH', examined: res.total },
          ...(sort ? [{ stage: 'SORT', inMemory: true }] : []),
        ],
      };
    }
    const t0 = process.hrtime.bigint();
    const all = this.storage.readDocuments(db, coll);
    const indexes = this.loadIndexes(db, coll);
    const pick = pickIndexFilter(filter, indexes);
    let source = all;
    if (pick) source = all.filter((d) => pick.ids.has(d._id));
    const matched = source.filter((d) => matches(d, filter));
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    return {
      collection: coll,
      documents: all.length,
      indexUsed: pick ? { field: pick.field, candidates: pick.ids.size } : null,
      scanned: source.length,
      matched: matched.length,
      sort: sort ? { fields: Object.keys(sort), inMemory: true } : null,
      timeMs: Math.round(ms * 100) / 100,
      plan: [
        pick
          ? { stage: 'IXSCAN', index: pick.field, keys: pick.ids.size }
          : { stage: 'COLLSCAN', examined: all.length },
        { stage: 'FETCH', examined: source.length },
        { stage: 'MATCH', matched: matched.length },
        ...(sort ? [{ stage: 'SORT', inMemory: true, fields: Object.keys(sort) }] : []),
      ],
    };
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
    this.assertUnique(db, coll, docs);
    this.storage.writeDocuments(db, coll, docs);
    this.afterWrite(db, coll, docs);
    return { restoredId: doc._id, op: entry.op };
  }

  /* ---------------------------------------------------------------- */
  /* Saved views (persistent read-only pipelines)                      */
  /* ---------------------------------------------------------------- */

  viewsFile(db) {
    return '_views.json';
  }

  listViews(db) {
    const store = this.storage.readSidecar(db, this.viewsFile(db));
    return store && Array.isArray(store.views) ? store.views : [];
  }

  getView(db, name) {
    return this.listViews(db).find((v) => v.name === name) || null;
  }

  /**
   * Create or update a saved view: { name, coll, pipeline }. The view name
   * becomes a read-only virtual collection backed by `coll`'s pipeline.
   */
  saveView(db, { id, name, coll, pipeline } = {}) {
    if (typeof name !== 'string' || !/^[\w-]{1,64}$/.test(name)) {
      throw new Error(`Invalid view name "${name}". Use 1-64 chars: a-z, A-Z, 0-9, _ or -.`);
    }
    if (this.storage.listCollections(db).includes(name)) {
      throw new Error(`"${name}" is already a collection — pick another view name.`);
    }
    if (!Array.isArray(pipeline) || pipeline.length === 0) {
      throw new Error('A view needs a non-empty pipeline.');
    }
    if (!this.storage.listCollections(db).includes(coll)) {
      throw new Error(`Source collection "${coll}" does not exist.`);
    }
    const views = this.listViews(db);
    const existing = views.find((v) => (id && v.id === id) || v.name === name);
    if (views.some((v) => v.name === name && v.id !== existing?.id)) {
      throw new Error(`A saved view named "${name}" already exists in "${db}".`);
    }
    const now = new Date().toISOString();
    const entry = {
      id: existing?.id || crypto.randomUUID(),
      name,
      coll,
      pipeline,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (existing) views[views.indexOf(existing)] = entry;
    else views.push(entry);
    this.storage.writeSidecar(db, this.viewsFile(db), { views });
    return entry;
  }

  deleteView(db, id) {
    const views = this.listViews(db).filter((v) => v.id !== id);
    this.storage.writeSidecar(db, this.viewsFile(db), { views });
    return { ok: true };
  }

  /* ---------------------------------------------------------------- */
  /* Trash (soft-deleted documents, restorable)                        */
  /* ---------------------------------------------------------------- */

  trashFile(db) {
    return '_trash.json';
  }

  readTrash(db) {
    const store = this.storage.readSidecar(db, this.trashFile(db));
    return store && Array.isArray(store.entries) ? store : { entries: [] };
  }

  /** Keep deleted documents restorable (bounded per database). */
  pushTrash(db, coll, docs) {
    if (!docs || docs.length === 0) return;
    const store = this.readTrash(db);
    const at = new Date().toISOString();
    for (const doc of docs) {
      store.entries.unshift({ trashId: crypto.randomUUID(), coll, at, doc });
    }
    while (store.entries.length > TRASH_LIMIT) store.entries.pop();
    this.storage.writeSidecar(db, this.trashFile(db), store);
  }

  /** List trashed documents, newest first (optionally one collection). */
  listTrash(db, { coll, limit = 200 } = {}) {
    let entries = this.readTrash(db).entries;
    if (coll) entries = entries.filter((e) => e.coll === coll);
    return entries.slice(0, limit);
  }

  /** Put a trashed document back into its original collection. */
  restoreTrash(db, trashId) {
    const store = this.readTrash(db);
    const entry = store.entries.find((e) => e.trashId === trashId);
    if (!entry) throw new Error('Trash entry not found — it may have been purged.');
    this.assertWritable(db, entry.coll);
    const docs = this.storage.readDocuments(db, entry.coll);
    if (docs.some((d) => d._id === entry.doc._id)) {
      throw new Error(
        `A document with _id "${entry.doc._id}" already exists in "${entry.coll}" — resolve the conflict first.`
      );
    }
    docs.push(entry.doc);
    this.assertUnique(db, entry.coll, docs);
    this.storage.writeDocuments(db, entry.coll, docs);
    this.afterWrite(db, entry.coll, docs);
    store.entries = store.entries.filter((e) => e.trashId !== trashId);
    this.storage.writeSidecar(db, this.trashFile(db), store);
    return { restoredId: entry.doc._id, coll: entry.coll };
  }

  purgeTrash(db, trashId) {
    const store = this.readTrash(db);
    store.entries = store.entries.filter((e) => e.trashId !== trashId);
    this.storage.writeSidecar(db, this.trashFile(db), store);
    return { ok: true };
  }

  emptyTrash(db) {
    this.storage.writeSidecar(db, this.trashFile(db), { entries: [] });
    return { ok: true };
  }

  /* ---------------------------------------------------------------- */
  /* Schema analyzer (field distribution across documents)             */
  /* ---------------------------------------------------------------- */

  /**
   * Walk every document and summarize each dotted field path: how many
   * documents carry it, which JSON types appear, distinct values (capped)
   * and a few samples. Used by the visual schema analyzer.
   */
  analyzeSchema(db, coll) {
    const view = this.getView(db, coll);
    const docs = view
      ? this.findView(db, view, {}).documents
      : this.storage.readDocuments(db, coll);
    const fields = new Map();
    const DISTINCT_CAP = 200;

    const record = (path, value) => {
      let f = fields.get(path);
      if (!f) {
        f = { path, count: 0, types: {}, distinct: new Set(), samples: [], min: null, max: null };
        fields.set(path, f);
      }
      f.count++;
      const t = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      f.types[t] = (f.types[t] || 0) + 1;
      if (t !== 'object' && t !== 'array' && t !== 'function') {
        const key = JSON.stringify(value);
        if (f.distinct.size < DISTINCT_CAP) f.distinct.add(key);
        if (f.samples.length < 3 && !f.samples.some((s) => JSON.stringify(s) === key)) {
          f.samples.push(value);
        }
        if (t === 'number' || t === 'string') {
          if (f.min === null || value < f.min) f.min = value;
          if (f.max === null || value > f.max) f.max = value;
        }
      }
    };

    const walk = (obj, prefix) => {
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        record(path, v);
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
          walk(v, path);
        }
      }
    };

    for (const doc of docs) walk(doc, '');

    return {
      collection: coll,
      view: Boolean(view),
      documents: docs.length,
      fields: [...fields.values()]
        .map((f) => ({
          path: f.path,
          count: f.count,
          fillRate: docs.length ? Math.round((f.count / docs.length) * 1000) / 10 : 0,
          types: f.types,
          distinct: f.distinct.size,
          distinctCapped: f.distinct.size >= DISTINCT_CAP,
          samples: f.samples,
          min: f.min,
          max: f.max,
        }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    };
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
      version: '1.3.0',
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
