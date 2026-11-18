/**
 * PocketDB — Local HTTP bridge ("server mode").
 *
 * A dependency-free Node HTTP server that exposes the engine to other
 * local apps — e.g. a React web application's backend. By default it
 * binds to 127.0.0.1 ONLY, so it is never reachable from other machines,
 * and it reuses the same engine (and its cross-process write locks) as the
 * studio, so concurrent writers stay safe. A shared-secret bearer token
 * and a 0.0.0.0 "LAN mode" are opt-in.
 *
 * Endpoints (JSON unless noted):
 *   GET    /api/health                     → { ok, dataDir }
 *   GET    /api/databases                  → databases + collection stats
 *   GET    /api/:db                        → collections of a database
 *   GET    /api/:db/:coll                  → find  (?filter=&sort=&limit=&skip=)
 *   POST   /api/:db/:coll                  → insertOne (object) | insertMany (array)
 *   PUT    /api/:db/:coll?filter=...       → updateOne (body = update spec)
 *   DELETE /api/:db/:coll?filter=...       → deleteMany
 *   GET    /api/:db/:coll/:id              → findOne by _id
 *   PUT    /api/:db/:coll/:id              → updateOne by _id
 *   DELETE /api/:db/:coll/:id              → deleteOne by _id
 *   GET    /api/:db/:coll/events           → SSE change feed (live writes)
 *   GET    /api/:db/files                  → file metadata list
 *   POST   /api/:db/files                  → putFile { filename, base64, contentType }
 *   GET    /api/:db/files/:id              → raw bytes (binary response)
 *   DELETE /api/:db/files/:id              → deleteFile
 *
 * CORS is open (reflected origin) so browser apps on any localhost port
 * can call it; the bind address keeps exposure local.
 */
'use strict';

const http = require('http');
const { assertValidName } = require('./storage.cjs');

// Generous enough for a 16 MB file's base64 encoding (~33% larger).
const MAX_BODY_BYTES = 25 * 1024 * 1024;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
}

/** Check the opt-in shared secret (Authorization: Bearer or ?token=). */
function isAuthorized(req, url, token) {
  if (!token) return true;
  if (url.searchParams.get('token') === token) return true;
  const header = req.headers.authorization || '';
  return header === `Bearer ${token}`;
}

/** Read + parse a JSON request body (empty bodies resolve to undefined). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(Object.assign(new Error(`Invalid JSON body: ${err.message}`), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** Parse a JSON query-string parameter (?filter={"a":1}). */
function parseJsonParam(raw) {
  if (raw == null || raw === '') return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw Object.assign(new Error(`Query parameter is not valid JSON: ${err.message}`), { status: 400 });
  }
}

