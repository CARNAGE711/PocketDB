/**
 * PocketDB — Saved connections store.
 *
 * Persists the studio's saved connections (URI, name, color tag, favorite)
 * as JSON next to the app's user-data: <userData>/pocketdb-connections.json.
 * The VS Code extension reads the same file, so favorites are shared.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ConnectionsStore {
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

  /** Saved connections, favorites pinned to the top (like MongoDB Compass). */
  list() {
    return [...this.load()].sort((a, b) => {
      if (Boolean(b.favorite) !== Boolean(a.favorite)) return b.favorite ? 1 : -1;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  /** Insert or update a connection; assigns id/createdAt for new entries. */
  save(conn) {
    if (!conn || typeof conn !== 'object') throw new Error('Connection must be an object.');
    if (typeof conn.uri !== 'string' || !conn.uri.trim()) {
      throw new Error('Connection needs a URI.');
    }
    const clean = {
      id: conn.id,
      name: String(conn.name || 'Local data directory').slice(0, 64),
      color: conn.color == null ? null : String(conn.color).slice(0, 16),
      favorite: Boolean(conn.favorite),
      uri: conn.uri.trim(),
    };

    const list = this.load();
    const existing = clean.id ? list.findIndex((c) => c.id === clean.id) : -1;
    if (existing >= 0) {
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
    this.persist(this.load().filter((c) => c.id !== id));
    return { ok: true };
  }
}

module.exports = { ConnectionsStore };
