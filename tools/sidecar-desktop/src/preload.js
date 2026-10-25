'use strict';
// The one bridge between the app's windows and the main process. The windows
// are sandboxed and get only these calls.

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('sidecarApp', {
  state: () => ipcRenderer.invoke('app:state'),
  onState: on('app:state'),
  clickMenu: (id) => ipcRenderer.invoke('menu:click', id),
  join: (address, name) => ipcRenderer.invoke('join:submit', { address, name }),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  logs: () => ipcRenderer.invoke('logs:get'),
  onLogLine: on('logs:line'),
  openLogFolder: () => ipcRenderer.invoke('logs:open-folder'),
  dismissTrayNotice: () => ipcRenderer.invoke('notice:dismiss'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
});
