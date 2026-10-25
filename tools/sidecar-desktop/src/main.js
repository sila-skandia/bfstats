'use strict';
// bfstats Sidecar: a tray app that joins a BF1942 server through the UDP
// sidecar (tools/bf1942-models/sidecar) and opens the browser viewer on it.
// features/sidecar-desktop-app/README.md has the plan and how to run it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, safeStorage, screen, shell } = require('electron');

const { SCHEME, parseAddress, parseJoinLink, linkFromArgv, cleanName, formatAddress } = require('./address');
const { RotatingLog } = require('./logger');
const { Settings, DEFAULT_VIEWER, localViewerBase } = require('./settings');
const { fetchServers } = require('./servers');
const { installProfiles } = require('./game-install');
const { cleanProfileName } = require('./address');
const { SidecarSession, freePort } = require('./sidecar-session');
const { describe, trayIconState } = require('./sidecar-status');
const { buildModel, toTemplate, toPlain } = require('./menu-model');
const { Account, TokenStore } = require('./account');
const { trayVisibility } = require('./tray-support');
const { panelState } = require('./panel-state');
const { trayAnchoredPosition, cornerPosition, fitSize } = require('./panel-position');
const linux = require('./linux-integration');

const SERVER_REFRESH_MS = 60_000;
const PROFILE_WAIT_MS = 5_000;        // a join waits this long for the profile list, then uses the last one
const PROFILE_REFRESH_MIN_MS = 5_000; // opening the panel reloads the profiles at most this often
const ASSETS = path.join(__dirname, '..', 'assets');

