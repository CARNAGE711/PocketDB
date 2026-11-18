/**
 * PocketDB for VS Code.
 *
 * Connects to a local PocketDB data directory (the same files the desktop
 * studio writes) and provides:
 *   - an Explorer tree: databases -> collections
 *   - open collection files (NDJSON) directly in the editor
 *   - insert / delete documents without leaving VS Code
 *   - a lightweight document search (JSON filters, dot-notation, operators)
 *
 * It shares the desktop app's saved connections file
 * (<appData>/PocketDB/pocketdb-connections.json), so favorites set in the
 * studio appear here too.
 */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/* ------------------------------------------------------------------ */
/* Location helpers                                                    */
/* ------------------------------------------------------------------ */

/** Where the desktop studio keeps its settings (per-OS equivalent of userData). */
function appDataDir() {
  switch (process.platform) {
    case 'win32': return path.join(os.homedir(), 'AppData', 'Roaming', 'PocketDB');
    case 'darwin': return path.join(os.homedir(), 'Library', 'Application Support', 'PocketDB');
    default: return path.join(os.homedir(), '.config', 'PocketDB');
  }
}

function defaultDataDir() {
  return path.join(appDataDir(), 'pocketdb-data');
}

/** Parse "pocketdb:///C:/..." into a local path (mirrors electron/db/uri.cjs). */
function parsePocketUri(input) {
  let s = String(input || '').trim().replace(/^pocketdb:\/\//i, '');
  try { s = decodeURIComponent(s); } catch { /* keep raw */ }
  s = s.replace(/\/+$/, '');
  if (/^\/[A-Za-z]:/.test(s)) s = s.slice(1);
  return path.normalize(s);
}

/** Read the connections saved by the desktop studio (favorites first). */
function readSavedConnections() {
  try {
    const list = JSON.parse(
      fs.readFileSync(path.join(appDataDir(), 'pocketdb-connections.json'), 'utf8')
    );
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Lightweight storage layer                                           */
/* ------------------------------------------------------------------ */

let counter = Math.floor(Math.random() * 0xffffff);

/** ObjectId-style unique id (matches the desktop engine's format). */
function genId() {
  counter = (counter + 1) % 0xffffff;
  return (
    Math.floor(Date.now() / 1000).toString(16).padStart(8, '0') +
    crypto.randomBytes(5).toString('hex') +
    counter.toString(16).padStart(6, '0')
  );
}

/** Read an NDJSON collection file into an array of documents. */
function readNdjson(file) {
  const docs = [];
  if (!fs.existsSync(file)) return docs;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { docs.push(JSON.parse(t)); } catch { /* skip corrupt lines */ }
  }
  return docs;
}

class PocketStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }

  get label() {
    return path.basename(this.dataDir) === 'pocketdb-data'
      ? this.dataDir
      : `${this.dataDir} (custom)`;
  }

  collFile(db, coll) {
    return path.join(this.dataDir, db, `${coll}.ndjson`);
  }

  listDatabases() {
    try {
      return fs
        .readdirSync(this.dataDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => ({
          name: d.name,
          collections: fs
            .readdirSync(path.join(this.dataDir, d.name))
            .filter((f) => f.endsWith('.ndjson'))
            .map((f) => f.slice(0, -7)),
        }));
    } catch {
      return [];
    }
  }

  appendDoc(db, coll, doc) {
    const file = this.collFile(db, coll);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const prepared = { ...doc, _id: doc._id || genId() };
    fs.appendFileSync(file, JSON.stringify(prepared) + '\n', 'utf8');
    return prepared._id;
  }

  deleteDoc(db, coll, id) {
    const file = this.collFile(db, coll);
    const docs = readNdjson(file);
    const kept = docs.filter((d) => d._id !== id);
    if (kept.length === docs.length) return false;
    fs.writeFileSync(file, kept.map((d) => JSON.stringify(d)).join('\n') + (kept.length ? '\n' : ''), 'utf8');
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Document search (subset of the studio's query engine)               */
/* ------------------------------------------------------------------ */

function getPath(doc, dotted) {
  let cur = doc;
  for (const part of String(dotted).split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function matchDoc(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = getPath(doc, key);
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, arg]) => {
        switch (op) {
          case '$eq': return value === arg;
          case '$ne': return value !== arg;
          case '$gt': return value > arg;
          case '$gte': return value >= arg;
          case '$lt': return value < arg;
          case '$lte': return value <= arg;
          case '$in': return Array.isArray(arg) && arg.includes(value);
          case '$regex': return typeof value === 'string' && new RegExp(arg).test(value);
          default: return false;
        }
      });
    }
    return value === cond || (Array.isArray(value) && value.includes(cond));
  });
}

