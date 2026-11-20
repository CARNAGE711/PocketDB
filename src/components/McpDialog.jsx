/**
 * McpDialog — connect external AI clients to this data directory.
 *
 * PocketDB ships a standalone stdio MCP server (electron/mcp-server.cjs)
 * exposing the same engine API as tools. This dialog shows the exact command
 * and a ready-to-paste mcpServers config for Claude Desktop / Cursor.
 */
import { Check, Copy, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Banner, Button, Modal } from './ui.jsx';

function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard unavailable — the text stays selectable */
    }
  };
  return (
    <Button variant="subtle" className="!px-2 !py-1 !text-[10px]" onClick={copy}>
      {done ? <Check size={11} className="text-emerald-300" /> : <Copy size={11} />} {done ? 'Copied' : label}
    </Button>
  );
}

export default function McpDialog({ onClose }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.mcpInfo().then(setInfo).catch((e) => setError(e.message));
  }, []);

  const configText = info ? JSON.stringify(info.config, null, 2) : '';

  return (
    <Modal
      title="MCP server"
      subtitle="Let Claude Desktop, Cursor or any MCP client read and write this data directory"
      onClose={onClose}
      width="max-w-2xl"
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      {error && <div className="mb-3"><Banner onClose={() => setError(null)}>{error}</Banner></div>}

      {!info ? (
        <p className="py-8 text-center font-mono text-xs text-slate-500">loading MCP configuration…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-ink-700 bg-ink-900 p-3">
            <Terminal size={15} className="mt-0.5 shrink-0 text-brand-300" />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">run manually</p>
              <code className="mt-1 block break-all rounded bg-ink-950 px-2 py-1.5 font-mono text-[11px] text-slate-300">
                {info.command}
              </code>
              <p className="mt-1.5 text-[11px] text-slate-600">
                The server speaks JSON-RPC 2.0 over stdio. It needs Node.js on PATH and reads the same
                NDJSON files as the app — close writes are reflected live.
              </p>
            </div>
            <CopyButton text={info.command} />
          </div>

          <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                client config · mcpServers
              </p>
              <CopyButton text={configText} label="Copy JSON" />
            </div>
            <pre className="mt-2 max-h-52 overflow-auto rounded bg-ink-950 p-2.5 font-mono text-[11px] leading-relaxed text-slate-300">
              {configText}
            </pre>
          </div>

          <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">tools exposed</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {[
                'list_databases', 'list_collections', 'find', 'insert_one', 'insert_many',
                'update_many', 'delete_many', 'aggregate', 'create_index', 'list_indexes',
                'explain', 'analyze_schema', 'list_views', 'save_view', 'list_trash', 'restore_trash',
              ].map((t) => (
                <span key={t} className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                  {t}
                </span>
              ))}
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-600">
            Data directory: <span className="font-mono text-slate-400">{info.dataDir || '(not connected)'}</span>.
            The server is read/write; deletes are soft and restorable from the trash. Only point MCP clients
            you trust at a data directory — there is no authentication on stdio.
          </p>
        </div>
      )}
    </Modal>
  );
}
