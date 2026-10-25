'use strict';
// Linux desktop integration without root: a .desktop entry in
// ~/.local/share/applications that handles bfstats-sidecar:// links, made the
// default handler with xdg-mime; and the autostart entry for "Start at login".
// Used by the packaged app (Exec = the AppImage) and by
// `npm run register-linux` (Exec = electron on this checkout).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const DESKTOP_ID = 'bfstats-sidecar.desktop';
const MIME = 'x-scheme-handler/bfstats-sidecar';

const dataHome = () => process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
const configHome = () => process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');

/** Quote one Exec argument per the desktop entry spec. */
function quoteExecArg(a) {
  if (!/[\s"'\\$`<>~|&;*?#()]/.test(a)) return a;
  return `"${a.replace(/([\\"`$])/g, '\\$1')}"`;
}

function desktopEntry({ exec, icon, name = 'bfstats Sidecar', withUrl = true, hidden = false }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${name}`,
    'Comment=Join BF1942 servers and play them in the browser',
    `Exec=${exec.map(quoteExecArg).join(' ')}${withUrl ? ' %u' : ''}`,
    icon ? `Icon=${icon}` : null,
    'Terminal=false',
    'Categories=Game;',
    withUrl ? `MimeType=${MIME};` : null,
    'StartupWMClass=bfstats-sidecar',
    hidden ? 'NoDisplay=true' : null,
    '',
  ].filter((l) => l !== null).join('\n');
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10000 }, (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr, error: err?.message }));
  });
}

/** A stable copy of the icon: an AppImage's own files vanish when it exits. */
function installIcon(src) {
  if (!src) return null;
  const dest = path.join(dataHome(), 'icons', 'hicolor', '512x512', 'apps', 'bfstats-sidecar.png');
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, fs.readFileSync(src));
    return dest;
  } catch { return null; }
}

/** Write the handler entry and make it the default for the scheme. */
async function installProtocolHandler({ exec, icon }) {
  const dir = path.join(dataHome(), 'applications');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, DESKTOP_ID);
  fs.writeFileSync(file, desktopEntry({ exec, icon: installIcon(icon) }));
  const steps = [];
  steps.push(['update-desktop-database', await run('update-desktop-database', [dir])]);
  steps.push(['xdg-mime', await run('xdg-mime', ['default', DESKTOP_ID, MIME])]);
  const q = await run('xdg-mime', ['query', 'default', MIME]);
  return { file, default: q.stdout.trim(), ok: q.stdout.trim() === DESKTOP_ID, steps };
}

const autostartFile = () => path.join(configHome(), 'autostart', DESKTOP_ID);

function setAutostart(enabled, { exec, icon }) {
  const file = autostartFile();
  if (!enabled) { try { fs.unlinkSync(file); } catch { /* not there */ } return false; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, desktopEntry({ exec, icon: installIcon(icon), withUrl: false }));
  return true;
}

const autostartEnabled = () => fs.existsSync(autostartFile());

module.exports = { DESKTOP_ID, MIME, desktopEntry, installProtocolHandler, setAutostart, autostartEnabled, quoteExecArg };
