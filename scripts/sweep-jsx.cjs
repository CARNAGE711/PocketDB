/**
 * Static sweep: find capitalized identifiers used in JSX or as icon props
 * that are neither imported nor defined in the file. Catches missing lucide
 * imports (e.g. `icon: Bookmark` with no import) that vite build misses.
 */
const fs = require('fs');
const path = require('path');

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.jsx?$/.test(entry.name)) files.push(p);
  }
}
walk(path.join(__dirname, '..', 'src'));

let problems = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');

  // Collect local definitions: imports, function/const/class declarations,
  // destructured params, and JSX-in-scope helpers.
  const defined = new Set(['React', 'window', 'document', 'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Set', 'Map', 'Promise', 'Error', 'Date', 'Buffer']);
  for (const m of src.matchAll(/import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g)) {
    if (m[1]) defined.add(m[1]);
    if (m[2]) for (const part of m[2].split(',')) {
      const name = part.split(/\s+as\s+/).pop().trim();
      if (name) defined.add(name);
    }
  }
  for (const m of src.matchAll(/(?:function|class|const|let|var)\s+([\w$]+)/g)) defined.add(m[1]);
  for (const m of src.matchAll(/(?:function\s*[\w$]*\s*\(|\()([^)]*)\)\s*(?:=>|\{)/g)) {
    // parameter destructuring / named params (handles `icon: Icon` aliases)
    for (const part of m[1].split(',')) {
      const name = part.replace(/[{}[\]\s]/g, '').split(':').pop().trim();
      if (/^[A-Z][\w$]*$|^[a-z][\w$]*$/.test(name)) defined.add(name);
    }
  }
  for (const m of src.matchAll(/\{([^}]*)\}\s*=\s*(?:props|use\w+\([^)]*\)|[\w$.]+)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(':')[0].trim();
      if (name) defined.add(name);
    }
  }

  // Usages: JSX tags <Foo, icon: Foo, component={Foo}, <Foo ... />
  const used = new Set();
  for (const m of src.matchAll(/<([A-Z][\w$]*)/g)) used.add(m[1]);
  for (const m of src.matchAll(/(?:icon|component|render|onChart|as)\s*:\s*([A-Z][\w$]*)/g)) used.add(m[1]);
  for (const m of src.matchAll(/icon=\{([A-Z][\w$]*)\}/g)) used.add(m[1]);

  for (const name of used) {
    if (!defined.has(name)) {
      console.log(`MISSING: ${path.relative(path.join(__dirname, '..'), file)} uses <${name}> but never defines/imports it`);
      problems++;
    }
  }
}
console.log(problems === 0 ? 'SWEEP CLEAN — no undefined component identifiers' : `${problems} problem(s) found`);
