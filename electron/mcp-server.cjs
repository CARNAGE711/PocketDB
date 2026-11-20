#!/usr/bin/env node
/**
 * PocketDB MCP server (stdio).
 *
 * Exposes the PocketDB engine to MCP clients (Claude Desktop, Cursor, etc.)
 * over newline-delimited JSON-RPC 2.0 on stdin/stdout. Logs go to stderr so
 * the protocol stream stays clean.
 *
 * Usage:
 *   node electron/mcp-server.cjs --data "C:\path\to\pocketdb-data"
 *
 * Client config (Claude Desktop / Cursor):
 *   {
 *     "mcpServers": {
 *       "pocketdb": {
 *         "command": "node",
 *         "args": ["<path>/electron/mcp-server.cjs", "--data", "<dataDir>"]
 *       }
 *     }
 *   }
 *
 * Tools mirror the engine API: list/inspect namespaces, find, insert, update,
 * delete, aggregate, indexes, explain, schema analysis, views and trash.
 */
'use strict';

const path = require('path');
const { PocketEngine } = require('./db/engine.cjs');

const VERSION = '1.0.0';

/* ------------------------------ arguments ----------------------------- */

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return null;
}

const dataDir = path.resolve(
  argValue('--data') || process.env.POCKETDB_DATA_DIR || path.join(process.cwd(), 'pocketdb-data')
);

const engine = new PocketEngine(dataDir);

/* -------------------------------- tools ------------------------------- */

const tools = [
  {
    name: 'list_databases',
    description: 'List every database in the PocketDB data directory with its collections and document counts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => engine.listDatabases(),
  },
  {
    name: 'list_collections',
    description: 'List collections (and saved views) in a database with document counts and sizes.',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string', description: 'Database name' } },
      required: ['db'],
      additionalProperties: false,
    },
    run: ({ db }) => engine.listCollections(db),
  },
  {
    name: 'find',
    description:
      'Query documents with a MongoDB-style filter (dot-notation, $eq $ne $gt $gte $lt $lte $in $nin $exists $regex $text $and $or $not), optional sort, skip, limit and projection.',
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string' },
        coll: { type: 'string' },
        filter: { type: 'object', description: 'MongoDB-style selector (default {})' },
        sort: { type: 'object', description: 'e.g. { "createdAt": -1 }' },
        skip: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 0 },
        projection: { type: 'object', description: 'e.g. { "_id": 0, "name": 1 }' },
      },
      required: ['db', 'coll'],
      additionalProperties: false,
    },
    run: ({ db, coll, filter, sort, skip, limit, projection }) =>
      engine.find(db, coll, { filter, sort, skip, limit, projection }),
  },
  {
    name: 'insert_one',
    description: 'Insert one JSON document. _id is auto-assigned when omitted; unique indexes are enforced.',
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string' },
        coll: { type: 'string' },
        document: { type: 'object' },
      },
      required: ['db', 'coll', 'document'],
      additionalProperties: false,
    },
    run: ({ db, coll, document }) => engine.insertOne(db, coll, document),
  },
  {
    name: 'insert_many',
    description: 'Insert an array of JSON documents in one write.',
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string' },
        coll: { type: 'string' },
        documents: { type: 'array', items: { type: 'object' } },
      },
      required: ['db', 'coll', 'documents'],
      additionalProperties: false,
    },
    run: ({ db, coll, documents }) => engine.insertMany(db, coll, documents),
  },
  {
    name: 'update_many',
    description: 'Apply a MongoDB-style update ($set / $unset / $inc / $push / $pull / $rename) to every matching document.',
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string' },
        coll: { type: 'string' },
        filter: { type: 'object' },
        update: { type: 'object', description: 'e.g. { "$set": { "status": "active" } }' },
      },
      required: ['db', 'coll', 'filter', 'update'],
      additionalProperties: false,
    },
    run: ({ db, coll, filter, update }) => engine.updateMany(db, coll, filter, update),
  },
  {
    name: 'delete_many',
    description: 'Delete every matching document. Deletions are kept in the trash for later restore.',
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string' },
        coll: { type: 'string' },
        filter: { type: 'object' },
      },
      required: ['db', 'coll', 'filter'],
      additionalProperties: false,
    },
    run: ({ db, coll, filter }) => engine.deleteMany(db, coll, filter),
  },
  {
    name: 'aggregate',
    description:
      'Run an aggregation pipeline: $match, $sort, $limit, $skip, $project, $count, $unwind, $group, $lookup, $replaceRoot.',
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string' },
        coll: { type: 'string' },
        pipeline: { type: 'array', items: { type: 'object' } },
      },
      required: ['db', 'coll', 'pipeline'],
      additionalProperties: false,
    },
    run: ({ db, coll, pipeline }) => engine.aggregate(db, coll, pipeline),
  },
  {
    name: 'create_index',
    description:
      'Create a single-field or compound ("a+b") index. Unique indexes reject duplicate indexed values on write.',
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string' },
        coll: { type: 'string' },
        field: { type: 'string', description: 'Field path, or "a+b" for a compound index' },
        unique: { type: 'boolean' },
      },
      required: ['db', 'coll', 'field'],
      additionalProperties: false,
    },
    run: ({ db, coll, field, unique }) => engine.createIndex(db, coll, field, { unique: Boolean(unique) }),
  },
  {
    name: 'list_indexes',
    description: 'List indexes on a collection (fields, uniqueness, key counts).',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' }, coll: { type: 'string' } },
      required: ['db', 'coll'],
      additionalProperties: false,
    },
    run: ({ db, coll }) => engine.listIndexes(db, coll),
  },
  {
    name: 'explain',
    description: 'Explain a filter: index scan vs collection scan, documents examined, matches and timing.',
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string' },
        coll: { type: 'string' },
        filter: { type: 'object' },
        sort: { type: 'object' },
      },
      required: ['db', 'coll'],
      additionalProperties: false,
    },
    run: ({ db, coll, filter, sort }) => engine.explain(db, coll, { filter, sort }),
  },
  {
    name: 'analyze_schema',
    description: 'Summarize field distribution across documents: fill rate, JSON types, distinct values and samples.',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' }, coll: { type: 'string' } },
      required: ['db', 'coll'],
      additionalProperties: false,
    },
    run: ({ db, coll }) => engine.analyzeSchema(db, coll),
  },
  {
    name: 'list_views',
    description: 'List saved views (read-only pipelines) in a database.',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' } },
      required: ['db'],
      additionalProperties: false,
    },
    run: ({ db }) => engine.listViews(db),
  },
  {
    name: 'save_view',
    description: 'Create or update a saved view: a named, read-only pipeline over an existing collection.',
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string' },
        name: { type: 'string' },
        coll: { type: 'string', description: 'Source collection' },
        pipeline: { type: 'array', items: { type: 'object' } },
      },
      required: ['db', 'name', 'coll', 'pipeline'],
      additionalProperties: false,
    },
    run: ({ db, name, coll, pipeline }) => engine.saveView(db, { name, coll, pipeline }),
  },
  {
    name: 'list_trash',
    description: 'List soft-deleted documents (newest first), optionally for one collection.',
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string' },
        coll: { type: 'string' },
        limit: { type: 'integer', minimum: 1 },
      },
      required: ['db'],
      additionalProperties: false,
    },
    run: ({ db, coll, limit }) => engine.listTrash(db, { coll, limit }),
  },
  {
    name: 'restore_trash',
    description: 'Restore a soft-deleted document by its trashId.',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' }, trashId: { type: 'string' } },
      required: ['db', 'trashId'],
      additionalProperties: false,
    },
    run: ({ db, trashId }) => engine.restoreTrash(db, trashId),
  },
];

