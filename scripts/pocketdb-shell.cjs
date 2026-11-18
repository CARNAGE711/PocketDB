#!/usr/bin/env node
/**
 * PocketDB shell — an interactive REPL over the same engine the studio uses.
 *
 * Every command talks directly to the file-based engine, so anything typed
 * here appears in the studio (and vice versa, thanks to cross-process locks).
 *
 * Usage:
 *   node scripts/pocketdb-shell.cjs [dataDir] [--passphrase=SECRET]
 *
 * Commands (dot-prefixed, Mongo-shell flavored):
 *   .dbs                       list databases
 *   .use <db>                  switch database
 *   .collections               list collections in the current db
 *   .insert <coll> <json>      insert one document (or multi-line paste)
 *   .find <coll> [filter]      pretty-print up to 25 matches (see .findopts)
 *   .update <coll> <filter> <update>   updateOne (use .updatemany for all)
 *   .updatemany <coll> <filter> <update>
 *   .delete <coll> [filter]    deleteOne (use .deletemany for all)
 *   .deletemany <coll> [filter]
 *   .count <coll> [filter]     count matches
 *   .aggregate <coll> <pipeline-json>  run an aggregation pipeline
 *   .indexes <coll>            list sidecar indexes
 *   .mkindex <coll> <field>    create an index
 *   .rmindex <coll> <field>    drop an index
 *   .schema <coll> [rules]     get / set validation rules ('.schema coll' shows)
 *   .history <coll> [id]       revision log (optionally one document's)
 *   .files <db>                list files stored in a database
 *   .rmcoll <coll>             drop a collection (with confirm)
 *   .findopts                  show the find options syntax
 *   .help                      all commands
 *   .exit                      leave the shell
 *
 * Free-form JavaScript is NOT evaluated on purpose — input is parsed as
 * JSON, never executed, so pasted data can never run code.
 */
'use strict';

const path = require('path');
const os = require('os');
const readline = require('readline');
const { PocketEngine } = require('../electron/db/engine.cjs');

/* ------------------------------ helpers ------------------------------ */

function defaultDataDir() {
  if (process.env.POCKETDB_DATA_DIR) return process.env.POCKETDB_DATA_DIR;
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'PocketDB', 'pocketdb-data');
}

function parseJsonOrThrow(text, what = 'JSON') {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid ${what}: ${err.message}`);
  }
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function short(value, max = 72) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  brand: (s) => `\x1b[36m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
};

/* ------------------------------- state ------------------------------- */

const args = process.argv.slice(2);
const positional = [];
let passphrase = process.env.POCKETDB_PASSPHRASE || null;
for (const a of args) {
  if (a.startsWith('--passphrase=')) passphrase = a.slice('--passphrase='.length);
  else positional.push(a);
}

const dataDir = path.resolve(positional[0] || defaultDataDir());
const engine = new PocketEngine(dataDir, { passphrase });
let currentDb = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '',
  terminal: process.stdin.isTTY === true,
});

function prompt() {
  const where = currentDb ? `${currentDb}> ` : 'pocketdb> ';
  rl.setPrompt(C.brand(where));
  rl.prompt();
}

function printDbList() {
  const dbs = engine.listDatabases();
  for (const d of dbs) {
    const docs = d.collections.reduce((s, c) => s + c.count, 0);
    console.log(`  ${d.name.padEnd(24)} ${C.dim(`${d.collections.length} coll(s) · ${docs} doc(s)`)}`);
  }
  if (dbs.length === 0) console.log(C.dim('  (no databases yet — .use <name> creates one)'));
}

function findDocs(coll, rest) {
  // .find coll [filter] [sort] [limit] — the tail args are JSON snippets.
  const parts = rest.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) || [];
  const [, filterText = '{}', sortText, limitText] = parts;
  const filter = parseJsonOrThrow(filterText || '{}', 'filter');
  const sort = sortText ? parseJsonOrThrow(sortText, 'sort') : undefined;
  const limit = limitText ? Number(limitText) : 25;
  const { documents, total } = engine.find(currentDb, coll, { filter, sort, limit });
  console.log(C.dim(`matched ${total} · showing ${documents.length}${limit ? ` (limit ${limit})` : ''}`));
  for (const d of documents) {
    console.log(`  ${C.brand(d._id)}  ${C.dim(short(d, 90))}`);
  }
}

/* ----------------------------- commands ------------------------------ */

