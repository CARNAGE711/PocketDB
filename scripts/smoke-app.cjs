// Smoke test: launch the packaged app, wait, verify it stays alive, then kill.
const { spawn } = require('child_process');
const path = require('path');

const exe = path.join(__dirname, '..', 'release', 'win-unpacked', 'PocketDB.exe');
const child = spawn(exe, [], { detached: true, stdio: 'ignore' });
child.unref();

setTimeout(() => {
  const { execSync } = require('child_process');
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq PocketDB.exe" /NH', { encoding: 'utf8' });
    const running = out.includes('PocketDB.exe');
    console.log('running after 12s:', running);
    if (running) {
      const lines = out.split('\r\n').filter((l) => l.includes('PocketDB.exe'));
      console.log('process count:', lines.length);
      console.log(lines.join('\n'));
    }
  } catch (e) {
    console.log('tasklist failed:', e.message);
  }
  try { execSync('taskkill /F /IM PocketDB.exe', { stdio: 'ignore' }); console.log('killed'); }
  catch (e) { console.log('kill failed:', e.message); }
  process.exit(0);
}, 12000);
