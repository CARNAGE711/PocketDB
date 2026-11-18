/**
 * SchemaDialog — per-collection validation rules.
 *
 * Rules are a JSON object: { required: [...], properties: { field: { type, enum } } }.
 * Saved rules are enforced on every insert/update; existing violations are
 * reported immediately.
 */
import { Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Button, Modal } from './ui.jsx';

const EXAMPLE = `{
  "required": ["status"],
  "properties": {
    "status": { "type": "string", "enum": ["active", "invited", "inactive"] },
    "profile.age": { "type": "number" }
  }
}`;

export default function SchemaDialog({ db, coll, onClose, onSaved }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getSchema(db, coll)
      .then((rules) => setText(rules ? JSON.stringify(rules, null, 2) : ''))
      .catch(() => setText(''));
  }, [db, coll]);

  const save = async () => {
    setError(null);
    setNotice(null);
    let rules;
    try {
      rules = text.trim() ? JSON.parse(text) : null;
    } catch (e) {
      setError(`Not valid JSON: ${e.message}`);
      return;
    }
    if (!rules) {
      try {
        await api.clearSchema(db, coll);
        setNotice('Validation cleared.');
        onSaved?.();
      } catch (e) {
        setError(e.message);
      }
      return;
    }
    setBusy(true);
    try {
      const res = await api.setSchema(db, coll, rules);
      setNotice(
        res.violations.length > 0
          ? `Rules saved — ${res.violations.length}+ existing document(s) violate them.`
          : 'Rules saved — all existing documents comply.'
      );
      setText(JSON.stringify(res.rules, null, 2));
      onSaved?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    try {
      await api.clearSchema(db, coll);
      setText('');
      setNotice('Validation cleared.');
      onSaved?.();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Modal
      title="Schema validation"
      subtitle={`${db} › ${coll} — enforced on every insert and update`}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={clear}>Clear rules</Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            <Shield size={13} /> {busy ? 'Validating…' : 'Save rules'}
          </Button>
        </>
      }
    >
      {error && <div className="mb-3"><Banner onClose={() => setError(null)}>{error}</Banner></div>}
      {notice && <div className="mb-3"><Banner kind="ok" onClose={() => setNotice(null)}>{notice}</Banner></div>}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE}
        spellCheck={false}
        rows={12}
        className="w-full rounded-lg border border-ink-600 bg-ink-900 p-3 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand-500"
      />
      <p className="mt-2 text-[11px] text-slate-600">
        Types: string, number, boolean, object, array, null. Dot-notation fields are supported. Leave empty and save to clear.
      </p>
    </Modal>
  );
}
