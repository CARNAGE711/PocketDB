/** Small reusable UI primitives: buttons, modal shell, prompts and confirm. */
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const VARIANTS = {
  primary: 'bg-brand-600 hover:bg-brand-500 text-ink-950 font-medium',
  danger: 'bg-rose-600 hover:bg-rose-500 text-white font-medium',
  ghost: 'bg-transparent hover:bg-ink-700 text-slate-300',
  subtle: 'bg-ink-700 hover:bg-ink-600 text-slate-200',
};

export function Button({ variant = 'subtle', className = '', ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function IconButton({ className = '', ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-ink-700 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent ${className}`}
    />
  );
}

/* --------------------- color tags (Compass-style) --------------------- */

export const COLOR_OPTIONS = [
  { label: 'No Color', value: null },
  { label: 'Green', value: '#22c55e' },
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Red', value: '#ef4444' },
  { label: 'Orange', value: '#f97316' },
];

/** Small round tag dot; a dashed outline when no color is chosen. */
export function ColorDot({ value, className = '' }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${className}`}
      style={{
        backgroundColor: value || 'transparent',
        border: value ? 'none' : '1px dashed #475569',
      }}
    />
  );
}

/** Dropdown selector for a color tag (used for connections and databases). */
export function ColorSelect({ value, onChange, light = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const current = COLOR_OPTIONS.find((c) => c.value === value) || COLOR_OPTIONS[0];

  const buttonCls = light
    ? 'flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-[#1c2b33]'
    : 'flex w-full items-center justify-between rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-300 hover:border-ink-600';
  const menuCls = light
    ? 'absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white py-1 shadow-lg'
    : 'absolute z-20 mt-1 w-full rounded-md border border-ink-600 bg-ink-850 py-1 shadow-xl';
  const itemCls = (selected) =>
    light
      ? `flex w-full items-center gap-2 px-3 py-1.5 text-sm ${
          selected ? 'text-emerald-700' : 'text-[#1c2b33]'
        } hover:bg-slate-100`
      : `flex w-full items-center gap-2 px-3 py-1.5 text-sm ${
          selected ? 'text-brand-300' : 'text-slate-300'
        } hover:bg-ink-700`;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className={buttonCls}>
        <span className="flex items-center gap-2">
          <ColorDot value={value} />
          {current.label}
        </span>
        <ChevronDown size={14} className="text-slate-400" />
      </button>
      {open && (
        <div className={menuCls}>
          {COLOR_OPTIONS.map((c) => (
            <button
              key={c.label}
              onClick={() => {
                onChange(c.value);
                setOpen(false);
              }}
              className={itemCls(c.value === value)}
            >
              <ColorDot value={c.value} /> {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Centered modal shell with a dim backdrop. Renders children directly. */
export function Modal({ title, subtitle, onClose, children, footer, width = 'max-w-2xl' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
      <div
        className={`flex w-full ${width} max-h-[85vh] flex-col rounded-xl border border-ink-600 bg-ink-850 shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-ink-700 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <IconButton onClick={onClose} aria-label="Close">
            <X size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-ink-700 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Modal that asks for a short text value (used to create db / collection). */
export function PromptDialog({ title, subtitle, placeholder, validate, onCancel, onSubmit }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);

  const submit = () => {
    const err = validate?.(value.trim());
    if (err) return setError(err);
    onSubmit(value.trim());
  };

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onCancel}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!value.trim()}>Create</Button>
        </>
      }
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder={placeholder}
        className="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500"
      />
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
      <p className="mt-2 text-xs text-slate-500">Allowed: letters, digits, underscore, hyphen (1–64 chars).</p>
    </Modal>
  );
}

/** Modal asking the user to confirm a destructive action. */
export function ConfirmDialog({ title, message, confirmLabel = 'Delete', onCancel, onConfirm }) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-sm text-slate-300">{message}</p>
    </Modal>
  );
}

/** Inline banner for engine errors / success notices. */
export function Banner({ kind = 'error', tone = 'dark', children, onClose }) {
  const styles =
    tone === 'light'
      ? kind === 'error'
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : kind === 'error'
        ? 'border-rose-800 bg-rose-950/60 text-rose-300'
        : 'border-emerald-800 bg-emerald-950/60 text-emerald-300';
  return (
    <div className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-xs ${styles}`}>
      <div className="min-w-0 break-words">{children}</div>
      {onClose && (
        <button onClick={onClose} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** Small keyboard-hint chip. */
export function Kbd({ children }) {
  return (
    <kbd className="rounded border border-ink-600 bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
      {children}
    </kbd>
  );
}

/** Toggle switch (dark studio styling). */
export function Switch({ on, onToggle, label }) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-brand-600' : 'bg-ink-600'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
          on ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

/** Segmented control for small option sets (view switchers). */
export function Segmented({ options, value, onChange, size = 'md' }) {
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';
  return (
    <div className="flex gap-1 rounded-lg bg-ink-850 p-1">
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            title={o.title || o.label}
            className={`flex items-center gap-1.5 rounded-md ${pad} transition-colors ${
              value === o.id ? 'bg-ink-600 text-slate-100' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {Icon && <Icon size={13} />} {o.label}
          </button>
        );
      })}
    </div>
  );
}
