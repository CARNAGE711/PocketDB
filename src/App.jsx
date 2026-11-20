/**
 * PocketDB Studio — application shell.
 *
 * Hub-and-surface navigation (no sidebar tree, no tab bar):
 *
 *   CommandBar ─ db/coll switchers (filter · pinned · recents) / breadcrumb /
 *                data-tools cluster (files vault · imports · snapshots) / palette
 *   ├── home      → DatabaseHome dashboard (stat tiles + collection cards)
 *   ├── coll      → collection surface: header + explorer + pager + console
 *   ├── pipeline  → PipelineStudio (horizontal stage rail)
 *   ├── charts    → ChartsStudio (SVG bars / donut over pipeline results)
 *   └── files     → FilesVault (binary storage)
 *
 * Plus: Ctrl+K command palette, saved queries, JSON/CSV export, duplicate
 * document, bulk selection ($in deletes + $set), inline grid cell editing,
 * document history, indexes, schema validation, imports (file + MongoDB),
 * snapshots, the HTTP bridge dialog, live sync, a first-launch tour, the
 * in-app docs, and a mono console status strip. All persistence goes
 * through the IPC bridge (src/lib/api.js) to the local file-based engine.
 */
import {
  Activity, Archive, Bookmark, BookOpen, Braces, CheckSquare, ChevronDown, Command, Database, Download,
  Eye, FileUp, FolderOpen, FolderPlus, HardDrive, Image as ImageIcon, Keyboard,
  KeyRound, LayoutDashboard, ListTree, LogOut, Pencil, Play, Plus, RefreshCw,
  ScanSearch, Server, Shield, Sparkles, Table, Terminal, Trash2, Undo2, Workflow, X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import ActivityFeed from './components/ActivityFeed.jsx';
import ChartsStudio from './components/ChartsStudio.jsx';
import CommandBar from './components/CommandBar.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import DatabaseHome from './components/DatabaseHome.jsx';
import DocumentExplorer from './components/DocumentExplorer.jsx';
import DocsPanel from './components/DocsPanel.jsx';
import { EditDocumentDialog, InsertDocumentDialog } from './components/DocumentDialogs.jsx';
import FilesVault from './components/FilesVault.jsx';
import HistoryDialog from './components/HistoryDialog.jsx';
import ImportDialog from './components/ImportDialog.jsx';
import IndexManagerDialog from './components/IndexManagerDialog.jsx';
import Launchpad from './components/Launchpad.jsx';
import McpDialog from './components/McpDialog.jsx';
import MongoImportDialog from './components/MongoImportDialog.jsx';
import NewDatabaseDialog from './components/NewDatabaseDialog.jsx';
import Pager from './components/Pager.jsx';
import PipelineStudio from './components/PipelineStudio.jsx';
import QueryConsole from './components/QueryConsole.jsx';
import SchemaAnalyzerDialog from './components/SchemaAnalyzerDialog.jsx';
import SchemaDialog from './components/SchemaDialog.jsx';
import ServerDialog from './components/ServerDialog.jsx';
import ShortcutsDialog from './components/ShortcutsDialog.jsx';
import SnapshotsDialog from './components/SnapshotsDialog.jsx';
import TourOverlay from './components/TourOverlay.jsx';
import TrashDialog from './components/TrashDialog.jsx';
import { Banner, Button, ConfirmDialog, IconButton, Modal, PromptDialog, Segmented } from './components/ui.jsx';

const NAME_PATTERN = /^[\w-]{1,64}$/;
const validateName = (name) =>
  NAME_PATTERN.test(name) ? null : 'Use 1-64 characters: letters, digits, underscore or hyphen.';

const TOUR_FLAG = 'pocketdb-tour-seen';

/* ------------------------------------------------------------------ */
/* Bulk $set dialog (updates every selected document)                  */
/* ------------------------------------------------------------------ */

function BulkSetDialog({ count, onClose, onApply }) {
  const [text, setText] = useState('{\n  "status": "archived"\n}');
  const [error, setError] = useState(null);

  const apply = () => {
    let spec;
    try {
      spec = JSON.parse(text);
    } catch (e) {
      setError(`Not valid JSON: ${e.message}`);
      return;
    }
    if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
      setError('Provide an object of { field: value } pairs (dot-notation allowed).');
      return;
    }
    onApply(spec);
  };

  return (
    <Modal
      title={`$set on ${count} document(s)`}
      subtitle="Applies the same update spec to every selected document"
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply}>
            <Braces size={13} /> Apply $set
          </Button>
        </>
      }
    >
      {error && <div className="mb-3"><Banner onClose={() => setError(null)}>{error}</Banner></div>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        spellCheck={false}
        className="w-full rounded-lg border border-ink-600 bg-ink-900 p-3 font-mono text-xs text-slate-100 outline-none focus:border-brand-500"
      />
    </Modal>
  );
}

