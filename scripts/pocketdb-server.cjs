#!/usr/bin/env node
/**
 * PocketDB HTTP bridge — standalone CLI.
 *
 * Exposes a PocketDB data directory over HTTP so any local app (React,
 * Express, scripts) can read/write it. Binds 127.0.0.1 by default;
 * --lan opts into 0.0.0.0 and --token adds bearer-token auth.
 *
 * Usage:
 *   node scripts/pocketdb-server.cjs [dataDir] [port] [--lan] [--token=SECRET]
 *
 *   dataDir  defaults to %APPDATA%/PocketDB/pocketdb-data
 *            (or $POCKETDB_DATA_DIR)
 *   port     defaults to 7400 (or $POCKETDB_PORT)
 */
'use strict';

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { PocketEngine } = require('../electron/db/engine.cjs');
const { createPocketServer } = require('../electron/db/server.cjs');

function defaultDataDir() {
  if (process.env.POCKETDB_DATA_DIR) return process.env.POCKETDB_DATA_DIR;
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'PocketDB', 'pocketdb-data');
}

const args = process.argv.slice(2);
const positional = [];
let lan = false;
let token = process.env.POCKETDB_TOKEN || null;

for (const arg of args) {
  if (arg === '--lan') lan = true;
  else if (arg.startsWith('--token=')) token = arg.slice('--token='.length);
  else positional.push(arg);
}

const dataDir = path.resolve(positional[0] || defaultDataDir());
const port = Number(positional[1] || process.env.POCKETDB_PORT || 7400);
const host = lan ? '0.0.0.0' : '127.0.0.1';

if (!token && lan) {
  // A LAN-exposed database without a shared secret is asking for trouble;
  // generate one and print it so the operator can hand it to clients.
  token = crypto.randomBytes(16).toString('hex');
  console.log(`[pocketdb] LAN mode with no --token given — generated one: ${token}`);
}

console.log(`[pocketdb] engine data dir : ${dataDir}`);
console.log(`[pocketdb] binding         : http://${host}:${port}${lan ? ' (LAN)' : ' (localhost only)'}`);
console.log(`[pocketdb] auth            : ${token ? 'bearer token required' : 'none'}`);

const engine = new PocketEngine(dataDir);
const server = createPocketServer({ engine, port, host, token });

server
  .start()
  .then((actualPort) => {
    console.log('[pocketdb] HTTP bridge ready. Endpoints:');
    console.log(`  GET    http://127.0.0.1:${actualPort}/api/health`);
    console.log(`  GET    http://127.0.0.1:${actualPort}/api/databases`);
    console.log(`  GET    http://127.0.0.1:${actualPort}/api/:db/:coll?filter={"a":1}&limit=50&skip=0`);
    console.log(`  POST   http://127.0.0.1:${actualPort}/api/:db/:coll          (JSON body = document | array)`);
    console.log(`  GET/PUT/DELETE http://127.0.0.1:${actualPort}/api/:db/:coll/:id`);
    console.log(`  GET    http://127.0.0.1:${actualPort}/api/:db/:coll/events   (SSE change feed)`);
    console.log(`  POST   http://127.0.0.1:${actualPort}/api/:db/files          ({ filename, base64 })`);
    console.log(`  GET    http://127.0.0.1:${actualPort}/api/:db/files/:id      (raw bytes)`);
    console.log('[pocketdb] press Ctrl+C to stop');
  })
  .catch((err) => {
    console.error(`[pocketdb] failed to start: ${err.message}`);
    process.exit(1);
  });

process.on('SIGINT', async () => {
  await server.stop();
  process.exit(0);
});
