/**
 * PocketDB — Query & Filtering Engine.
 *
 * Pure functions (no I/O) implementing:
 *  - dot-notation path resolution ("profile.address.city", "tags.0")
 *  - a selector matcher supporting $eq, $ne, $gt, $gte, $lt, $lte,
 *    $in, $nin, $regex (+$options), $exists, $text, and top-level
 *    $and/$or/$not
 *  - sort comparators, projections, and an aggregation pipeline runner
 *    supporting $match, $sort, $limit, $skip, $project, $count, $unwind,
 *    $group, $lookup, $replaceRoot.
 *
 * Semantics loosely follow MongoDB: a query on an array field matches if
 * ANY element satisfies the condition; comparisons only succeed between
 * comparable types (numbers with numbers, strings with strings, ...).
 */
'use strict';

/* ------------------------------------------------------------------ */
/* Deep equality                                                       */
/* ------------------------------------------------------------------ */

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false; // primitives that aren't ===
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/* ------------------------------------------------------------------ */
/* Dot-notation path resolution                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolve a dotted path against a document.
 * Examples: "name", "profile.age", "tags.0", "items.1.qty"
 * Walking into an array with a non-numeric segment maps the remaining
 * lookup over every element (Mongo-style behavior).
 */
function getPath(doc, dottedPath) {
  const parts = String(dottedPath).split('.');
  let cur = doc;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      if (/^\d+$/.test(part)) {
        cur = cur[Number(part)];
      } else {
        // Map the rest of the path over array elements.
        return cur
          .filter((el) => el != null && typeof el === 'object')
          .map((el) => getPath(el, parts.slice(parts.indexOf(part)).join('.')))
          .flat();
      }
    } else {
      cur = cur[part];
    }
  }
  return cur;
}

/** Immutable set of a dotted path (used by projections). Handles arrays. */
function setPath(obj, parts, value) {
  const head = parts[0];
  if (parts.length === 1) {
    obj[head] = value;
    return obj;
  }
  const rest = parts.slice(1);
  const next = obj[head];
  if (Array.isArray(next)) {
    // A numeric segment indexes the array; anything else projects the
    // remaining path into every element (Mongo-style $set semantics).
    if (/^\d+$/.test(rest[0])) {
      setPath(next, rest, value);
      return obj;
    }
    next.forEach((el, i) => {
      if (el == null || typeof el !== 'object') next[i] = {};
      setPath(next[i], rest, value);
    });
    return obj;
  }
  if (next == null || typeof next !== 'object') {
    obj[head] = /^\d+$/.test(rest[0]) ? [] : {};
  }
  setPath(obj[head], rest, value);
  return obj;
}

/** Immutable unset of a dotted path (used by exclusion projections / $unset). */
function unsetPath(obj, parts) {
  const head = parts[0];
  if (obj == null || typeof obj !== 'object') return;
  if (parts.length === 1) {
    if (Array.isArray(obj)) {
      const idx = /^\d+$/.test(head) ? Number(head) : null;
      if (idx !== null) obj.splice(idx, 1);
      return;
    }
    delete obj[head];
    return;
  }
  const next = obj[head];
  if (Array.isArray(next)) {
    // A numeric segment targets the array itself (splice an element);
    // otherwise project the unset into every object element.
    if (/^\d+$/.test(parts[1])) {
      unsetPath(next, parts.slice(1));
      return;
    }
    next.forEach((el) => {
      if (el != null && typeof el === 'object') unsetPath(el, parts.slice(1));
    });
  } else if (next != null && typeof next === 'object') {
    unsetPath(next, parts.slice(1));
  }
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

/**
 * Compare two values of the SAME type. Returns -1 | 0 | 1,
 * or null when the types are not comparable (MongoDB would not match).
 */
function cmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number' && !Number.isNaN(a) && !Number.isNaN(b)) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? 1 : -1;
  }
  return null;
}

/** Type rank used as a deterministic fallback in sorts. */
function typeRank(v) {
  if (v === undefined) return 0;
  if (v === null) return 1;
  if (typeof v === 'boolean') return 3;
  if (typeof v === 'number') return 2;
  if (typeof v === 'string') return 4;
  if (Array.isArray(v)) return 6;
  return 5; // plain objects
}

