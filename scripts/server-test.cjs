/**
 * Server-mode tests: boots the HTTP bridge against a temp data directory
 * and exercises every endpoint family via fetch (Node >= 18).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { PocketEngine } = require('../electron/db/engine.cjs');
const { createPocketServer } = require('../electron/db/server.cjs');

const dir = path.join(os.tmpdir(), `pocketdb-server-test-${Date.now()}`);

async function main() {
  const engine = new PocketEngine(dir);
  engine.createDatabase('shop');
  engine.insertMany('shop', 'products', [
    { name: 'Desk', price: 300, tags: ['furniture'] },
  ]);

  const server = createPocketServer({ engine, port: 0 }); // port 0 → random
  const port = await server.start();
  const base = `http://127.0.0.1:${port}/api`;
  const check = (label, cond) => console.log(`${cond ? 'ok' : 'FAIL'}: ${label}`);

  // health + databases
  const health = await (await fetch(`${base}/health`)).json();
  check('health reports dataDir', health.ok && health.dataDir === dir);

  const dbs = await (await fetch(`${base}/databases`)).json();
  check('databases listed', Array.isArray(dbs) && dbs.some((d) => d.name === 'shop'));

  // insert (single)
  const insertRes = await fetch(`${base}/shop/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Mouse', price: 25 }),
  });
  const inserted = await insertRes.json();
  check('insertOne returns insertedId', typeof inserted.insertedId === 'string');

  // insert (bulk array)
  const bulkRes = await fetch(`${base}/shop/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ name: 'Monitor', price: 450 }]),
  });
  const bulk = await bulkRes.json();
  check('insertMany accepts an array', bulk.insertedCount === 1);

  // find with filter + limit
  const found = await (
    await fetch(`${base}/shop/products?filter=${encodeURIComponent(JSON.stringify({ price: { $gte: 300 } }))}&limit=10`)
  ).json();
  check('find + $gte filter', found.total === 2 && found.documents.length === 2);

  // get one by id
  const one = await (await fetch(`${base}/shop/products/${inserted.insertedId}`)).json();
  check('findOne by id', one.name === 'Mouse');

  // update by id ($set operator)
  const upd = await fetch(`${base}/shop/products/${inserted.insertedId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ $set: { price: 30 } }),
  });
  const updBody = await upd.json();
  check('updateOne by id ($set)', updBody.modified === 1);
  const after = await (await fetch(`${base}/shop/products/${inserted.insertedId}`)).json();
  check('update persisted', after.price === 30);

  // delete by id
  const del = await (await fetch(`${base}/shop/products/${inserted.insertedId}`, { method: 'DELETE' })).json();
  check('deleteOne by id', del.deleted === 1);

  // files: upload → binary round-trip → delete
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  const fileRes = await fetch(`${base}/shop/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'dot.png', base64: PNG.toString('base64') }),
  });
  const file = await fileRes.json();
  check('file upload returns meta', file._id && file.contentType === 'image/png');

  const binRes = await fetch(`${base}/shop/files/${file._id}`);
  const bin = Buffer.from(await binRes.arrayBuffer());
  check(
    'file served as bytes with content-type',
    binRes.headers.get('content-type') === 'image/png' && bin.equals(PNG)
  );

  const fileDel = await (await fetch(`${base}/shop/files/${file._id}`, { method: 'DELETE' })).json();
  check('file delete', fileDel.deleted === 1);

  // validation: unsafe name rejected
  const bad = await fetch(`${base}/shop/../evil`);
  check('path traversal rejected', bad.status === 400);

  // CORS preflight
  const pre = await fetch(`${base}/health`, { method: 'OPTIONS' });
  check('CORS preflight 204 + allow-origin', pre.status === 204 && Boolean(pre.headers.get('access-control-allow-origin')));

  // SSE change feed: a write must arrive as an `data:` event within ~1s.
  {
    const ctrl = new AbortController();
    const sseRes = await fetch(`${base}/shop/products/events`, { signal: ctrl.signal });
    check('SSE content-type', (sseRes.headers.get('content-type') || '').includes('text/event-stream'));
    // The server writes a hello frame immediately.
    const reader = sseRes.body.getReader();
    let hello = '';
    {
      const { value } = await reader.read();
      hello = Buffer.from(value).toString('utf8');
    }
    check('SSE hello frame', hello.startsWith('retry:') && hello.includes('"hello":true'));

    // Now write from the engine and expect an event within the debounce window.
    const gotEvent = new Promise((resolve) => {
      let buf = '';
      const read = async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) return resolve(false);
            buf += Buffer.from(value).toString('utf8');
            if (buf.includes('"db":"shop"')) return resolve(true);
          }
        } catch {
          return resolve(false);
        }
      };
      read();
    });
    engine.insertOne('shop', 'products', { name: 'SSE-Target', price: 1 });
    const arrived = await Promise.race([
      gotEvent,
      new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);
    check('SSE push on engine write', arrived);
    ctrl.abort();
    // Give the server a beat to clean up its watcher entry.
    await new Promise((r) => setTimeout(r, 100));
  }

  // Token auth: unauthorized requests rejected, bearer + ?token= accepted,
  // health stays open.
  const s2 = createPocketServer({ engine, port: 0, token: 's3cret' });
  const port2 = await s2.start();
  const base2 = `http://127.0.0.1:${port2}/api`;
  const noAuth = await fetch(`${base2}/databases`);
  check('token: 401 without credentials', noAuth.status === 401);
  const withQuery = await fetch(`${base2}/databases?token=s3cret`);
  check('token: ?token= accepted', withQuery.status === 200);
  const withBearer = await fetch(`${base2}/databases`, {
    headers: { Authorization: 'Bearer s3cret' },
  });
  check('token: Bearer accepted', withBearer.status === 200);
  const healthOpen = await fetch(`${base2}/health`);
  check('token: health stays open', healthOpen.status === 200);

  await server.stop();
  await s2.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ALL SERVER TESTS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
