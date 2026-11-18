/**
 * PocketDB — Auto-update support (electron-updater).
 *
 * Kept opt-in and on-demand: the feed URL comes from POCKETDB_UPDATE_URL
 * (a generic provider, e.g. a static file server or GitHub Releases),
 * checks only run when the user asks (menu / palette), and nothing is
 * installed silently — the studio shows progress and quits to install
 * only after the user confirms.
 */
'use strict';

let wired = false;
let listeners = [];

function broadcast(status) {
  for (const l of listeners) {
    try {
      l(status);
    } catch {
      /* renderer gone */
    }
  }
}

/**
 * Wire autoUpdater once. `send` pushes status payloads to the renderer;
 * addRenderer(cb) lets the IPC layer subscribe lazily.
 */
function setupUpdater({ send }) {
  listeners.push(send);
  if (wired) return updaterApi;
  wired = true;

  try {
    const { autoUpdater } = require('electron-updater');
    if (process.env.POCKETDB_UPDATE_URL) {
      autoUpdater.setFeedURL({ provider: 'generic', url: process.env.POCKETDB_UPDATE_URL });
    }
    autoUpdater.on('checking-for-update', () => broadcast({ status: 'checking' }));
    autoUpdater.on('update-available', (i) => broadcast({ status: 'available', version: i?.version }));
    autoUpdater.on('update-not-available', (i) => broadcast({ status: 'up-to-date', version: i?.version }));
    autoUpdater.on('download-progress', (p) => broadcast({ status: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', (i) => broadcast({ status: 'downloaded', version: i?.version }));
    autoUpdater.on('error', (e) => broadcast({ status: 'error', message: String(e?.message || e) }));

    updaterApi.check = async () => {
      try {
        if (!process.env.POCKETDB_UPDATE_URL) {
          return { status: 'unconfigured' };
        }
        await autoUpdater.checkForUpdates();
        return { status: 'checking' };
      } catch (err) {
        return { status: 'error', message: String(err?.message || err) };
      }
    };
    updaterApi.install = () => {
      try {
        autoUpdater.quitAndInstall();
      } catch {
        /* no downloaded update */
      }
    };
  } catch {
    // electron-updater not importable (unlikely — it ships as a dependency)
  }
  return updaterApi;
}

const updaterApi = {
  check: async () => ({ status: 'unavailable' }),
  install: () => {},
};

module.exports = { setupUpdater };
