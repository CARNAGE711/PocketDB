/**
 * PocketDB — Database metadata store.
 *
 * Persists per-database presentation options (color tag, favorite) in
 * <userData>/pocketdb-database-meta.json, keyed by database name. Purely
 * cosmetic data — the storage layer itself is untouched.
 */
'use strict';

const fs = require('fs');
const path = require('path');

class DatabaseMetaStore {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  load() {
    try {
      const obj = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return obj && typeof obj === 'object' ? obj : {};
    } catch {
      return {};
    }
  }

  persist(obj) {
    const tmp = `${this.file}.tmp-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  list() {
    return this.load();
  }

  get(name) {
    return this.load()[name] || null;
  }

  /** Merge + persist metadata for one database. */
  set(name, meta) {
    const obj = this.load();
    obj[name] = {
      ...(obj[name] || {}),
      ...meta,
      updatedAt: new Date().toISOString(),
    };
    this.persist(obj);
    return obj[name];
  }

  remove(name) {
    const obj = this.load();
    if (obj[name]) {
      delete obj[name];
      this.persist(obj);
    }
  }
}

module.exports = { DatabaseMetaStore };
