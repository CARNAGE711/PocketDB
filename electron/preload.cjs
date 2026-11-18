/**
 * PocketDB — preload script.
 *
 * Exposes a tiny, auditable bridge (`window.pocketdb`) between the React
 * renderer and the Node.js storage engine living in the main process.
 * The renderer can never reach `fs` or Electron internals directly —
 * it can only call the whitelisted engine methods registered in ipc.cjs.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pocketdb', {
  /**
   * Invoke a storage-engine method by name.
   * @param {string} method   e.g. 'documents.find'
   * @param {object} payload  arguments for that method
   * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
   */
  call: (method, payload) =>
    ipcRenderer.invoke('pocketdb:call', { method, payload }),

  /**
   * Subscribe to live engine change events (pushed from the main process
   * when the watched data directory changes). Returns an unsubscribe fn.
   * @param {(payload: {at: number}) => void} callback
   * @returns {() => void}
   */
  onEngineChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('engine:changed', handler);
    return () => ipcRenderer.removeListener('engine:changed', handler);
  },

  /**
   * Subscribe to auto-update status pushes ('checking', 'available',
   * 'downloading', 'downloaded', 'up-to-date', 'error'). Unsubscribe fn.
   */
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  },

  // Static metadata about the bridge (handy for sanity checks in dev tools).
  bridgeVersion: '1.2.0',
});