// Our own data folder: the sidecar keeps its CD keys in ~/.config/bfstats-sidecar.
app.setName('bfstats-sidecar');
// SIDECAR_DESKTOP_DATA points a test run at its own folder.
app.setPath('userData', process.env.SIDECAR_DESKTOP_DATA || path.join(app.getPath('appData'), 'bfstats-sidecar-desktop'));
app.setAppLogsPath(path.join(app.getPath('userData'), 'logs'));
if (process.platform === 'win32') app.setAppUserModelId('io.bfstats.sidecar');
// A Wayland client cannot place its own windows: on GNOME Wayland the
// compositor places the popup panel. SIDECAR_DESKTOP_X11=1 runs the app under
// XWayland, where the panel can place itself (on this PC's GPU the X11 path
// crashed Chromium's GPU process, so it is not the default).
if (process.platform === 'linux' && process.env.SIDECAR_DESKTOP_X11 === '1') {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

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
let serversAt = null;        // when the list was fetched (ms): the panel counts the round time down from it
let nameInfo = null;         // who the next join plays as, for the panel ({ name, source, detail })
let serversTimer = null;
let quitting = false;
let account = null;          // the bfstats.io sign-in (src/account.js), made once the app is ready
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

/**
 * Who a join plays as (features/game-profiles): `{ name, nameFromPage,
 * source }`. A name the join carries (a link's `?name=`, the join window's)
 * is used as given. Otherwise the setting: the viewer's profile (the sidecar
 * waits for the page, `--name` the fallback), a profile of this PC's game
 * install, or the custom name.
 */
async function resolveName(explicit, { quiet = false, fetchProfiles = false } = {}) {
  const say = quiet ? () => {} : log;
  const custom = settings.get('playerName');
  const given = cleanName(explicit ?? '');
  if (given) return { name: given, nameFromPage: false, source: 'custom' };
  const source = settings.get('nameSource');
  if (source === 'account') {
    // Signed in: the account's active profile names the player, known before
    // the connect. Signed out (or no profile): the viewer's page names it.
    if (account?.signedIn) {
      if (fetchProfiles) await Promise.race([account.loadProfiles(), new Promise((r) => setTimeout(r, PROFILE_WAIT_MS))]);
      const active = account.activeProfile();
      // The sidecar name when the profile has one, else the game's.
      const name = active ? cleanProfileName(active.joinName ?? active.playerName) : null;
      if (name) {
        say(`player name from the bfstats.io profile ${active.name}${active.sidecarName ? ' (its sidecar name)' : ''}`);
        return { name, nameFromPage: false, source: 'account', profile: active.name };
      }
      say(account.profiles?.length ? 'the active bfstats.io profile has no usable player name: the viewer names the player'
        : 'no bfstats.io profile: the viewer names the player');
    }
    return { name: settings.get('lastPageName') || custom, nameFromPage: true, source: 'page' };
  }
  if (source === 'install') {
    const { install, profiles } = await installProfiles({ override: settings.get('gameDir') });
    const want = settings.get('installProfile');
    const pick = profiles.find((p) => want && p.folder.toLowerCase() === want.toLowerCase())
      ?? profiles.find((p) => p.current) ?? profiles[0] ?? null;
    const name = pick ? cleanProfileName(pick.playerName) : null;
    if (name) {
      say(`player name from the game install's profile ${pick.folder} (${install?.gameDir})`);
      return { name, nameFromPage: false, source };
    }
    say(`no usable profile in the game install (${install?.gameDir ?? 'not found'}): joining as the custom name`);
  }
  return { name: custom, nameFromPage: false, source: 'custom' };
}

/** Join a server: stop the session there is, start the new one. */
async function join({ host, port, name, serverName, mapName }) {
  const address = formatAddress({ host, port });
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
    const who = await resolveName(name, { fetchProfiles: true });
    const playerName = who.name;
    const s = new SidecarSession({
      mod: listed?.gameId ?? null,
      script: sidecarScript, host, port, name: playerName, team: settings.get('team'), wsPort, dataDir,
      nameFromPage: who.nameFromPage, nameSource: who.source,
      serverName: serverName ?? listed?.name ?? null, mapName: mapName ?? listed?.mapName ?? null,
      gameType: listed?.gameType ?? null, players: listed?.numPlayers ?? null, maxPlayers: listed?.maxPlayers ?? null,
      extraArgs: viewerOrigin ? ['--allow-origin', viewerOrigin] : [],
      log: (line) => sidecarLog.write(line),
    });
    session = s;
    let viewerOpened = false;
    let shownName = null;
    s.on('listening', (p) => {
      if (viewerOpened || s !== session) return;
      viewerOpened = true;
      openViewer(p);
    });
    s.on('change', (v) => {
      if (s !== session) return;
      if (v.playerName && v.playerName !== shownName) {
        shownName = v.playerName;
        log(`playing as ${v.playerName} (${v.playerNameFrom === 'page' ? "the viewer's profile" : v.playerNameFrom})`);
      }
      // The viewer's profile named the player: the next join's fallback.
      if (v.playerNameFrom === 'page' && v.playerName && v.playerName !== settings.get('lastPageName')) {
        settings.update({ lastPageName: v.playerName });
        refreshNameInfo();
      }
      onSessionChange(v);
    });
    s.on('exit', () => { if (s === session) refreshUi(); });
    log(`joining ${address} as ${who.nameFromPage ? `the viewer's profile name (fallback "${playerName}")` : `"${playerName}" (${who.source})`} (team ${settings.get('team') || 'auto'}), socket on ${wsPort}`);
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
    serversAt = Date.now();
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
    account: account ? account.view() : null,
    actions: {
      signIn: () => signIn(),
      cancelSignIn: () => account?.cancelSignIn(),
      activateProfile: (n) => activateProfile(n),
      openImport: () => openImport(),
      join, joinAddress,
      refreshServers,
      clearRecent: () => { settings.clearRecent(); refreshUi(); },
      openJoinWindow: () => openWindow('join'),
      openViewer: () => openViewer(),
      leave,
      openLogs: () => openWindow('logs'),
      openSettings: () => openWindow('settings'),
      toggleStartAtLogin: () => { setStartAtLogin(!startAtLoginEnabled()); refreshUi(); },
      openPanel: trayState.visible === false ? null : () => showPanel(),
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
    // SIDECAR_DESKTOP_MENU_FILE=<file>: a headless check reads the brief menu's model there.
    if (process.env.SIDECAR_DESKTOP_MENU_FILE) {
      try { fs.writeFileSync(process.env.SIDECAR_DESKTOP_MENU_FILE, JSON.stringify(toPlain(currentModel), null, 2)); } catch { /* a check's file */ }
    }
  }, 50);
}

function publicState(ctx = context()) {
  return {
    session: ctx.session,
    status: describe(ctx.session),
    tray: trayState,
    panel: panelState({ session: ctx.session, servers, serversError, serversAt, settings: ctx.settings, nameInfo, tray: trayState, account: ctx.account }),
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
  // Windows and KDE: a left click toggles the panel; the menu is the right
  // click. GNOME's AppIndicator sends no click: the menu's Open panel does it.
  tray.on('click', () => togglePanel());
  refreshUi();
}

const PANEL_SIZE = { width: 384, height: 640 };

const WINDOW_SPECS = {
  // The no-tray window: taller, as the tray notice sits above the card.
  panel: { file: 'panel.html', width: PANEL_SIZE.width + 16, height: 760, minWidth: 340, minHeight: 560, title: 'bfstats Sidecar' },
  join: { file: 'join.html', width: 420, height: 230, title: 'Join by address' },
  logs: { file: 'logs.html', width: 900, height: 600, title: 'Sidecar logs' },
  settings: { file: 'settings.html', width: 500, height: 880, title: 'Sidecar settings' },
};

// The panel is a popup (borderless, rounded, hides when it loses focus)
// where there is a tray, and the app's own window where there is none.
// SIDECAR_DESKTOP_PANEL=popup|window forces one (a check of the other).
const panelIsPopup = () => {
  const forced = process.env.SIDECAR_DESKTOP_PANEL;
  if (forced === 'popup' || forced === 'window') return forced === 'popup';
  return trayState.visible !== false;
};

function openWindow(name, { show = true } = {}) {
  const open = windows.get(name);
  if (open && !open.isDestroyed()) { if (show) { open.show(); open.focus(); } return open; }
  const spec = WINDOW_SPECS[name];
  const popup = name === 'panel' && panelIsPopup();
  const w = new BrowserWindow({
    width: spec.width, height: spec.height, title: spec.title,
    ...(popup ? {} : { minWidth: spec.minWidth, minHeight: spec.minHeight }),
    icon: path.join(ASSETS, 'icon.png'),
    backgroundColor: popup ? '#00000000' : '#131313',
    autoHideMenuBar: true,
    show: false,
    ...(popup ? {
      frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  w.removeMenu();
  // Links never navigate the app's windows; http(s) ones go to the browser.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.loadFile(path.join(__dirname, 'ui', spec.file), name === 'panel' ? { query: { mode: popup ? 'popup' : 'window' } } : {});
  if (popup) wirePopup(w);
  else if (show) w.once('ready-to-show', () => w.show());
  w.on('closed', () => {
    windows.delete(name);
    // Without a tray the panel is the app: closing it quits (and leaves).
    if (name === 'panel' && trayState.visible === false && !quitting) app.quit();
  });
  windows.set(name, w);
  return w;
}

// ---- the popup panel ------------------------------------------------------

let panelHiddenAt = 0;

function wirePopup(w) {
  w.on('blur', () => {
    // DevTools take the focus while debugging the panel; keep it up then.
    if (w.webContents.isDevToolsOpened()) return;
    hidePanel();
  });
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); hidePanel(); }
  });
}

/** Where the popup opens: by the tray icon when the tray says where it is
 * (Windows, KDE), else the top-right corner of the primary display. */
function placePanel(w) {
  const bounds = tray?.getBounds?.();
  const valid = bounds && bounds.width > 0 && bounds.height > 0;
  const display = valid
    ? screen.getDisplayNearestPoint({ x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) })
    : screen.getPrimaryDisplay();
  const size = fitSize(PANEL_SIZE, display.workArea);
  const at = (valid && trayAnchoredPosition({ trayBounds: bounds, size, workArea: display.workArea }))
    || cornerPosition({ workArea: display.workArea, size });
  w.setBounds({ ...at, ...size });
  // A native Wayland window cannot place itself: the size holds, the compositor picks the spot.
  const placedBy = process.platform === 'linux' && process.env.WAYLAND_DISPLAY && process.env.SIDECAR_DESKTOP_X11 !== '1'
    ? 'the compositor' : (valid ? 'the tray' : 'top right');
  log(`panel ${size.width}x${size.height} at ${at.x},${at.y} (${placedBy}, display ${display.id})`);
}

function showPanel() {
  reloadProfiles();
  if (!panelIsPopup()) return openWindow('panel');
  const w = openWindow('panel', { show: false });
  placePanel(w);
  const reveal = () => {
    w.show();
    w.focus();
    w.webContents.send('panel:shown');
  };
  if (w.webContents.isLoading()) w.once('ready-to-show', reveal); else reveal();
  return w;
}

function hidePanel() {
  const w = windows.get('panel');
  if (!w || w.isDestroyed() || !w.isVisible()) return;
  panelHiddenAt = Date.now();
  if (panelIsPopup()) w.hide(); else w.close();
}

function togglePanel() {
  const w = windows.get('panel');
  if (w && !w.isDestroyed() && w.isVisible()) return hidePanel();
  // A click on the tray icon blurs the open panel first: that click closes it.
  if (Date.now() - panelHiddenAt < 300) return;
  showPanel();
}

/** Who the next join plays as, for the panel; the install is read off the UI path. */
async function refreshNameInfo() {
  try {
    const who = await resolveName(undefined, { quiet: true });
    // The viewer's profile: the name is the page's; `name` is the fallback.
    const want = settings.get('nameSource');
    let detail = '';
    if (want === 'install' && who.source !== 'install') detail = 'No profile found in the game install';
    else if (want === 'account' && account?.signedIn && who.source !== 'account') detail = 'No active profile on bfstats.io';
    nameInfo = { name: who.name, source: who.source, detail, profile: who.profile ?? null };
  } catch (e) {
    nameInfo = null;
    log(`could not tell the player name: ${e.message}`);
  }
  refreshUi();
}

// ---- the bfstats.io account (features/app-sign-in) -------------------------

// Electron's safeStorage: the OS keyring (DPAPI on Windows, the Secret
// Service or KWallet on Linux), or on Linux without one 'basic_text', which
// still encrypts but with a fixed key; the panel says so.
const safeCrypt = {
  available: () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } },
  backend: () => (process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os'),
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (buf) => safeStorage.decryptString(buf),
};

