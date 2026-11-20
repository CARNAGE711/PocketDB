/**
 * TrashDialog — soft-deleted documents with one-click restore.
 *
 * Every delete keeps the removed document (bounded to the newest 500 per
 * database). Restoring reinserts it into its original collection unless the
 * _id already exists; purging is permanent.
 */
import { Loader2, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Button, Modal } from './ui.jsx';

function preview(doc) {
  try {
    const entries = Object.entries(doc).filter(([k]) => k !== '_id').slice(0, 3);
    return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('  ');
  } catch {
    return '';
  }
}

export default function TrashDialog({ db, onClose, onRestored }) {
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [collFilter, setCollFilter] = useState('');

  const load = useCallback(() => {
    api.listTrash(db).then(setEntries).catch((e) => setError(e.message));
  }, [db]);

  useEffect(() => {
    load();
  }, [load]);

  const colls = useMemo(
    () => [...new Set(entries.map((e) => e.coll))].sort(),
    [entries]
  );
  const visible = useMemo(
    () => (collFilter ? entries.filter((e) => e.coll === collFilter) : entries),
    [entries, collFilter]
  );

  const restore = async (entry) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.restoreTrash(db, entry.trashId);
      setNotice(`Restored ${res.restoredId} into "${res.coll}".`);
      load();
      onRestored?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const purge = async (entry) => {
    setBusy(true);
    setError(null);
    try {
      await api.purgeTrash(db, entry.trashId);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const emptyAll = async () => {
    if (!confirmEmpty) {
      setConfirmEmpty(true);
      return;
    }
    setConfirmEmpty(false);
    setBusy(true);
    setError(null);
    try {
      await api.emptyTrash(db);
      load();
      setNotice('Trash emptied.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Trash"
      subtitle={`Deleted documents from "${db}" — restorable until purged`}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button
            variant={confirmEmpty ? 'danger' : 'ghost'}
            onClick={emptyAll}
            disabled={busy || entries.length === 0}
          >
            <Trash2 size={13} /> {confirmEmpty ? 'Really empty trash?' : 'Empty trash'}
          </Button>
        </>
      }
    >
      {error && <div className="mb-3"><Banner onClose={() => setError(null)}>{error}</Banner></div>}
      {notice && <div className="mb-3"><Banner kind="ok" onClose={() => setNotice(null)}>{notice}</Banner></div>}

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-600 px-3 py-8 text-center text-xs text-slate-600">
          <Trash2 size={24} className="mx-auto mb-2 text-slate-700" />
          Trash is empty — deleted documents appear here automatically.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setCollFilter('')}
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                !collFilter ? 'bg-brand-600 text-ink-950' : 'bg-ink-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              all · {entries.length}
            </button>
            {colls.map((c) => (
              <button
                key={c}
                onClick={() => setCollFilter(c)}
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                  collFilter === c ? 'bg-brand-600 text-ink-950' : 'bg-ink-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {visible.map((entry) => (
              <div
                key={entry.trashId}
                className="group flex items-center gap-3 rounded-md border border-ink-800 bg-ink-850 px-3 py-2"
              >
                <Undo2 size={14} className="shrink-0 text-slate-600" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="truncate font-mono text-[11px] text-slate-300">{entry.doc._id}</code>
                    <span className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">
                      {entry.coll}
                    </span>
                  </div>
                  <p className="truncate font-mono text-[10px] text-slate-600" title={preview(entry.doc)}>
                    {preview(entry.doc) || '(empty document)'}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-slate-600">
                  {new Date(entry.at).toLocaleString()}
                </span>
                <button
                  onClick={() => restore(entry)}
                  disabled={busy}
                  title="Restore this document"
                  className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[10px] text-slate-400 hover:bg-ink-700 hover:text-emerald-300 disabled:opacity-40"
                >
                  {busy ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />} Restore
                </button>
                <button
                  onClick={() => purge(entry)}
                  disabled={busy}
                  title="Delete permanently"
                  aria-label="Purge permanently"
                  className="shrink-0 rounded p-1 text-slate-600 hover:text-rose-400 disabled:opacity-40"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="mt-3 text-[11px] text-slate-600">
        The newest 500 deletions are kept per database. Restoring fails if a document with the same _id exists.
      </p>
    </Modal>
  );
}
