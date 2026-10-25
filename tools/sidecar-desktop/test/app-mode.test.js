'use strict';
// Tray mode and window mode (src/app-mode.js), the tray hint, and the bus
// watch (src/tray-support.js watchTray) against a stand-in gdbus.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const {
  appMode, watchesTray, startAtLoginShown, onPanelHidden, HIDDEN_NOTICE, modeTransition,
  parseOsRelease, distroFamily, trayHint, ENABLE_COMMAND, parseNameOwnerChanged,
} = require('../src/app-mode');
const { watchTray, WATCHER } = require('../src/tray-support');
const { panelState } = require('../src/panel-state');
const { desktopEntry } = require('../src/linux-integration');

test('the mode: tray where one is seen, window where none is', () => {
  assert.equal(appMode({ platform: 'win32', trayVisible: false }), 'tray', 'Windows always has a tray');
  assert.equal(appMode({ platform: 'linux', trayVisible: true }), 'tray');
  assert.equal(appMode({ platform: 'linux', trayVisible: false }), 'window');
  assert.equal(appMode({ platform: 'linux', trayVisible: null }), 'tray', 'cannot tell: trust the tray');
  assert.equal(appMode({ platform: 'linux', trayVisible: true, forced: 'window' }), 'window', 'SIDECAR_DESKTOP_PANEL=window fakes no tray');
  assert.equal(appMode({ platform: 'linux', trayVisible: false, forced: 'popup' }), 'tray');
  assert.equal(watchesTray({ platform: 'linux' }), true);
  assert.equal(watchesTray({ platform: 'linux', forced: 'window' }), false, 'a forced mode stays put');
  assert.equal(watchesTray({ platform: 'win32' }), false);
});

test('Start at login: tray mode only', () => {
  assert.equal(startAtLoginShown('tray'), true);
  assert.equal(startAtLoginShown('window'), false);
});

test('hiding the panel: the window-mode notice once, never in tray mode', () => {
  assert.deepEqual(onPanelHidden({ mode: 'window', noticeShown: false }), { notify: true });
  assert.deepEqual(onPanelHidden({ mode: 'window', noticeShown: true }), { notify: false });
  assert.deepEqual(onPanelHidden({ mode: 'tray', noticeShown: false }), { notify: false });
  assert.equal(`${HIDDEN_NOTICE.title}. ${HIDDEN_NOTICE.body}`,
    'bfstats Sidecar is still running. Open it again from your app launcher; quit from its Quit button.');
});

test('switching modes live', () => {
  assert.equal(modeTransition('tray', 'tray'), null);
  assert.deepEqual(modeTransition('window', 'tray', { panelVisible: true }),
    { createTray: true, destroyTray: false, rebuildPanel: true, showPanel: false, notifyTray: true });
  assert.equal(modeTransition('window', 'tray', { panelVisible: false }).notifyTray, false, 'a hidden window moves quietly');
  assert.deepEqual(modeTransition('tray', 'window'),
    { createTray: false, destroyTray: true, rebuildPanel: true, showPanel: true, notifyTray: false });
});

test('os-release: quoted, unquoted, comments, escapes', () => {
  const r = parseOsRelease([
    '# a comment', 'NAME="Fedora Linux"', 'ID=fedora', "VERSION_ID='41'", 'PRETTY_NAME="A \\"quoted\\" name"', '', 'junk line',
  ].join('\n'));
  assert.deepEqual(r, { NAME: 'Fedora Linux', ID: 'fedora', VERSION_ID: '41', PRETTY_NAME: 'A "quoted" name' });
  assert.deepEqual(parseOsRelease(''), {});
  assert.deepEqual(parseOsRelease(undefined), {});
});

test('the distro family, by ID then ID_LIKE', () => {
  const fam = (text) => distroFamily(parseOsRelease(text));
  assert.equal(fam('ID=arch'), 'arch');
  assert.equal(fam('ID=endeavouros\nID_LIKE=arch'), 'arch');
  assert.equal(fam('ID=manjaro\nID_LIKE="arch"'), 'arch');
  assert.equal(fam('ID=fedora'), 'fedora');
  assert.equal(fam('ID="rocky"\nID_LIKE="rhel centos fedora"'), 'fedora');
  assert.equal(fam('ID=debian'), 'debian');
  assert.equal(fam('ID=ubuntu\nID_LIKE=debian'), 'debian');
  assert.equal(fam('ID=pop\nID_LIKE="ubuntu debian"'), 'debian');
  assert.equal(fam('ID=opensuse-tumbleweed\nID_LIKE="opensuse suse"'), null);
  assert.equal(distroFamily({}), null);
});

