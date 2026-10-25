'use strict';
// bfstats Sidecar: a tray app that joins a BF1942 server through the UDP
// sidecar (tools/bf1942-models/sidecar) and opens the browser viewer on it.
// features/sidecar-desktop-app/README.md has the plan and how to run it.

const path = require('node:path');
const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, shell } = require('electron');

const { SCHEME, parseAddress, parseJoinLink, linkFromArgv, cleanName, formatAddress } = require('./address');
const { RotatingLog } = require('./logger');
const { Settings, DEFAULT_VIEWER, localViewerBase } = require('./settings');
const { fetchServers } = require('./servers');
const { SidecarSession, freePort } = require('./sidecar-session');
const { describe, trayIconState } = require('./sidecar-status');
const { buildModel, toTemplate, toPlain, findById } = require('./menu-model');
const { trayVisibility } = require('./tray-support');
const linux = require('./linux-integration');

const SERVER_REFRESH_MS = 60_000;
const ASSETS = path.join(__dirname, '..', 'assets');

// Our own data folder: the sidecar keeps its CD keys in ~/.config/bfstats-sidecar.
app.setName('bfstats-sidecar');
// SIDECAR_DESKTOP_DATA points a test run at its own folder.
app.setPath('userData', process.env.SIDECAR_DESKTOP_DATA || path.join(app.getPath('appData'), 'bfstats-sidecar-desktop'));
app.setAppLogsPath(path.join(app.getPath('userData'), 'logs'));
if (process.platform === 'win32') app.setAppUserModelId('io.bfstats.sidecar');

if (!app.requestSingleInstanceLock()) {
  // The running copy gets our argv (a join link) through 'second-instance'.
  app.quit();
  process.exit(0);
}

const dataDir = app.getPath('userData');
const logsDir = app.getPath('logs');
const appLog = new RotatingLog(logsDir, 'app');
const sidecarLog = new RotatingLog(logsDir, 'sidecar');
const log = (line) => appLog.write(`[app] ${line}`);
const settings = new Settings(dataDir);

const sidecarScript = app.isPackaged
  ? path.join(process.resourcesPath, 'sidecar', 'sidecar.mjs')
  : path.resolve(__dirname, '..', '..', 'bf1942-models', 'sidecar', 'sidecar.mjs');

let tray = null;
let trayState = { visible: null, reason: 'not checked' };
let session = null;
let joining = null;          // the join under way (a promise), so two joins do not overlap
let servers = [];
let serversError = null;
let serversTimer = null;
let quitting = false;
const windows = new Map();   // name -> BrowserWindow

// ---- the launch command (dev and packaged), for .desktop files ------------

function launchCommand() {
  if (app.isPackaged) return [process.env.APPIMAGE || process.execPath];
  return [process.execPath, path.resolve(__dirname, '..')];
}

// ---- joining ---------------------------------------------------------------

function viewerUrl(wsPort) {
  const base = settings.get('viewerBase') || DEFAULT_VIEWER;
  return `${base}map.html?sidecar=127.0.0.1:${wsPort}`;
}

function originOf(url) { try { return new URL(url).origin; } catch { return null; } }

function lookupServer(address) {
  return servers.find((s) => `${s.ip}:${s.port}` === address) ?? null;
}

