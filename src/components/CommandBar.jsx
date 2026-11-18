/**
 * CommandBar — PocketDB's single top navigation strip.
 *
 * Replaces the classic sidebar-tree + tab-bar with a hub model:
 *   [← history back] [brand] [database switcher ▾] › [collection switcher ▾] › [surface]
 *
 * Right side: a labeled data-tools cluster (files vault, imports, snapshots —
 * the dashboard's action cards, always one click away), then the command
 * palette, refresh and disconnect (start page). The switcher dropdowns gained
 * a filter box, pinned collections (★) and a recent list for fast jumps.
 * ← walks back through the app's own nav history; the start page lives on
 * the right-edge (LogOut) button and the status-strip connection chip.
 */
import {
  Archive, ChevronDown, ChevronLeft, ChevronRight, Command, Database, Files, FileUp,
  FolderOpen, HardDrive, Image as ImageIcon, Layers, LogOut, Plus, RefreshCw, Search, SearchX, Star, Trash2, Workflow,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '../lib/utils.js';
import { IconButton } from './ui.jsx';

/** Close a dropdown when clicking anywhere outside of it. */
function useOutsideClose(open, close) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) close();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, close]);
  return ref;
}

/** Filter input shown inside the switcher dropdowns. */
function MenuFilter({ value, onChange, onClose, placeholder }) {
  return (
    <div className="px-3 pb-2">
      <div className="flex items-center gap-1.5 rounded-md border border-ink-600 bg-ink-900 px-2 focus-within:border-brand-500">
        <Search size={12} className="shrink-0 text-slate-600" />
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          placeholder={placeholder}
          className="w-full bg-transparent py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-600"
        />
      </div>
    </div>
  );
}

const SectionLabel = ({ children }) => (
  <p className="px-3 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-600">{children}</p>
);

