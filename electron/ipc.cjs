/**
 * PocketDB — IPC wiring.
 *
 * Every engine operation the renderer can trigger is registered here as a
 * whitelisted handler under a single invoke channel ('pocketdb:call').
 * Unknown method names are rejected, so the renderer surface is exactly
 * the list below — nothing else in Electron or Node is reachable.
 *
 * Beyond CRUD this layer also owns the "live sync" watcher (fs.watch on the
 * connected data directory → 'engine:changed' push events), the optional
 * localhost HTTP bridge (server mode), saved queries, and collection export.
 */
'use strict';

const { ipcMain, dialog, app, shell, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PocketEngine } = require('./db/engine.cjs');
const { assertValidName } = require('./db/storage.cjs');
const { parsePocketUri, toPocketUri } = require('./db/uri.cjs');
const { ConnectionsStore } = require('./db/connections.cjs');
const { DatabaseMetaStore } = require('./db/meta.cjs');
const { SavedQueriesStore } = require('./db/queries.cjs');
const { createPocketServer } = require('./db/server.cjs');
const Snapshots = require('./db/snapshots.cjs');
const { importDocuments, importFromMongo } = require('./db/import.cjs');
const { setupUpdater } = require('./updater.cjs');

/* ------------------------------------------------------------------ */
/* CSV export helper                                                   */
/* ------------------------------------------------------------------ */