function fallbackCmp(a, b) {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  const s = JSON.stringify(a) || '';
  const t = JSON.stringify(b) || '';
  return s < t ? -1 : s > t ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* Full-text ($text)                                                   */
/* ------------------------------------------------------------------ */

/** Collect lowercased word tokens from every string leaf of a document. */
function docTokens(doc, out = new Set()) {
  if (typeof doc === 'string') {
    for (const tok of doc.toLowerCase().split(/[^a-z0-9_]+/)) {
      if (tok) out.add(tok);
    }
  } else if (Array.isArray(doc)) {
    doc.forEach((el) => docTokens(el, out));
  } else if (doc && typeof doc === 'object') {
    Object.values(doc).forEach((v) => docTokens(v, out));
  }
  return out;
}

/**
 * $text: { $search: "term term2" } — OR of space-separated terms,
 * matched as prefixes against document tokens (Mongo-style stemming
 * approximated by prefix matching). Root-level operator.
 */
function textMatches(doc, cond) {
  const search = cond && typeof cond === 'object' ? cond.$search : cond;
  if (typeof search !== 'string' || !search.trim()) return false;
  const tokens = docTokens(doc);
  return search
    .toLowerCase()
    .split(/\s+/)
    .some((term) => [...tokens].some((tok) => tok.startsWith(term)));
}

/* ------------------------------------------------------------------ */
/* Selector matcher                                                    */
/* ------------------------------------------------------------------ */

const FIELD_OPERATORS = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
  '$in', '$nin', '$regex', '$options', '$exists',
]);

/** Is `cond` an operator object like { "$gte": 18 } ? */
function isOperatorObject(cond) {
  return (
    cond !== null &&
    typeof cond === 'object' &&
    !Array.isArray(cond) &&
    Object.keys(cond).length > 0 &&
    Object.keys(cond).every((k) => k.startsWith('$'))
  );
}

/**
 * Evaluate one field condition against a list of candidate values.
 * Candidates include the raw value plus (for arrays) each element, so
 * Mongo-like "matches any element" behavior falls out naturally.
 */
function matchCandidates(candidates, cond) {
  if (isOperatorObject(cond)) {
    const ops = Object.entries(cond).filter(([op]) => op !== '$options');
    return candidates.some((v) => ops.every(([op, arg]) => applyOperator(v, op, arg, cond)));
  }
  // Literal equality: raw value OR any array element matches.
  return candidates.some((v) => deepEqual(v, cond));
}

function applyOperator(value, op, arg, cond) {
  switch (op) {
    case '$eq': return deepEqual(value, arg);
    case '$ne': return !deepEqual(value, arg);
    case '$gt':
    case '$gte':
    case '$lt':
    case '$lte': {
      const c = cmp(value, arg);
      if (c === null) return false;
      if (op === '$gt') return c > 0;
      if (op === '$gte') return c >= 0;
      if (op === '$lt') return c < 0;
      return c <= 0; // $lte
    }
    case '$in':
      return Array.isArray(arg) && arg.some((x) => deepEqual(value, x));
    case '$nin':
      return Array.isArray(arg) && !arg.some((x) => deepEqual(value, x));
    case '$regex': {
      if (typeof value !== 'string' || typeof arg !== 'string') return false;
      try {
        return new RegExp(arg, cond.$options || '').test(value);
      } catch {
        return false; // invalid regex never matches (error surfaces at parse time in UI)
      }
    }
    case '$exists':
      return arg ? value !== undefined : value === undefined;
    default:
      return false;
  }
}

/**
 * Expand a raw value into the candidate list used by matchCandidates:
 * [raw, ...one level of array elements]. Literal array conditions still
 * match the raw value, while scalar conditions can match elements.
 */
function candidatesFor(raw) {
  const candidates = [raw];
  if (Array.isArray(raw)) {
    for (const el of raw) {
      candidates.push(el);
      if (Array.isArray(el)) candidates.push(...el); // handle mapped nested results
    }
  }
  return candidates;
}

/** Test a single document against a full selector object. */
function matches(doc, selector) {
  if (selector == null || typeof selector !== 'object') return true;
  return Object.entries(selector).every(([key, cond]) => {
    if (key === '$and' && Array.isArray(cond)) return cond.every((s) => matches(doc, s));
    if (key === '$or' && Array.isArray(cond)) return cond.some((s) => matches(doc, s));
    if (key === '$not') return !matches(doc, cond);
    if (key === '$text') return textMatches(doc, cond);
    if (key.startsWith('$')) return false; // unknown top-level op -> no match
    return matchCandidates(candidatesFor(getPath(doc, key)), cond);
  });
}

/* ------------------------------------------------------------------ */
/* Sorting & projections                                               */
/* ------------------------------------------------------------------ */

/** Build a comparator from a { path: 1 | -1 } sort spec (dot-notation aware). */
function makeComparator(spec) {
  const keys = Object.entries(spec || {});
  if (keys.length === 0) return () => 0;
  return (a, b) => {
    for (const [path, dir] of keys) {
      const av = getPath(a, path);
      const bv = getPath(b, path);
      const raw = cmp(av, bv);
      const c = raw === null ? fallbackCmp(av, bv) : raw;
      if (c !== 0) return dir === -1 ? -c : c;
    }
    return 0;
  };
}

