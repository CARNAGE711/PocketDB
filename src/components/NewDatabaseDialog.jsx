/**
 * NewDatabaseDialog — the "create database" sheet.
 *
 * Keeps every option from before (name, color tag, favorite pin, sample
 * seed, "Create & New" for making several in a row) but presented with
 * PocketDB's own styling: color swatches, switch toggles, live path preview.
 */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Button, COLOR_OPTIONS, Modal, Switch } from './ui.jsx';

const NAME_PATTERN = /^[\w-]{1,64}$/;

export default function NewDatabaseDialog({ dataDir, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(null);
  const [favorite, setFavorite] = useState(false);
  const [seed, setSeed] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [busy, setBusy] = useState(false);

  const create = async (keepOpen) => {
    setError(null);
    setOk(null);
    const trimmed = name.trim();
    if (!NAME_PATTERN.test(trimmed)) {
      setError('Database names use 1-64 characters: letters, digits, underscore or hyphen.');
      return;
    }
    setBusy(true);
    try {
      await api.createDatabase(trimmed, { color, favorite, seed });
      onCreated(trimmed, keepOpen); // refreshes the hub + selects the new db
      if (keepOpen) {
        setName('');
        setOk(`Database "${trimmed}" created. You can create another.`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const folderPath = `${String(dataDir || '').replace(/[\\/]+$/, '')}\\${name.trim() || '<name>'}`;

  return (
    <Modal
      title="New database"
      subtitle="A database is a folder inside the connected data directory"
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="subtle" onClick={() => create(true)} disabled={busy || !name.trim()}>
            Create &amp; New
          </Button>
          <Button variant="primary" onClick={() => create(false)} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      {error && <div className="mb-3"><Banner onClose={() => setError(null)}>{error}</Banner></div>}
      {ok && <div className="mb-3"><Banner kind="ok" onClose={() => setOk(null)}>{ok}</Banner></div>}

      {/* name */}
      <label className="text-sm font-semibold text-slate-200">Name</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && name.trim() && create(false)}
        placeholder="my-database"
        className="mt-1.5 w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500"
      />
      <p className="mt-1.5 break-all font-mono text-[11px] text-slate-600" title={folderPath}>
        {folderPath}
      </p>

      {/* color swatches */}
      <div className="mt-4">
        <label className="text-sm font-semibold text-slate-200">Color tag</label>
        <div className="mt-2 flex items-center gap-2">
          {COLOR_OPTIONS.map((c) => (
            <button
              key={c.label}
              onClick={() => setColor(c.value)}
              title={c.label}
              aria-label={c.label}
              className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
                color === c.value ? 'ring-2 ring-brand-400 ring-offset-2 ring-offset-ink-850' : ''
              }`}
              style={
                c.value
                  ? { backgroundColor: c.value }
                  : { border: '1px dashed #475569', backgroundColor: 'transparent' }
              }
            />
          ))}
        </div>
      </div>

      {/* favorite */}
      <div className="mt-4 flex items-center justify-between rounded-md border border-ink-700 bg-ink-900 px-3 py-2.5">
        <div>
          <p className="text-sm font-semibold text-slate-200">Favorite</p>
          <p className="mt-0.5 text-xs text-slate-600">Pins the database with a star in the switcher</p>
        </div>
        <Switch on={favorite} onToggle={() => setFavorite((v) => !v)} />
      </div>

      {/* seed sample */}
      <div className="mt-3 flex items-center justify-between rounded-md border border-ink-700 bg-ink-900 px-3 py-2.5">
        <div>
          <p className="text-sm font-semibold text-slate-200">Seed sample collection</p>
          <p className="mt-0.5 text-xs text-slate-600">Creates "sample-users" with starter documents</p>
        </div>
        <Switch on={seed} onToggle={() => setSeed((v) => !v)} />
      </div>
    </Modal>
  );
}
