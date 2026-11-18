/**
 * SnapshotsDialog — full snapshot manager for a database.
 *
 * The dashboard card shows the newest five with a quick "New snapshot";
 * this dialog lists every snapshot and can create, restore or delete
 * each one. Restoring swaps the live database folder for the snapshot
 * copy (atomic on the engine side, rolling back if the copy fails).
 */
import { Archive, CopyPlus, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Button, Modal } from './ui.jsx';

export default function SnapshotsDialog({ db, onClose, onRestored }) {
  const [snaps, setSnaps] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /* two-step confirm: 'restore:<id>' | 'del:<id>' | null */
  const [confirmId, setConfirmId] = useState(null);

  const load = useCallback(() => {
    api.listSnapshots(db).then(setSnaps).catch(() => setSnaps([]));
  }, [db]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createSnapshot(db);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (id) => {
    if (confirmId !== `restore:${id}`) {
      setConfirmId(`restore:${id}`);
      return;
    }
    setConfirmId(null);
    setBusy(true);
    setError(null);
    try {
      await api.restoreSnapshot(db, id);
      load();
      onRestored?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (confirmId !== `del:${id}`) {
      setConfirmId(`del:${id}`);
      return;
    }
    setConfirmId(null);
    setBusy(true);
    setError(null);
    try {
      await api.deleteSnapshot(db, id);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Snapshots"
      subtitle={`Full copies of "${db}", stored outside the data directory`}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={create} disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <CopyPlus size={13} />} New snapshot
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Banner onClose={() => setError(null)}>{error}</Banner>
        </div>
      )}

      {snaps.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-600">
          <Archive size={26} className="mx-auto mb-2 text-slate-700" />
          No snapshots yet — create one to get a restorable copy of the whole
          database folder (documents, indexes, schema rules and history).
        </p>
      ) : (
        <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {snaps.map((snap) => (
            <div
              key={snap.id}
              className="group flex items-center gap-3 rounded-md border border-ink-800 bg-ink-850 px-3 py-2"
            >
              <Archive size={14} className="shrink-0 text-brand-300" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300">{snap.id}</span>
              <span className="shrink-0 font-mono text-[10px] text-slate-600">{snap.collections} coll(s)</span>
              <button
                onClick={() => restore(snap.id)}
                disabled={busy}
                title={
                  confirmId === `restore:${snap.id}`
                    ? 'Click again to confirm — the live database folder is replaced'
                    : 'Restore this snapshot (replaces the live database folder)'
                }
                className={`flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  confirmId === `restore:${snap.id}`
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'text-slate-400 hover:bg-ink-700 hover:text-brand-300'
                }`}
              >
                <RotateCcw size={10} /> {confirmId === `restore:${snap.id}` ? 'Sure?' : 'Restore'}
              </button>
              <button
                onClick={() => remove(snap.id)}
                disabled={busy}
                title={confirmId === `del:${snap.id}` ? 'Click again to confirm' : 'Delete snapshot'}
                aria-label="Delete snapshot"
                className={`shrink-0 rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  confirmId === `del:${snap.id}`
                    ? 'bg-rose-500/20 text-rose-300'
                    : 'text-slate-600 hover:text-rose-400'
                }`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
        Snapshots live in <span className="font-mono text-slate-500">pocketdb-snapshots/{db}/&lt;timestamp&gt;/</span>{' '}
        — never inside the data directory, so they can't be mistaken for databases.
      </p>
    </Modal>
  );
}