/** Where the sign-in page opens. SIDECAR_DESKTOP_AUTH_URL_FILE hands the URL to a
 * check instead (written to that file); SIDECAR_DESKTOP_NO_BROWSER logs it. */
async function openSignInPage(url) {
  if (process.env.SIDECAR_DESKTOP_AUTH_URL_FILE) {
    fs.writeFileSync(process.env.SIDECAR_DESKTOP_AUTH_URL_FILE, url);
    log('sign-in page handed to SIDECAR_DESKTOP_AUTH_URL_FILE');
    return;
  }
  if (process.env.SIDECAR_DESKTOP_NO_BROWSER === '1') { log(`sign-in page (not opened): ${url}`); return; }
  await shell.openExternal(url);
}

function createAccount() {
  const site = process.env.SIDECAR_DESKTOP_SITE || settings.get('siteBase');
  const api = process.env.SIDECAR_DESKTOP_API || settings.get('apiBase') || site;
  account = new Account({
    siteBase: site, apiBase: api, device: os.hostname(), openUrl: openSignInPage,
    store: new TokenStore(path.join(dataDir, 'account.bin'), safeCrypt),
    log,
  });
  account.on('change', () => { refreshNameInfo(); });
  account.on('signed-out', () => notify('Signed out', 'Your bfstats.io sign-in ended. Sign in again from the panel.'));
  account.start();
  log(`account: site ${account.siteBase}, api ${account.apiBase}, token storage ${account.store.protection()}`);
  if (account.signedIn) account.loadProfiles();
}