/* ------------------------------------------------------------------ */
/* Tree data provider                                                  */
/* ------------------------------------------------------------------ */

class DatabasesProvider {
  constructor() {
    this.store = null;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }

  refresh() {
    this._emitter.fire();
  }

  getTreeItem(node) {
    if (node.type === 'database') {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'database';
      item.iconPath = new vscode.ThemeIcon('database');
      return item;
    }
    // collection
    const count = readNdjson(this.store.collFile(node.db, node.name)).length;
    const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
    item.description = `${count} docs`;
    item.contextValue = 'collection';
    item.iconPath = new vscode.ThemeIcon('json');
    item.tooltip = this.store.collFile(node.db, node.name);
    item.command = {
      command: 'pocketdb.openCollection',
      title: 'Open Collection',
      arguments: [node],
    };
    return item;
  }

  getChildren(node) {
    if (!this.store) return [];
    if (!node) {
      return this.store.listDatabases().map((db) => ({ type: 'database', ...db }));
    }
    return node.collections.map((name) => ({
      type: 'collection', db: node.name, name,
    }));
  }
}

/* ------------------------------------------------------------------ */
/* Activation                                                          */
/* ------------------------------------------------------------------ */

function resolveDataDir(context) {
  const fromSettings = vscode.workspace.getConfiguration('pocketdb').get('dataDir');
  if (fromSettings && fs.existsSync(fromSettings)) return new PocketStore(fromSettings);
  const fromState = context.globalState.get('pocketdb.dataDir');
  if (fromState) return new PocketStore(fromState);
  return new PocketStore(defaultDataDir()); // fall back to the studio's default location
}

