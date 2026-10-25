'use strict';
// The tray's right-click menu, as data: a brief of where you are (the
// session's state, server, map and name), Open panel, and Quit. Everything
// else lives in the popup panel (src/panel-state.js, src/ui/panel.*), which
// draws its own view of the same context; new features go there.
//
// Each section is a function of the app's context that returns items; the
// menu is the sections in order with separators between them. An item is
//   { id, label, click?, enabled?, type?: 'checkbox'|'radio'|'normal', checked?, submenu?: [items] }
// `id` must be unique and stable.

const { sessionLines } = require('./sidecar-status');
const { accountSection } = require('./panel-state');

// Electron reads '&' in a label as a mnemonic marker on Windows and Linux.
const text = (s) => String(s).replace(/&/g, '&&');
// Long server names would widen the whole menu.
const MAX_LABEL = 60;
const clip = (s) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 3)}...` : s);

// The panel holds everything else: joining, the server list, recent servers,
// the viewer, leaving, logs, settings. A left click on the icon opens it on
// Windows and KDE; GNOME's AppIndicator opens this menu on a single click and
// activates the app (the panel) on a double click.
const panelSection = (ctx) => (ctx.actions.openPanel
  ? [{ id: 'open-panel', label: 'Open panel', click: () => ctx.actions.openPanel() }]
  : []);

// The session header: state, then the server and what it plays, then the
// session's own actions. Not on a server, it is one line and no actions.
const statusSection = (ctx) => {
  const s = ctx.session;
  const { title, lines } = sessionLines(s);
  const items = [
    { id: 'status', label: text(title), enabled: false },
    ...lines.map((l, i) => ({ id: `status-${i}`, label: text(clip(l)), enabled: false })),
  ];
  if (s?.state === 'joined' && s.pageConnected === false) items.push({ id: 'status-page', label: 'Viewer not connected', enabled: false });
  return items;
};

// The account (features/app-sign-in): signed out, "Sign in..."; waiting for
// the browser, a line and Cancel; signed in, a Profile submenu of radio items
// (player name and profile name) that switches the active profile.
const accountMenu = (ctx) => {
  const a = accountSection(ctx.account);
  if (!a) return [];
  if (a.status === 'waiting') {
    return [
      { id: 'account-waiting', label: 'Finish signing in in your browser', enabled: false },
      { id: 'account-cancel', label: 'Cancel sign-in', click: () => ctx.actions.cancelSignIn() },
    ];
  }
  if (a.status !== 'signedIn') return [{ id: 'account-sign-in', label: 'Sign in...', click: () => ctx.actions.signIn() }];
  const profiles = a.profiles ?? [];
  const submenu = profiles.length
    ? profiles.map((p, i) => ({
      id: `profile-${i}`,
      type: 'radio',
      checked: !!p.active,
      label: text(clip(p.playsAs.toLowerCase() === p.name.toLowerCase() ? p.playsAs : `${p.playsAs}  (${p.name})`)),
      click: () => { if (!p.active) ctx.actions.activateProfile(p.name); },
    }))
    : [{ id: 'profile-none', label: a.loaded ? 'No profiles yet' : 'Loading...', enabled: false }];
  submenu.push({ id: 'profile-sep', type: 'separator' });
  submenu.push({ id: 'profile-import', label: 'Import profiles on bfstats.io', click: () => ctx.actions.openImport() });
  const active = profiles.find((p) => p.active);
  return [{ id: 'account-profile', label: text(clip(active ? `Profile: ${active.playsAs}` : 'Profile')), submenu }];
};

const quitSection = (ctx) => [
  { id: 'quit', label: 'Quit', click: () => ctx.actions.quit() },
];

const SECTIONS = [statusSection, accountMenu, panelSection, quitSection];

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