export default function App() {
  /* ------------------------- connection state ----------------------- */

  const [connState, setConnState] = useState(null); // { info, conn } once connected
  const [connectDefaults, setConnectDefaults] = useState(null); // { defaultUri }
  const [connectError, setConnectError] = useState(null);

  /* ------------------------------ state ---------------------------- */

  const [databases, setDatabases] = useState([]); // [{ name, collections: [{ name, count, size }], meta }]
  const [activeDb, setActiveDb] = useState(null);
  const [activeColl, setActiveColl] = useState(null);
  const [surface, setSurface] = useState('home'); // 'home' | 'coll' | 'pipeline' | 'charts' | 'files'
  const [view, setView] = useState('ledger'); // 'grid' | 'ledger' | 'tree'

  const [docs, setDocs] = useState([]);
  const [matched, setMatched] = useState(null);
  const [queryText, setQueryText] = useState('{}');
  const [lastFilter, setLastFilter] = useState({});
  const [queryError, setQueryError] = useState(null);

  /* pagination */
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  /* bulk selection (Set of _ids) + inline editing */
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState(() => new Set());

  /* charts surface: pipeline captured from the Pipeline studio */
  const [pipelineSpec, setPipelineSpec] = useState(null);

  const [filesCount, setFilesCount] = useState(0);
  const [savedQueries, setSavedQueries] = useState([]);
  const [serverInfo, setServerInfo] = useState(null); // { running, port, lan, tokenProtected } | null

  /* app version + auto-update status */
  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState(null);

  const [banner, setBanner] = useState(null); // { kind, text }
  const [dialog, setDialog] = useState(null); // { kind, ...payload }
  const [confirmState, setConfirmState] = useState(null);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);

  /* presentation-only navigation aids (localStorage): pinned collections
     appear first in the navbar switcher, recents are one-click shortcuts */
  const [pinnedColls, setPinnedColls] = useState(() => {
    try { return new Set(JSON.parse(window.localStorage.getItem('pocketdb-pinned-colls') || '[]')); } catch { return new Set(); }
  });
  const [recentColls, setRecentColls] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem('pocketdb-recent-colls') || '[]'); } catch { return []; }
  });

  /* open collection tabs (per database, persisted across launches) */
  const [openTabs, setOpenTabs] = useState(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem('pocketdb-open-tabs') || '[]');
      return Array.isArray(raw) ? raw.filter((t) => t && t.db && t.coll) : [];
    } catch {
      return [];
    }
  });

  const rememberTabs = useCallback((next) => {
    try { window.localStorage.setItem('pocketdb-open-tabs', JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  }, []);

  const togglePinColl = useCallback((db, coll) => {
    setPinnedColls((prev) => {
      const next = new Set(prev);
      const key = `${db}/${coll}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try { window.localStorage.setItem('pocketdb-pinned-colls', JSON.stringify([...next])); } catch { /* private mode */ }
      return next;
    });
  }, []);

  const recordRecentColl = useCallback((db, coll) => {
    setRecentColls((prev) => {
      const key = `${db}/${coll}`;
      const next = [key, ...prev.filter((k) => k !== key)].slice(0, 8);
      try { window.localStorage.setItem('pocketdb-recent-colls', JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  /* nav history: the ← button walks back through previous locations
     (surfaces / collections / databases) instead of leaving the studio */
  const navStackRef = useRef([]);
  const navPrevRef = useRef(null);
  const navSkipRef = useRef(false);
  const [canGoBack, setCanGoBack] = useState(false);

  /* --------------------------- data loading ------------------------- */

  const loadDatabases = useCallback(async () => {
    try {
      const list = await api.listDatabases();
      // Merge presentation metadata (color tag / favorite) per database.
      const metas = await api.databasesMetaList().catch(() => ({}));
      setDatabases(list.map((d) => ({ ...d, meta: metas[d.name] || null })));
      return list;
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
      return [];
    }
  }, []);

  /**
   * Load documents for the active collection. Returns { documents, total }
   * so callers can react to empty pages (e.g. clamp after deletions).
   */
  const loadDocs = useCallback(async (db, coll, { filter = lastFilter, skip = 0, limit = 500 } = {}) => {
    if (!db || !coll) {
      setDocs([]);
      setMatched(null);
      return null;
    }
    try {
      const { documents, total } = await api.find(db, coll, { filter, skip, limit });
      setDocs(documents);
      setMatched(total);
      setQueryError(null);
      return { documents, total };
    } catch (err) {
      setQueryError(err.message);
      setDocs([]);
      setMatched(null);
      return null;
    }
  }, [lastFilter]);

  const loadFilesCount = useCallback(async (db) => {
    if (!db) return setFilesCount(0);
    try {
      const files = await api.listFiles(db);
      setFilesCount(files.length);
    } catch {
      setFilesCount(0);
    }
  }, []);

  /* ------------------------- connection flow ------------------------ */

  const afterConnect = useCallback(async () => {
    const list = await loadDatabases();
    // Land on the first database's dashboard — the hub is home base.
    if (list.length > 0) {
      setActiveDb(list[0].name);
      setActiveColl(null);
      setSurface('home');
    }
    // One-time tour on the very first connect.
    if (!window.localStorage.getItem(TOUR_FLAG)) {
      setTourOpen(true);
    }
  }, [loadDatabases]);

  const handleConnected = useCallback(
    async ({ info, conn }) => {
      setConnState({ info, conn });
      setConnectError(null);
      await afterConnect();
    },
    [afterConnect]
  );

  /** Back to the launchpad to switch data directory. */
  const handleDisconnect = useCallback(() => {
    setConnectError(null);
    setBanner(null);
    setConnState(null);
    setPaletteOpen(false);
    setShortcutsOpen(false);
    navStackRef.current = [];
    navPrevRef.current = null;
    navSkipRef.current = false;
    setCanGoBack(false);
  }, []);

  // On launch: auto-connect to the favorite connection, otherwise show the
  // launchpad. Also fetch the app version for the status strip.
  useEffect(() => {
    (async () => {
      api.appVersion().then(setAppVersion).catch(() => {});
      let defaultUri = '';
      try {
        defaultUri = (await api.connectionsDefaults()).defaultUri;
      } catch {
        /* the launchpad will fall back to its example */
      }
      setConnectDefaults({ defaultUri });
      try {
        const saved = await api.listConnections();
        const favorite = saved.find((c) => c.favorite);
        if (favorite) {
          const info = await api.connectEngine(favorite.uri);
          await handleConnected({ info, conn: favorite });
        }
      } catch (err) {
        setConnectError(err.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --------------------------- user actions ------------------------- */

  /** Open a database → its dashboard. */
  const openDb = useCallback((name) => {
    setActiveDb(name);
    setActiveColl(null);
    setSurface('home');
    setQueryText('{}');
    setLastFilter({});
    setMatched(null);
    setSelection(new Set());
    setSelectMode(false);
  }, []);

  /** Open a collection → the data surface (and keep it as an open tab). */
  const openColl = useCallback((name) => {
    setActiveColl(name);
    setSurface('coll');
    setQueryText('{}');
    setLastFilter({});
    setMatched(null);
    setSelection(new Set());
    setSelectMode(false);
    recordRecentColl(activeDb, name);
    if (activeDb) {
      setOpenTabs((prev) => {
        const next = [
          ...prev.filter((t) => !(t.db === activeDb && t.coll === name)),
          { db: activeDb, coll: name },
        ].slice(-12);
        return rememberTabs(next);
      });
    }
  }, [activeDb, recordRecentColl, rememberTabs]);

  /** Close a collection tab; the neighbour becomes active when needed. */
  const closeTab = useCallback((tab) => {
    setOpenTabs((prev) => rememberTabs(prev.filter((t) => !(t.db === tab.db && t.coll === tab.coll))));
    if (activeDb === tab.db && activeColl === tab.coll) {
      const neighbour = openTabs.filter((t) => t.db === tab.db && t.coll !== tab.coll).pop();
      if (neighbour) {
        openColl(neighbour.coll);
      } else {
        setActiveColl(null);
        setSurface('home');
      }
    }
  }, [activeDb, activeColl, openTabs, openColl, rememberTabs]);

  /* push every location change onto the history stack (the previous
     location, so ← can restore it); skipped when ← itself navigates */
  useEffect(() => {
    const cur = { db: activeDb, coll: activeColl, surface, view };
    const prev = navPrevRef.current;
    if (navSkipRef.current) {
      navSkipRef.current = false;
    } else if (
      prev
      && (prev.db !== cur.db || prev.coll !== cur.coll || prev.surface !== cur.surface || prev.view !== cur.view)
    ) {
      navStackRef.current.push(prev);
      if (navStackRef.current.length > 50) navStackRef.current.shift();
      setCanGoBack(true);
    }
    navPrevRef.current = cur;
  }, [activeDb, activeColl, surface, view]);

  /** ← — restore the previous location (does not leave the studio). */
  const goBack = useCallback(() => {
    const prev = navStackRef.current.pop();
    if (!prev) return;
    const cur = navPrevRef.current;
    navSkipRef.current = true;
    setActiveDb(prev.db);
    setActiveColl(prev.coll);
    setSurface(prev.surface);
    setView(prev.view);
    /* only reset the query state when the collection itself changes —
       otherwise the loaded documents would disagree with the console */
    if (!cur || cur.db !== prev.db || cur.coll !== prev.coll) {
      setQueryText('{}');
      setLastFilter({});
      setMatched(null);
      setPage(0);
      setSelection(new Set());
      setSelectMode(false);
    }
    setCanGoBack(navStackRef.current.length > 0);
  }, []);

  useEffect(() => {
    setPage(0);
    loadDocs(activeDb, activeColl, { filter: {}, skip: 0, limit: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDb, activeColl]);

  useEffect(() => {
    loadFilesCount(activeDb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDb, surface]);

  /* saved queries for the active collection */
  const loadSavedQueries = useCallback(async () => {
    if (!activeDb || !activeColl) return setSavedQueries([]);
    try {
      setSavedQueries(await api.listQueries(activeDb, activeColl));
    } catch {
      setSavedQueries([]);
    }
  }, [activeDb, activeColl]);

  useEffect(() => {
    if (surface === 'coll') loadSavedQueries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDb, activeColl, surface]);

  /* server status + auto-update pushes */
  useEffect(() => {
    if (!connState) return undefined;
    api.serverStatus().then((s) => setServerInfo(s.running ? s : null)).catch(() => {});
    return api.onUpdateStatus((status) => setUpdateStatus(status));
  }, [connState]);

  const refreshAll = async () => {
    const list = await loadDatabases();
    if (activeDb && !list.some((d) => d.name === activeDb)) {
      openDb(list[0]?.name || null); // active database was dropped
      return;
    }
    const current = list.find((d) => d.name === activeDb);
    if (current && activeColl && !current.collections.some((c) => c.name === activeColl)) {
      setActiveColl(null); // collection was dropped
      setSurface('home');
    }
    // Drop tabs whose database/collection no longer exists.
    setOpenTabs((prev) => {
      const next = prev.filter((t) => {
        const d = list.find((x) => x.name === t.db);
        return d && d.collections.some((c) => c.name === t.coll);
      });
      return next.length === prev.length ? prev : rememberTabs(next);
    });
    await loadFilesCount(activeDb);
    if (activeDb && activeColl && surface === 'coll') {
      const res = await loadDocs(activeDb, activeColl, { skip: page * pageSize, limit: pageSize });
      // Clamp to page 0 if the current page fell out of range.
      if (res && res.documents.length === 0 && page > 0) {
        setPage(0);
        await loadDocs(activeDb, activeColl, { skip: 0, limit: pageSize });
      }
    }
  };

  // Live sync: the main process watches the data directory (fs.watch) and
  // pushes 'engine:changed' — external writes from other apps appear here
  // without a manual refresh.
  const refreshRef = useRef(null);
  refreshRef.current = refreshAll;

  useEffect(() => {
    if (!connState) return undefined;
    let timer = null;
    const off = api.onEngineChanged(() => {
      clearTimeout(timer);
      timer = setTimeout(() => refreshRef.current?.(), 350);
    });
    return () => {
      clearTimeout(timer);
      off?.();
    };
  }, [connState]);

  /* filter running (shared by console, Builder, palette and saved queries) */

  const runFilter = useCallback(
    async (text) => {
      let filter;
      try {
        filter = JSON.parse(text || '{}');
        if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) {
          throw new Error('Filter must be a JSON object.');
        }
      } catch (err) {
        setQueryError(`Invalid filter: ${err.message}`);
        return;
      }
      setQueryError(null);
      setLastFilter(filter);
      setPage(0);
      await loadDocs(activeDb, activeColl, { filter, skip: 0, limit: pageSize });
    },
    [activeDb, activeColl, pageSize, loadDocs]
  );

  /** QueryConsole Run button passes nothing; the Builder passes fresh JSON. */
  const runQuery = (text) => runFilter(typeof text === 'string' ? text : queryText);

  const clearQuery = async () => {
    setQueryText('{}');
    setLastFilter({});
    setPage(0);
    await loadDocs(activeDb, activeColl, { filter: {}, skip: 0, limit: pageSize });
  };

  const gotoPage = async (next) => {
    setPage(next);
    await loadDocs(activeDb, activeColl, { skip: next * pageSize, limit: pageSize });
  };

  const changePageSize = async (n) => {
    setPageSize(n);
    setPage(0);
    await loadDocs(activeDb, activeColl, { skip: 0, limit: n });
  };

  /* --------------------------- doc actions -------------------------- */

  /** Clone a document without its _id (the engine assigns a fresh one). */
  const duplicateDoc = async (doc) => {
    const { _id, ...rest } = doc;
    try {
      await api.insertOne(activeDb, activeColl, rest);
      setBanner({ kind: 'ok', text: 'Document duplicated.' });
      await refreshAll();
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  };

  /**
   * Inline grid cell edit: parse the drafted cell as JSON when possible
   * (numbers, booleans, objects) and apply as a dotted-path $set.
   */
  const handleCellEdit = async (doc, col, draft) => {
    if (col === '_id') return;
    let value;
    try {
      value = JSON.parse(draft);
    } catch {
      value = draft; // treat as a plain string
    }
    const current = col.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), doc);
    if (JSON.stringify(current) === JSON.stringify(value)) return; // no change
    try {
      await api.updateOne(activeDb, activeColl, { _id: doc._id }, { $set: { [col]: value } });
      setBanner({ kind: 'ok', text: `Updated "${col}" of ${doc._id}.` });
      await refreshAll();
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  };

  /* bulk selection */

  const toggleSelect = (doc) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(doc._id)) next.delete(doc._id);
      else next.add(doc._id);
      return next;
    });
  };

  const bulkDelete = () => {
    const ids = [...selection];
    setConfirmState({
      kind: 'bulk-delete', db: activeDb, coll: activeColl, ids,
      title: 'Delete selected documents',
      message: `Delete ${ids.length} selected document(s)? Their pre-images stay in the history log.`,
    });
  };

  const bulkSet = async (spec) => {
    setDialog(null);
    try {
      const res = await api.updateMany(
        activeDb,
        activeColl,
        { _id: { $in: [...selection] } },
        { $set: spec }
      );
      setSelection(new Set());
      setBanner({ kind: 'ok', text: `$set applied to ${res.modified} document(s).` });
      await refreshAll();
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  };

  /* dialogs */

  /** Called by NewDatabaseDialog after a successful create. keepOpen=true
   *  means "Create & New" — refresh, select the new db, keep the dialog up. */
  const handleDbCreated = async (name, keepOpen) => {
    await loadDatabases();
    openDb(name);
    if (!keepOpen) setDialog(null);
  };

  const createColl = async (name) => {
    setDialog(null);
    try {
      await api.createCollection(dialog.db, name);
      await loadDatabases();
      openColl(name);
      setBanner({ kind: 'ok', text: `Collection "${name}" created.` });
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  };

  /** Drop confirmation that knows whether the target is a collection or a view. */
  const confirmDropColl = (db, coll) => {
    const target = databases
      .find((d) => d.name === db)
      ?.collections.find((c) => c.name === coll);
    setConfirmState({
      kind: 'drop-coll', db, coll,
      title: target?.view ? 'Delete saved view' : 'Drop collection',
      message: target?.view
        ? `Delete the view "${coll}" from "${db}"? The source collection "${target.source}" and its documents are untouched.`
        : `Drop collection "${coll}" from "${db}"? All documents in it will be deleted (they stay restorable in the trash).`,
    });
  };

  const runConfirmed = async () => {
    const action = confirmState;
    setConfirmState(null);
    try {
      if (action.kind === 'drop-db') {
        await api.dropDatabase(action.db);
        setBanner({ kind: 'ok', text: `Database "${action.db}" dropped.` });
      } else if (action.kind === 'drop-coll') {
        const res = await api.dropCollection(action.db, action.coll);
        setBanner({
          kind: 'ok',
          text: res?.view ? `View "${action.coll}" deleted.` : `Collection "${action.coll}" dropped.`,
        });
      } else if (action.kind === 'delete-doc') {
        await api.deleteOne(action.db, action.coll, action.doc._id);
        setBanner({ kind: 'ok', text: 'Document deleted.' });
      } else if (action.kind === 'bulk-delete') {
        const res = await api.deleteMany(action.db, action.coll, { _id: { $in: action.ids } });
        setSelection(new Set());
        setBanner({ kind: 'ok', text: `${res.deleted} document(s) deleted.` });
      }
      await refreshAll();
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  };

  /* saved-query callbacks (QueryConsole) */

  const saveQuery = async (name) => {
    try {
      await api.saveQuery({ db: activeDb, coll: activeColl, name, text: queryText });
      setSavedQueries(await api.listQueries(activeDb, activeColl));
      setBanner({ kind: 'ok', text: `Filter "${name}" saved.` });
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  };

  const deleteQuery = async (id) => {
    try {
      await api.deleteQuery(id);
      setSavedQueries(await api.listQueries(activeDb, activeColl));
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  };

  const pickQuery = (q) => {
    setQueryText(q.text);
    runFilter(q.text);
  };

  /* export (JSON / CSV) */

  useEffect(() => {
    if (!exportOpen) return undefined;
    const onDown = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [exportOpen]);

  const doExport = async (format) => {
    setExportOpen(false);
    try {
      const target = await api.exportCollection(activeDb, activeColl, format);
      if (target) setBanner({ kind: 'ok', text: `Exported to ${target}` });
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  };

  /* ------------------------- global keyboard ------------------------ */

  useEffect(() => {
    const onKey = (e) => {
      if (!connState) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connState]);

  /* Alt+1..7 — jump straight to a surface or tool (guarded by what exists) */
  useEffect(() => {
    if (!connState) return undefined;
    const onKey = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const jumps = {
        1: () => activeDb && setSurface('home'),
        2: () => activeColl && setSurface('coll'),
        3: () => activeColl && setSurface('pipeline'),
        4: () => activeDb && setSurface('files'),
        5: () => setDialog({ kind: 'activity' }),
        6: () => activeDb && setDialog({ kind: 'trash' }),
        7: () => activeColl && setDialog({ kind: 'analyze' }),
      };
      const jump = jumps[e.key];
      if (jump) {
        e.preventDefault();
        jump();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connState, activeDb, activeColl]);

  /* ------------------------------ render ---------------------------- */

  if (!connState) {
    if (!connectDefaults) {
      return (
        <div className="flex h-full items-center justify-center bg-ink-950 font-mono text-xs text-slate-500">
          starting pocketdb engine…
        </div>
      );
    }
    return (
      <Launchpad
        initialUri={connectDefaults.defaultUri}
        initialError={connectError}
        onConnected={handleConnected}
      />
    );
  }

  const dbObj = databases.find((d) => d.name === activeDb) || null;
  const activeCollStats = dbObj?.collections.find((c) => c.name === activeColl);
  const hasDb = Boolean(activeDb);
  const hasColl = Boolean(activeDb && activeColl);
  const isView = Boolean(activeCollStats?.view);
  const tabsForDb = openTabs.filter((t) => t.db === activeDb);

  /* command-palette items (context-aware) */
  const paletteItems = [
    hasDb && {
      id: 'nav:home', group: 'Navigate', icon: LayoutDashboard,
      label: `Database overview — ${activeDb}`, run: () => setSurface('home'),
    },
    hasColl && {
      id: 'nav:coll', group: 'Navigate', icon: FolderOpen,
      label: `Collection — ${activeColl}`, run: () => setSurface('coll'),
    },
    hasColl && {
      id: 'nav:pipeline', group: 'Navigate', icon: Workflow,
      label: 'Pipeline studio', run: () => setSurface('pipeline'),
    },
    hasColl && pipelineSpec && {
      id: 'nav:charts', group: 'Navigate', icon: Table,
      label: 'Chart results', run: () => setSurface('charts'),
    },
    hasDb && {
      id: 'nav:files', group: 'Navigate', icon: ImageIcon,
      label: 'Files vault', run: () => setSurface('files'),
    },
    ...databases.map((d) => ({
      id: `db:${d.name}`, group: 'Databases', icon: Database, label: d.name, run: () => openDb(d.name),
    })),
    ...(dbObj?.collections || []).map((c) => ({
      id: `coll:${c.name}`, group: 'Collections', icon: FolderOpen, label: c.name, run: () => openColl(c.name),
    })),
    ...savedQueries.map((q) => ({
      id: `saved:${q.id}`, group: 'Saved', icon: Bookmark,
      label: q.name, run: () => pickQuery(q),
    })),
    {
      id: 'act:new-db', group: 'Actions', icon: FolderPlus,
      label: 'New database', run: () => setDialog({ kind: 'new-db' }),
    },
    hasDb && {
      id: 'act:new-coll', group: 'Actions', icon: Plus,
      label: 'New collection', run: () => setDialog({ kind: 'new-coll', db: activeDb }),
    },
    hasColl && !isView && {
      id: 'act:insert', group: 'Actions', icon: Plus,
      label: 'Insert document', run: () => setDialog({ kind: 'insert' }),
    },
    hasColl && !isView && {
      id: 'act:import', group: 'Actions', icon: FileUp,
      label: 'Import documents into this collection', run: () => setDialog({ kind: 'import', coll: activeColl }),
    },
    hasDb && {
      id: 'act:import-mongo', group: 'Actions', icon: Server,
      label: 'Import from a MongoDB server', run: () => setDialog({ kind: 'mongo' }),
    },
    hasColl && {
      id: 'act:run', group: 'Actions', icon: Play,
      label: 'Run filter', run: () => runQuery(),
    },
    hasColl && {
      id: 'act:export-json', group: 'Actions', icon: Download,
      label: 'Export collection as JSON', run: () => doExport('json'),
    },
    hasColl && {
      id: 'act:export-csv', group: 'Actions', icon: Download,
      label: 'Export collection as CSV', run: () => doExport('csv'),
    },
    hasColl && !isView && {
      id: 'act:select', group: 'Actions', icon: CheckSquare,
      label: selectMode ? 'Exit bulk selection' : 'Bulk-select documents',
      run: () => setSelectMode((v) => !v),
    },
    hasColl && !isView && {
      id: 'act:indexes', group: 'Actions', icon: KeyRound,
      label: 'Indexes', run: () => setDialog({ kind: 'indexes' }),
    },
    hasColl && !isView && {
      id: 'act:schema', group: 'Actions', icon: Shield,
      label: 'Schema validation rules', run: () => setDialog({ kind: 'schema' }),
    },
    hasColl && {
      id: 'act:schema-analyzer', group: 'Actions', icon: ScanSearch,
      label: 'Schema analyzer — field distribution', run: () => setDialog({ kind: 'analyze' }),
    },
    hasDb && {
      id: 'act:trash', group: 'Actions', icon: Undo2,
      label: 'Trash — restore deleted documents', run: () => setDialog({ kind: 'trash' }),
    },
    hasDb && {
      id: 'act:activity', group: 'Actions', icon: Activity,
      label: 'Activity feed — live engine events', run: () => setDialog({ kind: 'activity' }),
    },
    hasDb && {
      id: 'act:mcp', group: 'Actions', icon: Terminal,
      label: 'MCP server — connect an AI client', run: () => setDialog({ kind: 'mcp' }),
    },
    hasColl && {
      id: 'act:view-grid', group: 'View', icon: Table,
      label: 'View as grid', run: () => { setView('grid'); setSurface('coll'); },
    },
    hasColl && {
      id: 'act:view-ledger', group: 'View', icon: ListTree,
      label: 'View as ledger', run: () => { setView('ledger'); setSurface('coll'); },
    },
    hasColl && {
      id: 'act:view-tree', group: 'View', icon: Braces,
      label: 'View as JSON tree', run: () => { setView('tree'); setSurface('coll'); },
    },
    hasDb && {
      id: 'act:server', group: 'Actions', icon: Server,
      label: 'HTTP bridge (server mode)…', run: () => setDialog({ kind: 'server' }),
    },
    hasDb && {
      id: 'act:snapshots', group: 'Actions', icon: Archive,
      label: 'Snapshots — database backups…', run: () => setDialog({ kind: 'snapshots' }),
    },
    {
      id: 'act:docs', group: 'Actions', icon: BookOpen,
      label: 'Quick reference (docs)', run: () => setDialog({ kind: 'docs' }),
    },
    {
      id: 'act:tour', group: 'Actions', icon: Sparkles,
      label: 'Replay the intro tour', run: () => setTourOpen(true),
    },
    {
      id: 'act:refresh', group: 'Actions', icon: RefreshCw,
      label: 'Refresh', run: () => refreshAll(),
    },
    {
      id: 'act:keys', group: 'Actions', icon: Keyboard,
      label: 'Keyboard shortcuts', run: () => setShortcutsOpen(true),
    },
    {
      id: 'act:disconnect', group: 'Actions', icon: LogOut,
      label: 'Switch connection / directory', run: handleDisconnect,
    },
  ].filter(Boolean);

  return (
    <div className="flex h-full flex-col">
      {/* brand accent line */}
      <div className="h-0.5 shrink-0 bg-gradient-to-r from-brand-500 via-brand-400/40 to-transparent" />

      <CommandBar
        databases={databases}
        activeDb={activeDb}
        activeColl={activeColl}
        surface={surface}
        onOpenDb={openDb}
        onOpenColl={openColl}
        onCreateDb={() => setDialog({ kind: 'new-db' })}
        onNewColl={() => hasDb && setDialog({ kind: 'new-coll', db: activeDb })}
        onDropDb={(db) =>
          setConfirmState({
            kind: 'drop-db', db,
            title: 'Drop database',
            message: `Drop database "${db}" and all of its collections? This permanently deletes the files on disk.`,
          })
        }
        onDropColl={confirmDropColl}
        onBack={goBack}
        canGoBack={canGoBack}
        backTitle={canGoBack ? 'Back' : 'Nothing to go back to'}
        onRefresh={refreshAll}
        onPalette={() => setPaletteOpen(true)}
        onDisconnect={handleDisconnect}
        onFilesVault={() => hasDb && setSurface('files')}
        onImportDocs={() =>
          hasDb
          && setDialog({ kind: 'import-pick', db: activeDb, colls: dbObj?.collections.map((c) => c.name) || [] })
        }
        onImportMongo={() => setDialog({ kind: 'mongo' })}
        onSnapshots={() => hasDb && setDialog({ kind: 'snapshots' })}
        onActivity={() => setDialog({ kind: 'activity' })}
        onTrash={() => hasDb && setDialog({ kind: 'trash' })}
        pinnedColls={[...pinnedColls]}
        onTogglePin={togglePinColl}
        recentColls={recentColls}
      />

      {/* open collection tabs (per database) */}
      {hasDb && surface !== 'files' && tabsForDb.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-ink-700 bg-ink-950 px-3 py-1">
          {tabsForDb.map((tab) => {
            const stats = dbObj?.collections.find((c) => c.name === tab.coll);
            const active = activeColl === tab.coll && surface !== 'home';
            return (
              <div
                key={`${tab.db}/${tab.coll}`}
                className={`group flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 transition-colors ${
                  active
                    ? 'border-brand-500/50 bg-ink-800 text-slate-100'
                    : 'border-transparent text-slate-500 hover:bg-ink-900 hover:text-slate-300'
                }`}
              >
                <button
                  onClick={() => openColl(tab.coll)}
                  className="flex min-w-0 items-center gap-1.5 py-0.5 text-xs"
                  title={stats?.view ? `Read-only view of "${stats.source}"` : `Open ${tab.coll}`}
                >
                  {stats?.view ? (
                    <Eye size={11} className="shrink-0 text-indigo-400" />
                  ) : (
                    <FolderOpen size={11} className={`shrink-0 ${active ? 'text-brand-400' : 'text-slate-600'}`} />
                  )}
                  <span className="max-w-[11rem] truncate">{tab.coll}</span>
                  {stats?.count !== null && stats?.count !== undefined && (
                    <span className="shrink-0 font-mono text-[9px] text-slate-600">{stats.count}</span>
                  )}
                </button>
                <button
                  onClick={() => closeTab(tab)}
                  title={`Close ${tab.coll}`}
                  aria-label={`Close ${tab.coll}`}
                  className="rounded p-0.5 text-slate-600 opacity-0 transition-opacity hover:bg-ink-700 hover:text-slate-200 group-hover:opacity-100"
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}
          <button
            onClick={() => setDialog({ kind: 'new-coll', db: activeDb })}
            title="New collection"
            aria-label="New collection"
            className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-ink-800 hover:text-brand-300"
          >
            <Plus size={12} />
          </button>
        </div>
      )}

      {/* content */}
      <main className="flex min-h-0 flex-1 flex-col bg-ink-950">
        {banner && (
          <div className="px-4 pt-3">
            <Banner kind={banner.kind} onClose={() => setBanner(null)}>{banner.text}</Banner>
          </div>
        )}

        {!hasDb ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-ink-600 bg-ink-900">
                <FolderPlus size={26} className="text-slate-600" />
              </div>
              <p className="text-sm font-medium text-slate-400">No databases yet</p>
              <p className="mt-1 text-xs text-slate-600">Create your first database to get started.</p>
              <Button variant="primary" className="mt-4" onClick={() => setDialog({ kind: 'new-db' })}>
                <Plus size={14} /> New database
              </Button>
            </div>
          </div>
        ) : surface === 'files' ? (
          <FilesVault db={activeDb} key={activeDb} />
        ) : !activeColl ? (
          /* any surface without a collection falls back to the dashboard */
          <DatabaseHome
            db={dbObj}
            filesCount={filesCount}
            dataDir={connState.info.dataDir}
            onOpenColl={openColl}
            onNewColl={() => setDialog({ kind: 'new-coll', db: activeDb })}
            onDropColl={(coll) => confirmDropColl(activeDb, coll)}
            onInsertDoc={(coll) => setDialog({ kind: 'insert', db: activeDb, coll })}
            onDropDb={() =>
              setConfirmState({
                kind: 'drop-db', db: activeDb,
                title: 'Drop database',
                message: `Drop database "${activeDb}" and all of its collections? This permanently deletes the files on disk.`,
              })
            }
          />
        ) : surface === 'pipeline' ? (
          <PipelineStudio
            key={`${activeDb}/${activeColl}`}
            db={activeDb}
            coll={activeColl}
            isView={isView}
            onChart={(pipeline) => {
              setPipelineSpec(pipeline);
              setSurface('charts');
            }}
            onViewSaved={async (view) => {
              await loadDatabases();
              setBanner({ kind: 'ok', text: `Saved view "${view.name}" — open it from the collection switcher.` });
            }}
          />
        ) : surface === 'charts' ? (
          <ChartsStudio
            key={`${activeDb}/${activeColl}/${JSON.stringify(pipelineSpec)}`}
            db={activeDb}
            coll={activeColl}
            stages={pipelineSpec}
          />
        ) : (
          /* collection surface */
          <>
            <div className="flex shrink-0 items-center justify-between border-b border-ink-700 bg-ink-900 px-4 py-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-slate-500">collection</span>
                <span className="truncate text-sm font-medium text-slate-100">{activeColl}</span>
                {isView ? (
                  <span
                    className="flex shrink-0 items-center gap-1 rounded-full bg-indigo-500/15 px-2 py-0.5 font-mono text-[10px] text-indigo-300"
                    title={`Read-only view of "${activeCollStats?.source}" — edit the source collection instead`}
                  >
                    <Eye size={10} /> view of {activeCollStats?.source}
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-ink-800 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                    {activeCollStats?.count ?? matched ?? 0} docs
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Segmented
                  value={view}
                  onChange={setView}
                  options={[
                    { id: 'grid', label: 'Grid', icon: Table, title: 'Table grid' },
                    { id: 'ledger', label: 'Ledger', icon: ListTree, title: 'Row ledger with expandable detail' },
                    { id: 'tree', label: 'JSON', icon: Braces, title: 'JSON tree cards' },
                  ]}
                />
                <span className="mx-1 h-5 w-px bg-ink-700" />
                {!isView && (
                  <>
                    <IconButton
                      onClick={() => setSelectMode((v) => !v)}
                      title={selectMode ? 'Exit bulk selection' : 'Bulk-select documents'}
                      aria-label="Toggle bulk selection"
                      className={selectMode ? 'bg-ink-700 text-brand-300' : ''}
                    >
                      <CheckSquare size={14} />
                    </IconButton>
                    <IconButton
                      onClick={() => setDialog({ kind: 'indexes' })}
                      title="Indexes (faster equality / $in lookups)"
                      aria-label="Manage indexes"
                    >
                      <KeyRound size={14} />
                    </IconButton>
                    <IconButton
                      onClick={() => setDialog({ kind: 'schema' })}
                      title="Schema validation rules"
                      aria-label="Schema validation"
                    >
                      <Shield size={14} />
                    </IconButton>
                    <IconButton
                      onClick={() => setDialog({ kind: 'import', coll: activeColl })}
                      title="Import documents (JSON / NDJSON / CSV)"
                      aria-label="Import documents"
                    >
                      <FileUp size={14} />
                    </IconButton>
                  </>
                )}
                <IconButton
                  onClick={() => setDialog({ kind: 'analyze' })}
                  title="Schema analyzer — field distribution across documents"
                  aria-label="Schema analyzer"
                >
                  <ScanSearch size={14} />
                </IconButton>
                <span className="mx-1 h-5 w-px bg-ink-700" />
                {/* export dropdown */}
                <div className="relative" ref={exportRef}>
                  <Button variant="ghost" onClick={() => setExportOpen((o) => !o)} title="Export collection">
                    <Download size={14} /> Export
                    <ChevronDown size={12} className="text-slate-500" />
                  </Button>
                  {exportOpen && (
                    <div className="absolute right-0 z-40 mt-1 w-44 rounded-lg border border-ink-600 bg-ink-850 py-1 shadow-2xl">
                      <button
                        onClick={() => doExport('json')}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-ink-800 hover:text-brand-300"
                      >
                        <Download size={12} /> JSON (.json)
                      </button>
                      <button
                        onClick={() => doExport('csv')}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-ink-800 hover:text-brand-300"
                      >
                        <Download size={12} /> CSV (.csv)
                      </button>
                    </div>
                  )}
                </div>
                <Button variant="ghost" onClick={() => setSurface('pipeline')}>
                  <Workflow size={14} /> Pipeline
                </Button>
                {!isView && (
                  <Button variant="primary" onClick={() => setDialog({ kind: 'insert' })}>
                    <Plus size={14} /> Insert
                  </Button>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <DocumentExplorer
                view={view}
                docs={docs}
                onEdit={(doc) => setDialog({ kind: 'edit', doc })}
                onDuplicate={duplicateDoc}
                onHistory={(doc) => setDialog({ kind: 'history', docId: doc._id })}
                selection={!isView && selectMode ? selection : null}
                onToggleSelect={toggleSelect}
                onCellEdit={handleCellEdit}
                readOnly={isView}
                onDelete={(doc) =>
                  setConfirmState({
                    kind: 'delete-doc', db: activeDb, coll: activeColl, doc,
                    title: 'Delete document',
                    message: `Delete document ${doc._id}? Its pre-image is kept in the history log and the document can be restored from the trash.`,
                  })
                }
              />

              {/* floating bulk bar */}
              {!isView && selectMode && selection.size > 0 && (
                <div className="flex shrink-0 items-center gap-3 border-t border-brand-500/30 bg-brand-950/20 px-4 py-2">
                  <span className="font-mono text-xs text-brand-300">{selection.size} selected</span>
                  <Button variant="danger" onClick={bulkDelete}>
                    <Trash2 size={13} /> Delete
                  </Button>
                  <Button variant="subtle" onClick={() => setDialog({ kind: 'bulk-set' })}>
                    <Pencil size={13} /> $set field…
                  </Button>
                  <Button variant="ghost" onClick={() => setSelection(new Set())}>
                    Clear selection
                  </Button>
                </div>
              )}

              <Pager
                page={page}
                pageSize={pageSize}
                total={matched ?? 0}
                onPage={gotoPage}
                onPageSize={changePageSize}
              />
              <QueryConsole
                db={activeDb}
                coll={activeColl}
                queryText={queryText}
                onQueryText={setQueryText}
                onRun={runQuery}
                onClear={clearQuery}
                matched={matched}
                loaded={docs.length}
                error={queryError}
                savedQueries={savedQueries}
                onSaveQuery={saveQuery}
                onDeleteQuery={deleteQuery}
                onPickQuery={pickQuery}
              />
            </div>
          </>
        )}
      </main>

      {/* console status strip */}
      <footer className="flex shrink-0 items-center gap-4 border-t border-ink-700 bg-ink-900 px-4 py-1.5 font-mono text-[10px] text-slate-500">
        <button
          onClick={handleDisconnect}
          title="Click to switch connection / data directory"
          className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-ink-700 hover:text-slate-300"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: connState.conn.color || '#14b8a6' }}
          />
          {connState.conn.name}
        </button>
        <span className="flex items-center gap-1.5">
          <HardDrive size={10} /> {connState.info.dataDir}
        </span>
        <span className="hidden xl:inline">{connState.info.format}</span>
        <span className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setDialog({ kind: 'activity' })}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-emerald-500/80 hover:bg-ink-700 hover:text-emerald-300"
            title="Live sync is on — click for the activity feed"
          >
            <Activity size={10} /> live sync
          </button>
          <button
            onClick={() => setDialog({ kind: 'server' })}
            title="HTTP bridge (server mode) — localhost REST API"
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-ink-700 ${
              serverInfo ? 'text-emerald-400' : 'hover:text-slate-300'
            }`}
          >
            <Server size={10} />
            {serverInfo ? `http://127.0.0.1:${serverInfo.port}` : 'server off'}
          </button>
          <button
            onClick={() => setDialog({ kind: 'docs' })}
            title="PocketDB quick reference"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-ink-700 hover:text-slate-300"
          >
            <BookOpen size={10} /> docs
          </button>
          {updateStatus?.status === 'downloaded' ? (
            <button
              onClick={() => api.installUpdate().catch(() => {})}
              title="A downloaded update is ready — quit and install"
              className="rounded bg-brand-600 px-1.5 py-0.5 text-ink-950 hover:bg-brand-500"
            >
              update ready{updateStatus.version ? ` · v${updateStatus.version}` : ''} — install
            </button>
          ) : updateStatus?.status === 'downloading' ? (
            <span className="text-brand-300">downloading update {updateStatus.percent ?? 0}%</span>
          ) : null}
          <span title={`PocketDB v${appVersion || connState.info.version}`}>
            v{appVersion || '…'}
          </span>
          <span title="Databases in this data directory" className="flex items-center gap-1">
            <Database size={10} /> {databases.length} dbs
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <Command size={10} /> Ctrl+K palette
          </span>
        </span>
      </footer>

      {/* ---------------------------- overlays ---------------------------- */}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {tourOpen && (
        <TourOverlay
          onClose={() => {
            setTourOpen(false);
            try { window.localStorage.setItem(TOUR_FLAG, '1'); } catch { /* private mode */ }
          }}
        />
      )}

      {dialog?.kind === 'new-db' && (
        <NewDatabaseDialog
          dataDir={connState.info.dataDir}
          onClose={() => setDialog(null)}
          onCreated={handleDbCreated}
        />
      )}

      {dialog?.kind === 'new-coll' && (
        <PromptDialog
          title={`New collection in "${dialog.db}"`}
          subtitle="Creates an NDJSON file inside the database folder"
          placeholder="my-collection"
          validate={validateName}
          onCancel={() => setDialog(null)}
          onSubmit={createColl}
        />
      )}

      {dialog?.kind === 'insert' && (
        <InsertDocumentDialog
          db={dialog.db || activeDb}
          coll={dialog.coll || activeColl}
          onClose={() => setDialog(null)}
          onInserted={async () => {
            setDialog(null);
            setBanner({ kind: 'ok', text: 'Document inserted.' });
            await refreshAll();
          }}
        />
      )}

      {dialog?.kind === 'edit' && (
        <EditDocumentDialog
          db={activeDb}
          coll={activeColl}
          doc={dialog.doc}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            setBanner({ kind: 'ok', text: 'Document saved.' });
            await refreshAll();
          }}
        />
      )}

      {dialog?.kind === 'indexes' && hasColl && (
        <IndexManagerDialog db={activeDb} coll={activeColl} onClose={() => setDialog(null)} />
      )}

      {dialog?.kind === 'schema' && hasColl && (
        <SchemaDialog
          db={activeDb}
          coll={activeColl}
          onClose={() => setDialog(null)}
          onSaved={() => refreshAll().catch(() => {})}
        />
      )}

      {dialog?.kind === 'history' && hasColl && (
        <HistoryDialog
          db={activeDb}
          coll={activeColl}
          docId={dialog.docId}
          onClose={() => setDialog(null)}
          onRestored={() => refreshAll().catch(() => {})}
        />
      )}

      {dialog?.kind === 'import' && (
        <ImportDialog
          db={activeDb}
          coll={dialog.coll || activeColl}
          onClose={() => setDialog(null)}
          onImported={async () => {
            setBanner({ kind: 'ok', text: 'Import finished.' });
            await refreshAll();
          }}
        />
      )}

      {dialog?.kind === 'import-pick' && (
        <PromptDialog
          title="Import documents — target collection"
          subtitle="Type an existing collection, or a new name to create it on import"
          placeholder="my-collection"
          validate={validateName}
          onCancel={() => setDialog(null)}
          onSubmit={(coll) => setDialog({ kind: 'import', coll })}
        />
      )}

      {dialog?.kind === 'mongo' && (
        <MongoImportDialog
          dataDir={connState.info.dataDir}
          onClose={() => setDialog(null)}
          onImported={async () => {
            setBanner({ kind: 'ok', text: 'MongoDB mirror finished.' });
            await refreshAll();
          }}
        />
      )}

      {dialog?.kind === 'snapshots' && hasDb && (
        <SnapshotsDialog
          db={activeDb}
          onClose={() => setDialog(null)}
          onRestored={async () => {
            setBanner({ kind: 'ok', text: 'Snapshot restored — the database is back to the snapshot state.' });
            await refreshAll();
          }}
        />
      )}

      {dialog?.kind === 'activity' && <ActivityFeed onClose={() => setDialog(null)} />}

      {dialog?.kind === 'trash' && hasDb && (
        <TrashDialog
          db={activeDb}
          onClose={() => setDialog(null)}
          onRestored={async () => {
            setBanner({ kind: 'ok', text: 'Document restored from the trash.' });
            await refreshAll();
          }}
        />
      )}

      {dialog?.kind === 'analyze' && hasColl && (
        <SchemaAnalyzerDialog db={activeDb} coll={activeColl} onClose={() => setDialog(null)} />
      )}

      {dialog?.kind === 'mcp' && <McpDialog onClose={() => setDialog(null)} />}

      {dialog?.kind === 'bulk-set' && (
        <BulkSetDialog count={selection.size} onClose={() => setDialog(null)} onApply={bulkSet} />
      )}

      {dialog?.kind === 'server' && (
        <ServerDialog
          serverInfo={serverInfo}
          onClose={() => setDialog(null)}
          onStarted={(info) => {
            setServerInfo(info);
            setBanner({ kind: 'ok', text: `HTTP bridge running at http://127.0.0.1:${info.port}.` });
          }}
          onStopped={() => {
            setServerInfo(null);
            setBanner({ kind: 'ok', text: 'HTTP bridge stopped.' });
          }}
        />
      )}

      {dialog?.kind === 'docs' && <DocsPanel onClose={() => setDialog(null)} />}

      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          onCancel={() => setConfirmState(null)}
          onConfirm={runConfirmed}
        />
      )}
    </div>
  );
}
