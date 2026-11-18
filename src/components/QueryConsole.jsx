/**
 * QueryConsole — the collection filter as a terminal-style drawer docked
 * to the bottom of the data surface (instead of a top filter bar).
 *
 * Collapsed it is a single status strip: `filter ▸ {...} · matched N`.
 * Expanding reveals two tabs: the Monaco JSON editor and the visual
 * Builder (field/operator/value chips). Also hosts **saved queries**:
 * load a persisted filter from the dropdown, or save the current filter
 * with a name (stored per collection).
 */
import { Bookmark, ChevronDown, ChevronRight, Play, RotateCcw, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import MonacoJsonEditor from './MonacoJsonEditor.jsx';
import QueryBuilder from './QueryBuilder.jsx';
import { Button, IconButton, Segmented } from './ui.jsx';

function SavedMenu({ queries, onPick, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" onClick={() => setOpen((o) => !o)} title="Load a saved filter">
        <Bookmark size={12} /> Saved ({queries.length})
      </Button>
      {open && (
        <div className="absolute bottom-full right-0 z-40 mb-1 w-64 rounded-lg border border-ink-600 bg-ink-850 py-1 shadow-2xl">
          {queries.map((q) => (
            <div key={q.id} className="group flex items-center hover:bg-ink-800">
              <button
                onClick={() => { onPick(q); setOpen(false); }}
                className="flex min-w-0 flex-1 items-center px-3 py-2 text-left text-xs text-slate-300"
              >
                <span className="min-w-0 flex-1 truncate">{q.name}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(q.id); }}
                title="Delete saved query"
                className="mr-1 rounded p-1 text-slate-600 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100"
                aria-label="Delete saved query"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {queries.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-600">No saved filters yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function QueryConsole({
  queryText, onQueryText, onRun, onClear, matched, loaded, error,
  savedQueries = [], onSaveQuery, onDeleteQuery, onPickQuery,
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('json'); // 'json' | 'builder'
  const [naming, setNaming] = useState(false);
  const [nameVal, setNameVal] = useState('');

  // Surface errors automatically so they are never hidden in the strip.
  useEffect(() => {
    if (error) setOpen(true);
  }, [error]);

  const submitName = async () => {
    const name = nameVal.trim();
    if (!name) return;
    try {
      await onSaveQuery(name);
      setNaming(false);
      setNameVal('');
    } catch {
      /* the shell banner shows the error */
    }
  };

  return (
    <div className="shrink-0 border-t border-ink-700 bg-ink-900">
      {/* status strip (always visible) */}
      <div className="flex items-center gap-3 px-4 py-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          title="Toggle filter console"
        >
          {open ? (
            <ChevronDown size={13} className="shrink-0 text-slate-500" />
          ) : (
            <ChevronRight size={13} className="shrink-0 text-slate-500" />
          )}
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-slate-500">filter</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-400">{queryText || '{}'}</code>
          {error ? (
            <span className="shrink-0 truncate font-mono text-[11px] text-rose-400" title={error}>
              ! {error}
            </span>
          ) : (
            matched !== null && (
              <span className="shrink-0 font-mono text-[11px] text-slate-600">
                matched <span className="text-brand-300">{matched}</span>
                {loaded !== null && <> / showing {loaded}</>}
              </span>
            )
          )}
        </button>

        {/* saved-query actions */}
        {savedQueries.length > 0 && (
          <SavedMenu queries={savedQueries} onPick={onPickQuery} onDelete={onDeleteQuery} />
        )}
        <IconButton
          onClick={() => { setNaming(true); setNameVal(''); }}
          title="Save this filter"
          aria-label="Save this filter"
          className={naming ? 'text-brand-300' : ''}
        >
          <Bookmark size={13} />
        </IconButton>
      </div>

      {/* inline save-naming row */}
      {naming && (
        <div className="flex items-center gap-2 px-4 pb-2">
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-slate-500">save as</span>
          <input
            autoFocus
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitName();
              if (e.key === 'Escape') setNaming(false);
            }}
            placeholder="active-users"
            className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-850 px-2 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand-500"
          />
          <Button variant="primary" onClick={submitName} disabled={!nameVal.trim()}>Save</Button>
          <Button variant="ghost" onClick={() => setNaming(false)}>Cancel</Button>
        </div>
      )}

      {/* expanded editor */}
      {open && (
        <div className="px-4 pb-3">
          <div className="mb-2 flex items-center justify-between">
            <Segmented
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { id: 'json', label: 'JSON' },
                { id: 'builder', label: 'Builder', icon: Wand2, title: 'Visual filter builder' },
              ]}
            />
            <code className="truncate font-mono text-[10px] text-slate-600">
              $eq $ne $gt $gte $lt $lte $in $regex $text · dot-notation ("profile.age")
            </code>
          </div>
          {mode === 'json' ? (
            <>
              <MonacoJsonEditor value={queryText} onChange={onQueryText} height={110} />
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={onClear} title="Reset filter">
                  <RotateCcw size={13} /> Clear
                </Button>
                <Button variant="primary" onClick={onRun}>
                  <Play size={13} /> Run
                </Button>
              </div>
            </>
          ) : (
            <QueryBuilder
              filterText={queryText}
              onApply={(json) => {
                onQueryText(json);
                onRun(json);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
