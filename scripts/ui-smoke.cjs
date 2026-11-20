/* Renderer smoke test over CDP: drives the real Electron UI and checks the new surfaces.
 * Run with: node scripts/ui-smoke.cjs
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { spawn, execSync } = require('child_process');
const { PocketEngine } = require('../electron/db/engine.cjs');

const repo = path.join(__dirname, '..');
const electron = require('electron');
const PORT = 9333;
const dataDir = path.join(os.tmpdir(), 'pocketdb-ui-' + Date.now());
const uri = 'pocketdb:///' + dataDir.replace(/\\/g, '/');

/* seed the data directory */
const seed = new PocketEngine(dataDir);
if (seed.listDatabases().some((d) => d.name === 'pocketdb-demo')) seed.dropDatabase('pocketdb-demo');
seed.createDatabase('uitest');
seed.createCollection('uitest', 'people');
seed.insertMany('uitest', 'people', [
  { name: 'Ada', active: true, age: 36, team: 'core' },
  { name: 'Grace', active: true, age: 45, team: 'core' },
  { name: 'Linus', active: false, age: 54, team: 'kernel' },
]);
seed.createCollection('uitest', 'orders');
seed.insertMany('uitest', 'orders', [
  { item: 'laptop', total: 1200 },
  { item: 'mouse', total: 25 },
]);
seed.saveView('uitest', {
  name: 'active-people',
  coll: 'people',
  pipeline: [{ $match: { active: true } }, { $project: { _id: 0, name: 1, age: 1 } }],
});

/* kill leftovers */
try { execSync('taskkill /F /IM PocketDB.exe', { stdio: 'ignore' }); } catch { /* none */ }
try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* none */ }

