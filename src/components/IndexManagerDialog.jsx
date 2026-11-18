/**
 * IndexManagerDialog — list / create / drop the sidecar indexes that let
 * the engine prune scans on equality & $in predicates.
 */
import { Key, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Modal } from './ui.jsx';

export default function IndexManagerDialog({ db, coll, onClose }) {
  const [indexes, setIndexes] = useState([]);
  const [field, setField] = useState('');
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
      const res = await api.createIndex(db, coll, field.trim());
      setNotice(`Index on "${res.field}" built over ${res.documents} document(s).`);
      setField('');
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
            <Key size={14} className="shrink-0 text-brand-300" />
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-200">{idx.field}</code>
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

      <div className="mt-4 flex items-center gap-2 border-t border-ink-700 pt-4">
        <input
          autoFocus
          value={field}
          onChange={(e) => setField(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && field.trim() && create()}
          placeholder="field e.g. profile.age"
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
      <p className="mt-2 text-[11px] text-slate-600">
        Dot-notation fields index arrays per element (multikey). Indexes rebuild automatically after every write.
      </p>
    </Modal>
  );
}
