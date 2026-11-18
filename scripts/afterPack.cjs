/**
 * afterPack.cjs — electron-builder hook that runs after the app is copied
 * into release/win-unpacked but before the NSIS installer is built.
 *
 * Why: the build runs with `signAndEditExecutable: false` because
 * electron-builder's winCodeSign cache extraction needs symlink privileges
 * this machine doesn't have. Instead we embed the app icon ourselves with
 * the vendored rcedit binary, and drop the icon next to the exe so the
 * main process can use it for the window / taskbar.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const root = path.join(__dirname, '..');
  const icon = path.join(root, 'build', 'icon.ico');
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);

  // 1) Embed the icon (and app metadata) into PocketDB.exe.
  const rcedit = path.join(__dirname, 'vendor', 'rcedit-x64.exe');
  try {
    execFileSync(rcedit, [
      exePath,
      '--set-icon', icon,
      '--set-version-string', 'ProductName', 'PocketDB',
      '--set-version-string', 'FileDescription', 'PocketDB — NoSQL Document Studio',
      '--set-version-string', 'CompanyName', 'PocketDB',
      '--set-product-version', context.packager.appInfo.version,
      '--set-file-version', context.packager.appInfo.version,
    ], { stdio: 'inherit' });
    console.log(`[afterPack] icon embedded into ${exeName}`);
  } catch (err) {
    console.warn('[afterPack] rcedit failed:', err.message);
  }

  // 2) Copy the icon into resources/ so main.cjs can set the window icon.
  const resourcesDir = path.join(context.appOutDir, 'resources');
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.copyFileSync(icon, path.join(resourcesDir, 'icon.ico'));
  console.log('[afterPack] window icon copied to resources/icon.ico');
};