/**
 * Apply a projection spec.
 *  - Inclusion ({ "name": 1, "profile.age": 1, "_id": 0 }) -> only those paths.
 *  - Exclusion ({ "internal": 0 }) -> everything except those paths.
 */
function projectDoc(doc, spec) {
  if (!spec || typeof spec !== 'object' || Object.keys(spec).length === 0) return doc;
  const entries = Object.entries(spec);
  const isInclusion = entries.some(([, v]) => v === 1 || (v && typeof v === 'object'));

  if (isInclusion) {
    const out = {};
    // _id is included by default unless explicitly disabled.
    if (spec._id !== 0 && doc._id !== undefined) out._id = doc._id;
    for (const [path, flag] of entries) {
      if (!flag || path === '_id') continue;
      const val = getPath(doc, path);
      if (val === undefined) continue;
      setPath(out, path.split('.'), Array.isArray(val) ? [...val] : val);
    }
    return out;
  }

  // Exclusion projection: clone then strip.
  const out = JSON.parse(JSON.stringify(doc));
  for (const [path, flag] of entries) {
    if (flag === 0) unsetPath(out, path.split('.'));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Aggregation pipeline                                                */
/* ------------------------------------------------------------------ */

/* --------------------------- $group ------------------------------- */

/** Resolve the group key: "$field.path" reference, literal, or null. */
function groupKeyOf(doc, spec) {
  if (spec === null || spec === undefined) return null;
  if (typeof spec === 'string' && spec.startsWith('$')) {
    return getPath(doc, spec.slice(1));
  }
  return spec; // literal constant per document
}

/** Evaluate one accumulator spec ({ "$sum": "$field" } etc.) over a group. */
function evalAccumulator(field, acc, groupDocs, stageNo) {
  if (acc === null || typeof acc !== 'object' || Array.isArray(acc) || Object.keys(acc).length !== 1) {
    throw new Error(
      `Stage ${stageNo}: $group field "${field}" expects an accumulator object like { "$sum": "$price" }.`
    );
  }
  const [op, arg] = Object.entries(acc)[0];
  const isFieldRef = typeof arg === 'string' && arg.startsWith('$');
  const values = isFieldRef
    ? groupDocs.map((d) => getPath(d, arg.slice(1))).filter((v) => v !== undefined)
    : groupDocs.map(() => arg);

  switch (op) {
    case '$sum': {
      if (isFieldRef) return values.filter((v) => typeof v === 'number').reduce((s, v) => s + v, 0);
      if (typeof arg === 'number') return values.length * arg;
      return values.reduce((s, v) => (typeof v === 'number' ? s + v : s), 0);
    }
    case '$avg': {
      const nums = values.filter((v) => typeof v === 'number');
      return nums.length === 0 ? null : nums.reduce((s, v) => s + v, 0) / nums.length;
    }
    case '$min':
    case '$max': {
      if (values.length === 0) return null;
      let best = values[0];
      for (const v of values.slice(1)) {
        const c = cmp(v, best);
        const rank = c === null ? fallbackCmp(v, best) : c;
        if (op === '$min' ? rank < 0 : rank > 0) best = v;
      }
      return best;
    }
    case '$count':
      return groupDocs.length;
    case '$first':
      return values[0];
    case '$last':
      return values[values.length - 1];
    case '$push':
      return values.map((v) => JSON.parse(JSON.stringify(v)));
    case '$addToSet': {
      const set = [];
      for (const v of values) {
        if (!set.some((x) => deepEqual(x, v))) set.push(JSON.parse(JSON.stringify(v)));
      }
      return set;
    }
    default:
      throw new Error(
        `Stage ${stageNo}: unsupported accumulator "${op}". Supported: $sum, $avg, $min, $max, $count, $first, $last, $push, $addToSet.`
      );
  }
}

function stageGroup(docs, spec, stageNo) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(`Stage ${stageNo}: $group expects an object like { "_id": "$field", "total": { "$sum": 1 } }.`);
  }
  const groups = new Map();
  for (const d of docs) {
    const key = groupKeyOf(d, spec._id);
    const k = JSON.stringify(key);
    if (!groups.has(k)) groups.set(k, { key, docs: [] });
    groups.get(k).docs.push(d);
  }
  const accumFields = Object.entries(spec).filter(([f]) => f !== '_id');
  return [...groups.values()].map(({ key, docs: groupDocs }) => {
    const out = { _id: key };
    for (const [field, acc] of accumFields) {
      out[field] = evalAccumulator(field, acc, groupDocs, stageNo);
    }
    return out;
  });
}

/* --------------------------- $lookup ------------------------------ */

