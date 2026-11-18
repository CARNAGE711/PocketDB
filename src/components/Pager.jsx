/**
 * Pager — pagination strip for the collection surface.
 * Documents load in pages (server-side skip/limit) instead of one big dump.
 */
import { ChevronLeft, ChevronRight, ListFilter } from 'lucide-react';

export default function Pager({ page, pageSize, total, onPage, onPageSize }) {
  const pageCount = Math.max(1, Math.ceil((total || 0) / pageSize));
  const current = Math.min(page, pageCount - 1);
  const from = total === 0 ? 0 : current * pageSize + 1;
  const to = Math.min(total || 0, (current + 1) * pageSize);

  return (
    <div className="flex shrink-0 items-center justify-between border-t border-ink-700 bg-ink-900 px-4 py-1.5 font-mono text-[10px] text-slate-500">
      <span className="flex items-center gap-1.5">
        <ListFilter size={10} className="text-slate-600" />
        {total} matched{total > 0 && <> · showing {from}–{to}</>}
      </span>
      <div className="flex items-center gap-2">
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-[10px] text-slate-300 outline-none focus:border-brand-500"
          aria-label="Page size"
        >
          {[25, 50, 100, 250].map((n) => (
            <option key={n} value={n}>{n} / page</option>
          ))}
        </select>
        <button
          onClick={() => onPage(current - 1)}
          disabled={current === 0}
          title="Previous page"
          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 hover:bg-ink-700 hover:text-slate-300 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronLeft size={11} /> prev
        </button>
        <span className="text-slate-400">
          page {current + 1} / {pageCount}
        </span>
        <button
          onClick={() => onPage(current + 1)}
          disabled={current + 1 >= pageCount}
          title="Next page"
          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 hover:bg-ink-700 hover:text-slate-300 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          next <ChevronRight size={11} />
        </button>
      </div>
    </div>
  );
}