const HELP = `
  ${C.brand('.dbs')}                                   list databases
  ${C.brand('.use')} <db>                              switch (or create) a database
  ${C.brand('.collections')}                           list collections here
  ${C.brand('.insert')} <coll> <json>                  insert one document
  ${C.brand('.find')} <coll> [filter] [sort] [limit]   query documents
  ${C.brand('.update')} <coll> <filter> <update>       update the first match
  ${C.brand('.updatemany')} <coll> <filter> <update>   update every match
  ${C.brand('.delete')} <coll> [filter]                delete the first match
  ${C.brand('.deletemany')} <coll> [filter]            delete every match
  ${C.brand('.count')} <coll> [filter]                 count matches
  ${C.brand('.aggregate')} <coll> <pipeline>           run an aggregation pipeline
  ${C.brand('.mkindex')} <coll> <field> · .rmindex …   manage indexes
  ${C.brand('.indexes')} <coll>                        list indexes
  ${C.brand('.schema')} <coll> [rules]                 get/set validation rules
  ${C.brand('.history')} <coll> [_id]                  revision log
  ${C.brand('.files')} <db>                            list stored files
  ${C.brand('.rmcoll')} <coll>                         drop a collection
  ${C.brand('.help')} · .exit
`.trim();

const commands = {
  help() {
    console.log(HELP);
  },

  dbs() {
    printDbList();
  },

  use(rest) {
    const name = rest.trim();
    if (!name) {
      printDbList();
      return;
    }
    if (!/^[\w-]{1,64}$/.test(name)) {
      throw new Error('Database names use 1-64 chars: a-z A-Z 0-9 _ -');
    }
    if (!engine.storage.databaseExists(name)) engine.createDatabase(name);
    currentDb = name;
    console.log(C.ok(`switched to db ${name}`));
  },

  collections() {
    if (!currentDb) throw new Error('No database selected — run .use <db> first.');
    const colls = engine.listCollections(currentDb, { includeSystem: false });
    for (const c of colls) {
      console.log(`  ${c.name.padEnd(24)} ${C.dim(`${c.count} docs · ${c.size} bytes`)}`);
    }
    if (colls.length === 0) console.log(C.dim('  (empty)'));
  },

  insert(rest) {
    if (!currentDb) throw new Error('No database selected — run .use <db> first.');
    const sp = rest.indexOf(' ');
    if (sp < 0) throw new Error('Usage: .insert <coll> <json-document>');
    const coll = rest.slice(0, sp).trim();
    const text = rest.slice(sp + 1).trim();
    if (!text) throw new Error('Provide a JSON document to insert.');
    const doc = parseJsonOrThrow(text, 'document');
    const res = engine.insertOne(currentDb, coll, doc);
    console.log(C.ok(`inserted _id ${res.insertedId} into ${coll}`));
  },

  find(rest) {
    if (!currentDb) throw new Error('No database selected — run .use <db> first.');
    const coll = rest.trim().split(/\s+/)[0];
    if (!coll) throw new Error('Usage: .find <coll> [filter]');
    findDocs(coll, rest.trim());
  },

  update(rest, { many = false } = {}) {
    if (!currentDb) throw new Error('No database selected — run .use <db> first.');
    // Split into three JSON-ish args, respecting quoted strings.
    const parts = [];
    const re = /(?:[^\s"']|"[^"]*"|'[^']*')+/g;
    let m;
    while ((m = re.exec(rest)) !== null) parts.push(m[0]);
    const [coll, filterText = '{}', updateText] = parts;
    if (!coll || !updateText) throw new Error('Usage: .update <coll> <filter> <update>');
    const res = many
      ? engine.updateMany(currentDb, coll, parseJsonOrThrow(filterText, 'filter'), parseJsonOrThrow(updateText, 'update'))
      : engine.updateOne(currentDb, coll, parseJsonOrThrow(filterText, 'filter'), parseJsonOrThrow(updateText, 'update'));
    console.log(C.ok(`matched ${res.matched} · modified ${res.modified}`));
  },

  updatemany(rest) {
    commands.update.call(null, rest, { many: true });
  },

  delete(rest, { many = false } = {}) {
    if (!currentDb) throw new Error('No database selected — run .use <db> first.');
    const parts = (rest.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) || []).filter(Boolean);
    const [coll, filterText = '{}'] = parts;
    if (!coll) throw new Error('Usage: .delete <coll> [filter]');
    const res = many
      ? engine.deleteMany(currentDb, coll, parseJsonOrThrow(filterText, 'filter'))
      : engine.deleteOne(currentDb, coll, parseJsonOrThrow(filterText, 'filter'));
    console.log(C.ok(`deleted ${many ? res.deleted : Math.min(res.deleted, 1)} document(s)`));
  },

  deletemany(rest) {
    commands.delete.call(null, rest, { many: true });
  },

  count(rest) {
    if (!currentDb) throw new Error('No database selected — run .use <db> first.');
    const parts = (rest.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) || []).filter(Boolean);
    const [coll, filterText = '{}'] = parts;
    if (!coll) throw new Error('Usage: .count <coll> [filter]');
    const { count } = engine.count(currentDb, coll, parseJsonOrThrow(filterText, 'filter'));
    console.log(C.ok(String(count)));
  },

  aggregate(rest) {
    if (!currentDb) throw new Error('No database selected — run .use <db> first.');
    const sp = rest.indexOf(' ');
    if (sp < 0) throw new Error('Usage: .aggregate <coll> <pipeline-json>');
    const coll = rest.slice(0, sp).trim();
    const pipeline = parseJsonOrThrow(rest.slice(sp + 1).trim(), 'pipeline');
    const { documents } = engine.aggregate(currentDb, coll, pipeline);
    console.log(C.dim(`${documents.length} result doc(s)`));
    console.log(pretty(documents.slice(0, 10)));
  },

  indexes(rest) {
    if (!currentDb) throw new Error('No database selected — run .use <db> first.');
    const coll = rest.trim();
    if (!coll) throw new Error('Usage: .indexes <coll>');
    const list = engine.listIndexes(currentDb, coll);
    for (const idx of list) {
      console.log(`  ${idx.field.padEnd(24)} ${C.dim(`${idx.entryCount} keys · built ${idx.createdAt}`)}`);
    }
    if (list.length === 0) console.log(C.dim('  (no indexes — .mkindex <coll> <field>)'));
  },

  mkindex(rest) {
    if (!currentDb) throw new Error('No database selected — run .use <db> first.');
    const [coll, field] = rest.trim().split(/\s+/);
    if (!coll || !field) throw new Error('Usage: .mkindex <coll> <field>');
    const res = engine.createIndex(currentDb, coll, field);
    console.log(C.ok(`index on "${res.field}" built over ${res.documents} doc(s) (${res.entries} keys)`));
  },

  rmindex(rest) {
    if (!currentDb) throw new Error('No database selected — run .use <db> first.');
    const [coll, field] = rest.trim().split(/\s+/);
    if (!coll || !field) throw new Error('Usage: .rmindex <coll> <field>');
    engine.dropIndex(currentDb, coll, field);
    console.log(C.ok(`index on "${field}" dropped`));
  },

  schema(rest) {
    if (!currentDb) throw new Error('No database selected — run .use <db> first.');
    const sp = rest.indexOf(' ');
    const coll = sp < 0 ? rest.trim() : rest.slice(0, sp).trim();
    if (!coll) throw new Error('Usage: .schema <coll> [rules-json]');
    const rulesText = sp < 0 ? null : rest.slice(sp + 1).trim();
    if (!rulesText) {
      const rules = engine.getSchema(currentDb, coll);
      console.log(rules ? pretty(rules) : C.dim(`  (no rules on ${coll})`));
      return;
    }
    const res = engine.setSchema(currentDb, coll, parseJsonOrThrow(rulesText, 'rules'));
    console.log(C.ok(`rules saved — ${res.violations.length} existing violation(s)`));
    for (const v of res.violations) console.log(C.warn(`  ! ${v}`));
  },

  history(rest) {
    if (!currentDb) throw new Error('No database selected — run .use <db> first.');
    const [coll, id] = rest.trim().split(/\s+/);
    if (!coll) throw new Error('Usage: .history <coll> [_id]');
    const revisions = engine.listHistory(currentDb, coll, { id: id || undefined, limit: 20 });
    for (const rev of revisions) {
      console.log(`  ${C.brand(rev.op.padEnd(6))} ${C.dim(rev.at)}  ${rev.doc?._id}  ${C.dim(short(rev.doc, 60))}`);
    }
    if (revisions.length === 0) console.log(C.dim('  (no revisions recorded)'));
  },

  files(rest) {
    const db = rest.trim() || currentDb;
    if (!db) throw new Error('Usage: .files <db>');
    const files = engine.listFiles(db);
    for (const f of files) {
      console.log(`  ${C.brand(f._id)}  ${f.filename}  ${C.dim(`${(f.size / 1024).toFixed(1)} KB · ${f.contentType}`)}`);
    }
    if (files.length === 0) console.log(C.dim('  (no files stored)'));
  },

  rmcoll(rest) {
    if (!currentDb) throw new Error('No database selected — run .use <db> first.');
    const coll = rest.trim();
    if (!coll) throw new Error('Usage: .rmcoll <coll>');
    console.log(C.warn(`This drops "${coll}" in "${currentDb}" permanently. Type the collection name to confirm.`));
    rl.question(C.warn('confirm> '), (answer) => {
      if (answer.trim() === coll) {
        engine.dropCollection(currentDb, coll);
        console.log(C.ok(`collection ${coll} dropped`));
      } else {
        console.log(C.dim('cancelled'));
      }
      prompt();
    });
    return 'async'; // prompt already re-armed
  },

  findopts() {
    console.log(`  .find <coll> [filter] [sort] [limit]
  filter: ${C.dim('{"status":"active","profile.age":{"$gte":18}}')}
  sort:   ${C.dim('{"createdAt":-1}')}   limit: ${C.dim('10')}
  text:   ${C.dim('{"$text":{"$search":"ada"}}')}`);
  },

  exit() {
    rl.close();
    return 'exit';
  },

  quit() {
    return commands.exit();
  },
};

