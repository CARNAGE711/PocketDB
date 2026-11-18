/**
 * Launchpad — PocketDB's entry screen (replaces the connection screen).
 *
 * Console-style centered launcher, no sidebar and no tabs:
 *   - brand block + tagline
 *   - inline quick-connect strip (URI or Browse, one keystroke away)
 *   - saved connections as a card grid (click = connect, hover = actions)
 *   - new/edit connection opens as a full-form sheet
 */
import {
  FolderOpen, Pencil, Play, Plus, Star, Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { pathToPocketUri, pocketUriToPath } from '../lib/utils.js';
import { Banner, Button, ColorSelect, Modal, Switch } from './ui.jsx';
import logoUrl from '../assets/logo.png';

const EXAMPLE_URI = 'pocketdb:///C:/Users/me/pocketdb-data';

export default function Launchpad({ initialUri, initialError, onConnected }) {
  const [saved, setSaved] = useState([]);
  const [search, setSearch] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  /* quick-connect strip */
  const [quickUri, setQuickUri] = useState(initialUri || '');

  /* form state */
  const [uri, setUri] = useState(initialUri || '');
  const [editUri, setEditUri] = useState(true);
  const [dir, setDir] = useState(() => pocketUriToPath(initialUri || ''));
  const [name, setName] = useState('');
  const [color, setColor] = useState(null);
  const [favorite, setFavorite] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [error, setError] = useState(initialError || null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listConnections().then(setSaved).catch(() => {});
  }, []);

  /* favorites first, then alphabetical */
  const sorted = useMemo(
    () =>
      [...saved].sort((a, b) => {
        const fa = a.favorite ? 0 : 1;
        const fb = b.favorite ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return a.name.localeCompare(b.name);
      }),
    [saved]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((c) => `${c.name} ${c.uri}`.toLowerCase().includes(q));
  }, [sorted, search]);

  /* --------------------------- actions --------------------------- */

  const connect = async (conn, { save = false } = {}) => {
    setError(null);
    if (!conn.uri) {
      setError('Enter a connection string, e.g. ' + EXAMPLE_URI);
      return;
    }
    setBusy(true);
    try {
      if (save) {
        await api.saveConnection(conn);
        setSaved(await api.listConnections());
      }
      const info = await api.connectEngine(conn.uri, passphrase.trim() || undefined);
      setPassphrase('');
      onConnected({ info, conn });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const connectDefault = () =>
    connect({
      name: 'Local data directory',
      color: null,
      favorite: false,
      uri: initialUri || '',
    });

  const browse = async (apply) => {
    const picked = await api.pickDirectory();
    if (!picked) return;
    apply(picked);
  };

  const openNew = () => {
    setEditingId(null);
    setUri('');
    setDir('');
    setName('');
    setColor(null);
    setFavorite(false);
    setPassphrase('');
    setShowAdvanced(false);
    setError(null);
    setSheetOpen(true);
  };

  const openEdit = (connection) => {
    setEditingId(connection.id);
    setUri(connection.uri);
    setDir(pocketUriToPath(connection.uri));
    setName(connection.name);
    setColor(connection.color || null);
    setFavorite(Boolean(connection.favorite));
    setPassphrase('');
    setShowAdvanced(false);
    setError(null);
    setSheetOpen(true);
  };

  const buildConnection = () => ({
    id: editingId || undefined,
    name: name.trim() || 'Local data directory',
    color,
    favorite,
    uri: uri.trim(),
  });

  const saveOnly = async () => {
    setError(null);
    try {
      await api.saveConnection(buildConnection());
      setSaved(await api.listConnections());
      setSheetOpen(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const forget = async (e, conn) => {
    e.stopPropagation();
    try {
      await api.deleteConnection(conn.id);
      setSaved(await api.listConnections());
    } catch (err) {
      setError(err.message);
    }
  };

  /* ------------------------------ render -------------------------- */

  return (
    <div className="h-full overflow-y-auto bg-ink-950">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10">
        {error && !sheetOpen && (
          <Banner onClose={() => setError(null)}>{error}</Banner>
        )}

        {/* brand */}
        <div className="flex flex-col items-center text-center">
          <img
            src={logoUrl}
            alt="PocketDB"
            className="h-24 w-24 object-contain"
            style={{ filter: 'drop-shadow(0 0 40px rgba(20, 184, 166, 0.25))' }}
          />
          <h1 className="mt-4 text-2xl font-semibold text-slate-100">PocketDB</h1>
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
            local document studio
          </p>
        </div>

        {/* quick-connect strip */}
        <div className="mt-9 rounded-lg border border-ink-700 bg-ink-900 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">quick connect</p>
          <div className="mt-2 flex gap-2">
            <input
              value={quickUri}
              onChange={(e) => setQuickUri(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && quickUri.trim() && connect({ name: 'Quick connect', color: null, favorite: false, uri: quickUri.trim() })}
              placeholder={EXAMPLE_URI}
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-ink-600 bg-ink-850 px-3 py-2 font-mono text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand-500"
            />
            <Button
              variant="subtle"
              onClick={() => browse((picked) => setQuickUri(pathToPocketUri(picked)))}
              title="Pick a data folder"
            >
              <FolderOpen size={14} />
            </Button>
            <Button
              variant="primary"
              disabled={busy || !quickUri.trim()}
              onClick={() => connect({ name: 'Quick connect', color: null, favorite: false, uri: quickUri.trim() })}
            >
              {busy ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-600">
            Point at any folder — a new data directory is created and seeded automatically.{' '}
            {initialUri && (
              <button onClick={connectDefault} disabled={busy} className="text-brand-300 hover:underline">
                Use the default directory
              </button>
            )}
          </p>
        </div>

        {/* saved connections */}
        <div className="mt-9 flex items-center justify-between gap-3">
          <h2 className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
            saved connections · {saved.length}
          </h2>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search…"
              className="w-32 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-brand-500"
            />
            <Button variant="subtle" onClick={openNew}>
              <Plus size={13} /> New connection
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="group relative rounded-lg border border-ink-700 bg-ink-900 p-4 pl-5 transition-colors hover:border-ink-600"
            >
              {/* color band */}
              <span
                className="absolute bottom-3 left-0 top-3 w-0.5 rounded-full"
                style={{ backgroundColor: c.color || 'transparent' }}
              />
              <button onClick={() => connect(c)} disabled={busy} className="block w-full text-left">
                <span className="flex items-center gap-2">
                  {c.favorite && <Star size={12} className="shrink-0 text-amber-400" />}
                  <span className="truncate text-sm font-medium text-slate-200">{c.name}</span>
                </span>
                <code className="mt-1.5 block truncate font-mono text-[11px] text-slate-600">{c.uri}</code>
              </button>
              <div className="mt-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => connect(c)}
                  disabled={busy}
                  title="Connect"
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-brand-300 hover:bg-ink-700 disabled:opacity-40"
                >
                  <Play size={11} /> Connect
                </button>
                <button
                  onClick={() => openEdit(c)}
                  title="Edit"
                  className="rounded p-1.5 text-slate-500 hover:bg-ink-700 hover:text-slate-200"
                  aria-label="Edit connection"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={(e) => forget(e, c)}
                  title="Forget"
                  className="rounded p-1.5 text-slate-500 hover:bg-ink-700 hover:text-rose-400"
                  aria-label="Forget connection"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <p className="mt-3 rounded-lg border border-dashed border-ink-700 p-6 text-center text-xs text-slate-600">
            {saved.length === 0
              ? 'No saved connections yet — quick-connect above, or create one.'
              : 'No connections match your search.'}
          </p>
        )}

        <div className="mt-auto pt-10 text-center font-mono text-[10px] text-slate-700">
          engine v1.2.0 · ndjson storage · fully offline
        </div>
      </div>

      {/* ------------------------ form sheet ------------------------ */}
      {sheetOpen && (
        <Modal
          title={editingId ? 'Edit connection' : 'New connection'}
          subtitle="Connections are local data directories"
          onClose={() => setSheetOpen(false)}
          width="max-w-2xl"
          footer={
            <>
              <Button variant="ghost" onClick={() => setSheetOpen(false)}>Cancel</Button>
              <Button variant="subtle" onClick={saveOnly} disabled={busy}>Save</Button>
              <Button
                variant="subtle"
                onClick={() => connect(buildConnection())}
                disabled={busy}
              >
                Connect
              </Button>
              <Button
                variant="primary"
                onClick={() => connect(buildConnection(), { save: true })}
                disabled={busy}
              >
                {busy ? 'Connecting…' : 'Save & Connect'}
              </Button>
            </>
          }
        >
          {error && (
            <div className="mb-3">
              <Banner onClose={() => setError(null)}>{error}</Banner>
            </div>
          )}

          {/* URI / directory */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-slate-200">URI</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Edit connection string</span>
              <Switch on={editUri} onToggle={() => setEditUri((v) => !v)} />
            </div>
          </div>

          {editUri ? (
            <textarea
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              spellCheck={false}
              className="mt-2 h-20 w-full resize-y rounded-md border border-ink-600 bg-ink-900 p-3 font-mono text-sm text-slate-100 outline-none focus:border-brand-500"
            />
          ) : (
            <div className="mt-2 flex gap-2">
              <input
                value={dir}
                onChange={(e) => { setDir(e.target.value); setUri(pathToPocketUri(e.target.value)); }}
                spellCheck={false}
                className="min-w-0 flex-1 rounded-md border border-ink-600 bg-ink-900 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-brand-500"
              />
              <Button variant="subtle" onClick={() => browse((picked) => { setDir(picked); setUri(pathToPocketUri(picked)); })}>
                <FolderOpen size={14} /> Browse
              </Button>
            </div>
          )}

          {/* name + color */}
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-slate-200">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Local data directory"
                className="mt-1.5 w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-slate-200">Color</label>
              <div className="mt-1.5">
                <ColorSelect value={color} onChange={setColor} />
              </div>
            </div>
          </div>

          {/* favorite */}
          <div className="mt-4 flex items-center justify-between rounded-md border border-ink-700 bg-ink-900 px-3 py-2.5">
            <div>
              <p className="text-sm font-semibold text-slate-200">Favorite this connection</p>
              <p className="mt-0.5 text-xs text-slate-600">Auto-connects on launch and pins to the top</p>
            </div>
            <Switch on={favorite} onToggle={() => setFavorite((v) => !v)} />
          </div>

          {/* advanced */}
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="mt-4 text-xs font-semibold text-slate-400 hover:text-slate-200"
          >
            {showAdvanced ? '▾' : '▸'} Advanced options
          </button>
          {showAdvanced && (
            <div className="mt-2 space-y-3 rounded-md border border-ink-700 bg-ink-900 p-3 text-xs text-slate-500">
              <div>
                <p>
                  Each database is a folder and each collection an{' '}
                  <span className="text-slate-300">NDJSON</span> file inside it. Connecting to a path
                  that does not exist yet creates it and seeds demo data.
                </p>
                <p className="mt-2 break-all font-mono text-[11px] text-brand-300">{uri || EXAMPLE_URI}</p>
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  encryption passphrase (optional)
                </label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="leave empty unless this data directory is encrypted"
                  autoComplete="off"
                  className="w-full rounded border border-ink-600 bg-ink-950 px-2.5 py-1.5 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand-500"
                />
                <p className="mt-1.5">
                  If the data directory was connected with a passphrase before, provide the same
                  one — every file on disk is AES-256-GCM encrypted and needs it to decrypt.
                </p>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
