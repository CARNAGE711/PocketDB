/**
 * ChartsStudio — dependency-free SVG charts over pipeline results.
 * Pick a category field (x-axis / slices) and a value (a numeric field
 * or "count"), then render a bar chart or donut — pure SVG, on-theme.
 */
import { BarChart3, Loader2, PieChart, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Button, Segmented } from './ui.jsx';

const PALETTE = ['#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#ec4899', '#eab308'];

/** Number-ish fields from result docs, plus a synthetic "count". */
function pickFields(docs) {
  const numeric = new Set();
  for (const d of docs) {
    for (const [k, v] of Object.entries(d)) {
      if (k === '_id') continue;
      if (typeof v === 'number') numeric.add(k);
    }
  }
  return [...numeric].sort();
}

function BarChart({ series, max }) {
  return (
    <svg viewBox={`0 0 ${series.length * 64 + 16} 240`} className="h-64 w-full">
      {series.map((s, i) => {
        const h = max > 0 ? Math.max(2, (s.value / max) * 200) : 2;
        return (
          <g key={s.label}>
            <rect
              x={i * 64 + 12}
              y={220 - h}
              width={44}
              height={h}
              rx={4}
              fill={PALETTE[i % PALETTE.length]}
              opacity={0.9}
            />
            <text x={i * 64 + 34} y={236} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="monospace">
              {s.label.length > 8 ? `${s.label.slice(0, 7)}…` : s.label}
            </text>
            <text x={i * 64 + 34} y={214 - h} textAnchor="middle" fontSize="9" fill="#e2e8f0" fontFamily="monospace">
              {s.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ series, total }) {
  let acc = 0;
  const cx = 120;
  const cy = 120;
  const r = 90;
  return (
    <svg viewBox="0 0 240 240" className="mx-auto h-64 w-64">
      {series.map((s, i) => {
        const frac = total > 0 ? s.value / total : 0;
        const a0 = acc * 2 * Math.PI - Math.PI / 2;
        acc += frac;
        const a1 = acc * 2 * Math.PI - Math.PI / 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const x0 = cx + r * Math.cos(a0);
        const y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1);
        const y1 = cy + r * Math.sin(a1);
        return (
          <path
            key={s.label}
            d={`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`}
            fill={PALETTE[i % PALETTE.length]}
            opacity={0.9}
            stroke="#0b0f14"
            strokeWidth={2}
          />
        );
      })}
      <circle cx={120} cy={120} r={50} fill="#0b0f14" />
      <text x={120} y={124} textAnchor="middle" fontSize="18" fill="#e2e8f0" fontFamily="monospace">
        {total}
      </text>
    </svg>
  );
}

export default function ChartsStudio({ db, coll, stages }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState('bar');
  const [category, setCategory] = useState('_id');
  const [value, setValue] = useState('count');

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      const { documents } = await api.runPipeline(db, coll, stages);
      setDocs(documents);
      // Sensible defaults once results land: $group output groups by _id.
      const numeric = pickFields(documents);
      setValue(numeric[0] || 'count');
      setCategory(documents[0] && '_id' in documents[0] ? '_id' : category);
    } catch (e) {
      setDocs(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (stages) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const series = useMemo(() => {
    if (!docs) return [];
    const countOf = (d) => 1;
    return docs.map((d) => ({
      label: category === '_id' || category in d ? String(d[category] ?? '(none)') : '(none)',
      value: value === 'count' ? countOf(d) : typeof d[value] === 'number' ? d[value] : 0,
    }));
  }, [docs, category, value]);

  const max = Math.max(1, ...series.map((s) => s.value));
  const total = series.reduce((sum, s) => sum + s.value, 0);

  if (!stages) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-center text-sm text-slate-500">
        <div>
          <BarChart3 size={28} className="mx-auto mb-2 text-slate-700" />
          <p className="font-medium text-slate-400">No pipeline to chart yet</p>
          <p className="mt-1 text-xs">Build one in the Pipeline studio, then choose “Chart results”.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* config strip */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-ink-700 bg-ink-900 px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
          chart <span className="normal-case text-slate-400">{db} › {coll}</span>
        </span>
        <Segmented
          size="sm"
          value={type}
          onChange={setType}
          options={[
            { id: 'bar', label: 'Bars', icon: BarChart3 },
            { id: 'donut', label: 'Donut', icon: PieChart },
          ]}
        />
        <label className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
          category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded border border-ink-600 bg-ink-850 px-1.5 py-1 font-mono text-[11px] text-slate-300 outline-none focus:border-brand-500"
          >
            <option value="_id">_id</option>
            {docs && docs[0] && Object.keys(docs[0]).filter((k) => k !== '_id').map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
          value
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="rounded border border-ink-600 bg-ink-850 px-1.5 py-1 font-mono text-[11px] text-slate-300 outline-none focus:border-brand-500"
          >
            <option value="count">count</option>
            {pickFields(docs || []).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <Button variant="ghost" onClick={run} disabled={busy} className="ml-auto">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Re-run
        </Button>
      </div>

      {error && (
        <div className="px-4 pt-3">
          <Banner onClose={() => setError(null)}>{error}</Banner>
        </div>
      )}

      {/* chart body */}
      {docs ? (
        <div className="min-h-0 flex-1 overflow-auto p-6">
          {series.length === 0 ? (
            <p className="mt-16 text-center text-xs text-slate-600">The pipeline returned no rows to chart.</p>
          ) : type === 'bar' ? (
            <BarChart series={series} max={max} />
          ) : (
            <Donut series={series} total={total} />
          )}
          {/* legend */}
          <div className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-x-4 gap-y-1">
            {series.slice(0, 12).map((s, i) => (
              <span key={i} className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                {s.label} · {s.value}
              </span>
            ))}
          </div>
        </div>
      ) : (
        !error && (
          <div className="flex min-h-0 flex-1 items-center justify-center font-mono text-xs text-slate-600">
            running pipeline…
          </div>
        )
      )}
    </div>
  );
}
