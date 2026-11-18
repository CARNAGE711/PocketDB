# PocketDB for VS Code

Browse and edit your **PocketDB** databases without leaving VS Code.

The extension reads the **same local data files** the PocketDB desktop studio
writes — databases are folders, collections are NDJSON files — so changes are
instantly visible from either tool.

## Features

- **PocketDB view in the activity bar** — a tree of every database → collection
  in the connected data directory, with live document counts
- **Open collection files** — collections open as NDJSON documents in the editor
- **Insert Document** — prompt-based JSON insert with `_id` auto-generation
- **Delete Document** — pick a document from a quick list, confirm, done
- **Search Documents** — JSON filters with dot-notation and the familiar
  operators (`$eq $ne $gt $gte $lt $lte $in $regex`); results open as pretty JSON
- **Shared connections** — reads the desktop studio's saved connections
  (`%APPDATA%/PocketDB/pocketdb-connections.json`); ★ favorites are listed first
- **Status bar chip** — shows the connected data directory; click to change it

## Getting started

### Run it from source (no marketplace install needed)

1. Open the `vscode-extension` folder in VS Code (or open it as a workspace
   folder next to the main project).
2. Press **F5** — a fresh *Extension Development Host* window opens.
3. Click the **PocketDB icon** in the activity bar.
4. Click **Choose Data Directory** (or the status-bar chip) and pick:
   - one of your saved connections from the desktop studio, or
   - `Browse…` → any folder, or
   - the default `%APPDATA%/PocketDB/pocketdb-data`.

### Package a .vsix

```bash
cd vscode-extension
npx @vscode/vsce package
code --install-extension pocketdb-vscode-1.0.0.vsix
```

## Settings

| Setting | Description |
| --- | --- |
| `pocketdb.dataDir` | Hard-code a data directory path. Leave empty to use the directory chosen in the PocketDB sidebar (persisted per VS Code profile). |

## Commands

| Command | What it does |
| --- | --- |
| `PocketDB: Choose Data Directory` | Pick a saved connection, browse, or use the default |
| `PocketDB: Refresh` | Re-scan databases and collections |
| `Open Collection File` (context) | Open the collection's NDJSON file |
| `Insert Document` (context) | Append a new document |
| `Delete Document` (context) | Remove a document by id |
| `Search Documents` (context) | Filter documents with a JSON query |
