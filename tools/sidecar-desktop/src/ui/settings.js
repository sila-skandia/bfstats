'use strict';

const api = window.sidecarApp;
const $ = (id) => document.getElementById(id);
const fields = ['playerName', 'team', 'viewerBase', 'wsPort'];
let defaults = {};

function example() {
  const base = $('viewerBase').value.trim() || defaults.viewerBase;
  $('viewer-example').textContent = `${base.replace(/\/?$/, '/')}map.html?sidecar=127.0.0.1:${$('wsPort').value || 17942}`;
}

api.settings().then((s) => {
  defaults = s.defaults;
  for (const f of fields) $(f).value = s[f];
  $('startAtLogin').checked = !!s.startAtLogin;
  example();
});

$('viewerBase').addEventListener('input', example);
$('wsPort').addEventListener('input', example);
$('preset-live').addEventListener('click', () => { $('viewerBase').value = defaults.viewerBase; example(); });
$('preset-local').addEventListener('click', () => { $('viewerBase').value = defaults.localViewer; example(); });
$('cancel').addEventListener('click', () => api.closeWindow());

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  for (const el of document.querySelectorAll('[data-error]')) el.textContent = '';
  const patch = {
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
  $('saved').textContent = Object.keys(errors).length ? '' : 'Saved';
  setTimeout(() => { $('saved').textContent = ''; }, 2000);
});
