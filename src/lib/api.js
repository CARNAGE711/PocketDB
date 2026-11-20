/**
 * Typed wrapper around the preload bridge (window.pocketdb).
 * The renderer only ever calls whitelisted engine methods through here.
 */

function call(method, payload = {}) {
  if (!window.pocketdb) {
    return Promise.reject(
      new Error('PocketDB bridge unavailable. Launch the app through Electron (`npm run dev`), not a plain browser tab.')
    );
  }
  return window.pocketdb.call(method, payload).then((res) => {
    if (!res || !res.ok) throw new Error(res?.error || 'Engine call failed');
    return res.data;
  });
}

export const api = {
  /* connections (Compass-style) */
  connectionsDefaults: () => call('connections.defaults'),
  listConnections: () => call('connections.list'),
  saveConnection: (conn) => call('connections.save', conn),
  deleteConnection: (id) => call('connections.delete', { id }),
  connectEngine: (uri, passphrase) => call('engine.connect', { uri, passphrase }),

  /* native helpers */
  pickDirectory: () => call('app.pickDirectory'),
  openDataFolder: (target) => call('app.openDataFolder', { target }),

  /* databases */
  listDatabases: () => call('databases.list'),
  databasesMetaList: () => call('databases.metaList'),
  createDatabase: (name, opts = {}) => call('databases.create', { name, ...opts }),
  dropDatabase: (name) => call('databases.drop', { name }),

  /* collections */
  listCollections: (db) => call('collections.list', { db }),
  createCollection: (db, name) => call('collections.create', { db, name }),
  dropCollection: (db, name) => call('collections.drop', { db, name }),

  /* documents */
  find: (db, coll, opts = {}) => call('documents.find', { db, coll, ...opts }),
  explain: (db, coll, filter, sort) => call('documents.explain', { db, coll, filter, sort }),
  insertOne: (db, coll, doc) => call('documents.insertOne', { db, coll, doc }),
  updateOne: (db, coll, filter, update) => call('documents.updateOne', { db, coll, filter, update }),
  deleteOne: (db, coll, id) => call('documents.deleteOne', { db, coll, id }),
  deleteMany: (db, coll, filter) => call('documents.deleteMany', { db, coll, filter }),
  count: (db, coll, filter) => call('documents.count', { db, coll, filter }),

  /* aggregations */
  runPipeline: (db, coll, pipeline) => call('aggregations.run', { db, coll, pipeline }),

  /* indexes */
  listIndexes: (db, coll) => call('indexes.list', { db, coll }),
  createIndex: (db, coll, field, unique = false) => call('indexes.create', { db, coll, field, unique }),
  dropIndex: (db, coll, field) => call('indexes.drop', { db, coll, field }),

  /* saved views (read-only pipelines) */
  listViews: (db) => call('views.list', { db }),
  saveView: (db, { id, name, coll, pipeline }) => call('views.save', { db, id, name, coll, pipeline }),
  deleteView: (db, id) => call('views.delete', { db, id }),

  /* trash (soft-deleted documents) */
  listTrash: (db, coll) => call('trash.list', { db, coll }),
  restoreTrash: (db, trashId) => call('trash.restore', { db, trashId }),
  purgeTrash: (db, trashId) => call('trash.purge', { db, trashId }),
  emptyTrash: (db) => call('trash.empty', { db }),

  /* schema validation + analyzer */
  getSchema: (db, coll) => call('schema.get', { db, coll }),
  setSchema: (db, coll, rules) => call('schema.set', { db, coll, rules }),
  clearSchema: (db, coll) => call('schema.clear', { db, coll }),
  analyzeSchema: (db, coll) => call('schema.analyze', { db, coll }),

  /* history (revision log) */
  listHistory: (db, coll, id) => call('history.list', { db, coll, id }),
  restoreRevision: (db, coll, revId) => call('history.restore', { db, coll, revId }),

  /* snapshots (database backups) */
  createSnapshot: (db) => call('snapshots.create', { db }),
  listSnapshots: (db) => call('snapshots.list', { db }),
  restoreSnapshot: (db, id) => call('snapshots.restore', { db, id }),
  deleteSnapshot: (db, id) => call('snapshots.delete', { db, id }),
  getSnapshotSchedule: () => call('snapshots.scheduleGet'),
  setSnapshotSchedule: (opts) => call('snapshots.scheduleSet', opts),

  /* activity feed */
  listActivity: (limit) => call('activity.list', { limit }),

  /* MCP server configuration */
  mcpInfo: () => call('mcp.info'),

  /* import (JSON / NDJSON / CSV + MongoDB mirror) */
  importDocs: (db, coll, { text, format } = {}) => call('imports.documents', { db, coll, text, format }),
  importFromMongo: ({ uri, dbs, limitPerColl } = {}) => call('imports.mongodb', { uri, dbs, limitPerColl }),

  /* app + auto-update */
  appVersion: () => call('app.version'),
  checkUpdates: () => call('updates.check'),
  installUpdate: () => call('updates.install'),
  onUpdateStatus: (callback) => window.pocketdb.onUpdateStatus(callback),

  /* files (binary storage) */
  putFile: (db, name, base64, contentType) => call('files.put', { db, name, base64, contentType }),
  listFiles: (db) => call('files.list', { db }),
  getFile: (db, id) => call('files.get', { db, id }),
  deleteFile: (db, id) => call('files.delete', { db, id }),
  openFileExternally: (db, id) => call('files.openExternally', { db, id }),
  saveFileAs: (db, id) => call('files.saveAs', { db, id }),

  /* saved queries (per-collection filters) */
  listQueries: (db, coll) => call('queries.list', { db, coll }),
  saveQuery: ({ db, coll, name, text }) => call('queries.save', { db, coll, name, text }),
  deleteQuery: (id) => call('queries.delete', { id }),

  /* collection export */
  exportCollection: (db, coll, format) => call('exports.collection', { db, coll, format }),

  /* server mode (localhost HTTP bridge) */
  serverStart: ({ port, token, lan } = {}) => call('server.start', { port, token, lan }),
  serverStop: () => call('server.stop'),
  serverStatus: () => call('server.status'),

  /* live change events (pushed from the main process) */
  onEngineChanged: (callback) => window.pocketdb.onEngineChanged(callback),
  onActivity: (callback) => window.pocketdb.onActivity(callback),
};
