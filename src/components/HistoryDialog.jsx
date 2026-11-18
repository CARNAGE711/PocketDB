/**
 * HistoryDialog — the automatic revision log for one document.
 * Every update/delete recorded a pre-image; restore puts it back
 * (keeping its _id) with one click.
 */
import { History, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Modal } from './ui.jsx';

export default function HistoryDialog({ db, coll, docId, onClose, onRestored }) {
  const [revisions, setRevisions] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = () => api.listHistory(db, coll, docId).then(setRevisions).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, coll, docId]);

  const restore = async (revId) => {
    setError(null);
    try {
      await api.restoreRevision(db, coll, revId);
      setNotice('Revision restored into the collection.');
      await load();
      onRestored?.();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Modal
      title="Document history"
      subtitle={`${db} › ${coll} › ${docId}`}
      onClose={onClose}
      width="max-w-xl"
    >
      {error && <div className="mb-3"><Banner onClose={() => setError(null)}>{error}</Banner></div>}
      {notice && <div className="mb-3"><Banner kind="ok" onClose={() => setNotice(null)}>{notice}</Banner></div>}

      <div className="space-y-2">
        {revisions.map((rev) => (
          <div key={rev.revId} className="rounded-lg border border-ink-700 bg-ink-900">
            <div className="flex items-center gap-3 px-3 py-2">
              <History size={13} className="shrink-0 text-slate-500" />
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                  rev.op === 'delete' ? 'bg-rose-950/60 text-rose-300' : 'bg-ink-700 text-slate-300'
                }`}
              >
                {rev.op}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-600">
                {new Date(rev.at).toLocaleString()}
              </span>
              <button
                onClick={() => restore(rev.revId)}
                title="Restore this revision"
                className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-ink-700 hover:text-brand-300"
              >
                <RotateCcw size={11} /> Restore
              </button>
            </div>
            <pre className="max-h-32 overflow-auto border-t border-ink-800 px-3 py-2 font-mono text-[10px] leading-relaxed text-slate-500">
              {JSON.stringify(rev.doc, null, 2)}
            </pre>
          </div>
        ))}
        {revisions.length === 0 && (
          <p className="rounded-lg border border-dashed border-ink-600 px-3 py-6 text-center text-xs text-slate-600">
            <History size={22} className="mx-auto mb-2 text-slate-700" />
            No revisions yet — edits and deletes of this document are recorded automatically (last 200 kept per collection).
          </p>
        )}
      </div>
    </Modal>
  );
}
