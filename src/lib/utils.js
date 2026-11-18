/** Small shared helpers for the studio UI. */

/** Parse JSON text, returning a discriminated result instead of throwing. */
export function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Pretty-print an object as indented JSON. */
export function stringify(value) {
  return JSON.stringify(value, null, 2);
}

/** Compact one-line preview of an arbitrary value for table cells. */
export function previewValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  const json = JSON.stringify(value);
  return json?.length > 60 ? json.slice(0, 57) + '…' : json;
}

/** Tailwind text color class per JSON value type (used by tree + grid). */
export function valueTypeClass(value) {
  if (value === null || value === undefined) return 'text-slate-500 italic';
  switch (typeof value) {
    case 'string': return 'text-emerald-300';
    case 'number': return 'text-sky-300';
    case 'boolean': return 'text-amber-300';
    default: return 'text-slate-300';
  }
}

/** Human-readable file size. */
export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** pocketdb:// URI <-> local path helpers (mirrors electron/db/uri.cjs). */
export function pathToPocketUri(dir) {
  return 'pocketdb:///' + String(dir).replace(/\\/g, '/').replace(/^\//, '');
}

export function pocketUriToPath(uri) {
  let s = String(uri || '').trim().replace(/^pocketdb:\/\//i, '');
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw text */
  }
  s = s.replace(/\/+$/, '');
  if (/^\/[A-Za-z]:/.test(s)) s = s.slice(1); // drop URI-authority slash on Windows drives
  return s;
}
