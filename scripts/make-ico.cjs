/**
 * make-ico.cjs — assembles build/icon.ico from the generated size PNGs.
 * Usage: node scripts/make-ico.cjs
 */
const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico').default;

const SIZES = [256, 128, 64, 48, 32, 16];
const root = path.join(__dirname, '..');

(async () => {
  const inputs = SIZES.map((s) => path.join(root, 'build', 'icons', `pocketdb-${s}.png`));
  const ico = await pngToIco(inputs);
  const out = path.join(root, 'build', 'icon.ico');
  fs.writeFileSync(out, ico);
  console.log(`OK -> build/icon.ico (${(fs.statSync(out).size / 1024).toFixed(1)} KB, ${SIZES.join('/')} px)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
