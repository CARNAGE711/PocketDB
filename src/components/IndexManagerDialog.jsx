/**
 * IndexManagerDialog — list / create / drop the sidecar indexes that let
 * the engine prune scans on equality & $in predicates.
 */
import { Key, Layers, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Modal } from './ui.jsx';

export default function IndexManagerDialog({ db, coll, onClose }) {
  const [indexes, setIndexes] = useState([]);
  const [field, setField] = useState('');
  const [unique, setUnique] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.listIndexes(db, coll).then(setIndexes).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, coll]);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api.createIndex(db, coll, field.trim(), unique);
      setNotice(
        `${res.unique ? 'Unique ' : ''}index on "${res.field}" built over ${res.documents} document(s).`
      );
      setField('');
      setUnique(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const drop = async (f) => {
    setError(null);
    try {
      await api.dropIndex(db, coll, f);
      setNotice(`Index on "${f}" dropped.`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Modal
      title="Indexes"
      subtitle={`${db} › ${coll} — equality & $in predicates use these maps to skip full scans`}
      onClose={onClose}
      width="max-w-lg"
    >
      {error && <div className="mb-3"><Banner onClose={() => setError(null)}>{error}</Banner></div>}
      {notice && <div className="mb-3"><Banner kind="ok" onClose={() => setNotice(null)}>{notice}</Banner></div>}

      <div className="space-y-2">
        {indexes.map((idx) => (
          <div key={idx.field} className="group flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
            {idx.fields.length > 1 ? (
              <Layers size={14} className="shrink-0 text-violet-300" />
            ) : (
              <Key size={14} className="shrink-0 text-brand-300" />
            )}
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {idx.fields.map((f, i) => (
                <span key={f} className="flex items-center gap-1">
                  {i > 0 && <span className="font-mono text-[10px] text-slate-600">+</span>}
                  <code className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-200">{f}</code>
                </span>
              ))}
              {idx.unique && (
                <span
                  className="flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-emerald-300"
                  title="Duplicate values are rejected on insert/update"
                >
                  <ShieldCheck size={9} /> unique
                </span>
              )}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-slate-600">
              {idx.entryCount} keys · {new Date(idx.createdAt).toLocaleString()}
            </span>
            <button
              onClick={() => drop(idx.field)}
              title="Drop index"
              className="shrink-0 rounded p-1 text-slate-600 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100"
              aria-label="Drop index"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {indexes.length === 0 && (
          <p className="rounded-lg border border-dashed border-ink-600 px-3 py-4 text-center text-xs text-slate-600">
            <Key size={20} className="mx-auto mb-2 text-slate-700" />
            No indexes — find queries scan the collection file.
          </p>
        )}
      </div>

      <div className="mt-4 border-t border-ink-700 pt-4">
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={field}
            onChange={(e) => setField(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && field.trim() && create()}
            placeholder="field e.g. profile.age — or a+b for compound"
            className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-900 px-3 py-2 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand-500"
          />
          <button
            onClick={create}
            disabled={!field.trim() || busy}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-xs font-medium text-ink-950 hover:bg-brand-500 disabled:opacity-40"
          >
            <Plus size={13} /> {busy ? 'Building…' : 'Create index'}
          </button>
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={unique}
            onChange={(e) => setUnique(e.target.checked)}
            className="h-3.5 w-3.5 accent-brand-500"
          />
          <ShieldCheck size={12} className={unique ? 'text-emerald-300' : 'text-slate-600'} />
          Unique — reject documents whose indexed value already exists (missing values are skipped)
        </label>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
        Compound indexes use <span className="font-mono text-slate-500">a+b</span> (equality on every field). Dot-notation
        fields index arrays per element (multikey). Indexes rebuild automatically after every write.
      </p>
    </Modal>
  );
}
