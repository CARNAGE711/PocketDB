/**
 * PocketDB — Import pipelines.
 *
 *  - parseDocsInput: turn pasted/file text (JSON array, NDJSON or CSV)
 *    into an array of documents. CSV gets a small RFC-4180-ish parser
 *    (quoted fields, escaped quotes, embedded commas/newlines) with
 *    automatic number/boolean coercion.
 *  - importDocuments: insert one document at a time so a bad row doesn't
 *    cancel the whole import; returns a per-run summary.
 *  - importFromMongo: mirror a real MongoDB server (mongodb:// URI) into
 *    the PocketDB data dir. BSON values are flattened to plain JSON
 *    (ObjectId → hex string, Date → ISO, Binary → { $binary }).
 */
'use strict';

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** Parse a CSV string into rows of string cells (handles quoted fields). */
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

/** Coerce a CSV cell into number / boolean / string. */
function coerceCell(value) {
  const v = value.trim();
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** CSV → documents (first row is the header; nested paths via dot-notation). */
function csvToDocs(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const doc = {};
    header.forEach((key, i) => {
      if (!key) return;
      const parts = key.split('.');
      let cur = doc;
      for (let j = 0; j < parts.length - 1; j++) {
        cur[parts[j]] = cur[parts[j]] || {};
        cur = cur[parts[j]];
      }
      cur[parts[parts.length - 1]] = coerceCell(cells[i] ?? '');
    });
    return doc;
  });
}

/* ------------------------------------------------------------------ */
/* Input dispatch                                                      */
/* ------------------------------------------------------------------ */

/**
 * Parse JSON (array or single object), NDJSON (one doc per line) or CSV
 * text into documents. Throws with a friendly message on bad input.
 */
function parseDocsInput(text, format) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  const fmt = (format || 'auto').toLowerCase();
  if (fmt === 'csv') return csvToDocs(trimmed);
  if (fmt === 'ndjson') {
    return trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, i) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          throw new Error(`NDJSON line ${i + 1} is not valid JSON: ${err.message}`);
        }
      });
  }
  if (fmt === 'json') {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`Not valid JSON: ${err.message}`);
    }
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  }
  // auto: try JSON array/object first, then NDJSON, then CSV
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return parseDocsInput(trimmed, 'json');
    } catch {
      /* fall through */
    }
  }
  if (trimmed.includes('\n')) {
    try {
      return parseDocsInput(trimmed, 'ndjson');
    } catch {
      /* fall through */
    }
  }
  return csvToDocs(trimmed);
}

/** Insert parsed documents one by one; tolerate individual failures. */
function importDocuments(engine, { db, coll, text, format }) {
  const docs = parseDocsInput(text, format);
  let inserted = 0;
  const errors = [];
  for (const doc of docs) {
    try {
      engine.insertOne(db, coll, doc);
      inserted++;
    } catch (err) {
      errors.push(err.message);
    }
  }
  return { total: docs.length, inserted, failed: docs.length - inserted, errors: errors.slice(0, 10) };
}

/* ------------------------------------------------------------------ */
/* MongoDB mirror                                                      */
/* ------------------------------------------------------------------ */

/** Flatten BSON into plain JSON-safe values. */
function bsonToPlain(v) {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'object') return v;
  if (v instanceof Date) return v.toISOString();
  if (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID') return v.toHexString();
  if (v._bsontype === 'Binary') return { $binary: Buffer.from(v.buffer).toString('base64') };
  if (v._bsontype === 'Decimal128') return v.toString();
  if (Array.isArray(v)) return v.map(bsonToPlain);
  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = bsonToPlain(val);
  return out;
}

/** Sanitize a Mongo namespace into the [\w-]{1,64} PocketDB format. */
function sanitizeName(raw, used) {
  let name = String(raw || '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
  if (!name) name = 'imported';
  let candidate = name;
  let n = 2;
  while (used.has(candidate)) candidate = `${name}-${n++}`;
  used.add(candidate);
  return candidate;
}

const MONGO_SKIP_DBS = new Set(['admin', 'config', 'local']);

/**
 * Mirror MongoDB collections into PocketDB.
 * opts: { uri, engine, dbs?: [names], limitPerColl?: number }
 * Returns a per-collection summary [{ from, to, imported, failed }].
 */
async function importFromMongo({ uri, engine, dbs, limitPerColl }) {
  let MongoClient;
  try {
    ({ MongoClient } = require('mongodb'));
  } catch {
    throw new Error('The MongoDB driver is not available. Install it with: npm install mongodb');
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    let names = Array.isArray(dbs) && dbs.length > 0 ? dbs : null;
    if (!names) {
      const list = await client.db().admin().listDatabases();
      names = list.databases.map((d) => d.name).filter((n) => !MONGO_SKIP_DBS.has(n));
    }
    const limit = Number(limitPerColl) > 0 ? Number(limitPerColl) : 0;
    const summary = [];
    const usedDb = new Set(engine.listDatabases().map((d) => d.name));

    for (const mongoDb of names) {
      const dbTo = sanitizeName(mongoDb, usedDb);
      const mdb = client.db(mongoDb);
      const colls = await mdb.listCollections().toArray();
      const usedColl = new Set();
      for (const c of colls) {
        const collTo = sanitizeName(c.name, usedColl);
        let cursor = mdb.collection(c.name).find({});
        if (limit) cursor = cursor.limit(limit);
        const raw = await cursor.toArray();
        let imported = 0;
        let failed = 0;
        for (const r of raw) {
          try {
            engine.insertOne(dbTo, collTo, bsonToPlain(r));
            imported++;
          } catch {
            failed++;
          }
        }
        summary.push({ from: `${mongoDb}.${c.name}`, to: `${dbTo}.${collTo}`, imported, failed });
      }
      if (colls.length === 0) summary.push({ from: mongoDb, to: dbTo, imported: 0, failed: 0, empty: true });
    }
    return summary;
  } finally {
    await client.close().catch(() => {});
  }
}

module.exports = { parseDocsInput, csvToDocs, importDocuments, importFromMongo, bsonToPlain };
