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
  isFivemExePathValid: (exePath) => ipcRenderer.invoke('fivem:isExePathValid', exePath),
  downloadInstallFiveM: () => ipcRenderer.invoke('fivem:downloadInstall'),
  onFivemInstallProgress: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_e, payload) => {
      try {
        listener(payload);
      } catch (_) {}
    };
    ipcRenderer.on('fivem-install-progress', handler);
    return () => ipcRenderer.removeListener('fivem-install-progress', handler);
  },
  ping: (host) => ipcRenderer.invoke('net:ping', host),
  getServerStatus: (connectHost) => ipcRenderer.invoke('server:status', connectHost),
  fetchVpnSubscription: (url) => ipcRenderer.invoke('subscription:fetch', url),
  startSystemTunnel: (payload) => ipcRenderer.invoke('tunnel:start', payload),
  startTunnelFromSubscription: () => ipcRenderer.invoke('tunnel:startFromSubscription'),
  /** Установка Zapret (ZAPRET\\afterlife-zapret-silent-install.bat), без sing-box. */
  repairInstallZapret: () => ipcRenderer.invoke('zapret:repairInstall'),
  repairRevertZapret: () => ipcRenderer.invoke('zapret:repairRevert'),
  subscriptionBypassVlessList: () => ipcRenderer.invoke('subscription:bypassVlessList'),
  stopSystemTunnel: () => ipcRenderer.invoke('tunnel:stop'),
  getTunnelStatus: () => ipcRenderer.invoke('tunnel:status'),
  getSystemInfo: () => ipcRenderer.invoke('system:getInfo'),
  detectBypassTools: () => ipcRenderer.invoke('system:detectBypassTools'),
  probeDiscordFiveM: () => ipcRenderer.invoke('routing:probeDiscordFiveM'),
  killUserBypass: () => ipcRenderer.invoke('bypass:killUserBypass'),
  checkDiscord: () => ipcRenderer.invoke('system:checkDiscord'),
  openDiscord: () => ipcRenderer.invoke('system:openDiscord'),
  restartElevated: () => ipcRenderer.invoke('app:restartElevated'),
  setWindowSizeAnimated: (width, height, durationMs) =>
    ipcRenderer.invoke('window:setSizeAnimated', width, height, durationMs),
  getWindowSize: () => ipcRenderer.invoke('window:getSize'),
  getEmbedPlaceholderUrl: () => ipcRenderer.invoke('assets:getEmbedPlaceholderUrl'),
  checkSelfUpdate: () => ipcRenderer.invoke('launcher:checkSelfUpdate'),
  applySelfUpdate: (downloadUrl) => ipcRenderer.invoke('launcher:applySelfUpdate', downloadUrl),
  onLauncherSelfUpdateProgress: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_e, payload) => {
      try {
        listener(payload);
      } catch (_) {}
    };
    ipcRenderer.on('launcher-self-update-progress', handler);
    return () => ipcRenderer.removeListener('launcher-self-update-progress', handler);
  },
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