/* ------------------------------- loop -------------------------------- */

let pendingLine = ''; // multi-line JSON paste support

function evalLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  // Continuation of a multi-line paste: accumulate until braces balance.
  if (pendingLine) {
    pendingLine += `\n${line}`;
    if ((pendingLine.match(/{/g) || []).length > (pendingLine.match(/}/g) || []).length) {
      rl.setPrompt(C.dim('…> '));
      return;
    }
    const complete = pendingLine;
    pendingLine = '';
    evalCommand(complete);
    return;
  }

  if (!trimmed.startsWith('.')) {
    console.log(C.dim('Commands start with a dot — .help for the list.'));
    return;
  }

  // Multi-line: a dot command whose JSON arg is missing closing braces.
  if ((trimmed.match(/{/g) || []).length > (trimmed.match(/}/g) || []).length) {
    pendingLine = trimmed;
    rl.setPrompt(C.dim('…> '));
    return;
  }

  evalCommand(trimmed);
}

function evalCommand(trimmed) {
  const sp = trimmed.indexOf(' ');
  const cmd = (sp < 0 ? trimmed : trimmed.slice(0, sp)).slice(1).toLowerCase();
  const rest = sp < 0 ? '' : trimmed.slice(sp + 1);

  const fn = commands[cmd];
  try {
    if (!fn) throw new Error(`Unknown command ".${cmd}" — try .help`);
    const result = fn(rest);
    if (result === 'exit') return;
    if (result && typeof result.then === 'function') {
      // A command returned a promise (async command): re-arm the prompt
      // only after it settles, and surface its errors like sync ones.
      Promise.resolve(result)
        .then((r) => {
          if (r === 'exit') return;
          if (r !== 'async') prompt();
        })
        .catch((err) => {
          console.log(C.err(`error: ${err.message}`));
          prompt();
        });
      return;
    }
    if (result !== 'async') prompt();
  } catch (err) {
    console.log(C.err(`error: ${err.message}`));
    prompt();
  }
}

console.log(`PocketDB shell ${C.dim('v' + (engine.info().version))}`);
console.log(C.dim(`data dir: ${dataDir}`));
console.log(C.dim('type .help for commands — input is parsed as JSON, never executed'));
const dbs = engine.listDatabases();
if (dbs.length > 0 && !currentDb) currentDb = dbs[0].name;
if (currentDb) console.log(C.ok(`connected to db ${currentDb}`));

rl.on('line', (line) => {
  try {
    evalLine(line);
  } catch (err) {
    console.log(C.err(`error: ${err.message}`));
    prompt();
  }
}).on('close', () => {
  console.log(C.dim('\nbye'));
  process.exit(0);
});

if (rl.terminal) prompt();
// Piped input works too: rl already evals every line; close exits via the
// 'close' handler above.