function stageLookup(docs, spec, stageNo, opts) {
  const { from, localField, foreignField, as } = spec || {};
  if (typeof from !== 'string' || !from || typeof localField !== 'string' ||
      typeof foreignField !== 'string' || typeof as !== 'string') {
    throw new Error(`Stage ${stageNo}: $lookup expects { from, localField, foreignField, as }.`);
  }
  if (typeof opts.loadColl !== 'function') {
    throw new Error(`Stage ${stageNo}: $lookup cannot read "${from}" — no collection loader available in this context.`);
  }
  const foreign = opts.loadColl(from);
  return docs.map((d) => {
    const local = getPath(d, localField);
    const joined = foreign.filter((f) => deepEqual(getPath(f, foreignField), local));
    const copy = JSON.parse(JSON.stringify(d));
    setPath(copy, as.split('.'), joined);
    return copy;
  });
}

/* ------------------------- $replaceRoot --------------------------- */

function stageReplaceRoot(docs, spec, stageNo) {
  const newRoot = spec && (spec.newRoot ?? spec.field);
  if (typeof newRoot !== 'string' || !newRoot) {
    throw new Error(`Stage ${stageNo}: $replaceRoot expects { "newRoot": "$field" }.`);
  }
  const path = newRoot.replace(/^\$/, '');
  return docs.map((d) => {
    const val = getPath(d, path);
    if (val === null || typeof val !== 'object' || Array.isArray(val)) {
      throw new Error(
        `Stage ${stageNo}: $replaceRoot field "${newRoot}" must resolve to an object on every document (got ${val === undefined ? 'missing' : Array.isArray(val) ? 'array' : typeof val}).`
      );
    }
    return JSON.parse(JSON.stringify(val));
  });
}

/**
 * Run a pipeline (array of stage objects) over a set of documents.
 * Supported stages: $match, $sort, $limit, $skip, $project, $count,
 * $unwind, $group, $lookup, $replaceRoot.
 * opts: { loadColl(name) } — needed for $lookup.
 * Throws a descriptive Error for malformed pipelines (surfaced in the UI).
 */
function aggregate(documents, pipeline, opts = {}) {
  if (!Array.isArray(pipeline)) throw new Error('Pipeline must be an array of stages.');
  let docs = documents;

  for (let i = 0; i < pipeline.length; i++) {
    const stage = pipeline[i];
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
      throw new Error(`Stage ${i}: each stage must be an object like { "$match": {...} }.`);
    }
    const [op, spec] = Object.entries(stage)[0];

    switch (op) {
      case '$match': {
        if (typeof spec !== 'object' || spec === null) throw new Error(`Stage ${i}: $match expects a selector object.`);
        docs = docs.filter((d) => matches(d, spec));
        break;
      }
      case '$sort': {
        docs = [...docs].sort(makeComparator(spec));
        break;
      }
      case '$limit': {
        const n = Number(spec);
        if (!Number.isInteger(n) || n < 0) throw new Error(`Stage ${i}: $limit expects a non-negative integer.`);
        docs = docs.slice(0, n);
        break;
      }
      case '$skip': {
        const n = Number(spec);
        if (!Number.isInteger(n) || n < 0) throw new Error(`Stage ${i}: $skip expects a non-negative integer.`);
        docs = docs.slice(n);
        break;
      }
      case '$project': {
        docs = docs.map((d) => projectDoc(d, spec));
        break;
      }
      case '$count': {
        if (typeof spec !== 'string' || !spec) throw new Error(`Stage ${i}: $count expects a field name string.`);
        docs = [{ [spec]: docs.length }];
        break;
      }
      case '$unwind': {
        const path = typeof spec === 'string' ? spec : spec && spec.path;
        if (typeof path !== 'string' || !path) throw new Error(`Stage ${i}: $unwind expects a path string.`);
        const field = path.replace(/^\$/, '');
        const out = [];
        for (const d of docs) {
          const val = getPath(d, field);
          if (Array.isArray(val)) {
            for (const el of val) {
              const copy = JSON.parse(JSON.stringify(d));
              setPath(copy, field.split('.'), el);
              out.push(copy);
            }
          } else if (val !== undefined) {
            out.push(d);
          }
        }
        docs = out;
        break;
      }
      case '$group': {
        docs = stageGroup(docs, spec, i);
        break;
      }
      case '$lookup': {
        docs = stageLookup(docs, spec, i, opts);
        break;
      }
      case '$replaceRoot': {
        docs = stageReplaceRoot(docs, spec, i);
        break;
      }
      default:
        throw new Error(
          `Stage ${i}: unsupported stage "${op}". Supported: $match, $sort, $limit, $skip, $project, $count, $unwind, $group, $lookup, $replaceRoot.`
        );
    }
  }
  return docs;
}

module.exports = {
  matches,
  getPath,
  setPath,
  unsetPath,
  projectDoc,
  makeComparator,
  aggregate,
  deepEqual,
  cmp,
  fallbackCmp,
};
