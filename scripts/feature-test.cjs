/* Feature test for the 9 new capabilities (run with: node scripts/feature-test.cjs) */
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { PocketEngine } = require('../electron/db/engine.cjs');

const dir = path.join(os.tmpdir(), 'pocketdb-features-' + Date.now());
const e = new PocketEngine(dir);
let passed = 0;
const ok = (name, cond) => {
  assert.ok(cond, name);
  passed++;
  console.log('ok  ', name);
};

e.createDatabase('feat');
e.createCollection('feat', 'users');
e.insertMany('feat', 'users', [
  { name: 'Ada', email: 'ada@x.io', team: 'core', age: 36, tags: ['math'] },
  { name: 'Grace', email: 'grace@x.io', team: 'core', age: 45, tags: ['navy'] },
  { name: 'Linus', email: 'linus@x.io', team: 'kernel', age: 54, tags: ['oss'] },
  { name: 'Margaret', email: 'margaret@x.io', team: 'core', age: 32, tags: ['apollo'] },
]);

/* ---- unique indexes ---- */
let res = e.createIndex('feat', 'users', 'email', { unique: true });
ok('unique index created', res.unique === true && res.entries === 4);
assert.throws(
  () => e.insertOne('feat', 'users', { name: 'Dup', email: 'ada@x.io' }),
  /Unique index violation/
);
ok('duplicate insert rejected by unique index', true);
assert.throws(
  () => e.updateOne('feat', 'users', { name: 'Linus' }, { $set: { email: 'ada@x.io' } }),
  /Unique index violation/
);
ok('duplicate update rejected by unique index', true);

/* multikey unique: per-element enforcement */
e.createIndex('feat', 'users', 'tags', { unique: true });
assert.throws(
  () => e.insertOne('feat', 'users', { name: 'Tag dup', email: 'tag@x.io', tags: ['math'] }),
  /Unique index violation/
);
ok('unique multikey index rejects a duplicate array element', true);
e.dropIndex('feat', 'users', 'tags');

/* ---- compound indexes ---- */
res = e.createIndex('feat', 'users', 'team+age');
ok('compound index created', Array.isArray(res.fields) && res.fields.join('+') === 'team+age');
let plan = e.explain('feat', 'users', { filter: { team: 'core', age: 45 } });
ok('explain picks compound index', plan.indexUsed && plan.indexUsed.field === 'team+age' && plan.scanned === 1);
ok('explain reports IXSCAN + matched', plan.plan[0].stage === 'IXSCAN' && plan.matched === 1);
plan = e.explain('feat', 'users', { filter: { name: 'Ada' } });
ok('explain falls back to COLLSCAN', plan.indexUsed === null && plan.plan[0].stage === 'COLLSCAN' && plan.scanned === 4);

/* ---- saved views ---- */
const view = e.saveView('feat', {
  name: 'core-users',
  coll: 'users',
  pipeline: [{ $match: { team: 'core' } }, { $project: { _id: 0, name: 1, age: 1 } }],
});
ok('view saved with id', Boolean(view.id));
let found = e.find('feat', 'core-users', {});
ok('view returns pipeline results', found.total === 3 && found.view === true && found.documents[0].email === undefined);
ok('view count matches', e.count('feat', 'core-users', {}).count === 3);
const agg = e.aggregate('feat', 'core-users', [{ $group: { _id: null, avg: { $avg: '$age' } } }]);
ok('aggregate runs on top of a view', Math.round(agg.documents[0].avg) === 38);
assert.throws(() => e.insertOne('feat', 'core-users', { name: 'nope' }), /read-only view/);
ok('writes to a view are rejected', true);
ok(
  'views appear in listDatabases',
  e.listDatabases().find((d) => d.name === 'feat').collections.some((c) => c.name === 'core-users' && c.view)
);
ok('views appear in listCollections with source', e.listCollections('feat').find((c) => c.name === 'core-users').source === 'users');
const vplan = e.explain('feat', 'core-users', { filter: { name: 'Ada' } });
ok('explain handles views', vplan.view === true && vplan.matched === 1);
e.deleteView('feat', view.id);
ok('view deleted', e.getView('feat', 'core-users') === null);

