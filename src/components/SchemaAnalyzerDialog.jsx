/**
 * SchemaAnalyzerDialog — visual field map for a collection.
 *
 * Walks every document and reports, per dotted path: how many documents
 * carry it (fill rate), the JSON types found, distinct-value count and a
 * few samples. Useful for discovering the real shape of imported data.
 */
import { Binary, Hash, Layers, Loader2, ScanSearch, ToggleLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Button, Modal } from './ui.jsx';

const TYPE_STYLE = {
  string: 'bg-sky-500/15 text-sky-300',
  number: 'bg-emerald-500/15 text-emerald-300',
  boolean: 'bg-amber-500/15 text-amber-300',
  object: 'bg-violet-500/15 text-violet-300',
  array: 'bg-indigo-500/15 text-indigo-300',
  null: 'bg-slate-500/15 text-slate-400',
};

export default function SchemaAnalyzerDialog({ db, coll, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api
      .analyzeSchema(db, coll)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [db, coll]);

  const fields = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return q ? data.fields.filter((f) => f.path.toLowerCase().includes(q)) : data.fields;
  }, [data, query]);

  return (
    <Modal
      title="Schema analyzer"
      subtitle={`${db} › ${coll} — field distribution across documents`}
      onClose={onClose}
      width="max-w-3xl"
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      {error && <div className="mb-3"><Banner onClose={() => setError(null)}>{error}</Banner></div>}

      {!data ? (
        <p className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Scanning documents…
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-md bg-ink-800 px-2 py-1 font-mono text-[10px] text-slate-400">
              <Layers size={10} /> {data.documents} documents
            </span>
            <span className="flex items-center gap-1.5 rounded-md bg-ink-800 px-2 py-1 font-mono text-[10px] text-slate-400">
              <ScanSearch size={10} /> {data.fields.length} paths
            </span>
            {data.view && (
              <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 font-mono text-[10px] text-indigo-300">
                read-only view
              </span>
            )}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="filter fields…"
              className="ml-auto w-48 rounded border border-ink-600 bg-ink-900 px-2 py-1 font-mono text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-brand-500"
            />
          </div>

          {fields.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink-600 px-3 py-8 text-center text-xs text-slate-600">
              <ScanSearch size={24} className="mx-auto mb-2 text-slate-700" />
              No fields — the collection has no documents yet.
            </p>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-ink-700">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-ink-900">
                  <tr className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
                    <th className="px-3 py-2">field</th>
                    <th className="px-3 py-2">types</th>
                    <th className="w-40 px-3 py-2">fill rate</th>
                    <th className="px-3 py-2">distinct</th>
                    <th className="px-3 py-2">samples</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.path} className="border-t border-ink-800 align-top hover:bg-ink-900/60">
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-200">
                        {f.path}
                        {f.types.object && !f.types.string && !f.types.number && (
                          <span className="ml-1.5 text-[9px] text-slate-600">object</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                          {Object.entries(f.types)
                            .sort((a, b) => b[1] - a[1])
                            .map(([t, n]) => (
                              <span
                                key={t}
                                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${TYPE_STYLE[t] || 'bg-ink-800 text-slate-400'}`}
                                title={`${n} document(s)`}
                              >
                                {t} ×{n}
                              </span>
                            ))}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-800">
                            <div
                              className="h-full rounded-full bg-brand-500"
                              style={{ width: `${Math.min(100, f.fillRate)}%` }}
                            />
                          </div>
                          <span className="font-mono text-[10px] text-slate-500">{f.fillRate}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-slate-400">
                        {f.distinct}
                        {f.distinctCapped ? '+' : ''}
                        {f.types.number && f.min !== null && (
                          <span className="ml-1 text-slate-600">
                            [{f.min}…{f.max}]
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-slate-500">
                        <span className="block max-w-[16rem] truncate" title={JSON.stringify(f.samples)}>
                          {f.samples.map((s) => JSON.stringify(s)).join(', ') || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-600">
            <Hash size={10} /> Distinct values are capped at 200 per field. Array elements are counted as the
            array value, not walked individually. <Binary size={10} /> Nested objects contribute dotted paths.
            <ToggleLeft size={10} /> Types reflect actual stored JSON.
          </p>
        </>
      )}
    </Modal>
  );
}
