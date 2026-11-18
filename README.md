# PocketDB

A fully functional, native desktop **NoSQL document database studio** — a lightweight,
offline-first alternative to MongoDB Compass, backed by a custom file-based storage
engine built with Node.js.

![Stack](https://img.shields.io/badge/Electron-React-Tailwind-blue)

## Feature Highlights

| Area | What you get |
| --- | --- |
| **Native shell** | Electron main + secure preload bridge (`contextIsolation: true`, `nodeIntegration: false`) |
| **Connections** | Launchpad entry screen: inline quick-connect, saved-connection cards with color bands, favorites (auto-connect), full form sheet with URI/directory toggle, optional encryption passphrase |
| **Storage engine** | Filesystem hierarchy: database folder → NDJSON collection files, atomic writes, auto ObjectId |
| **Query engine** | Dot-notation selectors with `$eq $ne $gt $gte $lt $lte $in $nin $regex $exists` + `$and/$or/$not` + token-based full-text `$text` |
| **Studio UI** | Hub-and-surface console: top command bar with history-aware back, database/collection switchers (filter box, ★ pinned & recent collections, live count chips, database stats chip, labeled data-tools cluster), per-database dashboard (stat tiles + collection cards), grid ↔ ledger ↔ JSON-tree explorer, bottom filter console (JSON editor **+ visual Builder**), insert/edit dialogs |
| **Pagination** | Collection reads are paged (25 / 50 / 100 / 250 per page) with a live `matched` count — no giant dumps |
| **Saved queries** | Name and persist per-collection filters; reload them from the console's Saved menu or the Ctrl+K palette |
| **Export** | One-click collection export to JSON or CSV (dotted-path columns), via save dialog |
| **Import** | Load a collection from a JSON array, NDJSON or CSV file (RFC-4180-ish parser, number/boolean coercion), or **mirror a live MongoDB server** into PocketDB via the bundled driver |
| **Duplicate document** | Copy any document in one click (fresh `_id`) from every explorer view |
| **Bulk actions** | Toggle **bulk selection** on any view (checkbox column), then delete or `$set` all selected documents with one `_id $in` update |
| **Inline editing** | Double-click a grid cell to edit it in place — values parse as JSON (numbers, booleans, objects) and apply as dotted-path `$set` |
| **Indexes** | Per-collection sidecar index maps (`coll.ndjson.idx.json`): equality & `$in` predicates prune scans automatically; multikey (array) fields supported; rebuilt after every write; managed from the collection header (key icon) |
| **Schema validation** | Optional per-collection rules (`coll.ndjson.schema.json`): required fields, types (string/number/boolean/object/array/null), enums — enforced on every insert/update, existing violations reported on save |
| **Document history** | Every update/delete records a pre-image in `coll.ndjson.hist.json` (last 200 kept) — browse and **restore any revision** (keeps `_id`) from a document's clock icon |
| **Snapshots** | One-click full copies of a database folder, stored *outside* the data directory with atomic restore (move-aside → copy → rollback on failure) — managed from the navbar or Ctrl+K |
| **Live sync** | `fs.watch` on the data directory — edits made by other apps appear in the studio automatically (350 ms debounce) |
| **Server mode** | Optional HTTP bridge (`127.0.0.1` by default, **LAN mode** opt-in) exposing the engine as REST with **bearer-token auth** and **SSE change feeds** (`/api/:db/:coll/events`) |
| **CLI shell** | `scripts/pocketdb-shell.cjs`: a Mongo-flavored REPL over the same engine (`.find`, `.insert`, `.aggregate`, `.mkindex`, `.schema`, `.history`, …) — input is parsed as JSON, never executed |
| **Aggregations** | Step-by-step pipeline builder: `$match`, `$sort`, `$limit`, `$skip`, `$project`, `$count`, `$unwind`, **`$group`** (9 accumulators), **`$lookup`** (joins), **`$replaceRoot`** with live results |
| **Charts** | **Charts studio**: plot pipeline results as SVG bar charts or donuts (category × value pickers, legend) — dependency-free |
| **File storage** | GridFS-style binary store (images, PDFs, audio, …) as base64 documents in a hidden `_files` collection — drag & drop upload, image thumbnails, previews, open externally, save as, 16 MB per file |
| **Write locking** | Cross-process `.lock` files serialise collection writes between the studio, the HTTP bridge and Node scripts (5 s timeout, stale-lock recovery) |
| **Encryption at rest** | Optional AES-256-GCM envelope (`PDBENC1`) per file with a scrypt-derived key from your passphrase — connect with the same passphrase to decrypt; plaintext files stay readable and get encrypted on the next write |
| **Auto-update** | electron-updater wired behind `POCKETDB_UPDATE_URL` — on-demand "Check for Updates" (Help menu / palette), download progress in the status strip, install on confirm |
| **Docs & tour** | In-app quick-reference panel and a 6-step first-launch tour (replayable from Ctrl+K) |
| **Offline** | Monaco bundled locally (no CDN), all data on local disk — zero cloud dependencies |

## Project Structure

```
pocketdb/
├── package.json                 # scripts + electron-builder packaging config
├── vite.config.js               # React renderer bundler (base './' for file:// loading)
├── tailwind.config.js           # dark studio theme tokens
├── postcss.config.js
├── index.html                   # renderer entry with CSP
├── electron/                    # ===== desktop shell + backend =====
│   ├── main.cjs                 # window creation, menu (+ update check), data-dir resolution
│   ├── preload.cjs              # contextBridge: call() + onEngineChanged()/onUpdateStatus() push events
│   ├── ipc.cjs                  # whitelisted engine registry, live-sync watcher, server mode, snapshots, imports, updater
│   ├── updater.cjs              # electron-updater wiring (feed via POCKETDB_UPDATE_URL)
│   └── db/
│       ├── engine.cjs           # PocketEngine: CRUD, namespaces, aggregation, files, indexes, schema, history, watch
│       ├── storage.cjs          # FileStorage: NDJSON files, atomic writes, cross-process locks, AES-GCM codec
│       ├── query.cjs            # matcher, dot-notation, projections, pipeline runner ($group/$lookup/$replaceRoot, $text)
│       ├── server.cjs           # HTTP bridge (REST over the engine, token auth, SSE change feed)
│       ├── snapshots.cjs        # database folder backups + atomic restore
│       ├── import.cjs           # JSON/NDJSON/CSV parsing + MongoDB mirroring (mongodb driver)
│       ├── queries.cjs          # saved per-collection filters store
│       ├── uri.cjs              # pocketdb:// connection-string parsing
│       ├── connections.cjs      # saved connections store (shared with VS Code)
│       └── objectId.cjs         # MongoDB-style 24-hex unique id generator
├── scripts/                     # icon pipeline, build hooks, tests, server CLI, shell
│   ├── pocketdb-server.cjs      # standalone HTTP bridge: node scripts/pocketdb-server.cjs [--lan] [--token=…]
│   └── pocketdb-shell.cjs       # interactive REPL over the engine: node scripts/pocketdb-shell.cjs
├── vscode-extension/            # ===== PocketDB for VS Code =====
│   ├── package.json             # tree view, commands, menus, settings
│   ├── extension.js             # databases/collections explorer + doc ops
│   └── media/                   # activity-bar + marketplace icons
└── src/                         # ===== React studio (renderer) =====
    ├── main.jsx
    ├── App.jsx                  # connection gate + all workspace state
    ├── index.css                # Tailwind layers + dark scrollbars
    ├── lib/
    │   ├── api.js               # typed wrapper over window.pocketdb bridge
    │   ├── monacoSetup.js       # offline Monaco loader + workers
    │   └── utils.js             # JSON helpers, URI helpers, value coloring
    └── components/
        ├── Launchpad.jsx        # entry screen: quick-connect, saved-connection cards, form sheet, encryption passphrase
        ├── CommandBar.jsx       # top strip: history back, db/coll switchers (filter, pinned, recents), data-tools cluster, stats chip
        ├── DatabaseHome.jsx     # per-database dashboard: stat tiles + collection cards
        ├── DocumentExplorer.jsx # grid ↔ ledger ↔ JSON-tree dispatcher, bulk selection, inline cell editing
        ├── JsonTreeView.jsx     # expandable JSON tree (shared by tree + ledger detail)
        ├── QueryConsole.jsx     # bottom filter console: JSON editor + visual Builder tabs, saved queries
        ├── QueryBuilder.jsx     # field/operator/value chips → JSON filter (AND/OR modes)
        ├── PipelineStudio.jsx   # aggregation builder with horizontal stage rail + chart hand-off
        ├── ChartsStudio.jsx     # SVG bar/donut charts over pipeline results
        ├── IndexManagerDialog.jsx # create/list/drop sidecar indexes
        ├── SchemaDialog.jsx     # per-collection validation rules
        ├── HistoryDialog.jsx    # revision log with one-click restore
        ├── ImportDialog.jsx     # JSON/NDJSON/CSV file import
        ├── MongoImportDialog.jsx# mirror a mongodb:// server into PocketDB
        ├── ServerDialog.jsx     # HTTP bridge: port, token, LAN toggle, start/stop
        ├── SnapshotsDialog.jsx  # full snapshot manager (create / restore / delete)
        ├── DocsPanel.jsx        # in-app quick reference
        ├── TourOverlay.jsx      # 6-step first-launch tour
        ├── FilesVault.jsx       # GridFS-style binary storage UI (with image thumbnails)
        ├── Pager.jsx            # pagination strip (page size, prev/next, showing ranges)
        ├── CommandPalette.jsx   # Ctrl+K quick launcher
        ├── ShortcutsDialog.jsx  # keyboard reference
        ├── DocumentDialogs.jsx  # insert / edit ($set / $unset) dialogs
        ├── NewDatabaseDialog.jsx# create-database sheet (name/color/favorite/seed)
        ├── MonacoJsonEditor.jsx # shared Monaco wrapper
        └── ui.jsx               # Button, Modal, PromptDialog, ConfirmDialog, Banner, Kbd, Switch, Segmented
```

## On-Disk Data Format

All data lives under the OS user-data directory
(`%APPDATA%/PocketDB/pocketdb-data` on Windows; override with `POCKETDB_DATA_DIR`):

```
pocketdb-data/
└── pocketdb-demo/            # a database = a folder
    ├── users.ndjson          # a collection = an NDJSON file (one doc per line)
    └── tasks.ndjson
```

Every document is a single JSON line with an auto-generated `_id`
(timestamp + machine nonce + counter, 24 hex chars).

## Getting Started

```bash
npm install

# development: Vite dev server + Electron (hot reload)
npm run dev

# production run: build the renderer, then launch offline
npm start

# package native installers (NSIS / DMG / AppImage via electron-builder)
npm run package
```

## Connecting (Launchpad)

The studio opens on the **Launchpad**: a centered console with a quick-connect
strip, saved connections as cards, and a full form sheet. A connection is a
`pocketdb://` URI pointing at a local data directory:

```
pocketdb:///C:/Users/me/pocketdb-data
```

- **Edit Connection String** toggle switches between the URI field and a
  folder picker (Browse)
- **Name** and **Color** tags organize your connections
- **Favorite this connection** pins it to the top and auto-connects on launch
- **Advanced options** exposes the optional **encryption passphrase** for
  data directories written with one (see *Encryption at rest*)
- **Save / Connect / Save & Connect** — saved connections live in
  `%APPDATA%/PocketDB/pocketdb-connections.json` and are shared with the
  VS Code extension

## Connecting from VS Code

The bundled **PocketDB for VS Code** extension (in `vscode-extension/`) browses
the same data files: databases → collections tree, NDJSON files in the editor,
insert/delete documents, and JSON-filter document search.

Run it without installing: open `vscode-extension/` in VS Code and press **F5**.
See `vscode-extension/README.md` for packaging a `.vsix`.

## Querying

Open a collection from its database dashboard, expand the **filter console**
docked at the bottom, write a filter in Monaco and press **Run**:

```json
{
  "status": "active",
  "profile.age": { "$gte": 30 },
  "tags": { "$in": ["pioneer", "git"] },
  "email": { "$regex": "pocket", "$options": "i" }
}
```

- Dot-notation reaches into nested objects (`profile.age`) and arrays (`tags.0`).
- Conditions on array fields match if **any** element satisfies them (Mongo-style).
- Comparisons only apply between comparable types; others never match.
- **Full-text search** with `{"$text": { "$search": "term term2" }}` — terms are
  tokenized (lowercased, split on non-alphanumerics) and matched as prefixes
  against every string leaf of the document; multiple terms OR together.
- Read documents in three views: **Grid** (auto-column table), **Ledger**
  (compact rows that expand into pretty JSON) or **JSON** (tree cards).
- The console has two tabs: the raw **JSON** editor and a visual **Builder**
  (field / operator / value rows with AND/OR combinator) that round-trips with
  the JSON tab and shows a live preview of the filter it will run.

### Pagination

The collection surface pages through matches instead of loading everything:
pick **25 / 50 / 100 / 250 per page** in the pager strip, move with
*prev/next*, and watch `matched / showing` counts in the filter console.
Changing the filter, collection or page size always returns you to page 1,
and deleting the last document on a page clamps you back automatically.

### Saved queries

Name the filter you're on (bookmark icon in the console) and it's stored
per-collection in `%APPDATA%/PocketDB/pocketdb-saved-queries.json`.
Reload it from the **Saved (N)** dropdown, the Ctrl+K palette, or manage
(saved filters can be deleted right from the menu).

### Duplicate a document

The **Copy** button on any document row (grid, ledger or tree view) clones
it without its `_id` — the engine assigns a fresh one on insert.

### Export a collection

The **Export** dropdown on a collection surface writes either
**JSON** (pretty, full documents) or **CSV** (dotted-path columns sorted
with `_id` first) through the native save dialog.

### Inline cell editing

In the **Grid** view, double-click any cell (except `_id`) to edit it in
place. The typed value is parsed as JSON when possible — `42` becomes a
number, `true` a boolean, `{"a":1}` an object — otherwise it stays a
string. On Enter or blur it applies as a dotted-path `$set` on that
document; invalid writes (e.g. schema violations) are surfaced as a banner.

### Bulk selection

The checkbox icon in the collection header (or Ctrl+K → *Bulk-select
documents*) switches on the selection column in every view. Pick documents,
then use the floating bar: **Delete** (one `_id $in` deleteMany) or
**$set field…** (one updateMany with your update spec). The status strip
shows how many are selected; **Clear selection** or leaving the collection
resets it.

### Indexes

The key icon in the collection header manages **sidecar indexes**
(`coll.ndjson.idx.json`): a sorted map of value → matching document ids.
The engine picks an index automatically for equality and `$in` predicates
on an indexed field and skips scanning the rest of the file. Indexes are
**multikey** (array fields index each element, Mongo-style) and are
rebuilt automatically after every write, so they can never go stale.
Operators that can't prune safely (`$ne`, `$regex`, `$exists`, …) fall
back to a full scan.

### Schema validation

The shield icon edits optional per-collection rules
(`coll.ndjson.schema.json`):

```json
{
  "required": ["status"],
  "properties": {
    "status": { "type": "string", "enum": ["active", "invited", "inactive"] },
    "profile.age": { "type": "number" }
  }
}
```

Rules are enforced on every insert and update — a violating write throws
before anything is written to disk. Saving rules scans existing documents
and reports violations immediately. Dot-notation fields are supported.

### Document history

Every update and delete records the **pre-image** of each document in
`coll.ndjson.hist.json` (newest 200 kept per collection). The clock icon
on any document opens its revision log; **Restore** puts a revision back
into the collection keeping its `_id` (or re-inserts it if it was deleted).

### Snapshots

The database dashboard's **Snapshots** card copies the whole database
folder to a timestamped backup under
`%APPDATA%/PocketDB/pocketdb-snapshots/<db>/<stamp>/` — *outside* the data
directory, so snapshots never appear as databases. **Restore** swaps the
live folder atomically (move aside → copy → verify → discard the old one,
rolling back if the copy fails). The **Snapshots** button in the navbar
(or Ctrl+K) opens the full snapshot manager — create, restore (two-step
confirm) and delete any snapshot.

### The navbar

The top strip carries everything:

- **← Back** walks back through your own navigation history (surfaces,
  collections, databases) — it never leaves the studio. The **start page**
  (connection switcher) lives on the right-edge button and the
  status-strip connection chip.
- **Database / collection switchers** showing live counts, with a filter
  box when the list is long, **★ pinned** collections (persisted, sorted
  first) and your **recent collections** as one-click shortcuts
- A **stats chip** for the active database (total docs · on-disk size)
- A **labeled data-tools cluster** — Files vault · Import · MongoDB ·
  Snapshots — reachable from any surface (the only place they live)
- Palette / refresh / disconnect on the right

### Import

The up-arrow icon in the collection header (or the dashboard's **Import
documents** card) loads a **JSON array, NDJSON or CSV** file into a
collection. The CSV parser handles quoted fields, embedded commas/newlines
and escaped quotes (RFC-4180-ish), coerces numbers/booleans/nulls, and
supports dot-notation headers (`profile.age`) for nested documents. Each
document is inserted individually, so one bad row doesn't cancel the run —
the dialog reports inserted/failed counts and the first errors.

**Import from MongoDB** mirrors a live `mongodb://` server into PocketDB
using the bundled driver: all non-system databases and collections are
copied (BSON flattened — ObjectId → hex string, Date → ISO string,
Binary → `{$binary}`), with an optional per-collection document limit.
Mongo namespace names are sanitized into the `[\w-]{1,64}` format PocketDB
uses, deduplicated with `-2` suffixes on collision.

### Live sync

The main process watches the connected data directory with `fs.watch`.
Edits made outside the studio — the HTTP bridge, a Node script, another
machine over a shared folder — refresh the open views automatically
(350 ms debounce, `live sync` indicator in the status strip).

## Updating

The Edit dialog accepts either:

- a **full replacement document** (with the same `_id`), or
- an **operator update**: `{ "$set": { "profile.age": 37 } }`,
  `{ "$unset": ["tags.0"] }` (dot-notation supported).

## Aggregations

Open the **Pipeline studio** from a collection surface. Stages render as
numbered chips on a rail — add any of `$match`, `$sort`, `$limit`, `$skip`,
`$project`, `$count`, `$unwind`, `$group`, `$lookup`, `$replaceRoot` from
the `+` menu, reorder or remove them in place; each stage's output feeds
the next:

```json
[ { "$match": { "status": "active" } },
  { "$group": { "_id": "$profile.city", "total": { "$sum": 1 } } },
  { "$sort": { "total": -1 } },
  { "$limit": 5 } ]
```

- **`$group`** supports `$sum`, `$avg`, `$min`, `$max`, `$count`,
  `$first`, `$last`, `$push`, `$addToSet`.
- **`$lookup`** joins another collection in the same database
  (`{ "from": "tasks", "localField": "assignee", "foreignField": "name", "as": "tasks" }`).
- **`$replaceRoot`** promotes a nested object to the document root
  (`{ "newRoot": "$profile" }`).

**Chart results** hands the pipeline to the **Charts studio**: pick a
category field (or `_id`) and a value (a numeric field or `count`), then
render the output as an SVG **bar chart** or **donut** with a legend — no
charting library, fully on-theme.

## Storing Files (images & binaries)

The **Files vault** (from the database dashboard or Ctrl+K) stores binary files
*inside* the selected database, MongoDB-GridFS-style: each file becomes a base64
document in a hidden `_files` collection, so everything persists in the same
NDJSON hierarchy and survives copying / backing up the data folder.

- Drag & drop anywhere in the vault (or the Upload button) — multiple files at a time
- **Image thumbnails** are rendered inline in the list (for images ≤ 2 MB, loaded lazily in batches); non-image types show type icons
- Image, text and JSON previews inline; other types open with the OS default app
- **Open externally** (writes to `%TEMP%\pocketdb-exports`) and **Save as…**
- Soft cap of **16 MB per file** (`POCKETDB_MAX_FILE_MB` env var to raise it)
- `_files` is hidden from the dashboard and database list; it only appears if you
  query it explicitly, and the VS Code extension never shows it either

## Server mode (HTTP bridge)

Open the `server off` chip in the status strip (or Ctrl+K → *HTTP bridge*)
for the bridge dialog: set the **port** (default 7400), an optional
**bearer token**, and toggle **LAN mode**. The bridge serves the connected
data directory over HTTP so a web app's backend, scripts or other tools
can read/write the same files — and it shares the engine's cross-process
write locks with the studio.

```
node scripts/pocketdb-server.cjs [dataDir] [port] [--lan] [--token=SECRET]
```

With `--lan` (bind `0.0.0.0`, reachable from other devices) and no token,
the CLI generates a random one and prints it. Endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | `{ ok, dataDir }` heartbeat (always open, no auth) |
| GET | `/api/databases` | databases + collection stats |
| GET | `/api/:db` | collections of a database |
| GET | `/api/:db/:coll` | find — `?filter=&sort=&limit=&skip=&projection=` (URL-encoded JSON) |
| POST | `/api/:db/:coll` | insertOne (object) or insertMany (array body) |
| PUT | `/api/:db/:coll?filter=…` | updateOne (body = update spec, `$set` / `$unset` / replacement) |
| DELETE | `/api/:db/:coll?filter=…` | deleteMany |
| GET/PUT/DELETE | `/api/:db/:coll/:id` | get / update / delete one document by `_id` |
| GET | `/api/:db/:coll/events` | **SSE change feed** — push events on every write |
| GET | `/api/:db/files` | file metadata list |
| POST | `/api/:db/files` | upload — `{ filename, base64, contentType }` |
| GET | `/api/:db/files/:id` | raw bytes (binary response, correct content-type) |
| DELETE | `/api/:db/files/:id` | delete file |

**Auth**: when a token is set, every endpoint except `/api/health` requires
`Authorization: Bearer <token>` or `?token=<token>` (health stays open so
reachability checks work). **SSE** connects like this:

```js
const es = new EventSource('http://127.0.0.1:7400/api/shop/products/events?token=SECRET');
es.onmessage = (e) => console.log('changed:', JSON.parse(e.data));
```

The bridge binds **`127.0.0.1` by default** (LAN mode is opt-in) and caps
request bodies at 25 MB (enough for a full file upload).

## CLI shell

`scripts/pocketdb-shell.cjs` is a Mongo-flavored REPL over the same engine
the studio uses (cross-process locks keep them consistent):

```
node scripts/pocketdb-shell.cjs [dataDir] [--passphrase=SECRET]

PocketDB shell> .dbs
PocketDB shell> .use shop
shop> .find products {"price":{"$gte":100}} {"price":-1} 10
shop> .aggregate products [{"$group":{"_id":"$status","n":{"$sum":1}}}]
shop> .mkindex products price
shop> .help
```

Commands: `.dbs .use .collections .insert .find .update .updatemany
.delete .deletemany .count .aggregate .indexes .mkindex .rmindex .schema
.history .files .rmcoll .findopts .help .exit`. Multi-line JSON pastes are
supported, and input is parsed as JSON — **never executed**.

## Auto-update

electron-updater is wired behind the `POCKETDB_UPDATE_URL` env var (a
generic provider URL, e.g. your static file server or GitHub Releases).
Checks are on-demand only — *Help → Check for Updates…* or the Ctrl+K
palette — download progress appears in the status strip, and nothing
installs until you confirm **update ready — install**. Without the env
var the feature reports `unconfigured` and stays inert.

## Keyboard model

- **Ctrl+K** — command palette: jump to any database/collection or saved
  query, insert documents, switch views, run filters, create databases,
  export a collection, bulk-select, open indexes/schema/snapshots/docs/tour,
  import (file or MongoDB), the HTTP bridge, disconnect
- **Ctrl+/** — shortcut reference
- **Alt+1 / 2 / 3 / 4** — dashboard / collection documents / pipeline
  studio / files vault
- **Esc** — close dialogs and the palette
- **Double-click** a grid cell — edit it in place

## Encryption at rest

When a connection is made with a passphrase (Launchpad → *Advanced
options*), every collection file and engine sidecar (indexes, schema,
history) is written as an **AES-256-GCM envelope**:

```
PDBENC1 | salt(16) | iv(12) | authTag(16) | ciphertext
```

The key is derived per file with **scrypt** from the passphrase + a random
salt, so files never share a keystream. Plaintext files remain readable
when a passphrase is set (they're encrypted on the next write), a wrong
passphrase fails with a clear error, and there's no recovery without it —
the passphrase is never stored. The status strip's data-dir chip reflects
the connection; the launchpad explains how to reconnect.

## Security Model

- The renderer has **no** Node access. The only bridge is `window.pocketdb.call()`.
- The main process exposes a **whitelist** of engine methods (`electron/ipc.cjs`);
  anything else is rejected.
- Database/collection names are validated (`[\w-]{1,64}`) at both the IPC and
  storage layers to rule out path traversal.
- Collection writes are atomic (temp file + rename), so crashes never corrupt a file.
- **Cross-process write locks**: every collection rewrite is serialised with a
  `.lock` file (exclusive create + polling), so the studio, the HTTP bridge and
  scripts writing the same directory can't silently drop each other's changes.
  Stale locks from crashed processes are stolen after 5 s.
- **Server mode** binds `127.0.0.1` by default; LAN mode is opt-in and
  auto-generates a token when none is given. Requests authenticate with a
  bearer token (`Authorization: Bearer …` or `?token=…`); `/api/health` is
  exempt so reachability checks keep working.
- **Encryption at rest** (see above): AES-256-GCM per file, scrypt-derived
  keys, GCM auth tags detect tampering.
- **Shell REPL**: input is parsed as JSON, never evaluated — pasted data
  can't execute code.

## Engine API (main process)

`electron/db/engine.cjs` — `PocketEngine`:

```
listDatabases / createDatabase / dropDatabase
listCollections / createCollection / dropCollection
find / findOne / insertOne / insertMany
updateOne / updateMany ($set / $unset / replacement)
deleteOne / deleteMany / count / aggregate
putFile / listFiles / getFile / deleteFile     (binary store)
createIndex / dropIndex / listIndexes          (sidecar index maps)
getSchema / setSchema / clearSchema            (per-collection rules)
listHistory / restoreRevision                  (revision log)
watch(db, coll|null, listener)                 (change feed)
```

Everything above is also reachable from any local process through the HTTP
bridge (see *Server mode*) or programmatically in plain Node:

```js
const { PocketEngine } = require('./electron/db/engine.cjs');
const engine = new PocketEngine('C:/data/pocketdb-data');
await engine.insertOne('shop', 'orders', { item: 'Desk', qty: 1 });
```