/** Flatten a document into dotted leaf paths (mirrors the renderer grid). */
function flattenDoc(doc, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(doc)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
      flattenDoc(v, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function toCsv(documents) {
  const keys = new Set();
  documents.forEach((d) => Object.keys(flattenDoc(d)).forEach((k) => keys.add(k)));
  const cols = [...keys].sort((a, b) => (a === '_id' ? -1 : b === '_id' ? 1 : a.localeCompare(b)));
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map(esc).join(',')];
  documents.forEach((d) => {
    const flat = flattenDoc(d);
    lines.push(cols.map((c) => esc(flat[c])).join(','));
  });
  return lines.join('\r\n') + '\r\n';
}

function registerIpc(defaultDataDir) {
  // Saved connections live next to the app's user data (shared with VS Code).
  const connections = new ConnectionsStore(
    path.join(app.getPath('userData'), 'pocketdb-connections.json')
  );

  // Per-database presentation options (color tag, favorite).
  const dbMeta = new DatabaseMetaStore(
    path.join(app.getPath('userData'), 'pocketdb-database-meta.json')
  );

  // Saved per-collection filters.
  const savedQueries = new SavedQueriesStore(
    path.join(app.getPath('userData'), 'pocketdb-saved-queries.json')
  );

  const engines = new Map(); // dataDir -> PocketEngine
  let activeDataDir = null;
  let pocketServer = null;

  // Snapshots live OUTSIDE the data dir (a folder inside it would look
  // like a database): <userData>/pocketdb-snapshots/<db>/<stamp>/
  const snapshotsDir = () => path.join(app.getPath('userData'), 'pocketdb-snapshots');

  /* ------------------------- activity feed -------------------------- */

  const activityLog = []; // newest first, bounded
  function pushActivity(entry) {
    const item = { id: crypto.randomUUID(), at: Date.now(), ...entry };
    activityLog.unshift(item);
    if (activityLog.length > 250) activityLog.pop();
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) win.webContents.send('engine:activity', item);
    return item;
  }

  /* --------------------- scheduled snapshots ------------------------ */

  const scheduleFile = () => path.join(app.getPath('userData'), 'pocketdb-snapshot-schedule.json');
  const defaultSchedule = () => ({ enabled: false, intervalMinutes: 60, keep: 5, lastRun: null });
  function readSchedule() {
    try {
      const parsed = JSON.parse(fs.readFileSync(scheduleFile(), 'utf8'));
      return { ...defaultSchedule(), ...parsed };
    } catch {
      return defaultSchedule();
    }
  }
  function writeSchedule(next) {
    try {
      fs.writeFileSync(scheduleFile(), JSON.stringify(next, null, 2), 'utf8');
    } catch (err) {
      console.error('[pocketdb] could not persist snapshot schedule:', err.message);
    }
    return next;
  }

  function runScheduledSnapshots() {
    const cfg = readSchedule();
    if (!cfg.enabled || !activeDataDir) return null;
    const due = !cfg.lastRun || Date.now() - cfg.lastRun >= cfg.intervalMinutes * 60 * 1000;
    if (!due) return null;
    const engine = engines.get(activeDataDir);
    if (!engine) return null;
    let created = 0;
    try {
      for (const db of engine.listDatabases().map((d) => d.name)) {
        const snap = Snapshots.createSnapshot({
          dataDir: activeDataDir,
          rootDir: snapshotsDir(),
          db,
        });
        created++;
        // Retention: keep the newest `keep` snapshots per database.
        const all = Snapshots.listSnapshots({ rootDir: snapshotsDir(), db });
        for (const old of all.slice(Math.max(1, cfg.keep))) {
          try { Snapshots.deleteSnapshot({ rootDir: snapshotsDir(), db, id: old.id }); } catch { /* best effort */ }
        }
        pushActivity({ op: 'snapshot', db, detail: `auto snapshot ${snap.id}`, auto: true });
      }
    } catch (err) {
      console.error('[pocketdb] scheduled snapshot failed:', err.message);
    }
    cfg.lastRun = Date.now();
    writeSchedule(cfg);
    if (created > 0) notifyFsChange();
    return created;
  }

  // Check once a minute; runs only while a data directory is connected.
  const scheduleTimer = setInterval(runScheduledSnapshots, 60 * 1000);
  if (scheduleTimer.unref) scheduleTimer.unref();

  // Auto-update plumbing (electron-updater; feed via POCKETDB_UPDATE_URL).
  const updater = setupUpdater({
    send: (status) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) win.webContents.send('update:status', status);
    },
  });

  /* ------------------------- live sync watcher ---------------------- */

  let watcher = null;
  let changeTimer = null;

  function notifyFsChange() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send('engine:changed', { at: Date.now() });
      }
    }, 350); // coalesce NDJSON write bursts
  }

  function startWatcher(dataDir) {
    stopWatcher();
    try {
      watcher = fs.watch(dataDir, { recursive: true }, notifyFsChange);
      watcher.on('error', stopWatcher);
    } catch (err) {
      console.error('[pocketdb] live watch unavailable:', err.message);
    }
  }

  function stopWatcher() {
    if (changeTimer) {
      clearTimeout(changeTimer);
      changeTimer = null;
    }
    if (watcher) {
      try { watcher.close(); } catch { /* ignore */ }
      watcher = null;
    }
  }

  const getEngine = () => {
    if (!activeDataDir) throw new Error('Not connected — open a connection first.');
    return engines.get(activeDataDir);
  };

  /** method name -> handler(payload) */
  const handlers = {
    /* -- connections ------------------------------------------------ */
    'connections.defaults': () => ({ defaultUri: toPocketUri(defaultDataDir) }),
    'connections.list': () => connections.list(),
    'connections.save': (conn) => connections.save(conn),
    'connections.delete': ({ id }) => connections.delete(id),

    'engine.connect': ({ uri, passphrase } = {}) => {
      const dataDir = parsePocketUri(uri);
      if (!path.isAbsolute(dataDir)) {
        throw new Error(
          `Connection string must point to an absolute data directory path. Got: "${dataDir}"`
        );
      }
      const existing = engines.get(dataDir);
      if (!existing) {
        engines.set(dataDir, new PocketEngine(dataDir, { passphrase }));
      } else if (passphrase) {
        // A passphrase was provided: always re-open with it — this also
        // recovers from an earlier connect with a wrong passphrase.
        engines.set(dataDir, new PocketEngine(dataDir, { passphrase }));
      }
      activeDataDir = dataDir;
      startWatcher(dataDir); // live sync: external writes flow to the studio
      return {
        ...getEngine().info(),
        uri: toPocketUri(dataDir),
        defaultUri: toPocketUri(defaultDataDir),
      };
    },

    'engine.info': () => ({
      ...getEngine().info(),
      uri: activeDataDir ? toPocketUri(activeDataDir) : null,
      defaultUri: toPocketUri(defaultDataDir),
    }),

    /* -- native shell helpers --------------------------------------- */
    'app.pickDirectory': async () => {
      const res = await dialog.showOpenDialog({
        title: 'Choose PocketDB data directory',
        properties: ['openDirectory', 'createDirectory'],
      });
      return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
    },

    'app.openDataFolder': ({ target } = {}) => {
      const dir =
        target && path.isAbsolute(target) ? target : activeDataDir || defaultDataDir;
      return shell.openPath(dir);
    },

    /* -- databases ------------------------------------------------- */
    'databases.list': () => getEngine().listDatabases(),
    'databases.metaList': () => dbMeta.list(),
    'databases.create': ({ name, color, favorite, seed }) => {
      getEngine().createDatabase(name);
      dbMeta.set(name, { color: color || null, favorite: Boolean(favorite) });
      if (seed) getEngine().seedSample(name);
      return { ok: true };
    },
    'databases.drop': ({ name }) => {
      const result = getEngine().dropDatabase(name);
      dbMeta.remove(name);
      return result;
    },

    /* -- collections ------------------------------------------------ */
    'collections.list': ({ db }) => getEngine().listCollections(db),
    'collections.create': ({ db, name }) => getEngine().createCollection(db, name),
    'collections.drop': ({ db, name }) => getEngine().dropCollection(db, name),

    /* -- documents --------------------------------------------------- */
    'documents.find': ({ db, coll, filter, sort, limit, skip, projection }) =>
      getEngine().find(db, coll, { filter, sort, limit, skip, projection }),
    'documents.explain': ({ db, coll, filter, sort }) =>
      getEngine().explain(db, coll, { filter, sort }),
    'documents.insertOne': ({ db, coll, doc }) => {
      const res = getEngine().insertOne(db, coll, doc);
      pushActivity({ op: 'insert', db, coll, detail: res.insertedId });
      return res;
    },
    'documents.updateOne': ({ db, coll, filter, update }) => {
      const res = getEngine().updateOne(db, coll, filter, update);
      pushActivity({ op: 'update', db, coll, detail: `${res.modified} modified` });
      return res;
    },
    'documents.updateMany': ({ db, coll, filter, update }) => {
      const res = getEngine().updateMany(db, coll, filter, update);
      pushActivity({ op: 'update', db, coll, detail: `${res.modified} modified` });
      return res;
    },
    'documents.deleteOne': ({ db, coll, id }) => {
      const res = getEngine().deleteOne(db, coll, { _id: id });
      pushActivity({ op: 'delete', db, coll, detail: `${res.deleted} deleted` });
      return res;
    },
    'documents.deleteMany': ({ db, coll, filter }) => {
      const res = getEngine().deleteMany(db, coll, filter);
      pushActivity({ op: 'delete', db, coll, detail: `${res.deleted} deleted` });
      return res;
    },
    'documents.count': ({ db, coll, filter }) => getEngine().count(db, coll, filter),

    /* -- aggregations ------------------------------------------------ */
    'aggregations.run': ({ db, coll, pipeline }) => getEngine().aggregate(db, coll, pipeline),

    /* -- files (GridFS-style binary storage) ------------------------- */
    'files.put': ({ db, name, base64, contentType, metadata }) =>
      getEngine().putFile(db, {
        filename: name,
        data: Buffer.from(String(base64 || ''), 'base64'),
        contentType,
        metadata,
      }),
    'files.list': ({ db }) => getEngine().listFiles(db),
    'files.get': ({ db, id }) => getEngine().getFile(db, id),
    'files.delete': ({ db, id }) => getEngine().deleteFile(db, id),

    // Write to a temp export folder and open with the OS default app.
    'files.openExternally': ({ db, id }) => {
      const file = getEngine().getFile(db, id);
      if (!file) throw new Error('File not found.');
      const dir = path.join(app.getPath('temp'), 'pocketdb-exports');
      fs.mkdirSync(dir, { recursive: true });
      const safeName = file.filename.replace(/[^\w.\- ()]/g, '_');
      const target = path.join(dir, `${file._id}-${safeName}`);
      fs.writeFileSync(target, Buffer.from(file.base64, 'base64'));
      return shell.openPath(target);
    },

    // Ask where to save, then write the file to the chosen location.
    'files.saveAs': async ({ db, id }) => {
      const file = getEngine().getFile(db, id);
      if (!file) throw new Error('File not found.');
      const res = await dialog.showSaveDialog({ defaultPath: file.filename });
      if (res.canceled || !res.filePath) return null;
      fs.writeFileSync(res.filePath, Buffer.from(file.base64, 'base64'));
      return res.filePath;
    },

    /* -- saved queries (per-collection filters) ---------------------- */
    'queries.list': ({ db, coll } = {}) =>
      savedQueries
        .list()
        .filter((q) => (!db || q.db === db) && (!coll || q.coll === coll)),
    'queries.save': ({ db, coll, name, text }) => savedQueries.save({ db, coll, name, text }),
    'queries.delete': ({ id }) => savedQueries.delete(id),

    /* -- collection export (JSON / CSV) ------------------------------ */
    'exports.collection': async ({ db, coll, format }) => {
      const { documents } = getEngine().find(db, coll, {});
      const isCsv = format === 'csv';
      const content = isCsv ? toCsv(documents) : JSON.stringify(documents, null, 2);
      const ext = isCsv ? 'csv' : 'json';
      const res = await dialog.showSaveDialog({
        title: `Export "${coll}"`,
        defaultPath: `${db}-${coll}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (res.canceled || !res.filePath) return null;
      fs.writeFileSync(res.filePath, content, 'utf8');
      return res.filePath;
    },

    /* -- server mode (localhost HTTP bridge) ------------------------- */
    'server.start': async ({ port, token, lan } = {}) => {
      const wanted = {
        port: Number(port) || Number(process.env.POCKETDB_PORT) || 7400,
        token: token ? String(token) : null,
        host: lan ? '0.0.0.0' : '127.0.0.1',
      };
      const current = pocketServer;
      const addr = current ? current.address() : null;
      const needsRebuild =
        !current ||
        !current.running ||
        !addr ||
        addr.port !== wanted.port ||
        addr.host !== wanted.host ||
        current.token !== wanted.token;
      if (needsRebuild) {
        if (current) await current.stop();
        pocketServer = createPocketServer({
          engine: getEngine(),
          port: wanted.port,
          host: wanted.host,
          token: wanted.token,
        });
      }
      const actual = await pocketServer.start();
      return {
        running: true,
        port: actual,
        host: wanted.host,
        lan: wanted.host !== '127.0.0.1',
        tokenProtected: Boolean(wanted.token),
        dataDir: activeDataDir,
      };
    },
    'server.stop': async () => {
      if (pocketServer) {
        await pocketServer.stop();
        pocketServer = null;
      }
      return { running: false };
    },
    'server.status': () =>
      pocketServer && pocketServer.running
        ? { running: true, ...pocketServer.address(), tokenProtected: Boolean(pocketServer.token), dataDir: activeDataDir }
        : { running: false },

    /* -- indexes ------------------------------------------------------ */
    'indexes.list': ({ db, coll }) => getEngine().listIndexes(db, coll),
    'indexes.create': ({ db, coll, field, unique }) => {
      const result = getEngine().createIndex(db, coll, field, { unique: Boolean(unique) });
      pushActivity({ op: 'index', db, coll, detail: `created ${result.field}${result.unique ? ' (unique)' : ''}` });
      return result;
    },
    'indexes.drop': ({ db, coll, field }) => {
      const res = getEngine().dropIndex(db, coll, field);
      pushActivity({ op: 'index', db, coll, detail: `dropped ${field}` });
      return res;
    },

    /* -- saved views (read-only pipelines) ----------------------------- */
    'views.list': ({ db }) => getEngine().listViews(db),
    'views.save': ({ db, id, name, coll, pipeline }) => {
      const view = getEngine().saveView(db, { id, name, coll, pipeline });
      pushActivity({ op: 'view', db, coll: view.coll, detail: `saved view "${view.name}"` });
      return view;
    },
    'views.delete': ({ db, id }) => {
      const res = getEngine().deleteView(db, id);
      pushActivity({ op: 'view', db, detail: 'view deleted' });
      return res;
    },

    /* -- trash (soft-deleted documents) -------------------------------- */
    'trash.list': ({ db, coll }) => getEngine().listTrash(db, { coll }),
    'trash.restore': ({ db, trashId }) => {
      const res = getEngine().restoreTrash(db, trashId);
      pushActivity({ op: 'restore', db, coll: res.coll, detail: `restored ${res.restoredId}` });
      return res;
    },
    'trash.purge': ({ db, trashId }) => getEngine().purgeTrash(db, trashId),
    'trash.empty': ({ db }) => getEngine().emptyTrash(db),

    /* -- schema validation -------------------------------------------- */
    'schema.get': ({ db, coll }) => getEngine().getSchema(db, coll),
    'schema.set': ({ db, coll, rules }) => getEngine().setSchema(db, coll, rules),
    'schema.clear': ({ db, coll }) => getEngine().clearSchema(db, coll),
    'schema.analyze': ({ db, coll }) => getEngine().analyzeSchema(db, coll),

    /* -- history (revision log) ---------------------------------------- */
    'history.list': ({ db, coll, id, limit }) => getEngine().listHistory(db, coll, { id, limit }),
    'history.restore': ({ db, coll, revId }) => {
      const result = getEngine().restoreRevision(db, coll, revId);
      pushActivity({ op: 'restore', db, coll, detail: `revision ${revId}` });
      notifyFsChange();
      return result;
    },

    /* -- snapshots (database backups) ----------------------------------- */
    'snapshots.create': ({ db }) => {
      const result = Snapshots.createSnapshot({ dataDir: activeDataDir, rootDir: snapshotsDir(), db });
      pushActivity({ op: 'snapshot', db, detail: `snapshot ${result.id}` });
      notifyFsChange();
      return result;
    },
    'snapshots.list': ({ db }) => Snapshots.listSnapshots({ rootDir: snapshotsDir(), db }),
    'snapshots.restore': ({ db, id }) => {
      const result = Snapshots.restoreSnapshot({ dataDir: activeDataDir, rootDir: snapshotsDir(), db, id });
      pushActivity({ op: 'restore', db, detail: `snapshot ${id}` });
      notifyFsChange();
      return result;
    },
    'snapshots.delete': ({ db, id }) => Snapshots.deleteSnapshot({ rootDir: snapshotsDir(), db, id }),
    'snapshots.scheduleGet': () => {
      const cfg = readSchedule();
      return {
        ...cfg,
        nextRun: cfg.enabled && cfg.lastRun
          ? cfg.lastRun + cfg.intervalMinutes * 60 * 1000
          : cfg.enabled
            ? Date.now()
            : null,
      };
    },
    'snapshots.scheduleSet': ({ enabled, intervalMinutes, keep }) => {
      const cfg = readSchedule();
      if (enabled !== undefined) cfg.enabled = Boolean(enabled);
      if (intervalMinutes !== undefined) {
        const n = Number(intervalMinutes);
        if (!Number.isFinite(n) || n < 1) throw new Error('Interval must be at least 1 minute.');
        cfg.intervalMinutes = n;
      }
      if (keep !== undefined) {
        const n = Number(keep);
        if (!Number.isInteger(n) || n < 1) throw new Error('Keep must be at least 1 snapshot.');
        cfg.keep = n;
      }
      writeSchedule(cfg);
      return { ...cfg };
    },
    'activity.list': ({ limit = 100 } = {}) => activityLog.slice(0, limit),

    /* -- import (JSON / NDJSON / CSV + MongoDB mirror) ------------------- */
    'imports.documents': ({ db, coll, text, format }) => {
      const result = importDocuments(getEngine(), { db, coll, text, format });
      pushActivity({ op: 'import', db, coll, detail: `${result.inserted ?? result.count ?? '?'} imported` });
      return result;
    },
    'imports.mongodb': async ({ uri, dbs, limitPerColl }) => {
      const result = await importFromMongo({ uri, engine: getEngine(), dbs, limitPerColl });
      pushActivity({ op: 'import', db: '(mongo)', detail: 'MongoDB mirror finished' });
      return result;
    },

    /* -- app + auto-update ------------------------------------------------ */
    'app.version': () => app.getVersion(),

    /* -- MCP server (standalone stdio bridge) -------------------------- */
    'mcp.info': () => {
      const packaged = path.join(process.resourcesPath || '', 'mcp', 'mcp-server.cjs');
      const dev = path.join(__dirname, 'mcp-server.cjs');
      const script = app.isPackaged && fs.existsSync(packaged) ? packaged : dev;
      const data = activeDataDir || '';
      return {
        script,
        dataDir: data,
        command: `node "${script}" --data "${data}"`,
        config: {
          mcpServers: {
            pocketdb: { command: 'node', args: [script, '--data', data] },
          },
        },
      };
    },
    'updates.check': () => updater.check(),
    'updates.install': () => {
      updater.install();
      return { ok: true };
    },
  };

  ipcMain.handle('pocketdb:call', async (_event, { method, payload }) => {
    const handler = handlers[method];
    if (!handler) {
      return { ok: false, error: `Unknown engine method: "${method}"` };
    }
    try {
      // Guard against path traversal: any db/coll in the payload must be a
      // safe name (defense in depth — the storage layer re-validates too).
      if (payload) {
        if (payload.db !== undefined) assertValidName(payload.db, 'database');
        if (payload.coll !== undefined) assertValidName(payload.coll, 'collection');
      }
      const data = await handler(payload || {});
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  return handlers;
}

module.exports = { registerIpc };
