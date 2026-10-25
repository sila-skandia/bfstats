'use strict';
// The live tail of the sidecar's output and the app's own log.

const api = window.sidecarApp;
const pre = document.getElementById('log');
const scroller = document.getElementById('scroller');
const follow = document.getElementById('follow');
const MAX = 2000;
const lines = { sidecar: [], app: [] };
let tab = 'sidecar';

function lineEl(text) {
  const div = document.createElement('div');
  const m = /^(\S+) (.*)$/.exec(text);
  const body = m ? m[2] : text;
  if (m) {
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = `${m[1].slice(11, 19)} `;
    div.append(ts);
  }
  const span = document.createElement('span');
  if (body.startsWith('[app]')) span.className = 'app';
  if (/denied|failed|error|refused|not rejoining|EADDRINUSE/i.test(body)) span.className = 'warn';
  span.textContent = body;
  div.append(span);
  return div;
}

function render() {
  pre.replaceChildren(...lines[tab].map(lineEl));
  if (follow.checked) scroller.scrollTop = scroller.scrollHeight;
}

for (const b of document.querySelectorAll('[data-tab]')) {
  b.addEventListener('click', () => {
    tab = b.dataset.tab;
    for (const o of document.querySelectorAll('[data-tab]')) o.setAttribute('aria-selected', String(o === b));
    render();
  });
}

api.onLogLine(({ which, line }) => {
  const list = lines[which];
  if (!list) return;
  list.push(line);
  if (list.length > MAX) list.splice(0, list.length - MAX);
  if (which !== tab) return;
  pre.append(lineEl(line));
  while (pre.childNodes.length > MAX) pre.firstChild.remove();
  if (follow.checked) scroller.scrollTop = scroller.scrollHeight;
});

document.getElementById('folder').addEventListener('click', () => api.openLogFolder());
document.getElementById('copy').addEventListener('click', () => navigator.clipboard.writeText(lines[tab].join('\n')));

api.logs().then((r) => {
  lines.sidecar = [...r.sidecar];
  lines.app = [...r.app];
  document.getElementById('dir').textContent = r.dir;
  render();
});
