/**
 * PocketDB — Filesystem storage layer.
 *
 * On-disk layout (NDJSON: one JSON document per line):
 *
 *   <dataDir>/
 *     └── <database>/            (one folder per database)
 *          ├── <collection>.ndjson   (one file per collection)
 *          └── ...
 *
 * Writes are atomic (temp file + rename) so a crash can never leave a
 * half-written collection behind. All names are validated to prevent
 * path traversal.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Only allow safe filesystem names: letters, digits, underscore, hyphen. */
function assertValidName(name, kind) {
  if (typeof name !== 'string' || !/^[\w-]{1,64}$/.test(name)) {
    throw new Error(`Invalid ${kind} name "${name}". Use 1-64 chars: a-z, A-Z, 0-9, _ or -.`);
  }
}

/* --------------------- encryption at rest (optional) --------------------- */

const ENC_MAGIC = 'PDBENC1';

/**
 * AES-256-GCM envelope written to disk when a passphrase is configured:
 *
 *   PDBENC1 | salt(16) | iv(12) | authTag(16) | ciphertext
 *
 * The key is derived per file from the passphrase + a random salt, so two
 * files never share a keystream and a leaked file reveals nothing about
 * the passphrase directly. Plaintext files are still readable when a
 * passphrase is set (they get encrypted on the next write).
 */
function makeCodec(passphrase) {
  if (!passphrase) {
    return {
      enabled: false,
      encrypt: (buf) => buf,
      decrypt: (buf) => buf,
    };
  }
  return {
    enabled: true,
    encrypt(buf) {
      const salt = crypto.randomBytes(16);
      const key = crypto.scryptSync(passphrase, salt, 32);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([Buffer.from(ENC_MAGIC, 'ascii'), salt, iv, tag, ct]);
    },
    decrypt(buf) {
      if (buf.length <= 45 || buf.slice(0, 7).toString('ascii') !== ENC_MAGIC) {
        return buf; // not encrypted (legacy/plaintext) — read as-is
      }
      if (!passphrase) {
        throw new Error(
          'This data directory is encrypted. Reconnect with the passphrase to read it.'
        );
      }
      const salt = buf.slice(7, 23);
      const iv = buf.slice(23, 35);
      const tag = buf.slice(35, 51);
      const ct = buf.slice(51);
      const key = crypto.scryptSync(passphrase, salt, 32);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      try {
        return Buffer.concat([decipher.update(ct), decipher.final()]);
      } catch {
        throw new Error(
          'Wrong passphrase — the data in this directory could not be decrypted.'
        );
      }
    },
  };
}

/* --------------------- cross-process write locks --------------------- */

const LOCK_TIMEOUT_MS = 5000;
const LOCK_POLL_MS = 25;

/** Synchronous sleep (blocks the calling thread briefly). */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* thread not blockable — the poll loop still works */
  }
}

/**
 * Advisory cross-process lock around a collection write.
 *
 * Several processes can touch the same data directory at once (the studio,
 * the HTTP bridge, Node scripts). Every write is a read→modify→write of the
 * whole NDJSON file, so two writers running in parallel could silently drop
 * each other's changes. The lock serialises those cycles per file. A lock
 * left behind by a crashed process is stolen after the timeout.
 */
function withLock(file, fn) {
  const lockFile = `${file}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lockFile, 'wx'); // exclusive create: the lock
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let stale = false;
      try {
        stale = Date.now() - fs.statSync(lockFile).mtimeMs > LOCK_TIMEOUT_MS;
      } catch {
        /* vanished — the next loop iteration should acquire */
      }
      if (stale) {
        try {
          fs.rmSync(lockFile, { force: true });
        } catch {
          /* another process stole it first — keep waiting */
        }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for the write lock on ${path.basename(file)}. ` +
          'Another PocketDB process may be busy writing this collection.'
        );
      }
      sleepSync(LOCK_POLL_MS);
    }
  }
  try {
    // Keep the mtime fresh so staleness detection reflects the live holder.
    const now = new Date();
    try { fs.utimesSync(lockFile, now, now); } catch { /* best effort */ }
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
    try { fs.rmSync(lockFile, { force: true }); } catch { /* best effort */ }
  }
}