test("the tray hint: this PC's install line first, then the rest", () => {
  const arch = trayHint({ osRelease: { ID: 'arch', NAME: 'Arch Linux' }, gnome: true });
  assert.equal(arch.gnome, true);
  assert.deepEqual(arch.installs.map((i) => [i.family, i.detected]), [['arch', true], ['fedora', false], ['debian', false]]);
  assert.equal(arch.installs[0].command, 'sudo pacman -S gnome-shell-extension-appindicator');
  assert.equal(arch.enable, ENABLE_COMMAND);
  assert.equal(ENABLE_COMMAND, 'gnome-extensions enable appindicatorsupport@rgcjonas.gmail.com');
  const ubuntu = trayHint({ osRelease: { ID: 'ubuntu', ID_LIKE: 'debian' }, gnome: true });
  assert.deepEqual(ubuntu.installs.map((i) => i.family), ['debian', 'arch', 'fedora']);
  assert.equal(ubuntu.installs[0].command, 'sudo apt install gnome-shell-extension-appindicator');
  const fedora = trayHint({ osRelease: { ID: 'fedora' }, gnome: true });
  assert.equal(fedora.installs[0].command, 'sudo dnf install gnome-shell-extension-appindicator');
  const other = trayHint({ osRelease: { ID: 'opensuse-tumbleweed' }, gnome: true });
  assert.deepEqual(other.installs.map((i) => [i.family, i.detected]), [['arch', false], ['fedora', false], ['debian', false]], 'unknown: all three, none marked');
  const notGnome = trayHint({ osRelease: { ID: 'arch' }, gnome: false });
  assert.deepEqual([notGnome.gnome, notGnome.installs, notGnome.enable], [false, [], null], 'the extension is GNOME only');
});

test('the panel carries the hint in window mode only', () => {
  const hint = trayHint({ osRelease: { ID: 'arch' }, gnome: true });
  const win = panelState({ session: null, servers: [], settings: { recent: [] }, mode: 'window', hint, tray: { visible: true } });
  assert.equal(win.trayless, true);
  assert.equal(win.hint, hint);
  const tray = panelState({ session: null, servers: [], settings: { recent: [] }, mode: 'tray', hint, tray: { visible: false } });
  assert.deepEqual([tray.trayless, tray.hint], [false, null]);
});

test('the launcher entry: shown in the app launcher, with the icon', () => {
  const e = desktopEntry({ exec: ['/opt/app'], icon: '/i.png' });
  assert.doesNotMatch(e, /NoDisplay/);
  assert.match(e, /^Icon=\/i\.png$/m);
  assert.match(e, /^Name=bfstats Sidecar$/m);
  assert.match(e, /^Keywords=.*BF1942/m);
});

test('NameOwnerChanged lines from gdbus monitor', () => {
  assert.deepEqual(parseNameOwnerChanged("/org/freedesktop/DBus: org.freedesktop.DBus.NameOwnerChanged ('org.kde.StatusNotifierWatcher', '', ':1.42')"),
    { name: 'org.kde.StatusNotifierWatcher', oldOwner: '', newOwner: ':1.42' });
  assert.deepEqual(parseNameOwnerChanged("/org/freedesktop/DBus: org.freedesktop.DBus.NameOwnerChanged ('org.kde.StatusNotifierWatcher', ':1.42', '')").newOwner, '');
  assert.equal(parseNameOwnerChanged('Monitoring signals on object /org/freedesktop/DBus owned by org.freedesktop.DBus'), null);
});

/** A stand-in for `gdbus monitor`: a child whose stdout the test writes. */
function fakeMonitor() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => { child.killed = true; };
  return child;
}
const line = (name, from, to) => `/org/freedesktop/DBus: org.freedesktop.DBus.NameOwnerChanged ('${name}', '${from}', '${to}')\n`;
const tick = () => new Promise((r) => setImmediate(r));

test('watchTray: the monitor reports the watcher coming and going', async () => {
  const child = fakeMonitor();
  const seen = [];
  let owned = false;
  const stop = watchTray({ initial: false, onChange: (h) => seen.push(h), owner: async () => owned, spawnFn: () => child });
  child.stdout.write('Monitoring signals on object /org/freedesktop/DBus owned by org.freedesktop.DBus\n');
  await tick();
  child.stdout.write(line('org.example.Other', '', ':1.9'));
  child.stdout.write(line(WATCHER, '', ':1.42'));
  await tick();
  child.stdout.write(line(WATCHER, '', ':1.42'));   // no change: not reported twice
  child.stdout.write(line(WATCHER, ':1.42', ''));
  await tick();
  assert.deepEqual(seen, [true, false]);
  stop();
  assert.equal(child.killed, true);
});

test('watchTray: the first line rechecks, catching a change before the monitor was up', async () => {
  const child = fakeMonitor();
  const seen = [];
  const stop = watchTray({ initial: false, onChange: (h) => seen.push(h), owner: async () => true, spawnFn: () => child });
  child.stdout.write('Monitoring signals on object /org/freedesktop/DBus owned by org.freedesktop.DBus\n');
  await tick(); await tick();
  assert.deepEqual(seen, [true]);
  stop();
});

test('watchTray: no gdbus monitor falls back to polling NameHasOwner', async () => {
  const child = fakeMonitor();
  const seen = [];
  let owned = false;
  const stop = watchTray({ initial: false, pollMs: 10, onChange: (h) => seen.push(h), owner: async () => owned, spawnFn: () => child });
  child.emit('error', new Error('spawn gdbus ENOENT'));
  owned = true;
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(seen, [true]);
  owned = null;                                       // cannot tell: no change
  await new Promise((r) => setTimeout(r, 30));
  owned = false;
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(seen, [true, false]);
  stop();
});
