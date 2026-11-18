/**
 * ImportDialog — load documents into a collection from a local file
 * (JSON array, NDJSON or CSV). The file is read in the renderer (File API),
 * parsed + inserted in the main process, and a per-run summary is shown.
 */
import { FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Modal } from './ui.jsx';

const FORMAT_BY_EXT = { json: 'json', ndjson: 'ndjson', csv: 'csv' };

export default function ImportDialog({ db, coll, onClose, onImported }) {
  const [fileName, setFileName] = useState('');
  const [format, setFormat] = useState('auto');
  const [text, setText] = useState('');
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSummary(null);
    setFileName(file.name);
    const ext = file.name.split('.').pop().toLowerCase();
    setFormat(FORMAT_BY_EXT[ext] || 'auto');
    try {
      setText(await file.text());
    } catch (err) {
      setError(`Could not read "${file.name}": ${err.message}`);
    }
  };

  const run = async () => {
    setError(null);
    setSummary(null);
    setBusy(true);
    try {
      const res = await api.importDocs(db, coll, { text, format });
      setSummary(res);
      if (res.inserted > 0) onImported?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import documents"
      subtitle={`${db} › ${coll} — JSON array, NDJSON or CSV (first row = header)`}
      onClose={onClose}
      width="max-w-lg"
    >
      {error && <div className="mb-3"><Banner onClose={() => setError(null)}>{error}</Banner></div>}
      {summary && (
        <div className="mb-3">
          <Banner kind={summary.failed > 0 ? 'error' : 'ok'}>
            {summary.inserted}/{summary.total} documents inserted
            {summary.failed > 0 && <> — {summary.failed} failed: {summary.errors[0]}</>}
          </Banner>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".json,.ndjson,.csv,.txt"
        onChange={pickFile}
        className="hidden"
        aria-label="Choose a file to import"
      />
      <button
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center gap-3 rounded-lg border border-dashed border-ink-600 px-4 py-4 text-left transition-colors hover:border-brand-500"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-ink-800 text-brand-300">
          <FileUp size={17} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-200">{fileName || 'Choose a file…'}</span>
          <span className="block text-xs text-slate-600">.json / .ndjson / .csv — or paste below</span>
        </span>
      </button>

      <div className="mt-3 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">format</span>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="rounded border border-ink-600 bg-ink-900 px-2 py-1 font-mono text-[11px] text-slate-300 outline-none focus:border-brand-500"
          aria-label="Import format"
        >
          <option value="auto">auto-detect</option>
          <option value="json">JSON</option>
          <option value="ndjson">NDJSON (one doc per line)</option>
          <option value="csv">CSV</option>
        </select>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='[ { "name": "Ada" }, { "name": "Alan" } ]  — or paste NDJSON / CSV'
        spellCheck={false}
        rows={8}
        className="mt-3 w-full rounded-lg border border-ink-600 bg-ink-900 p-3 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand-500"
      />

      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-300 hover:bg-ink-700">
          Close
        </button>
        <button
          onClick={run}
          disabled={!text.trim() || busy}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-brand-500 disabled:opacity-40"
        >
          {busy ? 'Importing…' : `Import into ${coll}`}
        </button>
      </div>
    </Modal>
  );
}
