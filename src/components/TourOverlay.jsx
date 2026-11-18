/**
 * TourOverlay — first-launch walkthrough: a few focused cards that
 * introduce the hub layout, the console, and the power features. Shown
 * once (localStorage flag), restartable from the palette.
 */
import { ArrowRight, Database, Filter, Image as ImageIcon, Server, Sparkles, Workflow } from 'lucide-react';
import { useState } from 'react';
import { Kbd } from './ui.jsx';

const STEPS = [
  {
    icon: Database,
    title: 'One dashboard per database',
    body: 'Pick a database from the top switcher. Every database opens as a dashboard: stat tiles, collection cards, the files vault and snapshots.',
  },
  {
    icon: Filter,
    title: 'The filter console lives at the bottom',
    body: 'Inside a collection, expand the strip at the bottom to write JSON filters (or use the Builder chips). Documents page through — 25 to 250 at a time.',
  },
  {
    icon: Workflow,
    title: 'Pipeline studio + charts',
    body: 'Chain $match → $group → $sort stages on a rail, then press “Chart results” to plot bars or a donut of the output.',
  },
  {
    icon: ImageIcon,
    title: 'Binary files, indexes, history',
    body: 'Drop images into the Files vault. Create sidecar indexes for fast lookups. Every edit is logged — restore any revision from a document’s history.',
  },
  {
    icon: Server,
    title: 'Server mode bridges your apps',
    body: 'The status strip can expose this data directory as a localhost REST API (with SSE change feeds) for your web apps and scripts.',
  },
  {
    icon: Sparkles,
    title: 'You are one keystroke away',
    body: (
      <>
        Press <Kbd>Ctrl+K</Kbd> for the command palette and <Kbd>Ctrl+/</Kbd> for the in-app docs. Happy querying!
      </>
    ),
  },
];

export default function TourOverlay({ onClose }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const Icon = step.icon;
  const last = i === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-md rounded-xl border border-ink-600 bg-ink-850 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-ink-700 px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-ink-950">
            <Icon size={17} />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-100">{step.title}</h2>
            <p className="font-mono text-[10px] text-slate-600">step {i + 1} / {STEPS.length}</p>
          </div>
        </div>
        <div className="px-5 py-4 text-sm leading-relaxed text-slate-300">{step.body}</div>
        <div className="flex items-center justify-between border-t border-ink-700 px-5 py-3">
          <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">
            Skip tour
          </button>
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, j) => (
              <span key={j} className={`h-1.5 w-1.5 rounded-full ${j <= i ? 'bg-brand-500' : 'bg-ink-600'}`} />
            ))}
            <button
              onClick={() => (last ? onClose() : setI(i + 1))}
              className="ml-2 flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-ink-950 hover:bg-brand-500"
            >
              {last ? 'Done' : 'Next'} {!last && <ArrowRight size={12} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
