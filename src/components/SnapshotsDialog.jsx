/**
 * SnapshotsDialog — full snapshot manager for a database.
 *
 * The dashboard card shows the newest five with a quick "New snapshot";
 * this dialog lists every snapshot and can create, restore or delete
 * each one. Restoring swaps the live database folder for the snapshot
 * copy (atomic on the engine side, rolling back if the copy fails).
 */
import { Archive, CalendarClock, CopyPlus, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Button, Modal } from './ui.jsx';

export default function SnapshotsDialog({ db, onClose, onRestored }) {
  const [snaps, setSnaps] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /* two-step confirm: 'restore:<id>' | 'del:<id>' | null */
  const [confirmId, setConfirmId] = useState(null);

  /* scheduled snapshots (global — applies to every database) */
  const [schedule, setSchedule] = useState(null);
  const [schedBusy, setSchedBusy] = useState(false);
  const [schedNotice, setSchedNotice] = useState(null);

  const load = useCallback(() => {
    api.listSnapshots(db).then(setSnaps).catch(() => setSnaps([]));
  }, [db]);

  useEffect(() => {
    load();
    api.getSnapshotSchedule().then(setSchedule).catch(() => {});
  }, [load]);

  const saveSchedule = async (patch) => {
    const next = { ...(schedule || {}), ...patch };
    setSchedule(next);
    setSchedBusy(true);
    setSchedNotice(null);
    try {
      const saved = await api.setSnapshotSchedule({
        enabled: next.enabled,
        intervalMinutes: next.intervalMinutes,
        keep: next.keep,
      });
      setSchedule({ ...next, ...saved });
      setSchedNotice(saved.enabled ? 'Schedule saved — automatic snapshots are on.' : 'Schedule saved — automatic snapshots are off.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSchedBusy(false);
    }
  };

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

      {/* scheduled snapshots */}
      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-900 p-3">
        <div className="flex items-center gap-2">
          <CalendarClock size={14} className={schedule?.enabled ? 'text-emerald-300' : 'text-slate-500'} />
          <span className="text-xs font-medium text-slate-300">Scheduled snapshots</span>
          <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-slate-500">
            all databases
          </span>
          <label className="ml-auto flex cursor-pointer items-center gap-2 font-mono text-[10px] text-slate-400">
            <input
              type="checkbox"
              checked={Boolean(schedule?.enabled)}
              disabled={!schedule || schedBusy}
              onChange={(e) => saveSchedule({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 accent-brand-500"
            />
            {schedule?.enabled ? 'on' : 'off'}
          </label>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-500">
          <span>every</span>
          <input
            type="number"
            min="1"
            value={schedule?.intervalMinutes ?? 60}
            disabled={!schedule || schedBusy}
            onChange={(e) =>
              setSchedule((s) => ({ ...s, intervalMinutes: Number(e.target.value) || 1 }))
            }
            className="w-16 rounded border border-ink-600 bg-ink-850 px-2 py-1 text-slate-200 outline-none focus:border-brand-500 disabled:opacity-50"
            aria-label="Interval in minutes"
          />
          <span>min · keep newest</span>
          <input
            type="number"
            min="1"
            value={schedule?.keep ?? 5}
            disabled={!schedule || schedBusy}
            onChange={(e) => setSchedule((s) => ({ ...s, keep: Number(e.target.value) || 1 }))}
            className="w-14 rounded border border-ink-600 bg-ink-850 px-2 py-1 text-slate-200 outline-none focus:border-brand-500 disabled:opacity-50"
            aria-label="Snapshots to keep"
          />
          <span>per database</span>
          <Button
            variant="subtle"
            className="ml-auto !px-2 !py-1 !text-[10px]"
            disabled={!schedule || schedBusy}
            onClick={() => saveSchedule({})}
          >
            {schedBusy ? <Loader2 size={10} className="animate-spin" /> : null} Save schedule
          </Button>
        </div>

        {schedNotice && <p className="mt-2 font-mono text-[10px] text-emerald-400">{schedNotice}</p>}
        {schedule?.enabled && schedule?.nextRun && (
          <p className="mt-2 font-mono text-[10px] text-slate-600">
            next run ≈ {new Date(schedule.nextRun).toLocaleString()} · snapshots are pruned to the newest{' '}
            {schedule.keep} per database.
          </p>
        )}
        {!schedule?.enabled && (
          <p className="mt-2 text-[10px] text-slate-600">
            When on, PocketDB snapshots every database in this data directory on the interval and prunes older ones.
          </p>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
        Snapshots live in <span className="font-mono text-slate-500">pocketdb-snapshots/{db}/&lt;timestamp&gt;/</span>{' '}
        — never inside the data directory, so they can't be mistaken for databases.
      </p>
    </Modal>
  );
}
