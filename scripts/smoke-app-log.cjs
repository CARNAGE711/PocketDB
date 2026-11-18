// Stronger smoke test: launch with --enable-logging, capture stderr for renderer errors.
const { spawn, execSync } = require('child_process');
const path = require('path');

const exe = path.join(__dirname, '..', 'release', 'win-unpacked', 'PocketDB.exe');
const child = spawn(exe, ['--enable-logging=stderr', '--v=1'], { stdio: ['ignore', 'pipe', 'pipe'] });

let log = '';
child.stderr.on('data', (d) => { log += d.toString(); });
child.stdout.on('data', (d) => { log += d.toString(); });

setTimeout(() => {
  const lines = log.split(/\r?\n/);
  const interesting = lines.filter((l) =>
    /error|uncaught|ReferenceError|TypeError|SyntaxError|cannot|failed|Uncaught/i.test(l)
    && !/gpu_|viz|dawn|ANGLE|fontconfig|dbus|bluetooth/i.test(l)
  );
  console.log('--- interesting log lines ---');
  console.log(interesting.length ? interesting.slice(0, 30).join('\n') : '(none)');
  console.log('--- window check ---');
  try {
    const out = execSync('powershell -NoProfile -Command "(Get-Process PocketDB -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle} | Select-Object -First 1).MainWindowTitle"', { encoding: 'utf8' });
    console.log('window title:', JSON.stringify(out.trim()));
  } catch (e) { console.log('title check failed'); }
  try { execSync('taskkill /F /IM PocketDB.exe', { stdio: 'ignore' }); console.log('killed'); }
  catch (e) { console.log('kill failed'); }
  process.exit(0);
}, 15000);
