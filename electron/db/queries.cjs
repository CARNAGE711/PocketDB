/**
 * PocketDB — Saved queries store.
 *
 * Persists the studio's per-collection filters (name + JSON text) as JSON
 * next to the app's user data: <userData>/pocketdb-saved-queries.json.
 * Same pattern as the connections store — atomic writes, no dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { assertValidName } = require('./storage.cjs');

class SavedQueriesStore {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  load() {
    try {
      const list = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  persist(list) {
    const tmp = `${this.file}.tmp-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  list() {
    return this.load();
  }

  /** Insert or update a saved query; assigns id/createdAt for new entries. */
  save({ id, db, coll, name, text }) {
    assertValidName(db, 'database');
    assertValidName(coll, 'collection');
    const cleanName = String(name || '').trim().slice(0, 80);
    if (!cleanName) throw new Error('A query name is required.');
    const cleanText = String(text || '{}').slice(0, 100000);
    try {
      JSON.parse(cleanText); // must be valid JSON to be runnable later
    } catch (err) {
      throw new Error(`Saved filter must be valid JSON: ${err.message}`);
    }

    const clean = { db, coll, name: cleanName, text: cleanText };
    const list = this.load();
    const existing = id ? list.findIndex((q) => q.id === id) : -1;
    if (existing >= 0) {
      clean.id = list[existing].id;
      clean.createdAt = list[existing].createdAt;
      list[existing] = clean;
    } else {
      clean.id = crypto.randomUUID();
      clean.createdAt = new Date().toISOString();
      list.push(clean);
    }
    this.persist(list);
    return clean;
  }

  delete(id) {
    this.persist(this.load().filter((q) => q.id !== id));
    return { ok: true };
  }
}

module.exports = { SavedQueriesStore };
