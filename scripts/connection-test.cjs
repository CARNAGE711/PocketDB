/* Connection-layer smoke test: pocketdb:// URIs + saved connections store */
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { parsePocketUri, toPocketUri } = require('../electron/db/uri.cjs');
const { ConnectionsStore } = require('../electron/db/connections.cjs');

// --- URI parsing ---
assert.strictEqual(parsePocketUri('pocketdb:///C:/Users/me/pocketdb-data'), path.normalize('C:/Users/me/pocketdb-data'));
assert.strictEqual(parsePocketUri('pocketdb://C:\\data\\db'), path.normalize('C:\\data\\db'));
assert.strictEqual(parsePocketUri('pocketdb:///home/me/pocketdb-data'), path.normalize('/home/me/pocketdb-data'));
assert.strictEqual(parsePocketUri('  pocketdb:///C:/spaces%20dir/db  '), path.normalize('C:/spaces dir/db'));

// round-trip
assert.strictEqual(parsePocketUri(toPocketUri('C:\\Users\\me\\pocketdb-data')), path.normalize('C:/Users/me/pocketdb-data'));

// rejections
assert.throws(() => parsePocketUri(''), /empty/i);
assert.throws(() => parsePocketUri('mongodb://localhost:27017'), /Unsupported scheme/i);

console.log('URI parsing OK');

// --- saved connections ---
const file = path.join(os.tmpdir(), 'pocketdb-conn-test-' + Date.now() + '.json');
const store = new ConnectionsStore(file);

const a = store.save({ name: 'Main', color: '#22c55e', favorite: true, uri: 'pocketdb:///C:/main' });
const b = store.save({ name: 'Scratch', uri: 'pocketdb:///C:/scratch' });
assert.strictEqual(a.id.length, 36, 'uuid assigned');
assert.notStrictEqual(a.id, b.id);

let list = store.list();
assert.strictEqual(list[0].name, 'Main', 'favorite pinned first');

// update existing (id preserved)
const a2 = store.save({ ...a, name: 'Main Studio' });
list = store.list();
assert.strictEqual(list.length, 2, 'no duplicate on update');
assert.strictEqual(list.find((c) => c.id === a.id).name, 'Main Studio');

// delete
store.delete(b.id);
assert.strictEqual(store.list().length, 1);

// validation
assert.throws(() => store.save({ name: 'x' }), /URI/i);

fs.rmSync(file, { force: true });
console.log('Connections store OK');

// --- database metadata store ---
const { DatabaseMetaStore } = require('../electron/db/meta.cjs');
const metaFile = path.join(os.tmpdir(), 'pocketdb-meta-test-' + Date.now() + '.json');
const meta = new DatabaseMetaStore(metaFile);

meta.set('work', { color: '#3b82f6', favorite: true });
meta.set('scratch', { color: null, favorite: false });
assert.strictEqual(meta.get('work').favorite, true);
assert.strictEqual(meta.get('missing'), null);

meta.set('work', { favorite: false }); // merge keeps color
assert.strictEqual(meta.get('work').color, '#3b82f6');
assert.strictEqual(meta.get('work').favorite, false);

meta.remove('scratch');
assert.strictEqual(meta.get('scratch'), null);
fs.rmSync(metaFile, { force: true });
console.log('Database meta store OK');

// --- optional seed on create ---
const dir2 = path.join(os.tmpdir(), 'pocketdb-seed-test-' + Date.now());
const { PocketEngine } = require('../electron/db/engine.cjs');
const e3 = new PocketEngine(dir2);
e3.createDatabase('seeded');
const seeded = e3.seedSample('seeded');
assert.strictEqual(seeded.insertedCount, 3);
assert.strictEqual(e3.count('seeded', 'sample-users').count, 3);
fs.rmSync(dir2, { recursive: true, force: true });
console.log('Seed sample OK');
console.log('ALL CONNECTION TESTS PASSED');
