/* MCP stdio smoke test (run with: node scripts/mcp-test.cjs) */
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { spawn } = require('child_process');
const { PocketEngine } = require('../electron/db/engine.cjs');

(async () => {
  const dir = path.join(os.tmpdir(), 'pocketdb-mcp-' + Date.now());
  const seed = new PocketEngine(dir);
  seed.createDatabase('mcpdb');
  seed.createCollection('mcpdb', 'notes');
  seed.insertOne('mcpdb', 'notes', { title: 'hello', n: 1 });

  const serverScript = process.argv[2] || path.join(__dirname, '..', 'electron', 'mcp-server.cjs');
  const child = spawn(process.execPath, [serverScript, '--data', dir], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';
  const pending = new Map();
  let nextId = 1;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });

  const call = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}. stderr: ${stderr}`));
      }
    }, 5000);
  });

  const init = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  assert.strictEqual(init.result.serverInfo.name, 'pocketdb');
  console.log('ok   initialize');

  const list = await call('tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  assert.ok(names.includes('find') && names.includes('insert_one') && names.includes('explain'));
  console.log(`ok   tools/list (${names.length} tools)`);

  const dbs = await call('tools/call', { name: 'list_databases', arguments: {} });
  const dbData = JSON.parse(dbs.result.content[0].text);
  assert.ok(dbData.some((d) => d.name === 'mcpdb'));
  console.log('ok   tools/call list_databases');

  const ins = await call('tools/call', {
    name: 'insert_one',
    arguments: { db: 'mcpdb', coll: 'notes', document: { title: 'from mcp', n: 2 } },
  });
  assert.ok(JSON.parse(ins.result.content[0].text).insertedId);
  console.log('ok   tools/call insert_one');

  const found = await call('tools/call', {
    name: 'find',
    arguments: { db: 'mcpdb', coll: 'notes', filter: { n: { $gte: 2 } } },
  });
  const foundData = JSON.parse(found.result.content[0].text);
  assert.strictEqual(foundData.total, 1);
  assert.strictEqual(foundData.documents[0].title, 'from mcp');
  console.log('ok   tools/call find');

  const bad = await call('tools/call', { name: 'nope', arguments: {} });
  assert.strictEqual(bad.result.isError, true);
  console.log('ok   unknown tool reports isError');

  const expl = await call('tools/call', {
    name: 'explain',
    arguments: { db: 'mcpdb', coll: 'notes', filter: { title: 'hello' } },
  });
  assert.ok(JSON.parse(expl.result.content[0].text).plan.length > 0);
  console.log('ok   tools/call explain');

  child.stdin.end();
  child.kill();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nALL MCP TESTS PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