class FileStorage {
  constructor(rootDir, { passphrase } = {}) {
    this.root = rootDir;
    this.codec = makeCodec(passphrase);
    fs.mkdirSync(this.root, { recursive: true });
  }

  /* ------------------------- path helpers ------------------------- */

  dbDir(db) {
    return path.join(this.root, db);
  }

  collFile(db, coll) {
    return path.join(this.dbDir(db), `${coll}.ndjson`);
  }

  /* ------------------------- databases ---------------------------- */

  listDatabases() {
    return fs
      .readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  createDatabase(db) {
    assertValidName(db, 'database');
    fs.mkdirSync(this.dbDir(db), { recursive: true });
  }

  /** Drop a database and every collection file inside it. */
  dropDatabase(db) {
    assertValidName(db, 'database');
    fs.rmSync(this.dbDir(db), { recursive: true, force: true });
  }

  databaseExists(db) {
    return fs.existsSync(this.dbDir(db));
  }

  /* ------------------------ collections --------------------------- */

  listCollections(db) {
    if (!this.databaseExists(db)) return [];
    return fs
      .readdirSync(this.dbDir(db))
      .filter((f) => f.endsWith('.ndjson'))
      .map((f) => f.slice(0, -'.ndjson'.length));
  }

  createCollection(db, coll) {
    assertValidName(db, 'database');
    assertValidName(coll, 'collection');
    if (!this.databaseExists(db)) {
      throw new Error(`Database "${db}" does not exist.`);
    }
    const file = this.collFile(db, coll);
    if (!fs.existsSync(file)) fs.writeFileSync(file, '', 'utf8');
  }

  dropCollection(db, coll) {
    assertValidName(coll, 'collection');
    const file = this.collFile(db, coll);
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  /* -------------------------- documents --------------------------- */

  /** Parse an NDJSON collection file into an array of documents. */
  readDocuments(db, coll) {
    const file = this.collFile(db, coll);
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file);
    const text = this.codec.decrypt(raw).toString('utf8');
    const docs = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        docs.push(JSON.parse(trimmed));
      } catch (err) {
        // Skip (but report) corrupt lines instead of taking the whole DB down.
        console.error(`[pocketdb] corrupt line in ${coll}: ${err.message}`);
      }
    }
    return docs;
  }

  /** Atomically rewrite a collection file from an array of documents. */
  writeDocuments(db, coll, docs) {
    assertValidName(db, 'database');
    assertValidName(coll, 'collection');
    fs.mkdirSync(this.dbDir(db), { recursive: true });
    const file = this.collFile(db, coll);
    const body = Buffer.from(
      docs.map((d) => JSON.stringify(d)).join('\n') + (docs.length ? '\n' : ''),
      'utf8'
    );
    withLock(file, () => {
      const tmp = `${file}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      fs.writeFileSync(tmp, this.codec.encrypt(body));
      fs.renameSync(tmp, file);
    });
  }

  /** Approximate on-disk size of a collection file, in bytes. */
  collectionSize(db, coll) {
    const file = this.collFile(db, coll);
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  }

  /* --------------------------- sidecars ---------------------------- */

  /**
   * Internal per-collection sidecars (index maps, schema rules, history)
   * live next to their NDJSON file with a `.json` suffix — engine-managed,
   * encrypted when the codec is enabled, invisible to listCollections.
   */
  readSidecar(db, filename) {
    const file = path.join(this.dbDir(db), filename);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(this.codec.decrypt(fs.readFileSync(file)).toString('utf8'));
    } catch (err) {
      console.error(`[pocketdb] unreadable sidecar ${filename}: ${err.message}`);
      return null;
    }
  }

  writeSidecar(db, filename, value) {
    assertValidName(db, 'database');
    fs.mkdirSync(this.dbDir(db), { recursive: true });
    const file = path.join(this.dbDir(db), filename);
    const tmp = `${file}.tmp-${Date.now()}`;
    fs.writeFileSync(tmp, this.codec.encrypt(Buffer.from(JSON.stringify(value, null, 2), 'utf8')));
    fs.renameSync(tmp, file);
    return file;
  }

  removeSidecar(db, filename) {
    try {
      fs.rmSync(path.join(this.dbDir(db), filename), { force: true });
    } catch {
      /* best effort */
    }
  }
}

module.exports = { FileStorage, assertValidName };
