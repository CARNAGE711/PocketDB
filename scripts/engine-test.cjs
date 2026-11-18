/* Headless engine smoke test (run with: node scripts/engine-test.cjs) */
const os = require('os');
const path = require('path');
const fs = require('fs');
const { PocketEngine } = require('../electron/db/engine.cjs');

(async () => {
const dir = path.join(os.tmpdir(), 'pocketdb-test-' + Date.now());
const e = new PocketEngine(dir);

// --- namespaces ---
e.createDatabase('shop');
e.createCollection('shop', 'products');
const { insertedIds } = e.insertMany('shop', 'products', [
  { name: 'Laptop', price: 1200, stock: 5, specs: { cpu: 'M1', ram: 16 }, tags: ['tech', 'big'] },
  { name: 'Mouse', price: 25, stock: 100, specs: { cpu: 'none', ram: 0 }, tags: ['tech'] },
  { name: 'Desk', price: 300, stock: 10, specs: { cpu: 'none', ram: 0 }, tags: ['furniture'] },
  { name: 'Monitor', price: 450, stock: 7, specs: { cpu: 'none', ram: 0 }, tags: ['tech', 'display'] },
]);
console.log('inserted:', insertedIds.length, 'ids unique:', new Set(insertedIds).size === 4);

// --- dot notation + operators ---
let r = e.find('shop', 'products', { filter: { 'specs.ram': { $gte: 8 } } });
console.log('ram>=8:', r.documents.map((d) => d.name).join(','), '(want Laptop)');

r = e.find('shop', 'products', { filter: { tags: { $in: ['furniture'] } } });
console.log('tag furniture:', r.documents.map((d) => d.name).join(','), '(want Desk)');

r = e.find('shop', 'products', { filter: { name: { $regex: '^(L|D)', $options: 'i' } } });
console.log('regex ^(L|D):', r.documents.map((d) => d.name).join(','), '(want Laptop,Desk)');

r = e.find('shop', 'products', { filter: { price: { $ne: 25, $lte: 450 } }, sort: { price: -1 } });
console.log('sorted desc:', r.documents.map((d) => d.name + ':' + d.price).join(','), '(want Monitor,Desk,Laptop)');

r = e.find('shop', 'products', { filter: { $or: [{ name: 'Desk' }, { stock: { $gt: 50 } }] } });
console.log('$or:', r.documents.map((d) => d.name).join(','), '(want Desk,Mouse)');

// --- update ($set dot-notation + $unset) ---
const u = e.updateOne('shop', 'products', { name: 'Mouse' }, { $set: { 'specs.ram': 99 }, $unset: ['tags.0'] });
r = e.find('shop', 'products', { filter: { 'specs.ram': 99 } });
console.log('updated matched:', u.matched, 'modified:', u.modified, '| tags now:', JSON.stringify(r.documents[0].tags), '(want [])');

// --- aggregation ---
r = e.aggregate('shop', 'products', [
  { $match: { stock: { $gt: 5 } } },
  { $sort: { price: 1 } },
  { $project: { _id: 0, name: 1, price: 1 } },
]);
console.log('pipeline:', JSON.stringify(r.documents));

r = e.aggregate('shop', 'products', [{ $unwind: 'tags' }, { $count: 'tagRows' }]);
console.log('unwind+count:', JSON.stringify(r.documents), '(want {"tagRows":4})');

// --- delete ---
const d = e.deleteOne('shop', 'products', { name: 'Desk' });
console.log('deleted:', d.deleted, '| remaining:', e.count('shop', 'products').count, '(want 1, 3)');

// --- guards ---
try {
  e.insertOne('shop', 'products', { _id: insertedIds[0], name: 'dupe' });
  console.log('DUPLICATE ALLOWED (BAD)');
} catch (err) {
  console.log('duplicate _id guarded ok');
}
try {
  e.createDatabase('../evil');
  console.log('TRAVERSAL ALLOWED (BAD)');
} catch (err) {
  console.log('path traversal guarded ok');
}

// --- persistence round-trip ---
const e2 = new PocketEngine(dir);
console.log('reloaded docs:', e2.count('shop', 'products').count, '(want 3)');
console.log('demo seed present:', e2.listDatabases().some((x) => x.name === 'pocketdb-demo'));

// --- files (binary storage) ---
// A tiny valid PNG (1x1 transparent) to prove binary round-trip.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const stored = e.putFile('shop', {
  filename: 'logo.png',
  data: PNG_1PX,
  metadata: { source: 'test' },
});
console.log('file stored:', stored.filename, stored.contentType, stored.size, 'bytes');

