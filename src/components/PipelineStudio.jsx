/**
 * PipelineStudio — the aggregation builder, redesigned.
 *
 * Stages render as numbered chips flowing left→right on a rail (the output
 * of each stage feeds the next, drawn with arrows). The selected stage's
 * spec opens in the editor panel; results render underneath in any view.
 */
import {
  ArrowDown, ArrowUp, BarChart3, BookmarkPlus, Braces, Eye, ListTree, Play, Plus, Table, Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { tryParseJson } from '../lib/utils.js';
import DocumentExplorer from './DocumentExplorer.jsx';
import MonacoJsonEditor from './MonacoJsonEditor.jsx';
import { Banner, Button, Segmented } from './ui.jsx';

/** Starter JSON per stage type ($limit / $skip take a bare number). */
const STAGE_TEMPLATES = {
  $match: '{\n  "status": "active"\n}',
  $sort: '{\n  "createdAt": -1\n}',
  $limit: '5',
  $skip: '0',
  $project: '{\n  "_id": 0,\n  "name": 1,\n  "profile.age": 1\n}',
  $count: '"total"',
  $unwind: '"tags"',
  $group: '{\n  "_id": "$status",\n  "total": { "$sum": 1 },\n  "avgAge": { "$avg": "$profile.age" }\n}',
  $lookup: '{\n  "from": "tasks",\n  "localField": "name",\n  "foreignField": "assignee",\n  "as": "assignedTasks"\n}',
  $replaceRoot: '{\n  "newRoot": "$profile"\n}',
};

let stageSeq = 0;
function newStage(type = '$match') {
  return { id: `stage-${++stageSeq}`, type, text: STAGE_TEMPLATES[type] };
}

export default function PipelineStudio({ db, coll, isView = false, onChart, onViewSaved }) {
  const [stages, setStages] = useState([newStage('$match')]);
  const [selectedId, setSelectedId] = useState(stages[0].id);
  const [results, setResults] = useState(null);
  const [resultView, setResultView] = useState('ledger');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [namingView, setNamingView] = useState(false);
  const [viewName, setViewName] = useState('');
  const [viewNotice, setViewNotice] = useState(null);
  const [viewBusy, setViewBusy] = useState(false);
  const addRef = useRef(null);

  const selected = stages.find((s) => s.id === selectedId) || stages[0];

  useEffect(() => {
    if (!addMenu) return undefined;
    const onDown = (e) => {
      if (addRef.current && !addRef.current.contains(e.target)) setAddMenu(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [addMenu]);

  const updateSelected = (text) => {
    setStages((prev) => prev.map((s) => (s.id === selected.id ? { ...s, text } : s)));
  };

  const addStage = (type) => {
    const stage = newStage(type);
    setStages((prev) => [...prev, stage]);
    setSelectedId(stage.id);
  };

  const removeStage = (id) => {
    setStages((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) next.push(newStage('$match'));
      if (id === selectedId) setSelectedId(next[0].id);
      return next;
    });
  };

  const moveStage = (id, dir) => {
    setStages((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const changeType = (id, type) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, type, text: STAGE_TEMPLATES[type] } : s)));
  };

  /** Validate + build the pipeline array (shared by Run and Chart). */
  const buildPipeline = () => {
    const pipeline = [];
    for (const stage of stages) {
      const parsed = tryParseJson(stage.text);
      if (!parsed.ok) throw new Error(`Stage "${stage.type}": invalid JSON — ${parsed.error}`);
      pipeline.push({ [stage.type]: parsed.value });
    }
    return pipeline;
  };

  /** Validate + run the whole pipeline against the engine. */
  const run = async () => {
    setError(null);
    let pipeline;
    try {
      pipeline = buildPipeline();
    } catch (err) {
      setError(err.message);
      return;
    }
    setBusy(true);
    try {
      const { documents } = await api.runPipeline(db, coll, pipeline);
      setResults(documents);
    } catch (err) {
      setResults(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /** Hand the parsed pipeline to the charts surface. */
  const chartResults = () => {
    try {
      onChart?.(buildPipeline());
    } catch (err) {
      setError(err.message);
    }
  };

  /** Persist the current pipeline as a read-only virtual collection. */
  const saveAsView = async () => {
    setError(null);
    let pipeline;
    try {
      pipeline = buildPipeline();
    } catch (err) {
      setError(err.message);
      return;
    }
    setViewBusy(true);
    try {
      const view = await api.saveView(db, { name: viewName.trim(), coll, pipeline });
      setViewNotice(`Saved view "${view.name}" — it now appears as a read-only collection.`);
      setNamingView(false);
      setViewName('');
      onViewSaved?.(view);
    } catch (err) {
      setError(err.message);
    } finally {
      setViewBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* stage rail */}
      <div className="shrink-0 border-b border-ink-700 bg-ink-900 px-4 py-3">
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
            pipeline <span className="text-slate-700">//</span>{' '}
            <span className="normal-case text-slate-400">
              {db} › {coll}
            </span>
            {isView && (
              <span className="flex items-center gap-1 rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[9px] normal-case text-indigo-300">
                <Eye size={9} /> view
              </span>
            )}
          </h3>
          <div className="flex items-center gap-2">
            {!isView && (
              <Button
                variant="ghost"
                onClick={() => { setNamingView((v) => !v); setViewNotice(null); }}
                title="Save this pipeline as a read-only virtual collection"
              >
                <BookmarkPlus size={13} /> Save as view
              </Button>
            )}
            {onChart && (
              <Button variant="ghost" onClick={chartResults} title="Plot these results as bars / donut">
                <BarChart3 size={13} /> Chart results
              </Button>
            )}
            <Button variant="primary" onClick={run} disabled={busy}>
              <Play size={13} /> {busy ? 'Running…' : 'Run pipeline'}
            </Button>
          </div>
        </div>

        {namingView && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-brand-500/30 bg-brand-950/20 px-2 py-1.5">
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-slate-500">view name</span>
            <input
              autoFocus
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && viewName.trim()) saveAsView();
                if (e.key === 'Escape') setNamingView(false);
              }}
              placeholder="active-users"
              className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-900 px-2 py-1 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand-500"
            />
            <Button variant="primary" onClick={saveAsView} disabled={!viewName.trim() || viewBusy}>
              {viewBusy ? 'Saving…' : 'Save view'}
            </Button>
            <Button variant="ghost" onClick={() => setNamingView(false)}>Cancel</Button>
          </div>
        )}

        {viewNotice && (
          <div className="mb-2">
            <Banner kind="ok" onClose={() => setViewNotice(null)}>{viewNotice}</Banner>
          </div>
        )}

        <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
          {stages.map((stage, i) => {
            const isSelected = stage.id === selectedId;
            return (
              <div key={stage.id} className="flex shrink-0 items-center">
                {i > 0 && <span className="px-1 font-mono text-slate-600">→</span>}
                <div
                  onClick={() => setSelectedId(stage.id)}
                  className={`group flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                    isSelected
                      ? 'border-brand-600 bg-ink-800 text-slate-100'
                      : 'border-ink-700 bg-ink-850 text-slate-400 hover:bg-ink-800'
                  }`}
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-ink-600 font-mono text-[9px] text-slate-300">
                    {i + 1}
                  </span>
                  <code className={isSelected ? 'text-brand-300' : ''}>{stage.type}</code>
                  <span className="flex opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => moveStage(stage.id, -1)}
                      className="rounded p-0.5 hover:bg-ink-600"
                      title="Move earlier"
                      aria-label="Move earlier"
                    >
                      <ArrowUp size={11} />
                    </button>
                    <button
                      onClick={() => moveStage(stage.id, 1)}
                      className="rounded p-0.5 hover:bg-ink-600"
                      title="Move later"
                      aria-label="Move later"
                    >
                      <ArrowDown size={11} />
                    </button>
                    <button
                      onClick={() => removeStage(stage.id)}
                      className="rounded p-0.5 hover:bg-ink-600 hover:text-rose-400"
                      title="Remove stage"
                      aria-label="Remove stage"
                    >
                      <Trash2 size={11} />
                    </button>
                  </span>
                </div>
              </div>
            );
          })}

          {/* add-stage menu */}
          <div className="flex shrink-0 items-center" ref={addRef}>
            {stages.length > 0 && <span className="px-1 font-mono text-slate-600">→</span>}
            <div className="relative">
              <button
                onClick={() => setAddMenu((o) => !o)}
                title="Add stage"
                className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-dashed border-ink-600 text-slate-500 transition-colors hover:border-brand-500 hover:text-brand-300"
                aria-label="Add stage"
              >
                <Plus size={14} />
              </button>
              {addMenu && (
                <div className="absolute left-0 z-30 mt-1 w-40 rounded-lg border border-ink-600 bg-ink-850 py-1 shadow-2xl">
                  {Object.keys(STAGE_TEMPLATES).map((t) => (
                    <button
                      key={t}
                      onClick={() => { addStage(t); setAddMenu(false); }}
                      className="flex w-full items-center px-3 py-1.5 font-mono text-xs text-slate-300 hover:bg-ink-800 hover:text-brand-300"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* stage spec editor */}
      <div className="shrink-0 border-b border-ink-700 bg-ink-900 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
            stage spec <span className="text-brand-300">{selected.type}</span>
          </h3>
          <select
            value={selected.type}
            onChange={(e) => changeType(selected.id, e.target.value)}
            className="rounded border border-ink-600 bg-ink-850 px-2 py-1 font-mono text-[11px] text-slate-300 outline-none focus:border-brand-500"
            aria-label="Stage type"
          >
            {Object.keys(STAGE_TEMPLATES).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <MonacoJsonEditor value={selected.text} onChange={updateSelected} height={130} />
      </div>

      {/* results */}
      {error && (
        <div className="px-4 pt-3">
          <Banner onClose={() => setError(null)}>{error}</Banner>
        </div>
      )}

      {results ? (
        <>
          <div className="flex shrink-0 items-center justify-between border-b border-ink-700 bg-ink-900 px-4 py-2">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
              results · {results.length} docs
            </h3>
            <Segmented
              size="sm"
              value={resultView}
              onChange={setResultView}
              options={[
                { id: 'grid', label: 'Grid', icon: Table },
                { id: 'ledger', label: 'Ledger', icon: ListTree },
                { id: 'tree', label: 'JSON', icon: Braces },
              ]}
            />
          </div>
          <DocumentExplorer view={resultView} docs={results} onEdit={() => {}} onDelete={() => {}} onDuplicate={() => {}} />
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center text-center text-sm text-slate-500">
          <div>
            <p className="font-medium text-slate-400">Run the pipeline to preview results.</p>
            <p className="mt-1 text-xs">Chain stages on the rail above — each output feeds the next.</p>
          </div>
        </div>
      )}
    </div>
  );
}