const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], {
  cwd: repo,
  env: { ...process.env, POCKETDB_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let appLog = '';
child.stdout.on('data', (d) => { appLog += d.toString(); });
child.stderr.on('data', (d) => { appLog += d.toString(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('CDP endpoint never appeared. App log:\n' + appLog);
}

(async () => {
  const page = await target();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('CDP websocket failed'));
  });

  let nextId = 1;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'exception');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 10000);
  });

  const evalJs = async (expression, awaitPromise = true) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result.value;
  };

  const bodyText = () => evalJs('document.body.innerText');
  const waitFor = async (needle, label = needle, ms = 8000) => {
    const started = Date.now();
    while (Date.now() - started < ms) {
      const text = await bodyText();
      if (text.includes(needle)) return text;
      await sleep(200);
    }
    throw new Error(`timed out waiting for "${label}"`);
  };
  const clickAria = (label) => evalJs(`(() => {
    const el = document.querySelector('button[aria-label="${label}"]');
    if (!el) return false;
    el.click();
    return true;
  })()`);
  const clickText = (text) => evalJs(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  const closeDialog = () => clickText('Close');
  let passed = 0;
  const ok = (name) => { passed++; console.log('ok   ', name); };

  await send('Runtime.enable');
  await send('Page.enable');

  /* connect (launchpad) — force the seeded directory even if a favorite auto-connected */
  let text = await bodyText();
  if (!text.includes('uitest') && !text.includes('Connect')) {
    // Connected to some other data directory: return to the launchpad.
    await clickAria('Connections');
    await sleep(500);
  }
  await waitFor('Connect', 'launchpad');
  const setUri = await evalJs(`(() => {
    const inp = [...document.querySelectorAll('input')].find((i) => i.placeholder && i.placeholder.includes('pocketdb://'));
    if (!inp) return 'no-input';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, ${JSON.stringify(uri)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return inp.value;
  })()`);
  assert.strictEqual(setUri, uri, 'URI input accepted the test path');
  const clicked = await clickText('Connect');
  assert.ok(clicked, 'Connect button present');
  try {
    text = await waitFor('uitest', 'database dashboard', 15000);
  } catch (err) {
    console.error('DEBUG body after connect:\n' + (await bodyText()).slice(0, 1200));
    throw err;
  }
  ok('launchpad connects to the seeded data directory');

  try {
    text = await waitFor('Collections', 'dashboard collections', 10000);
  } catch (err) {
    console.error('DEBUG dashboard body:\n' + (await bodyText()).slice(0, 1500));
    throw err;
  }
  assert.ok(text.includes('people'), 'people collection card');
  assert.ok(text.includes('active-people'), 'saved view card on dashboard');
  ok('dashboard lists collections and saved views');

  /* open people */
  const opened = await evalJs(`(() => {
    const card = [...document.querySelectorAll('.group')].find((el) =>
      el.textContent.includes('people') && el.textContent.includes('docs') && el.querySelector('button'));
    if (!card) return 'no-card';
    const open = [...card.querySelectorAll('button')].find((b) => b.textContent.includes('people'));
    if (!open) return 'no-open-button';
    open.click();
    return open.textContent.trim();
  })()`);
  try {
    text = await waitFor('Ada', 'documents rendered');
  } catch (err) {
    console.error('DEBUG opened:', opened);
    console.error('DEBUG body after open:\n' + (await bodyText()).slice(0, 1200));
    throw err;
  }
  assert.ok(text.includes('matched'), 'filter strip present');
  ok('collection opens and renders documents');

  /* open orders through the collection switcher -> creates a tab */
  await evalJs(`document.querySelector('button[title="Switch collection"]')?.click()`);
  await sleep(300);
  await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('orders'));
    b?.click();
  })()`);
  text = await waitFor('orders', 'orders collection');
  const tabs = await evalJs(`window.localStorage.getItem('pocketdb-open-tabs') || ''`);
  assert.ok(tabs.includes('people') && tabs.includes('orders'), 'both collections persisted as tabs');
  ok('collection tabs persist both open collections');

  /* explain */
  await evalJs(`document.querySelector('button[title="Toggle filter console"]')?.click()`);
  await sleep(300);
  assert.ok(await clickText('Explain'), 'Explain button');
  try {
    text = await waitFor('COLLSCAN', 'explain plan');
  } catch (err) {
    console.error('DEBUG body after explain:\n' + (await bodyText()).slice(-1600));
    throw err;
  }
  assert.ok(text.includes('FULL SCAN') && text.includes('FETCH'), 'plan stages shown');
  ok('explain panel renders a query plan');

  /* schema analyzer */
  assert.ok(await clickAria('Schema analyzer'), 'schema analyzer button');
  text = await waitFor('field distribution', 'schema analyzer');
  assert.ok(text.includes('item') && text.includes('total'), 'orders fields analyzed');
  await closeDialog();
  await sleep(250);
  ok('schema analyzer lists field distribution');

  /* activity */
  assert.ok(await clickAria('Activity feed'), 'activity button');
  text = await waitFor('Live engine events', 'activity feed');
  assert.ok(text.includes('insert') || text.includes('No activity'), 'activity rows/empty state');
  await closeDialog();
  await sleep(250);
  ok('activity feed opens');

  /* trash */
  assert.ok(await clickAria('Trash'), 'trash button');
  text = await waitFor('Deleted documents', 'trash dialog');
  await closeDialog();
  await sleep(250);
  ok('trash dialog opens');

  /* snapshots + schedule */
  assert.ok(await clickAria('Snapshots'), 'snapshots button');
  text = await waitFor('Scheduled snapshots', 'snapshot schedule');
  assert.ok(text.includes('every') && text.includes('keep newest'), 'schedule controls');
  await closeDialog();
  await sleep(250);
  ok('snapshot dialog shows schedule controls');

  /* saved view: read-only surface */
  await evalJs(`document.querySelector('button[title="Switch collection"]')?.click()`);
  await sleep(300);
  await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('active-people'));
    b?.click();
  })()`);
  text = await waitFor('view of people', 'read-only view surface');
  const hasInsert = await evalJs(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Insert')`);
  assert.strictEqual(hasInsert, false, 'view hides Insert');
  assert.ok(text.includes('Ada') && text.includes('Grace') && !text.includes('Linus'), 'view pipeline results only');
  ok('saved view opens read-only with pipeline results');

  /* IPC-level checks for schedule + MCP config */
  const sched = await evalJs(`window.pocketdb.call('snapshots.scheduleGet', {}).then((r) => r.data)`);
  assert.ok(sched && sched.intervalMinutes >= 1, 'schedule defaults');
  const mcp = await evalJs(`window.pocketdb.call('mcp.info', {}).then((r) => r.data)`);
  assert.ok(mcp.script.endsWith('mcp-server.cjs') && mcp.config.mcpServers.pocketdb, 'mcp config');
  ok('IPC: snapshot schedule + MCP info respond');

  /* no runtime errors */
  await sleep(500);
  const realErrors = errors.filter((e) => e && !/Autofill|DevTools|Electron Security Warning/i.test(e));
  if (realErrors.length) {
    console.log('\nRENDERER ERRORS:\n' + realErrors.join('\n---\n'));
    throw new Error(`${realErrors.length} renderer error(s)`);
  }
  ok('no renderer exceptions or console errors');

  console.log(`\nALL ${passed} UI SMOKE CHECKS PASSED`);
  ws.close();
  child.kill();
  try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* gone */ }
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
})().catch(async (err) => {
  console.error('\nUI SMOKE FAILED:', err.message);
  console.error('--- app log tail ---');
  console.error(appLog.split(/\r?\n/).slice(-30).join('\n'));
  try { child.kill(); } catch { /* ignore */ }
  try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* ignore */ }
  process.exit(1);
});
