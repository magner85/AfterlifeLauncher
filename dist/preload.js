const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (partial) => ipcRenderer.invoke('config:set', partial),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  launchFiveM: (opts) => ipcRenderer.invoke('fivem:launch', opts),
  findFiveMPath: () => ipcRenderer.invoke('fivem:findDefaultPath'),
  ping: (host) => ipcRenderer.invoke('net:ping', host),
  getServerStatus: (connectHost) => ipcRenderer.invoke('server:status', connectHost),
  fetchVpnSubscription: (url) => ipcRenderer.invoke('subscription:fetch', url),
  startSystemTunnel: (payload) => ipcRenderer.invoke('tunnel:start', payload),
  startTunnelFromSubscription: () => ipcRenderer.invoke('tunnel:startFromSubscription'),
  stopSystemTunnel: () => ipcRenderer.invoke('tunnel:stop'),
  getTunnelStatus: () => ipcRenderer.invoke('tunnel:status'),
  getSystemInfo: () => ipcRenderer.invoke('system:getInfo'),
  restartElevated: () => ipcRenderer.invoke('app:restartElevated'),
  setWindowSizeAnimated: (width, height, durationMs) =>
    ipcRenderer.invoke('window:setSizeAnimated', width, height, durationMs),
  getWindowSize: () => ipcRenderer.invoke('window:getSize'),
  getEmbedPlaceholderUrl: () => ipcRenderer.invoke('assets:getEmbedPlaceholderUrl'),
  /** Снять подписку: вернённая функция. */
  onWindowShown: (listener) => {
    const wrapped = () => {
      try {
        listener();
      } catch (_) {}
    };
    ipcRenderer.on('launcher:window-shown', wrapped);
    return () => ipcRenderer.removeListener('launcher:window-shown', wrapped);
  }
});