/** Join a server: stop the session there is, start the new one. */
async function join({ host, port, name, serverName, mapName }) {
  const address = formatAddress({ host, port });
  const playerName = cleanName(name ?? '') ?? settings.get('playerName');
  const listed = lookupServer(address);
  const prev = joining;
  const run = (async () => {
    await prev?.catch(() => {});
    if (session?.running) {
      log(`leaving ${session.address} for ${address}`);
      await session.stop();
    }
    const wsPort = await freePort(settings.get('wsPort'));
    const viewerOrigin = originOf(settings.get('viewerBase'));
    const s = new SidecarSession({
      script: sidecarScript, host, port, name: playerName, team: settings.get('team'), wsPort, dataDir,
      serverName: serverName ?? listed?.name ?? null, mapName: mapName ?? listed?.mapName ?? null,
      gameType: listed?.gameType ?? null, players: listed?.numPlayers ?? null, maxPlayers: listed?.maxPlayers ?? null,
      extraArgs: viewerOrigin ? ['--allow-origin', viewerOrigin] : [],
      log: (line) => sidecarLog.write(line),
    });
    session = s;
    let viewerOpened = false;
    s.on('listening', (p) => {
      if (viewerOpened || s !== session) return;
      viewerOpened = true;
      openViewer(p);
    });
    s.on('change', (v) => {
      if (s !== session) return;
      onSessionChange(v);
    });
    s.on('exit', () => { if (s === session) refreshUi(); });
    log(`joining ${address} as "${playerName}" (team ${settings.get('team') || 'auto'}), socket on ${wsPort}`);
    s.start();
    settings.addRecent(address, s.serverName);
    refreshUi();
  })();
  joining = run;
  try { await run; } catch (e) { log(`join failed: ${e.message}`); notify('Join failed', e.message); }
  finally { if (joining === run) joining = null; }
}

async function joinAddress(text, extra = {}) {
  const addr = parseAddress(text);
  if (!addr) return { ok: false, error: 'Expected host:port, for example 192.0.2.10:14567' };
  join({ ...addr, ...extra });
  return { ok: true };
}

let lastNotified = null;
function onSessionChange(v) {
  const key = `${v.state}|${v.detail}`;
  if (key !== lastNotified) {
    lastNotified = key;
    if (v.state === 'joined') notify('In game', describe(v));
    else if (['denied', 'ended', 'failed'].includes(v.state)) notify('Session ended', v.detail || describe(v));
    else if (v.state === 'unreachable') notify('No answer yet', v.detail);
    if (v.state !== 'listening') log(`status: ${describe(v)}`);
  }
  refreshUi();
}

function openViewer(wsPort = session?.wsPort) {
  if (!wsPort) return;
  const url = viewerUrl(wsPort);
  log(`opening the viewer: ${url}`);
  // SIDECAR_DESKTOP_NO_BROWSER=1: a headless check logs the URL and opens nothing.
  if (process.env.SIDECAR_DESKTOP_NO_BROWSER === '1') return;
  shell.openExternal(url).catch((e) => log(`could not open the browser: ${e.message}`));
}

async function leave() {
  if (!session?.running) return;
  log(`leaving ${session.address}`);
  await session.stop();
  refreshUi();
}

function handleLink(link) {
  if (!link) return false;
  const j = parseJoinLink(link);
  if (!j) {
    log(`ignored a link that is not a valid join: ${JSON.stringify(link).slice(0, 200)}`);
    notify('Link ignored', 'Not a valid bfstats-sidecar://join/<host>:<port> link');
    return true;
  }
  log(`join link: ${j.host}:${j.port}${j.name ? ` as "${j.name}"` : ''}`);
  join(j);
  return true;
}

// ---- the server list -------------------------------------------------------

async function refreshServers() {
  try {
    servers = await fetchServers();
    serversError = null;
    if (session) {
      const listed = lookupServer(session.address);
      if (listed) {
        Object.assign(session, { mapName: listed.mapName, gameType: listed.gameType, players: listed.numPlayers, maxPlayers: listed.maxPlayers });
        session.serverName ??= listed.name;
      }
    }
  } catch (e) {
    serversError = e.name === 'AbortError' ? 'timed out' : e.message;
    log(`server list: ${serversError}`);
  }
  refreshUi();
}

// ---- the menu, the tray and the panel --------------------------------------

function context() {
  return {
    session: session ? session.view() : null,
    servers, serversError,
    settings: settings.snapshot(),
    startAtLogin: startAtLoginEnabled(),
    actions: {
      join, joinAddress,
      refreshServers,
      clearRecent: () => { settings.clearRecent(); refreshUi(); },
      openJoinWindow: () => openWindow('join'),
      openViewer: () => openViewer(),
      leave,
      openLogs: () => openWindow('logs'),
      openSettings: () => openWindow('settings'),
      toggleStartAtLogin: () => { setStartAtLogin(!startAtLoginEnabled()); refreshUi(); },
      quit: () => app.quit(),
    },
  };
}

