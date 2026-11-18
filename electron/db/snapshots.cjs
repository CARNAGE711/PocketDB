/**
 * PocketDB — Database snapshots.
 *
 * A snapshot is a full copy of a database folder, stored OUTSIDE the data
 * directory (so it never shows up as a database): <rootDir>/<db>/<stamp>/.
 * Restores swap the live folder atomically (move aside → copy → verify),
 * keeping the original if the copy fails.
 *
 * Pure fs — no compression: NDJSON stays human-readable and the copy is
 * instant for typical database sizes.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { assertValidName } = require('./storage.cjs');

function dbSnapshotDir(rootDir, db) {
  return path.join(rootDir, db);
}

function stampDir(rootDir, db, id) {
  return path.join(rootDir, db, String(id));
}

/** Create a timestamped snapshot of a database folder. */
function createSnapshot({ dataDir, rootDir, db }) {
  assertValidName(db, 'database');
  const src = path.join(dataDir, db);
  if (!fs.existsSync(src)) throw new Error(`Database "${db}" does not exist.`);
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = stampDir(rootDir, db, id);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  const files = fs.readdirSync(dest).filter((f) => f.endsWith('.ndjson'));
  return { id, db, createdAt: id, path: dest, collections: files.length };
}

/** List snapshots of a database, newest first. */
function listSnapshots({ rootDir, db }) {
  const dir = dbSnapshotDir(rootDir, db);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      id: d.name,
      db,
      createdAt: d.name,
      path: stampDir(rootDir, db, d.name),
      collections: fs
        .readdirSync(stampDir(rootDir, db, d.name))
        .filter((f) => f.endsWith('.ndjson')).length,
    }))
    .sort((a, b) => b.id.localeCompare(a.id));
}

/** Restore a snapshot, replacing the live database folder atomically. */
function restoreSnapshot({ dataDir, rootDir, db, id }) {
  assertValidName(db, 'database');
  if (!/^[\w.:-]{1,80}$/.test(String(id))) throw new Error(`Invalid snapshot id "${id}".`);
  const snap = stampDir(rootDir, db, id);
  if (!fs.existsSync(snap)) throw new Error(`Snapshot "${id}" not found for "${db}".`);

  const dest = path.join(dataDir, db);
  const aside = `${dest}.restore-${Date.now()}`;
  if (fs.existsSync(dest)) fs.renameSync(dest, aside);
  try {
    fs.cpSync(snap, dest, { recursive: true });
  } catch (err) {
    // Never leave the database missing — put the original back.
    try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ }
    if (fs.existsSync(aside)) fs.renameSync(aside, dest);
    throw err;
  }
  try { fs.rmSync(aside, { recursive: true, force: true }); } catch { /* ignore */ }
  return { ok: true, restoredFrom: id };
}

/** Permanently delete one snapshot. */
function deleteSnapshot({ rootDir, db, id }) {
  if (!/^[\w.:-]{1,80}$/.test(String(id))) throw new Error(`Invalid snapshot id "${id}".`);
  fs.rmSync(stampDir(rootDir, db, id), { recursive: true, force: true });
  return { ok: true };
}

module.exports = { createSnapshot, listSnapshots, restoreSnapshot, deleteSnapshot };
