/**
 * ServerDialog — start / stop the localhost HTTP bridge with settings:
 * port, optional shared-secret token (Authorization: Bearer / ?token=)
 * and the opt-in LAN bind (0.0.0.0).
 */
import { Globe, KeyRound, Loader2, Network, Play, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Modal, Switch } from './ui.jsx';

export default function ServerDialog({ serverInfo, onClose, onStarted, onStopped }) {
  const [port, setPort] = useState('7400');
  const [token, setToken] = useState('');
  const [lan, setLan] = useState(false);
  const [status, setStatus] = useState(serverInfo);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.serverStatus().then((s) => {
      setStatus(s.running ? s : null);
      if (s.running) setPort(String(s.port));
    }).catch(() => {});
  }, []);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const info = await api.serverStart({ port: Number(port) || 7400, token: token.trim() || null, lan });
      setStatus(info);
      onStarted?.(info);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.serverStop();
      setStatus(null);
      onStopped?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const running = Boolean(status?.running);

  return (
    <Modal
      title="HTTP bridge (server mode)"
      subtitle="Expose this data directory as a REST API for local apps & scripts"
      onClose={onClose}
      width="max-w-md"
    >
      {error && <div className="mb-3"><Banner onClose={() => setError(null)}>{error}</Banner></div>}

      {running ? (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-3 text-xs text-emerald-300">
          <p className="flex items-center gap-2 font-medium">
            <Network size={14} /> Running
          </p>
          <p className="mt-1 font-mono">
            http://{status.lan ? '<your-ip>' : '127.0.0.1'}:{status.port}/api/…
          </p>
          <p className="mt-1 text-[11px] opacity-80">
            {status.lan ? 'LAN mode — reachable from other devices.' : 'localhost only.'}
            {status.tokenProtected ? ' Token required.' : ' No token.'}
          </p>
        </div>
      ) : (
        <p className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-3 text-xs text-slate-400">
          <Network size={14} className="mr-1.5 inline text-slate-500" />
          Bridge is off. Start it to let web apps and scripts read/write this data directory.
        </p>
      )}

      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2">
          <label className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-wider text-slate-500">port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            disabled={running}
            className="w-28 rounded border border-ink-600 bg-ink-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-brand-500 disabled:opacity-40"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-wider text-slate-500">token</label>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={running}
            placeholder="(none — open to localhost)"
            className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand-500 disabled:opacity-40"
          />
          <KeyRound size={13} className="shrink-0 text-slate-600" />
        </div>
        <div className="flex items-center gap-2">
          <label className="flex w-24 shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
            <Globe size={12} /> LAN
          </label>
          <Switch on={lan} onToggle={() => setLan((v) => !v)} label="Bind 0.0.0.0 (reachable from other devices)" />
          <span className="text-[11px] text-slate-600">bind 0.0.0.0 (other devices can connect)</span>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2 border-t border-ink-700 pt-3">
        {running ? (
          <button
            onClick={stop}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Square size={13} />} Stop bridge
          </button>
        ) : (
          <button
            onClick={start}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-brand-500 disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={13} />} Start bridge
          </button>
        )}
      </div>
    </Modal>
  );
}
