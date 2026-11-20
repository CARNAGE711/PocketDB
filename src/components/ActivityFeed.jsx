/**
 * ActivityFeed — live tail of engine operations.
 *
 * The main process pushes 'engine:activity' for inserts, updates, deletes,
 * imports, snapshots, restores and index changes. This dialog keeps a local
 * ring of the newest events (plus the recent history fetched on open), with
 * an op filter, pause and clear controls.
 */
import {
  Activity, Archive, ArrowDownToLine, ArrowUpFromLine, Filter, History, KeyRound,
  Pause, Play, RotateCcw, Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Modal } from './ui.jsx';

const OP_STYLE = {
  insert: { label: 'insert', cls: 'bg-emerald-500/15 text-emerald-300', Icon: ArrowDownToLine },
  update: { label: 'update', cls: 'bg-brand-500/15 text-brand-300', Icon: RotateCcw },
  delete: { label: 'delete', cls: 'bg-rose-500/15 text-rose-300', Icon: Trash2 },
  import: { label: 'import', cls: 'bg-sky-500/15 text-sky-300', Icon: ArrowDownToLine },
  restore: { label: 'restore', cls: 'bg-amber-500/15 text-amber-300', Icon: History },
  snapshot: { label: 'snapshot', cls: 'bg-violet-500/15 text-violet-300', Icon: Archive },
  index: { label: 'index', cls: 'bg-teal-500/15 text-teal-300', Icon: KeyRound },
  view: { label: 'view', cls: 'bg-indigo-500/15 text-indigo-300', Icon: ArrowUpFromLine },
};

const FILTERS = ['all', 'insert', 'update', 'delete', 'import', 'restore', 'snapshot', 'index', 'view'];

function timeAgo(at) {
  const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export default function ActivityFeed({ onClose }) {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState('all');
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api.listActivity(150).then(setEvents).catch(() => setEvents([]));
    const off = api.onActivity((item) => {
      if (paused) return;
      setEvents((prev) => [item, ...prev].slice(0, 250));
    });
    return off;
  }, [paused]);

  // Re-render relative timestamps once a second.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const visible = useMemo(
    () => (filter === 'all' ? events : events.filter((e) => e.op === filter)),
    [events, filter]
  );

  return (
    <Modal
      title="Activity"
      subtitle="Live engine events — inserts, updates, deletes, imports, snapshots"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => setEvents([])}>
            <Trash2 size={13} /> Clear
          </Button>
          <Button variant="ghost" onClick={() => setPaused((p) => !p)}>
            {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Filter size={12} className="text-slate-600" />
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-2 py-0.5 font-mono text-[10px] transition-colors ${
              filter === f ? 'bg-brand-600 text-ink-950' : 'bg-ink-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-slate-600">
          <Activity size={10} className={paused ? 'text-slate-600' : 'animate-pulse text-emerald-400'} />
          {paused ? 'paused' : 'live'} · {visible.length}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-600 px-3 py-8 text-center text-xs text-slate-600">
          <Activity size={24} className="mx-auto mb-2 text-slate-700" />
          No activity yet — write a document, run an import or take a snapshot.
        </p>
      ) : (
        <div className="max-h-96 space-y-1 overflow-y-auto pr-1">
          {visible.map((e) => {
            const style = OP_STYLE[e.op] || OP_STYLE.update;
            const Icon = style.Icon;
            return (
              <div
                key={e.id}
                className="flex items-center gap-2.5 rounded-md border border-ink-800 bg-ink-850 px-3 py-1.5"
              >
                <span className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${style.cls}`}>
                  <Icon size={9} /> {style.label}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300">
                  {e.db}
                  {e.coll ? <span className="text-slate-500"> › </span> : null}
                  {e.coll ? <span className="text-slate-200">{e.coll}</span> : null}
                  {e.detail ? <span className="text-slate-500"> · {e.detail}</span> : null}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-slate-600" title={new Date(e.at).toLocaleString()}>
                  {timeAgo(e.at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