function createPocketServer({ engine, port = 7400, host = '127.0.0.1', token = null }) {
  let server = null;
  let watchers = new Set(); // active SSE subscriptions

  async function handle(req, res) {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (!url.pathname.startsWith('/api/')) {
      return json(res, 404, { error: 'Not found.' });
    }

    // Health stays open for reachability checks; everything else
    // honours the shared secret when one is configured.
    const isHealth = url.pathname === '/api/health';
    if (!isHealth && !isAuthorized(req, url, token)) {
      return json(res, 401, { error: 'Unauthorized — provide the API token.' });
    }

    const parts = url.pathname.slice('/api/'.length).split('/').filter(Boolean);

    /* ---------------------------- health ---------------------------- */
    if (parts.length === 0 && req.method === 'GET') {
      return json(res, 200, { ok: true, engine: 'PocketDB', dataDir: engine.dataDir });
    }
    if (parts.length === 1 && parts[0] === 'health' && req.method === 'GET') {
      return json(res, 200, { ok: true, engine: 'PocketDB', dataDir: engine.dataDir });
    }
    if (parts[0] === 'databases' && parts.length === 1 && req.method === 'GET') {
      return json(res, 200, engine.listDatabases());
    }

    try {
      const db = parts[0];
      assertValidName(db, 'database');
      const seg1 = parts[1];
      const seg2 = parts[2];

      /* ------------- SSE change feed (live writes) -------------------- */
      if (seg2 === 'events' && req.method === 'GET') {
        assertValidName(seg1, 'collection');
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('retry: 3000\n\n');
        const send = (payload) => {
          try {
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          } catch {
            /* connection already gone */
          }
        };
        send({ hello: true, db, at: Date.now() });
        const off = engine.watch(db, null, send);
        watchers.add(off);
        const close = () => {
          off();
          watchers.delete(off);
        };
        res.on('close', close);
        req.on('close', close);
        return; // response stays open
      }

      /* ----------------------------- files ---------------------------- */
      if (seg1 === 'files') {
        if (!seg2) {
          if (req.method === 'GET') return json(res, 200, engine.listFiles(db));
          if (req.method === 'POST') {
            const body = await readBody(req);
            const meta = engine.putFile(db, {
              filename: body?.filename,
              data: Buffer.from(String(body?.base64 || ''), 'base64'),
              contentType: body?.contentType,
              metadata: body?.metadata,
            });
            return json(res, 201, meta);
          }
          return json(res, 405, { error: 'Method not allowed.' });
        }

        if (req.method === 'GET') {
          const file = engine.getFile(db, seg2);
          if (!file) return json(res, 404, { error: 'File not found.' });
          const bytes = Buffer.from(file.base64, 'base64');
          res.writeHead(200, {
            'Content-Type': file.contentType || 'application/octet-stream',
            'Content-Length': bytes.length,
            'Content-Disposition': `inline; filename="${encodeURIComponent(file.filename)}"`,
          });
          res.end(bytes);
          return;
        }
        if (req.method === 'DELETE') return json(res, 200, engine.deleteFile(db, seg2));
        return json(res, 405, { error: 'Method not allowed.' });
      }

      /* ------------------- collections & documents -------------------- */
      const coll = seg1;
      assertValidName(coll, 'collection');

      if (!seg2) {
        if (req.method === 'GET') {
          const result = engine.find(db, coll, {
            filter: parseJsonParam(url.searchParams.get('filter')),
            sort: parseJsonParam(url.searchParams.get('sort')),
            limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
            skip: url.searchParams.has('skip') ? Number(url.searchParams.get('skip')) : undefined,
            projection: parseJsonParam(url.searchParams.get('projection')),
          });
          return json(res, 200, result);
        }
        if (req.method === 'POST') {
          const body = await readBody(req);
          if (Array.isArray(body)) return json(res, 201, engine.insertMany(db, coll, body));
          return json(res, 201, engine.insertOne(db, coll, body));
        }
        if (req.method === 'PUT') {
          const update = await readBody(req);
          const filter = parseJsonParam(url.searchParams.get('filter')) || {};
          return json(res, 200, engine.updateOne(db, coll, filter, update));
        }
        if (req.method === 'DELETE') {
          const filter = parseJsonParam(url.searchParams.get('filter')) || {};
          return json(res, 200, engine.deleteMany(db, coll, filter));
        }
        return json(res, 405, { error: 'Method not allowed.' });
      }

      // Single document by _id
      const id = seg2;
      if (req.method === 'GET') {
        const doc = engine.findOne(db, coll, { filter: { _id: id } });
        if (!doc) return json(res, 404, { error: 'Document not found.' });
        return json(res, 200, doc);
      }
      if (req.method === 'PUT') {
        const update = await readBody(req);
        return json(res, 200, engine.updateOne(db, coll, { _id: id }, update));
      }
      if (req.method === 'DELETE') return json(res, 200, engine.deleteOne(db, coll, { _id: id }));
      return json(res, 405, { error: 'Method not allowed.' });
    } catch (err) {
      return json(res, err.status || 400, { error: err.message || String(err) });
    }
  }

  return {
    get running() {
      return Boolean(server);
    },
    get token() {
      return token;
    },

    /** Start listening; resolves with the actual bound port. */
    start() {
      if (server) return Promise.resolve(server.address().port);
      return new Promise((resolve, reject) => {
        const s = http.createServer((req, res) => {
          handle(req, res).catch((err) => {
            try { json(res, 500, { error: err.message || 'Internal error' }); } catch { /* closed */ }
          });
        });
        s.once('error', reject);
        s.listen(port, host, () => {
          server = s;
          resolve(s.address().port);
        });
      });
    },

    stop() {
      return new Promise((resolve) => {
        for (const off of watchers) {
          try { off(); } catch { /* already closed */ }
        }
        watchers.clear();
        if (!server) return resolve();
        const s = server;
        server = null;
        s.close(() => resolve());
      });
    },

    address() {
      return server ? { port: server.address().port, host, lan: host !== '127.0.0.1' } : null;
    },
  };
}

module.exports = { createPocketServer };