function activate(context) {
  const provider = new DatabasesProvider();
  provider.store = resolveDataDir(context);

  vscode.window.registerTreeDataProvider('pocketdbDatabases', provider);
  context.subscriptions.push(
    vscode.window.createTreeView('pocketdbDatabases', { treeDataProvider: provider })
  );

  // Status bar chip showing the connected data directory.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  status.text = '$(database) PocketDB';
  status.tooltip = new vscode.MarkdownString(
    `**PocketDB data directory**\n\n\`${provider.store.dataDir}\`\n\nClick to change.`
  );
  status.command = 'pocketdb.selectDataDirectory';
  status.show();
  context.subscriptions.push(status);

  const refresh = () => {
    status.tooltip = new vscode.MarkdownString(
      `**PocketDB data directory**\n\n\`${provider.store.dataDir}\`\n\nClick to change.`
    );
    provider.refresh();
  };

  const setStore = (dataDir) => {
    provider.store = new PocketStore(dataDir);
    context.globalState.update('pocketdb.dataDir', dataDir);
    refresh();
  };

  /* -- choose data directory (saved connections + folder browse) ---- */
  context.subscriptions.push(
    vscode.commands.registerCommand('pocketdb.selectDataDirectory', async () => {
      const picks = readSavedConnections().map((c) => ({
        label: (c.favorite ? '★ ' : '') + c.name,
        description: c.uri,
        dataDir: parsePocketUri(c.uri),
      }));
      picks.push(
        { label: '$(folder-open) Browse for a data directory…', action: 'browse' },
        { label: '$(home) Use default location', description: defaultDataDir(), action: 'default' }
      );
      const pick = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Choose a PocketDB data directory to connect to',
      });
      if (!pick) return;

      if (pick.action === 'browse') {
        const folders = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          defaultUri: vscode.Uri.file(defaultDataDir()),
          openLabel: 'Connect',
        });
        if (folders && folders.length > 0) setStore(folders[0].fsPath);
      } else if (pick.action === 'default') {
        setStore(defaultDataDir());
      } else if (pick.dataDir) {
        setStore(pick.dataDir);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pocketdb.refresh', refresh),
    vscode.commands.registerCommand('pocketdb.openCollection', (node) => {
      const file = provider.store.collFile(node.db, node.name);
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, '', 'utf8'); // empty collection
      }
      vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
    }),
    vscode.commands.registerCommand('pocketdb.insertDocument', async (node) => {
      const text = await vscode.window.showInputBox({
        prompt: `New document for ${node.db}/${node.name} (JSON object)`,
        placeHolder: '{"name": "New Document", "status": "active"}',
        ignoreFocusOut: true,
      });
      if (!text) return;
      try {
        const doc = JSON.parse(text);
        if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
          throw new Error('A document must be a JSON object.');
        }
        const id = provider.store.appendDoc(node.db, node.name, doc);
        refresh();
        vscode.window.showInformationMessage(`Inserted document ${id}`);
      } catch (err) {
        vscode.window.showErrorMessage(`PocketDB: ${err.message}`);
      }
    }),
    vscode.commands.registerCommand('pocketdb.deleteDocument', async (node) => {
      const docs = readNdjson(provider.store.collFile(node.db, node.name)).slice(0, 500);
      if (docs.length === 0) {
        vscode.window.showInformationMessage('Collection is empty.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        docs.map((d) => ({
          label: d._id || '(no _id)',
          description: JSON.stringify(d).slice(0, 80),
          id: d._id,
        })),
        { placeHolder: `Select a document to delete from ${node.db}/${node.name}` }
      );
      if (!pick) return;
      const answer = await vscode.window.showWarningMessage(
        `Delete document ${pick.id}?`,
        { modal: true },
        'Delete'
      );
      if (answer !== 'Delete') return;
      provider.store.deleteDoc(node.db, node.name, pick.id);
      refresh();
      vscode.window.showInformationMessage(`Deleted document ${pick.id}`);
    }),
    vscode.commands.registerCommand('pocketdb.searchDocuments', async (node) => {
      const text = await vscode.window.showInputBox({
        prompt: `Filter for ${node.db}/${node.name} — JSON with dot-notation & operators`,
        placeHolder: '{"status": "active", "profile.age": {"$gte": 18}}',
        ignoreFocusOut: true,
      });
      if (!text) return;
      let filter;
      try {
        filter = JSON.parse(text);
        if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) {
          throw new Error('Filter must be a JSON object.');
        }
      } catch (err) {
        vscode.window.showErrorMessage(`PocketDB: ${err.message}`);
        return;
      }
      const matches = readNdjson(provider.store.collFile(node.db, node.name))
        .filter((d) => matchDoc(d, filter));
      if (matches.length === 0) {
        vscode.window.showInformationMessage('No documents match the filter.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        matches.map((d) => ({
          label: d._id || '(no _id)',
          description: JSON.stringify(d).slice(0, 80),
          doc: d,
        })),
        { placeHolder: `${matches.length} matching document(s)` }
      );
      if (pick) {
        const doc = await vscode.workspace.openTextDocument({
          content: JSON.stringify(pick.doc, null, 2),
          language: 'json',
        });
        vscode.window.showTextDocument(doc);
      }
    })
  );

  vscode.window.showInformationMessage(
    `PocketDB: connected to ${provider.store.dataDir}`
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