async function signIn() {
  if (!account || account.status === 'waiting') return;
  try { await account.signIn(); } catch (e) { log(`sign-in failed: ${e.message}`); notify('Sign-in failed', e.message); }
}

/** `{ ok: true }`, or `{ ok: false, error }` for the panel's edit field. */
async function setSidecarName(name, sidecarName) {
  try {
    await account?.setSidecarName(name, sidecarName);
    return { ok: true };
  } catch (e) {
    log(`could not set the sidecar name of ${name}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

async function activateProfile(name) {
  try { await account?.activate(name); } catch (e) { log(`could not switch profile: ${e.message}`); notify('Profile not switched', e.message); }
}

function openImport() {
  const url = account?.view().importUrl;
  if (url) shell.openExternal(url).catch((e) => log(`could not open the browser: ${e.message}`));
}

let profilesLoadedAt = 0;
function reloadProfiles() {
  if (!account?.signedIn || Date.now() - profilesLoadedAt < PROFILE_REFRESH_MIN_MS) return;
  profilesLoadedAt = Date.now();
  account.loadProfiles();
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
ipcMain.handle('panel:join', (_e, s = {}) => {
  const addr = parseAddress(`${s.ip ?? ''}:${s.port ?? ''}`);
  if (!addr) return { ok: false, error: 'Not a server address' };
  const listed = lookupServer(formatAddress(addr));
  join({ ...addr, serverName: listed?.name ?? (typeof s.name === 'string' ? s.name.slice(0, 120) : undefined), mapName: listed?.mapName });
  return { ok: true };
});
const PANEL_ACTIONS = {
  openViewer: () => openViewer(),
  leave: () => leave(),
  settings: () => openWindow('settings'),
  logs: () => openWindow('logs'),
  refresh: () => refreshServers(),
  clearRecent: () => { settings.clearRecent(); refreshUi(); },
  hide: () => hidePanel(),
  quit: () => app.quit(),
};
ipcMain.handle('panel:action', (_e, name) => {
  const fn = Object.hasOwn(PANEL_ACTIONS, name) ? PANEL_ACTIONS[name] : null;
  if (fn) fn();
  return !!fn;
});
const ACCOUNT_ACTIONS = {
  signIn: () => { signIn(); },
  cancel: () => account?.cancelSignIn(),
  signOut: () => account?.signOut(),
  dismiss: () => account?.dismissNotice(),
  import: () => openImport(),
  reload: () => account?.loadProfiles(),
};
ipcMain.handle('account:action', async (_e, name, arg) => {
  if (name === 'sidecarName') {
    const target = arg?.name;
    if (typeof target !== 'string' || !account?.profiles?.some((p) => p.name === target)) return { ok: false, error: 'No such profile' };
    const value = arg.sidecarName;
    if (value !== null && typeof value !== 'string') return { ok: false, error: 'Not a name' };
    return setSidecarName(target, value);
  }
  if (name === 'activate') {
    if (typeof arg !== 'string' || !account?.profiles?.some((p) => p.name === arg)) return false;
    await activateProfile(arg);
    return true;
  }
  const fn = Object.hasOwn(ACCOUNT_ACTIONS, name) ? ACCOUNT_ACTIONS[name] : null;
  if (fn) await fn();
  return !!fn;
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
  refreshNameInfo();
  return { errors };
});
// The game install's profiles, for the settings window's list. `gameDir`
// is the folder typed there (not yet saved), or the saved one.
ipcMain.handle('install:profiles', async (_e, gameDir) => {
  const dir = typeof gameDir === 'string' ? gameDir.trim() : settings.get('gameDir');
  const r = await installProfiles({ override: dir });
  return { gameDir: r.install?.gameDir ?? null, from: r.install?.from ?? null, missing: !!r.install?.missing, profiles: r.profiles };
});
ipcMain.handle('logs:get', () => ({ app: appLog.lines, sidecar: sidecarLog.lines, dir: logsDir }));
ipcMain.handle('logs:open-folder', () => shell.openPath(logsDir));
ipcMain.handle('notice:dismiss', () => { settings.update({ trayNoticeDismissed: true }); refreshUi(); });
ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
appLog.onLine((line) => broadcast('logs:line', { which: 'app', line }));
sidecarLog.onLine((line) => broadcast('logs:line', { which: 'sidecar', line }));

// ---- lifecycle -------------------------------------------------------------

app.on('second-instance', (_e, argv) => {
  if (!handleLink(linkFromArgv(argv))) showPanel();
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
  createAccount();
  createTray();
  // No tray on this desktop: the panel window is the app, and says why.
  if (trayState.visible === false) showPanel();
  refreshServers();
  refreshNameInfo();
  serversTimer = setInterval(refreshServers, SERVER_REFRESH_MS);
  handleLink(linkFromArgv(process.argv));
});

app.on('will-quit', () => { clearInterval(serversTimer); });
