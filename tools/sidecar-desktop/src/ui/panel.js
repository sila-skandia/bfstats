'use strict';
// The popup panel: the session card, the server browser and the name the
// app joins as. It draws `state.panel` (src/panel-state.js) from the same
// app:state broadcast the tray menu is built beside; actions go back through
// the preload bridge (src/preload.js).

const api = window.sidecarApp;
const mode = new URLSearchParams(location.search).get('mode') === 'window' ? 'window' : 'popup';
document.body.dataset.mode = mode;

const $ = (id) => document.getElementById(id);
const RENDER_MAX = 60;                 // rows drawn before "Show all"
const missingThumbs = new Set();       // map images that 404'd: not asked for again

let state = null;
let tab = 'live';
let query = '';
let showAll = false;
let cardKey = '';
let listKey = '';

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids) if (kid != null && kid !== false) e.append(kid);
  return e;
}

const svgUse = (id) => {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(ns, 'use');
  u.setAttribute('href', `#${id}`);
  s.append(u);
  return s;
};

const title = (s) => String(s ?? '').replace(/_/g, ' ').replace(/\b([a-z])/g, (c) => c.toUpperCase());
// As src/sidecar-status.js gameTypeTitle (the renderer cannot require it).
const GAME_TYPES = { conquest: 'Conquest', ctf: 'CTF', tdm: 'TDM', coop: 'Co-op', objectivemode: 'Objective', objective: 'Objective' };
const gameType = (t) => (t ? GAME_TYPES[String(t).toLowerCase()] ?? title(t) : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** An <img> of a map that fades in once loaded and hides for good on a 404. */
function mapImg(url, onMissing) {
  if (!url || missingThumbs.has(url)) return null;
  const img = el('img', { src: url, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
  img.addEventListener('load', () => img.classList.add('loaded'));
  img.addEventListener('error', () => { missingThumbs.add(url); img.remove(); onMissing?.(); });
  return img;
}

// ---- the round clock -------------------------------------------------------

function roundLeft(card, at, now = Date.now()) {
  if (card?.roundTimeRemain == null || !at) return null;
  return Math.max(0, Math.round(card.roundTimeRemain - (now - at) / 1000));
}
const clockText = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function tickClock() {
  const c = document.querySelector('.clock [data-clock]');
  if (!c || !state?.panel?.card) return;
  const left = roundLeft(state.panel.card, state.panel.serversAt);
  if (left != null) c.textContent = clockText(left);
}
setInterval(tickClock, 1000);

// ---- header, notice, footer ------------------------------------------------

const STATE_WORDS = {
  starting: 'Joining', listening: 'Joining', connecting: 'Joining', unreachable: 'No answer yet',
  joined: 'In game', rejoining: 'Rejoining', leaving: 'Leaving',
};

function renderChrome(s) {
  const p = s.panel;
  $('head-dot').dataset.dot = p.dot ?? '';
  $('head-state').textContent = p.card ? (STATE_WORDS[p.card.state] ?? p.card.state) : (p.lastEnded ? 'Session ended' : 'Idle');
  $('notice').hidden = !(p.trayless && !s.trayNoticeDismissed);
  $('foot-quit').hidden = !p.trayless;
  const foot = $('foot-name');
  const n = p.name;
  foot.replaceChildren('Name from ', el('b', { text: n.label }), n.fromPage ? '' : `: ${n.name || 'none'}`);
  foot.title = n.fromPage
    ? `The name of your bfstats.io profile, sent by the viewer as it opens (fallback ${n.name})`
    : `Joins as ${n.name}${n.detail ? ` (${n.detail})` : ''}`;
  $('count-live').textContent = p.serversTotal ? String(p.serversTotal) : '';
  $('count-recent').textContent = p.recent.length ? String(p.recent.length) : '';
}

// ---- the session card ------------------------------------------------------

function renderCard(s) {
  const p = s.panel;
  const key = JSON.stringify([p.card, p.lastEnded, p.name, p.serversAt]);
  if (key === cardKey) return;
  const first = !cardKey;
  const wasLive = cardKey.startsWith('[{');
  cardKey = key;
  const card = $('card');
  const c = p.card;
  card.className = c ? 'card live' : 'card idle';
  if (!first && wasLive !== !!c) { card.classList.add('enter'); }

  if (!c) {
    const who = p.name.fromPage
      ? [el('span', { text: 'Joins as your ' }), el('b', { text: 'viewer profile' })]
      : [el('span', { text: 'Joins as ' }), el('b', { text: p.name.name || 'no name' })];
    card.replaceChildren(el('div', { class: 'card-body' },
      el('div', { class: 'idle-mark' }, svgUse('i-play')),
      el('div', { class: 'idle-text' },
        el('div', { class: 'title', text: 'Not on a server' }),
        el('div', { class: 'sub' }, ...who),
        p.lastEnded ? el('div', { class: 'ended', title: p.lastEnded, text: `Last session: ${p.lastEnded}` }) : null,
      ),
    ));
    return;
  }

  const art = el('div', { class: 'art', 'aria-hidden': 'true' });
  const img = mapImg(c.thumb);
  if (img) art.append(img);

  const left = roundLeft(c, p.serversAt);
  const clock = left != null
    ? el('div', { class: 'clock' }, el('span', { 'data-clock': '', text: clockText(left) }), el('small', { text: 'round left' }))
    : null;

  const meta = [c.map, c.gameType].filter(Boolean).join(', ');
  const players = c.players != null ? (c.maxPlayers ? `${c.players}/${c.maxPlayers}` : `${c.players}`) : null;

  let tickets = null;
  if (c.tickets1 != null && c.tickets2 != null) {
    const total = Math.max(1, c.tickets1 + c.tickets2);
    const a = el('i'); const b = el('i');
    a.style.setProperty('flex-grow', String(c.tickets1 / total));
    b.style.setProperty('flex-grow', String(c.tickets2 / total));
    const split = el('div', { class: 'split' }, a, b);
    split.style.setProperty('--t1', teamColor(c.team1, 1));
    split.style.setProperty('--t2', teamColor(c.team2, 2));
    tickets = el('div', { class: 'tickets', title: 'Tickets, as the live list last saw them' },
      el('span', { class: 't1' }, el('span', { class: 'team', text: c.team1 ?? 'Team 1' }), String(c.tickets1)),
      split,
      el('span', { class: 't2' }, String(c.tickets2), el('span', { class: 'team', text: c.team2 ?? 'Team 2' })),
    );
  }

  let who;
  if (c.playerName) who = el('div', { class: 'who' }, svgUse('i-user'), el('span', { text: 'Playing as' }), el('b', { text: c.playerName }));
  else if (c.waitingForName) who = el('div', { class: 'who' }, svgUse('i-user'), el('span', { text: "Waiting for the viewer's profile" }));
  if (c.state === 'joined' && !c.pageConnected && who) who.append(el('span', { class: 'warn', text: '  Viewer not connected' }));
  if (c.state === 'unreachable' && c.detail) who = el('div', { class: 'who' }, el('span', { class: 'warn', text: c.detail }));

  card.replaceChildren(art, el('div', { class: 'card-body' },
    el('div', { class: 'card-top' },
      el('span', { class: 'chip' }, el('span', { class: 'dot', 'data-dot': c.dot ?? '' }), STATE_WORDS[c.state] ?? c.state),
      clock,
    ),
    el('h2', { class: 'card-name', title: c.name, text: c.name }),
    el('div', { class: 'card-meta' },
      meta ? el('span', { class: 'grow', text: meta }) : null,
      meta && players ? el('span', { class: 'sep', text: '/' }) : null,
      players ? el('span', { text: `${players} ${c.players === 1 && !c.maxPlayers ? 'player' : 'players'}` }) : null,
    ),
    el('div', { class: 'card-meta where' }, el('span', { class: 'addr', text: c.mod ? `${c.address}  ${c.mod}` : c.address })),
    tickets,
    who,
    el('div', { class: 'card-actions' },
      el('button', { class: 'btn primary', type: 'button', disabled: !c.canOpenViewer, onclick: () => api.panelAction('openViewer') }, svgUse('i-play'), 'Open viewer'),
      el('button', { class: 'btn ghost danger', type: 'button', disabled: !c.canLeave, onclick: () => api.panelAction('leave') }, svgUse('i-exit'), 'Leave'),
    ),
  ));
}

// The site's team colours (ui/src/views/v4/mmTokens.ts teamColor).
function teamColor(label, index) {
  const l = String(label ?? `team ${index}`).toLowerCase();
  if (/axis|german|red|north|nva|team 2/.test(l)) return 'var(--axis)';
  if (/alli|usa|blue|south|team 1/.test(l)) return 'var(--allies)';
  return 'var(--accent)';
}

// ---- the server browser ----------------------------------------------------

function loadOf(s) {
  if (!s.numPlayers) return 'idle';
  const r = s.maxPlayers ? s.numPlayers / s.maxPlayers : 0;
  if (r >= 1) return 'full';
  return r >= 0.66 ? 'busy' : 'ok';
}

function matches(s, q) {
  if (!q) return true;
  return [s.name, s.mapName, s.gameId, s.gameType, `${s.ip}:${s.port}`].some((v) => v && String(v).toLowerCase().includes(q));
}

function serverRow(s, current) {
  const address = `${s.ip}:${s.port}`;
  const isCurrent = current === address;
  const thumb = el('div', { class: 'thumb' });
  const letter = el('span', { class: 'mono-letter', text: (s.mapName || s.name || '?').trim().slice(0, 2).toUpperCase() });
  const img = mapImg(s.thumb, () => thumb.append(letter));
  thumb.append(img ?? letter);
  const sub = [title(s.mapName), gameType(s.gameType), s.gameId && s.gameId !== 'bf1942' ? s.gameId : null].filter(Boolean).join('  ·  ');
  const pct = s.maxPlayers ? Math.min(100, Math.round((s.numPlayers / s.maxPlayers) * 100)) : 0;
  const bar = el('i');
  bar.style.setProperty('--fill', `${Math.max(pct, s.numPlayers ? 4 : 0)}%`);
  return el('button', {
    class: 'row', type: 'button', role: 'listitem', 'data-load': loadOf(s),
    'aria-current': isCurrent ? 'true' : false,
    title: isCurrent ? `On ${s.name}` : `Join ${s.name} (${address})${s.anticheat ? '\nAnti-cheat on: the sidecar may be kicked' : ''}`,
    onclick: () => { if (!isCurrent) api.joinServer({ ip: s.ip, port: s.port, name: s.name }); },
  },
  thumb,
  el('div', { class: 'row-main' },
    el('div', { class: 'row-name' },
      el('span', { text: s.name }),
      s.anticheat ? el('em', { class: 'badge ac', text: 'AC' }) : null,
      s.password ? el('em', { class: 'badge pw', text: 'PW' }) : null,
    ),
    el('div', { class: 'row-sub', text: sub || address }),
  ),
  el('div', { class: 'row-load' },
    el('span', { class: 'n' }, String(s.numPlayers), el('small', { text: `/${s.maxPlayers}` })),
    el('div', { class: 'bar' }, bar),
  ));
}

function recentRow(r, listed, current) {
  if (listed) return serverRow(listed, current);
  const isCurrent = current === r.address;
  return el('button', {
    class: 'row', type: 'button', role: 'listitem', 'data-load': 'idle',
    'aria-current': isCurrent ? 'true' : false,
    title: `Join ${r.name ?? r.address}`,
    onclick: () => { if (!isCurrent) api.join(r.address); },
  },
  el('div', { class: 'thumb' }, el('span', { class: 'mono-letter', text: r.name ? r.name.trim().slice(0, 2).toUpperCase() : 'IP' })),
  el('div', { class: 'row-main' },
    el('div', { class: 'row-name' }, el('span', { text: r.name || r.address })),
    el('div', { class: 'row-sub', text: r.name ? r.address : 'Not on the live list' }),
  ),
  el('div'));
}

function renderList(s) {
  const p = s.panel;
  const q = query.trim().toLowerCase();
  const key = JSON.stringify([tab, q, showAll, p.current, p.serversAt, p.serversError, p.recent, tab === 'live' ? p.servers.length : 0]);
  if (key === listKey) return;
  listKey = key;
  const list = $('list');
  const keepScroll = list.scrollTop;
  const out = [];

  if (tab === 'live') {
    const all = p.servers.filter((x) => matches(x, q));
    if (!p.servers.length) {
      out.push(el('div', { class: 'empty-note', text: p.serversError ? `Could not load the list: ${p.serversError}` : 'Loading servers...' }));
    } else if (!all.length) {
      out.push(el('div', { class: 'empty-note', text: `No server matches "${query.trim()}"` }));
    } else {
      const shown = showAll ? all : all.slice(0, RENDER_MAX);
      const populated = shown.filter((x) => x.numPlayers > 0);
      const empty = shown.filter((x) => !x.numPlayers);
      if (populated.length) {
        out.push(el('div', { class: 'group' }, el('span', { class: 'eyebrow', text: 'Populated' }),
          el('span', { class: 'eyebrow', text: plural(all.reduce((n, x) => n + x.numPlayers, 0), 'player') })));
        out.push(...populated.map((x) => serverRow(x, p.current)));
      }
      if (empty.length) {
        out.push(el('div', { class: 'group' }, el('span', { class: 'eyebrow', text: 'Empty' }),
          el('span', { class: 'eyebrow', text: String(all.filter((x) => !x.numPlayers).length) })));
        out.push(...empty.map((x) => serverRow(x, p.current)));
      }
      if (all.length > shown.length) {
        out.push(el('button', { class: 'btn small more', type: 'button', text: `Show all ${all.length}`, onclick: () => { showAll = true; renderList(state); } }));
      }
    }
  } else {
    const rec = p.recent.filter((r) => matches({ name: r.name, ip: r.address.split(':')[0], port: r.address.split(':')[1] }, q));
    if (!rec.length) {
      out.push(el('div', { class: 'empty-note', text: p.recent.length ? `No recent server matches "${query.trim()}"` : 'Servers you join show here.' }));
    } else {
      out.push(...rec.map((r) => recentRow(r, p.servers.find((x) => `${x.ip}:${x.port}` === r.address), p.current)));
      out.push(el('button', { class: 'btn small more', type: 'button', text: 'Clear recent', onclick: () => api.panelAction('clearRecent') }));
    }
  }
  list.replaceChildren(...out);
  list.scrollTop = keepScroll;
}

// ---- wiring ----------------------------------------------------------------

function render(s) {
  state = s;
  if (!s?.panel) return;
  renderChrome(s);
  renderCard(s);
  renderList(s);
  $('btn-refresh').classList.remove('spin');
}

function setTab(t) {
  tab = t;
  $('tab-live').setAttribute('aria-selected', String(t === 'live'));
  $('tab-recent').setAttribute('aria-selected', String(t === 'recent'));
  showAll = false;
  if (state) renderList(state);
}

$('tab-live').addEventListener('click', () => setTab('live'));
$('tab-recent').addEventListener('click', () => setTab('recent'));
$('search').addEventListener('input', (e) => { query = e.target.value; showAll = false; if (state) renderList(state); });
$('btn-refresh').addEventListener('click', () => { $('btn-refresh').classList.add('spin'); api.panelAction('refresh'); });
$('btn-settings').addEventListener('click', () => api.panelAction('settings'));
$('foot-settings').addEventListener('click', () => api.panelAction('settings'));
$('btn-logs').addEventListener('click', () => api.panelAction('logs'));
$('btn-close').addEventListener('click', () => api.panelAction('hide'));
// Escape closes the popup (main.js catches it too, before the page sees it).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mode === 'popup' && !e.defaultPrevented) api.panelAction('hide');
});
$('foot-quit').addEventListener('click', () => api.panelAction('quit'));
$('dismiss').addEventListener('click', () => api.dismissTrayNotice());

$('address-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('address');
  const r = await api.join(input.value);
  $('address-error').textContent = r.ok ? '' : r.error;
  input.setAttribute('aria-invalid', String(!r.ok));
  if (r.ok) input.value = '';
});
$('address').addEventListener('input', () => { $('address-error').textContent = ''; $('address').removeAttribute('aria-invalid'); });

api.onPanelShown(() => {
  document.body.dataset.shown = 'false';
  void document.body.offsetWidth;            // restart the entrance
  document.body.dataset.shown = 'true';
});
api.onState(render);
api.state().then(render);
