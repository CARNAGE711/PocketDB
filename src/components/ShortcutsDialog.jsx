/**
 * ShortcutsDialog — quick reference for the console keyboard model.
 */
import { Modal, Kbd } from './ui.jsx';

const ROWS = [
  ['Ctrl+K', 'Open the command palette (jump anywhere, run actions)'],
  ['Ctrl+/', 'This shortcut reference'],
  ['Alt+1', 'Database dashboard'],
  ['Alt+2', 'Collection documents'],
  ['Alt+3', 'Pipeline studio'],
  ['Alt+4', 'Files vault'],
  ['Alt+5', 'Activity feed'],
  ['Alt+6', 'Trash — restore deleted documents'],
  ['Alt+7', 'Schema analyzer for the open collection'],
  ['Esc', 'Close dialogs and the palette'],
  ['↑ ↓ ↵', 'Navigate and run inside the palette'],
];

export default function ShortcutsDialog({ onClose }) {
  return (
    <Modal title="Keyboard shortcuts" subtitle="The console keyboard model" onClose={onClose} width="max-w-md">
      <div className="divide-y divide-ink-700">
        {ROWS.map(([keys, desc]) => (
          <div key={keys} className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-sm text-slate-300">{desc}</span>
            <span className="shrink-0"><Kbd>{keys}</Kbd></span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-600">
        JSON editors (Monaco) keep their own editing keys inside the editor surface.
      </p>
    </Modal>
  );
}