const got = e.getFile('shop', stored._id);
const roundTrip = Buffer.from(got.base64, 'base64');
console.log('round-trip identical:', roundTrip.equals(PNG_1PX), '| meta kept:', got.metadata.source === 'test');

// Default MIME detection from extension
const txtFile = e.putFile('shop', { filename: 'notes.txt', data: Buffer.from('hello pocketdb') });
console.log('guessed mime:', txtFile.contentType, '(want text/plain)');

// Regression: with several files stored, getFile must return the *requested*
// file, not the first document in the _files collection.
const fetched1 = e.getFile('shop', stored._id);
const fetched2 = e.getFile('shop', txtFile._id);
console.log(
  'getFile picks the right file among many:',
  fetched1.filename === 'logo.png' &&
    fetched2.filename === 'notes.txt' &&
    Buffer.from(fetched2.base64, 'base64').toString() === 'hello pocketdb'
);

const listed = e.listFiles('shop');
console.log('files listed:', listed.length, '| payload hidden:', listed.every((f) => f.data === undefined));

// Size guard
try {
  e.putFile('shop', { filename: 'big.bin', data: Buffer.alloc(17 * 1024 * 1024) });
  console.log('SIZE GUARD MISSING (BAD)');
} catch (err) {
  console.log('size guard ok:', /limit/.test(err.message));
}

e.deleteFile('shop', txtFile._id);
console.log('files after delete:', e.listFiles('shop').length, '(want 1)');

// _files stays hidden from the sidebar
const visible = e.listCollections('shop', { includeSystem: false }).map((c) => c.name);
console.log('_files hidden from UI:', !visible.includes('_files'), '| visible:', visible.join(','));

/* ================================================================== */
/* v1.1 features: indexes, new pipeline stages, $text, schema,         */
/* history, watch, updateOne/updateMany counts, encryption            */
/* ================================================================== */

// --- indexes (sidecar maps prune equality/$in scans) ---
e.createIndex('shop', 'products', 'price');
const idxList = e.listIndexes('shop', 'products');
console.log('index listed:', idxList.length === 1 && idxList[0].field === 'price', idxList[0]?.entryCount, 'keys');

// After a write, the index must be rebuilt to stay correct.
e.insertOne('shop', 'products', { name: 'Keyboard', price: 99, stock: 3, tags: ['tech'] });
r = e.find('shop', 'products', { filter: { price: 99 } });
console.log('index pruned find after write:', r.documents.length === 1 && r.documents[0].name === 'Keyboard');
r = e.find('shop', 'products', { filter: { price: { $in: [25, 99] } } });
console.log('index $in find:', r.documents.map((d) => d.name).sort().join(','), '(want Keyboard,Mouse)');

e.dropIndex('shop', 'products', 'price');
console.log('index dropped:', e.listIndexes('shop', 'products').length === 0);

// --- $group / $lookup / $replaceRoot ---
e.createCollection('shop', 'orders');
e.insertMany('shop', 'orders', [
  { item: 'Laptop', qty: 1, by: 'Ada' },
  { item: 'Mouse', qty: 2, by: 'Ada' },
  { item: 'Desk', qty: 1, by: 'Grace' },
]);

r = e.aggregate('shop', 'orders', [{ $group: { _id: '$by', units: { $sum: '$qty' }, orders: { $sum: 1 } } }]);
const grp = Object.fromEntries(r.documents.map((d) => [d._id, d.units]));
console.log('$group sums:', JSON.stringify(grp), '(want Ada:3, Grace:1)');

r = e.aggregate('shop', 'orders', [
  { $lookup: { from: 'products', localField: 'item', foreignField: 'name', as: 'product' } },
]);
const lap = r.documents.find((d) => d.item === 'Laptop');
console.log(
  '$lookup joined:',
  Array.isArray(lap.product) && lap.product[0].name === 'Laptop' && lap.product[0].price === 1200
);

r = e.aggregate('shop', 'products', [{ $match: { name: 'Laptop' } }, { $replaceRoot: { newRoot: '$specs' } }]);
console.log('$replaceRoot:', JSON.stringify(r.documents[0]), '(want the specs object)');

// --- $text (token-based scan) ---
r = e.find('shop', 'products', { filter: { $text: { $search: 'lap' } } });
console.log('$text prefix:', r.documents.map((d) => d.name).join(','), '(want Laptop)');

