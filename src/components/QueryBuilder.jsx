/**
 * QueryBuilder — the visual filter editor (no raw JSON required).
 *
 * Rows of { field, operator, value } chips with an AND/OR combinator;
 * a live JSON preview shows the filter that will run, and Apply feeds
 * it into the QueryConsole. Round-trips with the raw JSON editor: rows
 * are derived from the current filter whenever it changes.
 */
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';

const OPS = [
  { id: 'eq', label: '=', json: 'eq' },
  { id: 'ne', label: '≠', json: 'ne' },
  { id: 'gt', label: '>', json: 'gt' },
  { id: 'gte', label: '≥', json: 'gte' },
  { id: 'lt', label: '<', json: 'lt' },
  { id: 'lte', label: '≤', json: 'lte' },
  { id: 'in', label: 'in', json: 'in' },
  { id: 'regex', label: 'regex', json: 'regex' },
  { id: 'exists', label: 'exists', json: 'exists' },
  { id: 'text', label: 'text', json: 'text' },
];

const OP_BY_ID = Object.fromEntries(OPS.map((o) => [o.id, o]));

/**
 * Derive builder rows from a filter object. Only flat top-level fields
 * round-trip (nested $and/$or stay visible in the JSON tab instead).
 */
function rowsFromFilter(filter) {
  const rows = [];
  for (const [field, cond] of Object.entries(filter || {})) {
    if (field.startsWith('$')) continue; // $and/$or/$text handled separately
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const keys = Object.keys(cond);
      if (keys.length === 1 && keys[0] === '$eq') {
        rows.push({ field, op: 'eq', value: JSON.stringify(cond.$eq) });
        continue;
      }
      if (keys.length === 1 && keys[0] === '$in' && Array.isArray(cond.$in)) {
        rows.push({ field, op: 'in', value: JSON.stringify(cond.$in) });
        continue;
      }
      if (keys.length === 1 && keys[0] === '$regex') {
        rows.push({ field, op: 'regex', value: JSON.stringify(cond.$regex) });
        continue;
      }
      if (keys.length === 1 && keys[0] === '$exists') {
        rows.push({ field, op: 'exists', value: JSON.stringify(Boolean(cond.$exists)) });
        continue;
      }
    }
    rows.push({ field, op: 'eq', value: JSON.stringify(cond) });
  }
  if (filter && typeof filter.$text === 'object') {
    rows.push({ field: '', op: 'text', value: JSON.stringify(filter.$text.$search || '') });
  }
  return rows;
}

/** Build the JSON condition for one row (or null when incomplete). */
function rowCondition(row) {
  const value = row.value.trim();
  const op = OP_BY_ID[row.op];
  if (!op) return null;
  if (row.op === 'text') {
    const term = value.replace(/^"|"$/g, '');
    return term ? { $text: { $search: term } } : null;
  }
  if (!row.field.trim()) return null;

  // Parse the value as JSON when possible, otherwise treat as string.
  let parsed;
  try {
    parsed = JSON.parse(value === '' ? '""' : value);
  } catch {
    parsed = value;
  }

  switch (row.op) {
    case 'eq': return { [row.field]: parsed };
    case 'ne': return { [row.field]: { $ne: parsed } };
    case 'gt': return { [row.field]: { $gt: parsed } };
    case 'gte': return { [row.field]: { $gte: parsed } };
    case 'lt': return { [row.field]: { $lt: parsed } };
    case 'lte': return { [row.field]: { $lte: parsed } };
    case 'in': return { [row.field]: { $in: Array.isArray(parsed) ? parsed : [parsed] } };
    case 'regex': return { [row.field]: { $regex: typeof parsed === 'string' ? parsed : value } };
    case 'exists': return { [row.field]: { $exists: Boolean(parsed) } };
    default: return null;
  }
}

function buildFilter(rows, mode) {
  const conds = rows.map(rowCondition).filter(Boolean);
  if (conds.length === 0) return {};
  if (conds.length === 1) return conds[0];
  if (mode === 'any') return { $or: conds };
  return Object.assign({}, ...conds);
}

export default function QueryBuilder({ filterText, onApply }) {
  const [rows, setRows] = useState([{ field: '', op: 'eq', value: '""' }]);
  const [mode, setMode] = useState('all');

  // Re-derive rows when the filter changes elsewhere (saved query picked…).
  useEffect(() => {
    let filter = {};
    try {
      filter = JSON.parse(filterText || '{}');
    } catch {
      filter = {};
    }
    const derived = rowsFromFilter(filter);
    setRows(derived.length > 0 ? derived : [{ field: '', op: 'eq', value: '""' }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterText]);

  const setRow = (i, patch) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const addRow = () =>
    setRows((prev) => [...prev, { field: '', op: 'eq', value: '""' }]);

  const removeRow = (i) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, j) => j !== i)));

  const preview = JSON.stringify(buildFilter(rows, mode), null, 2);

  return (
    <div className="flex min-h-0 flex-col">
      {/* combinator */}
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">match</span>
        <div className="flex gap-1 rounded-lg bg-ink-850 p-1">
          {[
            { id: 'all', label: 'all (AND)' },
            { id: 'any', label: 'any (OR)' },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                mode === m.id ? 'bg-ink-600 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* rows */}
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <span className="w-8 shrink-0 text-center font-mono text-[10px] text-slate-600">
                {mode === 'any' ? 'OR' : 'AND'}
              </span>
            )}
            {i === 0 && <span className="w-8 shrink-0" />}
            <input
              value={row.field}
              onChange={(e) => setRow(i, { field: e.target.value })}
              placeholder="field.path"
              disabled={row.op === 'text'}
              className="w-40 shrink-0 rounded border border-ink-600 bg-ink-850 px-2 py-1 font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand-500 disabled:opacity-40"
            />
            <select
              value={row.op}
              onChange={(e) => setRow(i, { op: e.target.value })}
              className="w-24 shrink-0 rounded border border-ink-600 bg-ink-850 px-1.5 py-1 font-mono text-[11px] text-brand-300 outline-none focus:border-brand-500"
              aria-label="Operator"
            >
              {OPS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            <input
              value={row.value}
              onChange={(e) => setRow(i, { value: e.target.value })}
              placeholder='value ("text", 42, [1,2])'
              className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-850 px-2 py-1 font-mono text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand-500"
            />
            <button
              onClick={() => removeRow(i)}
              title="Remove condition"
              className="shrink-0 rounded p-1 text-slate-600 hover:text-rose-400"
              aria-label="Remove condition"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addRow}
        className="mt-1.5 flex w-fit items-center gap-1.5 rounded px-2 py-1 text-[11px] text-slate-500 hover:bg-ink-800 hover:text-brand-300"
      >
        <Plus size={12} /> Add condition
      </button>

      {/* live preview + apply */}
      <div className="mt-2 flex items-start gap-2 border-t border-ink-700 pt-2">
        <pre className="min-w-0 flex-1 truncate whitespace-pre-wrap rounded bg-ink-900 px-2.5 py-1.5 font-mono text-[10px] text-slate-500">
          {preview}
        </pre>
        <button
          onClick={() => onApply(preview)}
          title="Run this filter"
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-ink-950 hover:bg-brand-500"
        >
          <Wand2 size={13} /> Apply
        </button>
      </div>
    </div>
  );
}
