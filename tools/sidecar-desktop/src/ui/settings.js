'use strict';

const api = window.sidecarApp;
const $ = (id) => document.getElementById(id);
const fields = ['playerName', 'team', 'viewerBase', 'wsPort', 'gameDir'];
let defaults = {};
let savedProfile = '';

function example() {
  const base = $('viewerBase').value.trim() || defaults.viewerBase;
  $('viewer-example').textContent = `${base.replace(/\/?$/, '/')}map.html?sidecar=127.0.0.1:${$('wsPort').value || 17942}`;
}

const nameSource = () => document.querySelector('input[name="nameSource"]:checked')?.value ?? 'page';

function showSource() {
  $('install-fields').hidden = nameSource() !== 'install';
}

/** The install's profiles, for the list: the folder typed, else the saved one. */
async function scan() {
  const note = $('install-note');
  const select = $('installProfile');
  note.textContent = 'Looking for the game...';
  const r = await api.installProfiles($('gameDir').value);
  select.textContent = '';
  if (!r.gameDir || r.missing) {
    note.textContent = r.missing ? `No Mods/bf1942/Settings in ${r.gameDir}` : 'No game install found on this PC.';
    select.disabled = true;
    return;
  }
  const current = r.profiles.find((p) => p.current);
  const first = document.createElement('option');
  first.value = '';
  first.textContent = current ? `The game's current profile (${current.playerName})` : "The game's current profile";
  select.append(first);
  for (const p of r.profiles) {
    const o = document.createElement('option');
    o.value = p.folder;
    o.textContent = p.folder === p.playerName ? p.playerName : `${p.playerName} (${p.folder})`;
    select.append(o);
  }
  select.disabled = !r.profiles.length;
  select.value = r.profiles.some((p) => p.folder === savedProfile) ? savedProfile : '';
  note.textContent = r.profiles.length
    ? `${r.profiles.length} profile${r.profiles.length === 1 ? '' : 's'} in ${r.gameDir} (${r.from})`
    : `No profiles in ${r.gameDir}`;
}

api.settings().then((s) => {
  defaults = s.defaults;
  for (const f of fields) $(f).value = s[f] ?? '';
  $('startAtLogin').checked = !!s.startAtLogin;
  savedProfile = s.installProfile || '';
  const radio = document.querySelector(`input[name="nameSource"][value="${s.nameSource || 'page'}"]`);
  if (radio) radio.checked = true;
  showSource();
  example();
  scan();
});

for (const r of document.querySelectorAll('input[name="nameSource"]')) r.addEventListener('change', showSource);
$('rescan').addEventListener('click', scan);
$('viewerBase').addEventListener('input', example);
$('wsPort').addEventListener('input', example);
$('preset-live').addEventListener('click', () => { $('viewerBase').value = defaults.viewerBase; example(); });
$('preset-local').addEventListener('click', () => { $('viewerBase').value = defaults.localViewer; example(); });
$('cancel').addEventListener('click', () => api.closeWindow());

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  for (const el of document.querySelectorAll('[data-error]')) el.textContent = '';
  const patch = {
    nameSource: nameSource(),
    installProfile: $('installProfile').value,
    gameDir: $('gameDir').value,
    playerName: $('playerName').value,
    team: Number($('team').value),
    viewerBase: $('viewerBase').value,
    wsPort: Number($('wsPort').value),
    startAtLogin: $('startAtLogin').checked,
  };
  const { errors } = await api.saveSettings(patch);
  for (const [k, msg] of Object.entries(errors)) {
    const el = document.querySelector(`[data-error="${k}"]`);
    if (el) el.textContent = msg;
  }
  if (!errors.installProfile) savedProfile = patch.installProfile;
  $('saved').textContent = Object.keys(errors).length ? '' : 'Saved';
  setTimeout(() => { $('saved').textContent = ''; }, 2000);
});