let currentModel = [];
let uiTimer = null;
function refreshUi() {
  if (uiTimer) return;
  uiTimer = setTimeout(() => {
    uiTimer = null;
    const ctx = context();
    currentModel = buildModel(ctx);
    if (tray) {
      setTrayIcon(trayIconState(ctx.session));
      tray.setContextMenu(Menu.buildFromTemplate(toTemplate(currentModel)));
      tray.setToolTip(`bfstats Sidecar: ${describe(ctx.session)}`);
    }
    broadcast('app:state', publicState(ctx));
  }, 50);
}

function publicState(ctx = context()) {
  return {
    model: toPlain(currentModel.length ? currentModel : buildModel(ctx)),
    session: ctx.session,
    status: describe(ctx.session),
    tray: trayState,
    trayNoticeDismissed: !!settings.get('trayNoticeDismissed'),
    version: app.getVersion(),
  };
}

function broadcast(channel, payload) {
  for (const w of windows.values()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

// The tray icon carries the session's state as a dot: green in game, orange
// on the way in (assets/tray-<state>.png, scripts/make-icons.py).
const trayIcons = new Map();
let trayIconShown;
function trayIcon(state) {
  const file = state ? `tray-${state}.png` : 'tray.png';
  if (!trayIcons.has(file)) trayIcons.set(file, nativeImage.createFromPath(path.join(ASSETS, file)));
  return trayIcons.get(file);
}

function setTrayIcon(state) {
  if (!tray || state === trayIconShown) return;
  trayIconShown = state;
  tray.setImage(trayIcon(state));
  log(`tray icon: ${state ?? 'plain'}`);
}

function createTray() {
  tray = new Tray(trayIcon(null));
  trayIconShown = null;
  tray.setToolTip('bfstats Sidecar');
  // Windows and KDE: a left click opens the panel; the menu is the right click.
  tray.on('click', () => openWindow('panel'));
  refreshUi();
}

const WINDOW_SPECS = {
  panel: { file: 'panel.html', width: 420, height: 620, title: 'bfstats Sidecar' },
  join: { file: 'join.html', width: 420, height: 230, title: 'Join by address' },
  logs: { file: 'logs.html', width: 900, height: 600, title: 'Sidecar logs' },
  settings: { file: 'settings.html', width: 480, height: 580, title: 'Sidecar settings' },
};

function openWindow(name) {
  const open = windows.get(name);
  if (open && !open.isDestroyed()) { open.show(); open.focus(); return open; }
  const spec = WINDOW_SPECS[name];
  const w = new BrowserWindow({
    width: spec.width, height: spec.height, title: spec.title,
    icon: path.join(ASSETS, 'icon.png'),
    backgroundColor: '#151515',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  w.removeMenu();
  // Links never navigate the app's windows; http(s) ones go to the browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.loadFile(path.join(__dirname, 'ui', spec.file));
  w.once('ready-to-show', () => w.show());
  w.on('closed', () => {
    windows.delete(name);
    // Without a tray the panel is the app: closing it quits (and leaves).
    if (name === 'panel' && trayState.visible === false && !quitting) app.quit();
  });
  windows.set(name, w);
  return w;
}

// ---- start at login --------------------------------------------------------

function startAtLoginEnabled() {
  if (process.platform === 'linux') return linux.autostartEnabled();
  return app.getLoginItemSettings().openAtLogin;
}

function setStartAtLogin(on) {
  if (process.platform === 'linux') linux.setAutostart(on, { exec: launchCommand(), icon: path.join(ASSETS, 'icon.png') });
  else app.setLoginItemSettings({ openAtLogin: on });
  settings.update({ startAtLogin: on });
  log(`start at login ${on ? 'on' : 'off'}`);
}

// ---- notifications ---------------------------------------------------------

function notify(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title: `bfstats Sidecar: ${title}`, body: body || '', icon: path.join(ASSETS, 'icon.png'), silent: true }).show();
  } catch { /* no notification daemon */ }
}

// ---- the protocol handler --------------------------------------------------

async function registerProtocol() {
  if (process.platform === 'linux') {
    // Electron's own registration needs a matching installed .desktop file;
    // writing ours is what makes xdg-open find the app. Dev checkouts use
    // `npm run register-linux` instead, so a dev run never rewrites it.
    if (!app.isPackaged) return;
    try {
      const r = await linux.installProtocolHandler({ exec: launchCommand(), icon: path.join(ASSETS, 'icon.png') });
      log(`protocol handler: ${r.file} (default ${r.default || 'unset'})`);
    } catch (e) { log(`protocol handler not registered: ${e.message}`); }
    return;
  }
  const ok = app.isPackaged
    ? app.setAsDefaultProtocolClient(SCHEME)
    : app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(__dirname, '..')]);
  log(`protocol handler ${ok ? 'registered' : 'not registered'} for ${SCHEME}://`);
}

