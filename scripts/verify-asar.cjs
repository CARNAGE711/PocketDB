// Verify the packaged asar matches the final dist build and carries the fixes.
const fs = require('fs');

const asar = fs.readFileSync('release/win-unpacked/resources/app.asar').toString('latin1');
const distHtml = fs.readFileSync('dist/index.html', 'utf8');

const m1 = asar.match(/index-[\w-]+\.js/g) || [];
const m2 = distHtml.match(/index-[\w-]+\.js/g) || [];
console.log('asar bundle :', m1.join(', '));
console.log('dist bundle :', m2.join(', '));
console.log('bundle MATCH:', [...new Set(m1)].join() === [...new Set(m2)].join());
console.log('CSP shipped :', asar.includes("default-src 'self'"));
console.log('passphrase fix in asar:', asar.includes('always re-open with it'));

const exe = 'release/PocketDB Setup 1.1.0.exe';
const st = fs.statSync(exe);
console.log('installer   :', (st.size / 1048576).toFixed(1), 'MB ·', st.mtime.toISOString());
