/**
 * DatabaseHome — the dashboard hub for a database.
 *
 * Instead of a sidebar tree, each database is a dashboard: stat tiles
 * (collections / documents / on-disk / files) and a card grid of
 * collections with quick actions. The data tools (files vault, imports,
 * snapshots) live once — in the navbar — so they're reachable from any
 * surface without duplicating them here.
 */
import {
  FileText, Folder, FolderOpen, HardDrive, Image as ImageIcon, Layers, Plus, Star, Trash2,
} from 'lucide-react';
import { formatBytes } from '../lib/utils.js';
import { Button, IconButton } from './ui.jsx';

function StatTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-4 transition-colors hover:border-ink-600">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-600">
        <Icon size={12} /> {label}
      </div>
      <div className="mt-2 truncate font-mono text-xl text-slate-100">{value}</div>
    </div>
  );
}

export default function DatabaseHome({
  db, filesCount, dataDir,
  onOpenColl, onInsertDoc, onDropColl, onNewColl, onDropDb,
}) {
  const totalDocs = db.collections.reduce((sum, c) => sum + c.count, 0);
  const totalSize = db.collections.reduce((sum, c) => sum + c.size, 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 py-8">
        {/* hero */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              {db.meta?.color ? (
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: db.meta.color }} />
              ) : (
                <span className="h-3 w-3 shrink-0 rounded-full border border-dashed border-slate-600" />
              )}
              <h1 className="truncate text-2xl font-semibold text-slate-100">{db.name}</h1>
              {db.meta?.favorite && <Star size={15} className="shrink-0 text-amber-400" />}
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 truncate font-mono text-[11px] text-slate-600" title={`${dataDir}\\${db.name}`}>
              <HardDrive size={11} className="shrink-0 text-slate-700" />
              <span className="truncate">{dataDir}\{db.name}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="primary" onClick={onNewColl}>
              <Plus size={14} /> New collection
            </Button>
            <IconButton
              onClick={onDropDb}
              title="Drop database"
              aria-label="Drop database"
              className="hover:text-rose-400"
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
        </div>

        {/* stat tiles */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile icon={Layers} label="collections" value={db.collections.length} />
          <StatTile icon={FileText} label="documents" value={totalDocs} />
          <StatTile icon={HardDrive} label="on disk" value={formatBytes(totalSize)} />
          <StatTile icon={ImageIcon} label="files stored" value={filesCount} />
        </div>

        {/* collection cards */}
        <h2 className="mt-9 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-slate-500">
          <FolderOpen size={12} /> Collections · {db.collections.length}
        </h2>
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          {db.collections.map((c) => (
            <div
              key={c.name}
              className="group rounded-lg border border-ink-700 bg-ink-900 p-4 transition-colors hover:border-ink-600"
            >
              <button onClick={() => onOpenColl(c.name)} className="flex w-full items-center gap-3 text-left">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink-800 text-slate-500 transition-colors group-hover:text-brand-300">
                  <Folder size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-200">{c.name}</span>
                  <span className="block font-mono text-[10px] text-slate-600">
                    {c.count} docs · {formatBytes(c.size)}
                  </span>
                </span>
              </button>
              <div className="mt-2 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => onInsertDoc(c.name)}
                  title="Insert document"
                  className="rounded p-1.5 text-slate-500 hover:bg-ink-700 hover:text-slate-200"
                  aria-label="Insert document"
                >
                  <Plus size={13} />
                </button>
                <button
                  onClick={() => onDropColl(c.name)}
                  title="Drop collection"
                  className="rounded p-1.5 text-slate-500 hover:bg-ink-700 hover:text-rose-400"
                  aria-label="Drop collection"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}

          {/* ghost create card */}
          <button
            onClick={onNewColl}
            className="flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-ink-600 p-4 text-slate-600 transition-colors hover:border-brand-500 hover:text-brand-300"
          >
            <Plus size={18} />
            <span className="text-xs font-medium">New collection</span>
          </button>
        </div>
      </div>
    </div>
  );
}