/* ---- trash / soft delete ---- */
const target = e.find('feat', 'users', { filter: { name: 'Linus' } }).documents[0];
res = e.deleteOne('feat', 'users', { _id: target._id });
ok('delete moves doc out of collection', res.deleted === 1 && e.count('feat', 'users', {}).count === 3);
let trash = e.listTrash('feat');
ok('deleted doc is in the trash', trash.length === 1 && trash[0].doc._id === target._id && trash[0].coll === 'users');
res = e.restoreTrash('feat', trash[0].trashId);
ok('restore returns it to the collection', res.coll === 'users' && e.count('feat', 'users', {}).count === 4);
ok('trash is empty after restore', e.listTrash('feat').length === 0);
e.deleteOne('feat', 'users', { _id: target._id });
trash = e.listTrash('feat');
e.purgeTrash('feat', trash[0].trashId);
ok('purge removes the trash entry', e.listTrash('feat').length === 0);
e.insertOne('feat', 'users', { name: 'Temp', email: 'temp@x.io', team: 'kernel', age: 1, tags: [] });
e.deleteMany('feat', 'users', { team: 'kernel' });
ok('deleteMany feeds the trash', e.listTrash('feat').length === 1);
e.emptyTrash('feat');
ok('empty trash clears everything', e.listTrash('feat').length === 0);

/* ---- schema analyzer ---- */
const analysis = e.analyzeSchema('feat', 'users');
ok('schema analyzer counts documents', analysis.documents === 3);
const emailField = analysis.fields.find((f) => f.path === 'email');
ok('analyzer reports fill rate/types/distinct', emailField.fillRate === 100 && emailField.types.string === 3 && emailField.distinct === 3);
const tagsField = analysis.fields.find((f) => f.path === 'tags');
ok('analyzer detects arrays', tagsField.types.array === 3);

/* ---- indexes survive writes ---- */
e.insertOne('feat', 'users', { name: 'New', email: 'new@x.io', team: 'core', age: 20 });
const indexes = e.listIndexes('feat', 'users');
const emailIdx = indexes.find((i) => i.field === 'email');
ok('unique index rebuilt after write', emailIdx.unique === true && emailIdx.entryCount === 4);
const compoundIdx = indexes.find((i) => i.field === 'team+age');
ok('compound index rebuilt after write', compoundIdx.fields.join('+') === 'team+age' && compoundIdx.entryCount >= 4);

/* ---- revision restore respects unique indexes ---- */
const ada = e.find('feat', 'users', { filter: { email: 'ada@x.io' } }).documents[0];
e.updateOne('feat', 'users', { _id: ada._id }, { $set: { email: 'ada2@x.io' } });
const rev = e.listHistory('feat', 'users', { id: ada._id, limit: 5 }).find((r) => r.op === 'update');
const other = e.find('feat', 'users', { filter: { email: 'new@x.io' } }).documents[0];
e.updateOne('feat', 'users', { _id: other._id }, { $set: { email: 'ada@x.io' } });
assert.throws(() => e.restoreRevision('feat', 'users', rev.revId), /Unique index violation/);
ok('revision restore cannot violate a unique index', true);

/* ---- dropping a collection feeds the trash ---- */
e.createCollection('feat', 'scratch');
e.insertOne('feat', 'scratch', { note: 'keep me' });
e.dropCollection('feat', 'scratch');
const dropTrash = e.listTrash('feat', { coll: 'scratch' });
ok('drop collection keeps documents in the trash', dropTrash.length === 1 && dropTrash[0].doc.note === 'keep me');
e.emptyTrash('feat');

console.log(`\nALL ${passed} FEATURE TESTS PASSED`);
fs.rmSync(dir, { recursive: true, force: true });
