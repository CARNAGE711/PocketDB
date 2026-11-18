// Smoke test v2: track process lifetime, dump full stderr, exit codes.
const { spawn, execSync } = require('child_process');
const path = require('path');

const exe = path.join(__dirname, '..', 'release', 'win-unpacked', 'PocketDB.exe');
const child = spawn(exe, ['--enable-logging=stderr'], { stdio: ['ignore', 'pipe', 'pipe'] });

let log = '';
child.stderr.on('data', (d) => { log += d.toString(); });
child.stdout.on('data', (d) => { log += d.toString(); });
child.on('exit', (code, sig) => { console.log(`APP EXITED: code=${code} sig=${sig}`); });

setTimeout(() => {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq PocketDB.exe" /NH', { encoding: 'utf8' });
    console.log('running after 15s:', out.includes('PocketDB.exe'));
  } catch { console.log('tasklist failed'); }
  try {
    const out = execSync('powershell -NoProfile -Command "(Get-Process PocketDB -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle} | Select-Object -First 1).MainWindowTitle"', { encoding: 'utf8' });
    console.log('window title:', JSON.stringify(out.trim()));
  } catch { console.log('title check failed'); }
  console.log('--- full log tail ---');
  console.log(log.split(/\r?\n/).slice(-40).join('\n'));
  try { execSync('taskkill /F /IM PocketDB.exe', { stdio: 'ignore' }); console.log('killed'); }
  catch { console.log('nothing to kill'); }
  process.exit(0);
}, 15000);