export default function CommandBar({
  databases, activeDb, activeColl, surface,
  onOpenDb, onOpenColl, onCreateDb, onNewColl, onDropDb, onDropColl,
  onBack, canGoBack = false, backTitle = 'Back', onRefresh, onPalette, onDisconnect,
  onFilesVault, onImportDocs, onImportMongo, onSnapshots,
  pinnedColls = [], onTogglePin, recentColls = [],
}) {
  const [dbMenu, setDbMenu] = useState(false);
  const [collMenu, setCollMenu] = useState(false);
  const [dbFilter, setDbFilter] = useState('');
  const [collFilter, setCollFilter] = useState('');
  const dbRef = useOutsideClose(dbMenu, () => setDbMenu(false));
  const collRef = useOutsideClose(collMenu, () => setCollMenu(false));

  const db = databases.find((d) => d.name === activeDb) || null;
  const colls = db?.collections || [];

  const surfaceLabel = surface === 'pipeline' ? 'Pipeline' : surface === 'files' ? 'Files vault' : null;
  const SurfaceIcon = surface === 'pipeline' ? Workflow : Files;
  const activeCollStats = colls.find((c) => c.name === activeColl) || null;

  /* labeled data-tool button (label hides on narrow windows) */
  const toolBtn =
    'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-slate-400 transition-colors hover:bg-ink-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent';

  /* pinned + recent shortcuts for the active database (names verified against it) */
  const prefix = db ? `${db.name}/` : '';
  const pinnedNames = pinnedColls
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .filter((n) => colls.some((c) => c.name === n));
  const recentNames = recentColls
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .filter((n) => colls.some((c) => c.name === n) && !pinnedNames.includes(n))
    .slice(0, 6);

  /* database totals for the stats chip */
  const totals = db
    ? colls.reduce((acc, c) => ({ docs: acc.docs + c.count, size: acc.size + c.size }), { docs: 0, size: 0 })
    : null;

  const dbNeedle = dbFilter.trim().toLowerCase();
  const dbList = dbNeedle ? databases.filter((d) => d.name.toLowerCase().includes(dbNeedle)) : databases;
  const collNeedle = collFilter.trim().toLowerCase();
  const collList = collNeedle ? colls.filter((c) => c.name.toLowerCase().includes(collNeedle)) : colls;

  const starBtn = (name) => {
    const pinned = pinnedNames.includes(name);
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onTogglePin?.(db.name, name); }}
        title={pinned ? 'Unpin collection' : 'Pin collection to the top'}
        aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
        className={`shrink-0 rounded p-1 transition-opacity hover:text-amber-300 ${
          pinned ? 'text-amber-400 opacity-100' : 'text-slate-600 opacity-0 group-hover:opacity-100'
        }`}
      >
        <Star size={12} className={pinned ? 'fill-amber-400' : ''} />
      </button>
    );
  };

  const collRow = (c, keyPrefix) => (
    <div key={`${keyPrefix}${c.name}`} className="group flex items-center hover:bg-ink-800">
      <button
        onClick={() => { onOpenColl(c.name); setCollMenu(false); }}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <FolderOpen
          size={13}
          className={c.name === activeColl ? 'shrink-0 text-brand-400' : 'shrink-0 text-slate-600'}
        />
        <span className={`truncate ${c.name === activeColl ? 'font-medium text-brand-300' : 'text-slate-300'}`}>
          {c.name}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-600">
          {c.count} · {c.size ? `${Math.max(1, Math.round(c.size / 1024))} KB` : '—'}
        </span>
      </button>
      {starBtn(c.name)}
      <button
        onClick={(e) => { e.stopPropagation(); setCollMenu(false); onDropColl(db.name, c.name); }}
        title="Drop collection"
        className="mr-1 rounded p-1 text-slate-600 opacity-0 transition-opacity hover:bg-ink-700 hover:text-rose-400 group-hover:opacity-100"
        aria-label="Drop collection"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );

  return (
    <header className="flex shrink-0 items-center gap-1 border-b border-ink-700 bg-ink-900 px-3 py-2">
      <IconButton onClick={onBack} disabled={!canGoBack} title={backTitle} aria-label="Back">
        <ChevronLeft size={16} />
      </IconButton>

      {/* brand mark */}
      <div className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-ink-950">
        <Database size={15} />
      </div>

      {/* database switcher */}
      <div className="relative" ref={dbRef}>
        <button
          onClick={() => { setDbFilter(''); setDbMenu((o) => !o); }}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-200 hover:bg-ink-800"
          title="Switch database"
        >
          {db?.meta?.color ? (
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: db.meta.color }} />
          ) : (
            <span className="h-2 w-2 rounded-full border border-dashed border-slate-600" />
          )}
          {db?.meta?.favorite && <Star size={11} className="shrink-0 text-amber-400" />}
          <span className="max-w-[10rem] truncate font-medium">{db?.name || 'No database'}</span>
          {db && (
            <span className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-500" title="Collections in this database">
              {colls.length}
            </span>
          )}
          <ChevronDown size={13} className="text-slate-500" />
        </button>

        {dbMenu && (
          <div className="absolute left-0 z-40 mt-1 w-72 rounded-lg border border-ink-600 bg-ink-850 py-1 shadow-2xl">
            <p className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-slate-600">
              Databases · {databases.length}
            </p>
            {databases.length > 6 && (
              <MenuFilter value={dbFilter} onChange={setDbFilter} onClose={() => setDbMenu(false)} placeholder="Filter databases…" />
            )}
            <div className="max-h-72 overflow-y-auto">
              {dbList.map((d) => (
                <div key={d.name} className="group flex items-center hover:bg-ink-800">
                  <button
                    onClick={() => { onOpenDb(d.name); setDbMenu(false); }}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
                  >
                    {d.meta?.color ? (
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: d.meta.color }} />
                    ) : (
                      <span className="h-2 w-2 shrink-0 rounded-full border border-dashed border-slate-600" />
                    )}
                    {d.meta?.favorite && <Star size={11} className="shrink-0 text-amber-400" />}
                    <span className={`truncate ${d.name === activeDb ? 'font-medium text-brand-300' : 'text-slate-300'}`}>
                      {d.name}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-600">{d.collections.length}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDbMenu(false); onDropDb(d.name); }}
                    title="Drop database"
                    className="mr-1 rounded p-1 text-slate-600 opacity-0 transition-opacity hover:bg-ink-700 hover:text-rose-400 group-hover:opacity-100"
                    aria-label="Drop database"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {dbList.length === 0 && (
                <p className="flex items-center justify-center gap-2 px-3 py-3 text-xs text-slate-600">
                  <SearchX size={13} /> No databases match.
                </p>
              )}
            </div>
            <button
              onClick={() => { setDbMenu(false); onCreateDb(); }}
              className="mt-1 flex w-full items-center gap-2 border-t border-ink-700 px-3 py-2 text-sm text-slate-300 hover:bg-ink-800 hover:text-brand-300"
            >
              <Plus size={13} /> New database
            </button>
          </div>
        )}
      </div>

      {/* collection breadcrumb switcher */}
      {db && (
        <>
          <ChevronRight size={13} className="shrink-0 text-slate-600" />
          <div className="relative" ref={collRef}>
            <button
              onClick={() => { setCollFilter(''); setCollMenu((o) => !o); }}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-200 hover:bg-ink-800"
              title="Switch collection"
            >
              <span className="max-w-[12rem] truncate font-medium">
                {activeColl || (colls.length ? 'Collections' : 'No collection')}
              </span>
              {activeCollStats && (
                <span className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-500" title="Documents in this collection">
                  {activeCollStats.count}
                </span>
              )}
              <ChevronDown size={13} className="text-slate-500" />
            </button>

            {collMenu && (
              <div className="absolute left-0 z-40 mt-1 w-72 rounded-lg border border-ink-600 bg-ink-850 py-1 shadow-2xl">
                <p className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-slate-600">
                  Collections · {colls.length}
                </p>
                {colls.length > 6 && (
                  <MenuFilter value={collFilter} onChange={setCollFilter} onClose={() => setCollMenu(false)} placeholder="Filter collections…" />
                )}
                <div className="max-h-72 overflow-y-auto">
                  {!collNeedle && pinnedNames.length > 0 && <SectionLabel>Pinned</SectionLabel>}
                  {!collNeedle && pinnedNames.map((name) => collRow(colls.find((c) => c.name === name), 'pin:'))}

                  {!collNeedle && recentNames.length > 0 && <SectionLabel>Recent</SectionLabel>}
                  {!collNeedle && recentNames.map((name) => collRow(colls.find((c) => c.name === name), 'recent:'))}

                  {!collNeedle && (pinnedNames.length > 0 || recentNames.length > 0) && (
                    <SectionLabel>All collections</SectionLabel>
                  )}
                  {collList.map((c) => collRow(c, 'all:'))}
                  {collList.length === 0 && (
                    <p className="flex items-center justify-center gap-2 px-3 py-3 text-xs text-slate-600">
                      <SearchX size={13} /> No collections match.
                    </p>
                  )}
                </div>
                <button
                  onClick={() => { setCollMenu(false); onNewColl(); }}
                  className="mt-1 flex w-full items-center gap-2 border-t border-ink-700 px-3 py-2 text-sm text-slate-300 hover:bg-ink-800 hover:text-brand-300"
                >
                  <Plus size={13} /> New collection
                </button>
              </div>
            )}
          </div>

          {surfaceLabel && (
            <>
              <ChevronRight size={13} className="shrink-0 text-slate-600" />
              <span className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-400">
                <SurfaceIcon size={13} className="text-brand-300" /> {surfaceLabel}
              </span>
            </>
          )}

          {/* database stats chip */}
          {totals && (
            <span
              className="ml-1 hidden shrink-0 items-center gap-1.5 rounded-md bg-ink-850 px-2 py-1 font-mono text-[10px] text-slate-500 xl:inline-flex"
              title={`${colls.length} collection(s) · documents and size across this database`}
            >
              <HardDrive size={10} className="text-slate-600" />
              {totals.docs} docs · {formatBytes(totals.size)}
            </span>
          )}
        </>
      )}

      {/* data tools — the dashboard's action cards, always one click away */}
      <div className="ml-2 flex shrink-0 items-center gap-0.5 border-l border-ink-700 pl-2">
        <button
          onClick={onFilesVault}
          disabled={!activeDb}
          title="Files vault — binary storage (images, PDFs, audio, …)"
          aria-label="Files vault"
          className={toolBtn}
        >
          <ImageIcon size={14} /> <span className="hidden lg:inline">Files</span>
        </button>
        <button
          onClick={onImportDocs}
          disabled={!activeDb}
          title="Import documents — JSON array, NDJSON or CSV file → a collection"
          aria-label="Import documents"
          className={toolBtn}
        >
          <FileUp size={14} /> <span className="hidden lg:inline">Import</span>
        </button>
        <button
          onClick={onImportMongo}
          title="Import from MongoDB — mirror a live mongodb:// server"
          aria-label="Import from MongoDB"
          className={toolBtn}
        >
          <Layers size={14} /> <span className="hidden lg:inline">MongoDB</span>
        </button>
        <button
          onClick={onSnapshots}
          disabled={!activeDb}
          title="Snapshots — full copies of this database folder, with atomic restore"
          aria-label="Snapshots"
          className={toolBtn}
        >
          <Archive size={14} /> <span className="hidden lg:inline">Snapshots</span>
        </button>
      </div>

      {/* global actions */}
      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={onPalette}
          title="Command palette (Ctrl+K)"
          className="flex items-center gap-2 rounded-md border border-ink-600 bg-ink-850 px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:border-ink-600 hover:text-slate-300"
        >
          <Command size={12} />
          <span className="hidden sm:inline">Commands</span>
          <span className="font-mono text-[10px] text-slate-600">Ctrl+K</span>
        </button>
        <IconButton onClick={onRefresh} title="Refresh" aria-label="Refresh">
          <RefreshCw size={15} />
        </IconButton>
        <IconButton onClick={onDisconnect} title="Start page — switch connection / data directory" aria-label="Connections">
          <LogOut size={15} />
        </IconButton>
      </div>
    </header>
  );
}
