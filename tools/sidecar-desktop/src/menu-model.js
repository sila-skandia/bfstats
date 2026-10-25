'use strict';
// The tray menu, as data. Each section is a function of the app's context
// that returns items; the menu is the sections in order with separators
// between them. The same model drives the Electron tray menu and the
// fallback panel window (where there is no tray), so an item added here shows
// in both.
//
// To add an item ("a little trick for discoverability"): write a section, or
// add to one, and put it in SECTIONS. An item is
//   { id, label, click?, enabled?, type?: 'checkbox'|'radio'|'normal', checked?, submenu?: [items] }
// `id` must be unique and stable; the panel window clicks by id.

const { describe } = require('./sidecar-status');
const { serverLabel } = require('./servers');

const SERVERS_SHOWN = 25;

// Electron reads '&' in a label as a mnemonic marker on Windows and Linux.
const text = (s) => String(s).replace(/&/g, '&&');

const statusSection = (ctx) => {
  const s = ctx.session;
  const items = [{ id: 'status', label: describe(s), enabled: false }];
  if (s?.state === 'joined' && s.pageConnected === false) items.push({ id: 'status-page', label: 'Viewer not connected', enabled: false });
  return items;
};

const joinSection = (ctx) => {
  const list = ctx.servers ?? [];
  const populated = list.filter((s) => s.numPlayers > 0);
  const empty = list.filter((s) => s.numPlayers === 0);
  const toItem = (s) => ({
    id: `server:${s.ip}:${s.port}`,
    label: text(serverLabel(s)),
    click: () => ctx.actions.join({ host: s.ip, port: s.port, serverName: s.name, mapName: s.mapName }),
  });
  const servers = [];
  if (ctx.serversError && !list.length) servers.push({ id: 'servers-error', label: `Could not load the list: ${ctx.serversError}`, enabled: false });
  if (!list.length && !ctx.serversError) servers.push({ id: 'servers-loading', label: 'Loading...', enabled: false });
  servers.push(...populated.slice(0, SERVERS_SHOWN).map(toItem));
  if (empty.length) {
    servers.push({ id: 'servers-empty', label: `Empty servers (${empty.length})`, submenu: empty.slice(0, 60).map(toItem) });
  }
  servers.push({ id: 'servers-sep', type: 'separator' });
  servers.push({ id: 'servers-note', label: '[AC] anti-cheat on: the sidecar may be kicked', enabled: false });
  servers.push({ id: 'servers-refresh', label: 'Refresh list', click: () => ctx.actions.refreshServers() });

  const recent = ctx.settings.recent ?? [];
  const recentItems = recent.length
    ? [
      ...recent.map((r) => ({
        id: `recent:${r.address}`,
        label: text(r.name ? `${r.name} (${r.address})` : r.address),
        click: () => ctx.actions.joinAddress(r.address, { serverName: r.name }),
      })),
      { id: 'recent-sep', type: 'separator' },
      { id: 'recent-clear', label: 'Clear recent', click: () => ctx.actions.clearRecent() },
    ]
    : [{ id: 'recent-none', label: 'None yet', enabled: false }];

  return [
    { id: 'join', label: 'Join server', submenu: servers },
    { id: 'recent', label: 'Recent servers', submenu: recentItems },
    { id: 'join-address', label: 'Join by address...', click: () => ctx.actions.openJoinWindow() },
  ];
};

const sessionSection = (ctx) => {
  const live = !!ctx.session && !['idle', 'failed', 'ended', 'denied'].includes(ctx.session.state);
  return [
    { id: 'open-viewer', label: 'Open viewer', enabled: live, click: () => ctx.actions.openViewer() },
    { id: 'leave', label: 'Leave server', enabled: live, click: () => ctx.actions.leave() },
  ];
};

const appSection = (ctx) => [
  { id: 'logs', label: 'View logs', click: () => ctx.actions.openLogs() },
  { id: 'settings', label: 'Settings...', click: () => ctx.actions.openSettings() },
  { id: 'start-at-login', label: 'Start at login', type: 'checkbox', checked: !!ctx.startAtLogin, click: () => ctx.actions.toggleStartAtLogin() },
];

const quitSection = (ctx) => [
  { id: 'quit', label: 'Quit', click: () => ctx.actions.quit() },
];

const SECTIONS = [statusSection, joinSection, sessionSection, appSection, quitSection];

function buildModel(ctx, sections = SECTIONS) {
  const out = [];
  sections.forEach((section, i) => {
    const items = section(ctx);
    if (!items.length) return;
    if (out.length) out.push({ id: `sep-${i}`, type: 'separator' });
    out.push(...items);
  });
  return out;
}

/** The Electron Menu template of a model. */
function toTemplate(model) {
  return model.map((it) => {
    if (it.type === 'separator') return { type: 'separator' };
    const t = { id: it.id, label: it.label, enabled: it.enabled !== false };
    if (it.type) t.type = it.type;
    if (it.checked !== undefined) t.checked = it.checked;
    if (it.submenu) t.submenu = toTemplate(it.submenu);
    if (it.click) t.click = () => it.click();
    return t;
  });
}

/** The model without its functions, for the panel window. */
function toPlain(model) {
  return model.map((it) => {
    const p = { id: it.id, label: it.label, type: it.type ?? 'normal', enabled: it.enabled !== false };
    if (it.checked !== undefined) p.checked = !!it.checked;
    if (it.submenu) p.submenu = toPlain(it.submenu);
    p.clickable = !!it.click;
    return p;
  });
}

function findById(model, id) {
  for (const it of model) {
    if (it.id === id) return it;
    if (it.submenu) { const f = findById(it.submenu, id); if (f) return f; }
  }
  return null;
}

module.exports = { SECTIONS, buildModel, toTemplate, toPlain, findById };