const toolMap = new Map(tools.map((t) => [t.name, t]));

/* ------------------------------- protocol ----------------------------- */

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function toolResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  if (method === 'initialize') {
    reply(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'pocketdb', version: VERSION },
      instructions:
        `PocketDB local NoSQL studio at ${dataDir}. ` +
        'Use list_databases / list_collections to discover data, then find/aggregate to read and ' +
        'insert/update/delete to write. Deletes are restorable from the trash.',
    });
    return;
  }

  if (method === 'notifications/initialized' || isNotification) return;

  if (method === 'ping') {
    reply(id, {});
    return;
  }

  if (method === 'tools/list') {
    reply(id, {
      tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
    return;
  }

  if (method === 'tools/call') {
    const name = params?.name;
    const tool = toolMap.get(name);
    if (!tool) {
      reply(id, toolResult(`Unknown tool "${name}". Available: ${[...toolMap.keys()].join(', ')}`, true));
      return;
    }
    try {
      const args = params?.arguments || {};
      const value = await tool.run(args);
      reply(id, toolResult(value));
    } catch (err) {
      reply(id, toolResult(`PocketDB error: ${err.message}`, true));
    }
    return;
  }

  if (method === 'resources/list') {
    reply(id, { resources: [] });
    return;
  }

  replyError(id, -32601, `Method not found: ${method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      process.stderr.write(`[pocketdb-mcp] invalid JSON: ${err.message}\n`);
      continue;
    }
    Promise.resolve(handle(msg)).catch((err) => {
      process.stderr.write(`[pocketdb-mcp] ${err.stack || err.message}\n`);
      if (msg && msg.id !== undefined) replyError(msg.id, -32603, err.message);
    });
  }
});

process.stdin.on('end', () => process.exit(0));

process.stderr.write(`[pocketdb-mcp] ready — data directory: ${dataDir}\n`);
