/**
 * DocumentExplorer — three data views:
 *   grid   — auto-column table (dotted paths) with inline cell editing
 *   ledger — compact row ledger; click a row to expand its JSON detail
 *   tree   — expandable JSON cards
 * All views expose per-document select / edit / duplicate / history /
 * delete actions; grid cells edit in place (double-click).
 */
import { Check, ChevronDown, ChevronRight, Clock, Copy, Inbox, Pencil, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { previewValue, valueTypeClass } from '../lib/utils.js';
import JsonTreeView, { JsonNode } from './JsonTreeView.jsx';

/* ------------------------------------------------------------------ */
/* Grid view                                                           */
/* ------------------------------------------------------------------ */

/** Flatten a document into dotted leaf paths for grid columns. */
function flatten(doc, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(doc)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
      flatten(v, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** Derive a stable column set across all loaded documents. */
function useColumns(docs) {
  return useMemo(() => {
    const keys = new Set();
    docs.forEach((d) => Object.keys(flatten(d)).forEach((k) => keys.add(k)));
    const list = [...keys];
    // _id first, remaining columns alphabetical for stable reading order.
    list.sort((a, b) => (a === '_id' ? -1 : b === '_id' ? 1 : a.localeCompare(b)));
    return list;
  }, [docs]);
}

function DocActions({ doc, onEdit, onDelete, onDuplicate, onHistory }) {
  return (
    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
  );
}

/** Selection checkbox used by every view. */
function SelectBox({ checked, onToggle, title = 'Select document' }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={title}
      aria-label={title}
      aria-checked={checked}
      role="checkbox"
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
        checked ? 'border-brand-500 bg-brand-600 text-ink-950' : 'border-ink-600 bg-ink-850 text-transparent hover:border-brand-500'
      }`}
    >
      <Check size={11} strokeWidth={3} />
    </button>
  );
}

/** Inline-editable grid cell (double-click to edit; Enter/blur commits). */
function GridCell({ doc, col, onCellEdit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const flat = flatten(doc);
  const v = flat[col];

  const begin = () => {
    if (col === '_id' || !onCellEdit) return;
    setDraft(typeof v === 'string' ? v : JSON.stringify(v ?? null));
    setEditing(true);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onCellEdit?.(doc, col, draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="w-full rounded border border-brand-500 bg-ink-950 px-1.5 py-0.5 font-mono text-[11px] text-slate-100 outline-none"
      />
    );
  }

  return (
    <span
      onDoubleClick={begin}
      className={`block truncate ${col === '_id' ? '' : 'cursor-text'}`}
      title={onCellEdit && col !== '_id' ? `${previewValue(v)} — double-click to edit` : previewValue(v)}
    >
      {col === '_id' ? <code className="font-mono text-brand-300">{v}</code> : <span className={valueTypeClass(v)}>{previewValue(v)}</span>}
    </span>
  );
}

function DataGrid({ docs, onEdit, onDelete, onDuplicate, onHistory, selection, onToggleSelect, onCellEdit }) {
  const columns = useColumns(docs);
  const hasSelection = Boolean(selection);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 z-10 bg-ink-900">
          <tr>
            {hasSelection && <th className="w-8 border-b border-ink-700 px-2 py-2" aria-label="Select" />}
            {columns.map((col) => (
              <th
                key={col}
                className="whitespace-nowrap border-b border-ink-700 px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-slate-500"
              >
                {col}
              </th>
            ))}
            <th className="w-20 border-b border-ink-700 px-3 py-2" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => {
            const selected = selection?.has(doc._id);
            return (
              <tr key={doc._id} className={`group border-b border-ink-800 hover:bg-ink-900 ${selected ? 'bg-brand-950/20' : ''}`}>
                {hasSelection && (
                  <td className="px-2 py-2 align-top">
                    <SelectBox checked={selected} onToggle={() => onToggleSelect?.(doc)} />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col} className="max-w-[26rem] px-3 py-2 align-top">
                    <GridCell doc={doc} col={col} onCellEdit={onCellEdit} />
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right">
                  <div className="flex justify-end">
                    <DocActions doc={doc} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} onHistory={onHistory} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ledger view — the PocketDB signature layout                         */
/* ------------------------------------------------------------------ */

function LedgerView({ docs, onEdit, onDelete, onDuplicate, onHistory, selection, onToggleSelect }) {
  const [openId, setOpenId] = useState(null);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {docs.map((doc) => {
        const open = openId === doc._id;
        const selected = selection?.has(doc._id);
        const first = Object.entries(doc).find(([k]) => k !== '_id');
        return (
          <div key={doc._id} className={`border-b border-ink-800 ${selected ? 'bg-brand-950/10' : ''}`}>
            <div
              onClick={() => setOpenId(open ? null : doc._id)}
              className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${
                open ? 'bg-ink-900' : 'hover:bg-ink-900'
              }`}
            >
              {selection && (
                <SelectBox checked={selected} onToggle={() => onToggleSelect?.(doc)} />
              )}
              {open ? (
                <ChevronDown size={12} className="shrink-0 text-slate-600" />
              ) : (
                <ChevronRight size={12} className="shrink-0 text-slate-600" />
              )}
              <code className="shrink-0 font-mono text-[11px] text-brand-300">{doc._id}</code>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500">
                {first ? (
                  <>
                    <span className="text-violet-300">{first[0]}</span>
                    {': '}
                    <span className={valueTypeClass(first[1])}>{previewValue(first[1])}</span>
                  </>
                ) : (
                  '—'
                )}
              </span>
              <span className="flex shrink-0" onClick={(e) => e.stopPropagation()}>
                <DocActions doc={doc} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} onHistory={onHistory} />
              </span>
            </div>
            {open && (
              <div className="border-t border-ink-800 bg-ink-900 px-9 py-3">
                <JsonNode value={doc} depth={0} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dispatcher                                                          */
/* ------------------------------------------------------------------ */

export default function DocumentExplorer({
  view, docs, onEdit, onDelete, onDuplicate,
  onHistory, selection, onToggleSelect, onCellEdit,
}) {
  if (docs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="text-center text-sm text-slate-500">
          <Inbox size={34} className="mx-auto mb-3 text-slate-700" />
          <p className="font-medium text-slate-400">No documents match the current view.</p>
          <p className="mt-1 text-xs">Adjust the filter console below, or insert a new document.</p>
        </div>
      </div>
    );
  }
  const shared = { onEdit, onDelete, onDuplicate, onHistory, selection, onToggleSelect };
  if (view === 'grid') {
    return <DataGrid docs={docs} {...shared} onCellEdit={onCellEdit} />;
  }
  if (view === 'ledger') return <LedgerView docs={docs} {...shared} />;
  return (
    <JsonTreeView docs={docs} {...shared} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} />
  );
}
