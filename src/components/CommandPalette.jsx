/**
 * CommandPalette — the Ctrl+K quick launcher.
 *
 * One omnibar to jump to any database/collection or run workspace
 * actions. Arrow keys + Enter from the keyboard, mouse works too.
 * Items are provided by the app shell so they stay context-aware.
 */
import { Command, SearchX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Kbd } from './ui.jsx';

export default function CommandPalette({ open, onClose, items }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => `${it.label} ${it.group}`.toLowerCase().includes(needle));
  }, [items, q]);

  useEffect(() => {
    if (!open) return undefined;
    setQ('');
    setIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // Keep the highlight inside bounds when the list shrinks.
  const safeIdx = Math.min(idx, Math.max(0, filtered.length - 1));

  if (!open) return null;

  const run = (item) => {
    onClose();
    item.run();
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[safeIdx];
      if (item) run(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 p-6" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="mx-auto mt-[10vh] w-full max-w-xl overflow-hidden rounded-xl border border-ink-600 bg-ink-850 shadow-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-ink-700 px-4 py-3">
          <Command size={15} className="shrink-0 text-brand-300" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={onKey}
            placeholder="Type a command or search…"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onMouseEnter={() => setIdx(i)}
                onClick={() => run(item)}
                className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm ${
                  i === safeIdx ? 'bg-ink-800 text-slate-100' : 'text-slate-300'
                }`}
              >
                {Icon && <Icon size={14} className={i === safeIdx ? 'shrink-0 text-brand-300' : 'shrink-0 text-slate-500'} />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-slate-600">
                  {item.group}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-slate-600">
              <SearchX size={20} className="mx-auto mb-2 text-slate-700" />
              No matching commands.
            </p>
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-ink-700 px-4 py-2 text-[10px] text-slate-600">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> run</span>
        </div>
      </div>
    </div>
  );
}
