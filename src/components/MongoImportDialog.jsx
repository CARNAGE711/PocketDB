/**
 * MongoImportDialog — mirror a real MongoDB server into the PocketDB
 * data directory via the bundled mongodb driver (ObjectId → hex, Date → ISO).
 */
import { ArrowRightLeft, CloudOff, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Modal } from './ui.jsx';

export default function MongoImportDialog({ dataDir, onClose, onImported }) {
  const [uri, setUri] = useState('mongodb://127.0.0.1:27017');
  const [limit, setLimit] = useState('200');
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setError(null);
    setSummary(null);
    setBusy(true);
    try {
      const res = await api.importFromMongo({ uri: uri.trim(), limitPerColl: Number(limit) || 0 });
      setSummary(res);
      if (res.some((r) => r.imported > 0)) onImported?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import from MongoDB"
      subtitle={`Mirrors collections into ${dataDir}`}
      onClose={onClose}
      width="max-w-xl"
    >
      {error && <div className="mb-3"><Banner onClose={() => setError(null)}>{error}</Banner></div>}

      <div className="space-y-3">
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate-500">
            connection string
          </label>
          <input
            autoFocus
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            placeholder="mongodb://127.0.0.1:27017"
            className="w-full rounded border border-ink-600 bg-ink-900 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate-500">
            docs per collection (0 = all)
          </label>
          <input
            type="number"
            min="0"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-32 rounded border border-ink-600 bg-ink-900 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {summary && (
        <div className="mt-4 max-h-52 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900">
          {summary.map((row, i) => (
            <div key={i} className="flex items-center gap-2 border-b border-ink-800 px-3 py-1.5 font-mono text-[11px] last:border-0">
              <span className="min-w-0 flex-1 truncate text-slate-400">{row.from}</span>
              <ArrowRightLeft size={11} className="shrink-0 text-slate-600" />
              <span className="min-w-0 flex-1 truncate text-slate-200">{row.to}</span>
              <span className="shrink-0 text-brand-300">+{row.imported}</span>
              {row.failed > 0 && <span className="shrink-0 text-rose-400">!{row.failed}</span>}
            </div>
          ))}
          {summary.length === 0 && (
            <p className="px-3 py-3 text-xs text-slate-600">
              <CloudOff size={18} className="mx-auto mb-2 text-slate-700" />
              No collections found on the server.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2 border-t border-ink-700 pt-3">
        <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700">
          Close
        </button>
        <button
          onClick={run}
          disabled={!uri.trim() || busy}
          className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-brand-500 disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
          {busy ? 'Mirroring…' : 'Mirror into PocketDB'}
        </button>
      </div>
    </Modal>
  );
}
