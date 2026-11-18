/**
 * Insert / Edit document dialogs.
 * Both are Monaco JSON editors with validation; editing preserves `_id`
 * and can use $set / $unset operator updates or full replacement.
 */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { stringify, tryParseJson } from '../lib/utils.js';
import MonacoJsonEditor from './MonacoJsonEditor.jsx';
import { Banner, Modal } from './ui.jsx';

/* ---------------------------- Insert ------------------------------ */

export function InsertDocumentDialog({ db, coll, onClose, onInserted }) {
  const [text, setText] = useState('{\n  "name": "New Document",\n  "status": "active"\n}');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const insert = async () => {
    const parsed = tryParseJson(text);
    if (!parsed.ok) return setError(`Invalid JSON: ${parsed.error}`);
    if (parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return setError('A document must be a JSON object.');
    }
    setBusy(true);
    try {
      await api.insertOne(db, coll, parsed.value);
      onInserted();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Insert Document"
      subtitle={`${db} / ${coll} — _id is auto-generated if omitted`}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
            Cancel
          </button>
          <button
            onClick={insert}
            disabled={busy}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-brand-500 disabled:opacity-40"
          >
            {busy ? 'Inserting…' : 'Insert'}
          </button>
        </>
      }
    >
      <MonacoJsonEditor value={text} onChange={setText} height={320} />
      {error && <div className="mt-3"><Banner onClose={() => setError(null)}>{error}</Banner></div>}
    </Modal>
  );
}

/* ------------------------------ Edit ------------------------------ */

export function EditDocumentDialog({ db, coll, doc, onClose, onSaved }) {
  const [text, setText] = useState(() => stringify(doc));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const parsed = tryParseJson(text);
    if (!parsed.ok) return setError(`Invalid JSON: ${parsed.error}`);
    const next = parsed.value;
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      return setError('A document must be a JSON object.');
    }
    const isOperatorUpdate =
      Object.keys(next).length > 0 && Object.keys(next).every((k) => k.startsWith('$'));
    const changesWholeDoc = !isOperatorUpdate && next._id !== doc._id;
    if (changesWholeDoc) return setError('_id cannot be changed.');

    setBusy(true);
    try {
      // Operator update ({ $set: ... }) or full replacement — engine handles both.
      await api.updateOne(db, coll, { _id: doc._id }, next);
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Edit Document"
      subtitle={`${db} / ${coll} · _id ${doc._id}`}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-brand-500 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <p className="mb-2 text-xs text-slate-500">
        Provide the full document (replacement), or an operator update such as{' '}
        <code className="text-brand-300">{'{ "$set": { "status": "active" } }'}</code>.
      </p>
      <MonacoJsonEditor value={text} onChange={setText} height={320} />
      {error && <div className="mt-3"><Banner onClose={() => setError(null)}>{error}</Banner></div>}
    </Modal>
  );
}
