'use strict';
// The panel: the tray menu's own model (src/menu-model.js), drawn as a list.
// Where the desktop has no tray it is the app's face.

const api = window.sidecarApp;
const menuEl = document.getElementById('menu');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const notice = document.getElementById('notice');
const openSubmenus = new Set();

// Electron labels escape '&' as '&&'.
const label = (s) => String(s).replace(/&&/g, '&');

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids) if (kid) e.append(kid);
  return e;
}

function renderItems(items, parent) {
  for (const it of items) {
    if (it.type === 'separator') { parent.append(el('li', { class: 'sep', role: 'separator' })); continue; }
    if (it.submenu) {
      const details = el('details', { open: openSubmenus.has(it.id) });
      details.addEventListener('toggle', () => (details.open ? openSubmenus.add(it.id) : openSubmenus.delete(it.id)));
      const summary = el('summary', { class: 'item' }, el('span', { text: label(it.label) }), el('span', { class: 'chev', text: '>', 'aria-hidden': 'true' }));
      const sub = el('ul', { class: 'sub' });
      renderItems(it.submenu, sub);
      details.append(summary, sub);
      parent.append(el('li', {}, details));
      continue;
    }
    if (!it.clickable) {
      parent.append(el('li', {}, el('div', { class: 'item info', text: label(it.label) })));
      continue;
    }
    const kids = [el('span', { text: label(it.label) })];
    if (it.type === 'checkbox') kids.push(el('span', { class: 'check', text: it.checked ? '[on]' : '[off]' }));
    const btn = el('button', { class: 'item', type: 'button', disabled: !it.enabled, onclick: () => api.clickMenu(it.id) }, ...kids);
    parent.append(el('li', {}, btn));
  }
}

function render(state) {
  // The status line is the first item; it is drawn above the list.
  const items = state.model.filter((it) => it.id !== 'status' && !(it.type === 'separator' && it.id === 'sep-1'));
  statusEl.dataset.state = state.session?.state ?? 'idle';
  statusText.textContent = state.status;
  notice.hidden = !(state.tray?.visible === false && !state.trayNoticeDismissed);
  menuEl.replaceChildren();
  renderItems(items, menuEl);
}

document.getElementById('dismiss').addEventListener('click', () => api.dismissTrayNotice());
api.onState(render);
api.state().then(render);
