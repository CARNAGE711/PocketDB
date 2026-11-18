/**
 * Expandable JSON tree viewer.
 * Recursive node renderer with collapsible objects/arrays, color-coded
 * primitives, and per-document select/edit/history/delete actions.
 */
import { Check, ChevronDown, ChevronRight, Clock, Copy, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { valueTypeClass } from '../lib/utils.js';

function Primitive({ value }) {
  if (value === null || value === undefined) {
    return <span className="text-slate-500 italic">null</span>;
  }
  if (typeof value === 'string') return <span className="text-emerald-300">"{value}"</span>;
  if (typeof value === 'number') return <span className="text-sky-300">{value}</span>;
  if (typeof value === 'boolean') return <span className="text-amber-300">{String(value)}</span>;
  return <span className="text-slate-300">{String(value)}</span>;
}

/** A single collapsible node (object, array or primitive). */
export function JsonNode({ name, value, depth, defaultOpen = true }) {
  const [open, setOpen] = useState(depth < 3);
  const isBranch = value !== null && typeof value === 'object';

  if (!isBranch) {
    return (
      <div className="flex gap-1.5 leading-6">
        {name !== undefined && <span className="text-violet-300">{name}:</span>}
        <Primitive value={value} />
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [i, v])
    : Object.entries(value);
  const openBrace = Array.isArray(value) ? '[' : '{';
  const closeBrace = Array.isArray(value) ? ']' : '}';

  return (
    <div className="leading-6">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} className="text-slate-600" /> : <ChevronRight size={12} className="text-slate-600" />}
        {name !== undefined && <span className="text-violet-300">{name}:</span>}
        <span className="text-slate-500">
          {openBrace}
          {!open && <span className="text-slate-600"> … {closeBrace}</span>}
        </span>
        {!open && <span className="text-[10px] text-slate-600">{entries.length} items</span>}
      </button>
      {open && (
        <div className="ml-4 border-l border-ink-700 pl-3">
          {entries.map(([k, v]) => (
            <JsonNode key={k} name={k} value={v} depth={depth + 1} />
          ))}
          <div className="text-slate-500">{closeBrace}</div>
        </div>
      )}
    </div>
  );
}

export default function JsonTreeView({ docs, onEdit, onDelete, onDuplicate, onHistory, selection, onToggleSelect }) {
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      {docs.map((doc) => {
        const selected = selection?.has(doc._id);
        return (
          <div key={doc._id} className={`group relative rounded-lg border bg-ink-850 px-4 py-2 ${selected ? 'border-brand-600' : 'border-ink-700'}`}>
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {selection && (
              <button
                onClick={() => onToggleSelect?.(doc)}
                title="Select document"
                aria-label="Select document"
                className={`flex h-5 w-5 items-center justify-center rounded border ${
                  selected ? 'border-brand-500 bg-brand-600 text-ink-950' : 'border-ink-600 bg-ink-900 text-transparent hover:border-brand-500'
                }`}
              >
                <Check size={12} strokeWidth={3} />
              </button>
            )}
            <button
              onClick={() => onHistory?.(doc)}
              title="Document history"
              className="rounded p-1 text-slate-400 hover:bg-ink-700 hover:text-slate-100"
              aria-label="Document history"
            >
              <Clock size={13} />
            </button>
            <button
              onClick={() => onEdit(doc)}
              title="Edit document"
              className="rounded p-1 text-slate-400 hover:bg-ink-700 hover:text-slate-100"
              aria-label="Edit document"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => onDuplicate(doc)}
              title="Duplicate document"
              className="rounded p-1 text-slate-400 hover:bg-ink-700 hover:text-slate-100"
              aria-label="Duplicate document"
            >
              <Copy size={13} />
            </button>
            <button
              onClick={() => onDelete(doc)}
              title="Delete document"
              className="rounded p-1 text-slate-400 hover:bg-ink-700 hover:text-rose-400"
              aria-label="Delete document"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-600">
            document <code className="text-brand-300 normal-case">{doc._id}</code>
          </div>
          <JsonNode value={doc} depth={0} />
          </div>
        );
      })}
    </div>
  );
}