// ---- IPC -------------------------------------------------------------------

ipcMain.handle('app:state', () => publicState());
ipcMain.handle('menu:click', (_e, id) => {
  const it = findById(currentModel, String(id));
  if (it?.click && it.enabled !== false) it.click();
  return !!it;
});
ipcMain.handle('join:submit', (_e, { address, name } = {}) => {
  if (name !== undefined && name !== '' && !cleanName(name)) return { ok: false, error: 'Name: printable ASCII, 1 to 32 characters, no quotes' };
  const r = joinAddress(String(address ?? ''), name ? { name } : {});
  return r;
});
ipcMain.handle('settings:get', () => ({ ...settings.snapshot(), defaults: { viewerBase: DEFAULT_VIEWER, localViewer: localViewerBase() }, startAtLogin: startAtLoginEnabled() }));
ipcMain.handle('settings:save', (_e, patch = {}) => {
  const { startAtLogin, ...rest } = patch;
  const errors = settings.update(rest);
  if (startAtLogin !== undefined && !!startAtLogin !== startAtLoginEnabled()) setStartAtLogin(!!startAtLogin);
  refreshUi();
  return { errors };
});
ipcMain.handle('logs:get', () => ({ app: appLog.lines, sidecar: sidecarLog.lines, dir: logsDir }));
ipcMain.handle('logs:open-folder', () => shell.openPath(logsDir));
ipcMain.handle('notice:dismiss', () => { settings.update({ trayNoticeDismissed: true }); refreshUi(); });
ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
appLog.onLine((line) => broadcast('logs:line', { which: 'app', line }));
sidecarLog.onLine((line) => broadcast('logs:line', { which: 'sidecar', line }));

// ---- lifecycle -------------------------------------------------------------

app.on('second-instance', (_e, argv) => {
  if (!handleLink(linkFromArgv(argv))) openWindow('panel');
});
// macOS hands links over this way.
app.on('open-url', (e, url) => { e.preventDefault(); handleLink(url); });

// A tray app keeps running with no window open.
app.on('window-all-closed', () => {});

app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  if (session?.running) {
    e.preventDefault();
    log('quitting: leaving the server first');
    session.stop().finally(() => app.exit(0));
  }
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => app.quit());

app.whenReady().then(async () => {
  log(`started ${app.getVersion()} (${app.isPackaged ? 'packaged' : 'dev'}), sidecar ${sidecarScript}, data ${dataDir}`);
  await registerProtocol();
  trayState = await trayVisibility();
  log(`tray: ${trayState.visible === false ? 'not visible' : 'visible'} (${trayState.reason})`);
  createTray();
  // No tray on this desktop: the panel window is the app, and says why.
  if (trayState.visible === false) openWindow('panel');
  refreshServers();
  serversTimer = setInterval(refreshServers, SERVER_REFRESH_MS);
  handleLink(linkFromArgv(process.argv));
});

app.on('will-quit', () => { clearInterval(serversTimer); });