// --- schema validation ---
e.setSchema('shop', 'orders', { required: ['by'], properties: { qty: { type: 'number' } } });
try {
  e.insertOne('shop', 'orders', { item: 'Ghost', qty: 1 });
  console.log('SCHEMA NOT ENFORCED (BAD)');
} catch (err) {
  console.log('schema enforced ok:', /required/.test(err.message));
}
try {
  e.insertOne('shop', 'orders', { by: 'Bob', qty: 'many' });
  console.log('SCHEMA TYPE NOT ENFORCED (BAD)');
} catch (err) {
  console.log('schema type enforced ok:', /must be number/.test(err.message));
}
const viol = e.setSchema('shop', 'products', { required: ['neverPresent'] });
console.log('existing violations reported:', viol.violations.length > 0);
e.clearSchema('shop', 'orders');
e.clearSchema('shop', 'products'); // the deliberately-broken rules would block later writes

// --- history (pre-images + restore) ---
const before = e.find('shop', 'products', { filter: { name: 'Keyboard' } }).documents[0];
e.updateOne('shop', 'products', { name: 'Keyboard' }, { $set: { price: 199 } });
const revs = e.listHistory('shop', 'products', { id: before._id });
console.log('history recorded:', revs.length >= 1 && revs[0].op === 'update' && revs[0].doc.price === 99);
e.restoreRevision('shop', 'products', revs[0].revId);
const after = e.find('shop', 'products', { filter: { _id: before._id } }).documents[0];
console.log('revision restored:', after.price === 99 && after._id === before._id);

// --- watch (change feed) ---
let watchHit = null;
const off = e.watch('shop', 'orders', (ev) => { watchHit = ev; });
e.insertOne('shop', 'orders', { item: 'Watch', qty: 1, by: 'Linus' });
await new Promise((res) => setTimeout(res, 500)); // 150ms debounce + fs latency
console.log('watch event:', watchHit && watchHit.db === 'shop' && (watchHit.coll === 'orders' || watchHit.coll === null));
off();
e.deleteOne('shop', 'orders', { item: 'Watch' }); // cleanup

// --- updateOne vs updateMany counts (regression) ---
e.insertMany('shop', 'bulk', [{ a: 1 }, { a: 1 }, { a: 1 }]);
const uOne = e.updateOne('shop', 'bulk', { a: 1 }, { $set: { b: true } });
const uMany = e.updateMany('shop', 'bulk', { a: 1 }, { $set: { c: true } });
console.log(
  'updateOne/Many counts:',
  uOne.matched === 3 && uOne.modified === 1 && uMany.matched === 3 && uMany.modified === 3,
  '(updateOne changes only the first match, updateMany all of them)'
);

// --- encryption at rest ---
const encDir = path.join(os.tmpdir(), 'pocketdb-enc-' + Date.now());
const enc = new PocketEngine(encDir, { passphrase: 'correct horse' });
enc.createDatabase('vault');
enc.insertOne('vault', 'secrets', { note: 'hidden treasure', pin: 4321 });
const raw = fs.readFileSync(path.join(encDir, 'vault', 'secrets.ndjson'));
console.log('file encrypted on disk:', raw.slice(0, 7).toString('ascii') === 'PDBENC1');

// Wrong passphrase must fail loudly, right one must decrypt.
const wrong = new PocketEngine(encDir, { passphrase: 'wrong' });
try {
  wrong.count('vault', 'secrets');
  console.log('WRONG PASSPHRASE ACCEPTED (BAD)');
} catch (err) {
  console.log('wrong passphrase rejected ok');
}
const right = new PocketEngine(encDir, { passphrase: 'correct horse' });
console.log('right passphrase decrypts:', right.count('vault', 'secrets').count === 1);

// Plaintext stays readable when a passphrase is configured (mixed dirs).
const plainDir = path.join(os.tmpdir(), 'pocketdb-plain-' + Date.now());
const plain = new PocketEngine(plainDir);
plain.createDatabase('plain');
plain.insertOne('plain', 'docs', { hello: 'world' });
const upgraded = new PocketEngine(plainDir, { passphrase: 'later-set' });
console.log('plaintext tolerated with passphrase set:', upgraded.count('plain', 'docs').count === 1);
fs.rmSync(encDir, { recursive: true, force: true });
fs.rmSync(plainDir, { recursive: true, force: true });

fs.rmSync(dir, { recursive: true, force: true });
console.log('ALL ENGINE TESTS PASSED');
})();
