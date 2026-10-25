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
  renderNotice(p.trayless && !s.trayNoticeDismissed ? p.hint : undefined);
  const foot = $('foot-name');
  const n = p.name;
  foot.replaceChildren('Name from ', el('b', { text: n.label }), n.fromPage ? '' : `: ${n.name || 'none'}`);
  foot.title = n.fromPage
    ? `The name of your viewer profile, sent by the viewer as it opens (fallback ${n.name})${n.detail ? `. ${n.detail}` : ''}`
    : `Joins as ${n.name}${n.profile ? ` (profile ${n.profile})` : ''}${n.detail ? ` (${n.detail})` : ''}`;
  $('count-live').textContent = p.serversTotal ? String(p.serversTotal) : '';
  $('count-recent').textContent = p.recent.length ? String(p.recent.length) : '';
}

// ---- the tray hint (window mode) ---------------------------------------------

let noticeKey = '';

/** A command with a copy button; the button shows a tick once copied. */
function commandLine(command) {
  const btn = el('button', { class: 'icon-btn tiny copy', type: 'button', title: 'Copy', 'aria-label': `Copy ${command}` }, svgUse('i-copy'));
  btn.addEventListener('click', async () => {
    if (!(await api.copy(command))) return;
    btn.replaceChildren(svgUse('i-check'));
    btn.classList.add('done');
    setTimeout(() => { btn.replaceChildren(svgUse('i-copy')); btn.classList.remove('done'); }, 1400);
  });
  return el('div', { class: 'cmd' }, el('code', { text: command }), btn);
}

/** `hint` undefined hides it; null (no hint known) or a trayHint() draws it. */
function renderNotice(hint) {
  const box = $('notice');
  const key = JSON.stringify(hint ?? (hint === null ? 'none' : 'hidden'));
  if (key === noticeKey) return;
  noticeKey = key;
  box.hidden = hint === undefined;
  if (hint === undefined) { box.replaceChildren(); return; }
  const kids = [
    el('div', { class: 'eyebrow', text: 'No tray icon on this desktop' }),
    el('p', { text: 'Closing this window keeps the app running and on its server; open it again from your app launcher.' }),
  ];
  if (hint?.gnome) {
    const distro = (i) => el('div', { class: i.detected ? 'distro here' : 'distro' },
      el('span', { class: 'distro-name' }, i.label, i.detected ? el('em', { text: 'This PC' }) : null),
      commandLine(i.command));
    // This PC's line; the others fold away under it (all three when the distro is not known).
    const here = hint.installs.filter((i) => i.detected);
    const rest = hint.installs.filter((i) => !i.detected);
    const installs = here.length
      ? [...here.map(distro), el('details', { class: 'others' }, el('summary', { text: 'Other distros' }), ...rest.map(distro))]
      : rest.map(distro);
    kids.push(
      el('p', { text: "For the tray icon, add GNOME's AppIndicator extension:" }),
      el('ol', { class: 'steps' },
        el('li', {}, el('span', { class: 'step', text: 'Install it' }), ...installs),
        el('li', {}, el('span', { class: 'step', text: 'Log out and back in' })),
        el('li', {}, el('span', { class: 'step', text: 'Turn it on' }), commandLine(hint.enable))),
    );
  } else {
    kids.push(el('p', { text: 'A panel with a system tray (StatusNotifierItem) shows the icon.' }));
  }
  kids.push(el('div', { class: 'notice-foot' },
    el('span', { class: 'faint', text: 'The app moves to the tray once the icon can show.' }),
    el('button', { class: 'btn ghost small', type: 'button', onclick: () => api.dismissTrayNotice() }, 'Got it')));
  box.replaceChildren(...kids);
}

// ---- the bfstats.io account --------------------------------------------------

let accountKey = '';
let profilesOpen = false;
let switching = null;             // the profile name a click is switching to
// The sidecar name edit (features/game-profiles, "Sidecar name"): the profile
// being edited, the text typed so far (kept across re-renders), and the
// answer of a save that failed.
let editing = null;               // { name, draft, error, saving }

// As src/address.js sidecarNameError (the renderer cannot require it).
function sidecarNameError(name) {
  const t = String(name ?? '').trim();
  if (!t) return null;
  if (t.includes('"')) return 'No quotes';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(t)) return 'No control characters';
  if (/[^\u0000-\u00ff]/.test(t)) return 'Western European (Latin-1) letters only';
  if (t.length > 23) return 'At most 23 characters';
  return null;
}

const PROTECTION_NOTE = {
  basic_text: ['Sign-in saved without a keyring', 'No keyring service on this desktop: the sign-in is saved encrypted with a fixed key, so anyone who can read your files could use it. Installing gnome-keyring or KWallet protects it.'],
  memory: ['Sign-in not saved', 'This PC offers no encrypted storage: sign in again after the app restarts.'],
};

const rerenderAccount = () => { accountKey = ''; if (state) renderAccount(state); };

function profileRow(p) {
  if (editing?.name === p.name) return sidecarEditRow(p);
  const busy = switching === p.name;
  // The name a join uses, then (dimmed) the game's when the sidecar name differs, else the profile's.
  const second = p.renamed ? p.playerName : (p.name !== p.playsAs ? p.name : null);
  const pick = el('button', {
    class: 'prof', type: 'button', role: 'radio', 'aria-checked': String(p.active),
    'data-busy': busy ? 'true' : false,
    title: p.active ? `${p.playsAs} is the active profile` : `Play as ${p.playsAs} (profile ${p.name})`,
    onclick: async () => {
      if (p.active || switching) return;
      switching = p.name; accountKey = ''; render(state);
      try { await api.account('activate', p.name); } finally { switching = null; accountKey = ''; render(state); }
    },
  },
  el('span', { class: 'radio', 'aria-hidden': 'true' }),
  el('span', { class: 'prof-player', text: p.playsAs }),
  second ? el('span', { class: p.renamed ? 'prof-name prof-game' : 'prof-name', title: p.renamed ? `Game name ${p.playerName}, profile ${p.name}` : null, text: p.renamed ? `game: ${second}` : second }) : null,
  p.active ? el('span', { class: 'prof-tag', text: 'Active' }) : null);
  const pencil = el('button', {
    class: 'icon-btn tiny prof-edit', type: 'button',
    title: 'Sidecar name: the name you play as here', 'aria-label': `Sidecar name for ${p.name}`,
    'data-edit': p.name,
    onclick: () => { editing = { name: p.name, draft: p.sidecarName ?? '', error: null, saving: false, focus: true }; rerenderAccount(); },
  }, svgUse('i-pencil'));
  return el('div', { class: 'prof-row' }, pick, pencil);
}

/** The inline edit of one profile's sidecar name: Enter saves, Escape cancels, empty plays as the game name. */
function sidecarEditRow(p) {
  const e = editing;
  const why = sidecarNameError(e.draft) ?? e.error;
  const msg = el('div', { class: why ? 'prof-msg bad' : 'prof-msg', role: why ? 'alert' : null, 'data-msg': '' },
    why ?? (e.draft.trim() ? `Joins as ${e.draft.trim()}` : `Empty: joins as ${p.playerName}`));
  const save = async (clear = false) => {
    if (e.saving || (!clear && sidecarNameError(e.draft))) return;
    e.saving = true; e.error = null; rerenderAccount();
    const r = await api.account('sidecarName', { name: p.name, sidecarName: clear ? null : (e.draft.trim() || null) });
    if (editing !== e) return;
    e.saving = false;
    if (r?.ok) editing = null; else { e.error = r?.error || 'Not saved'; e.focus = true; }
    rerenderAccount();
  };
  const cancel = () => { editing = null; rerenderAccount(); };
  const input = el('input', {
    class: why ? 'prof-input bad' : 'prof-input', type: 'text', maxlength: '64', spellcheck: 'false', autocomplete: 'off',
    placeholder: p.playerName, 'aria-label': `Sidecar name for ${p.name}`, 'aria-invalid': why ? 'true' : 'false',
    disabled: e.saving,
    onkeydown: (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); save(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancel(); }
    },
  });
  input.value = e.draft;
  input.addEventListener('input', () => {
    e.draft = input.value; e.error = null;
    const w = sidecarNameError(e.draft);
    input.className = w ? 'prof-input bad' : 'prof-input';
    msg.className = w ? 'prof-msg bad' : 'prof-msg';
    msg.textContent = w ?? (e.draft.trim() ? `Joins as ${e.draft.trim()}` : `Empty: joins as ${p.playerName}`);
    okBtn.disabled = !!w;
  });
  const okBtn = el('button', { class: 'icon-btn tiny ok', type: 'button', title: 'Save', 'aria-label': 'Save sidecar name', disabled: e.saving || !!sidecarNameError(e.draft), onclick: () => save() }, svgUse('i-check'));
  if (e.focus) {
    e.focus = false;
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
  }
  return el('div', { class: 'prof-editor', 'data-busy': e.saving ? 'true' : false },
    el('div', { class: 'prof-edit-head' },
      el('span', { class: 'prof-edit-label', text: 'Sidecar name' }),
      el('span', { class: 'prof-name', text: p.name })),
    el('div', { class: 'prof-edit-line' },
      input,
      okBtn,
      p.sidecarName ? el('button', { class: 'icon-btn tiny', type: 'button', title: 'Use the game name', 'aria-label': 'Clear sidecar name', disabled: e.saving, onclick: () => save(true) }, svgUse('i-undo')) : null,
      el('button', { class: 'icon-btn tiny', type: 'button', title: 'Cancel', 'aria-label': 'Cancel', onclick: cancel }, svgUse('i-close'))),
    msg);
}

function renderAccount(s) {
  const a = s.panel.account;
  const box = $('account');
  const key = JSON.stringify([a, profilesOpen, switching, editing && { ...editing, draft: null }]);
  if (key === accountKey) return;
  accountKey = key;
  if (!a) { box.hidden = true; return; }
  box.hidden = false;
  box.dataset.status = a.status;
  const notice = a.notice
    ? el('div', { class: 'acct-notice', role: 'status' },
      el('span', { text: a.notice }),
      el('button', { class: 'icon-btn tiny', type: 'button', title: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => api.account('dismiss') }, svgUse('i-close')))
    : null;

  if (a.status === 'waiting') {
    box.replaceChildren(el('div', { class: 'acct-row' },
      el('span', { class: 'acct-spin', 'aria-hidden': 'true' }),
      el('div', { class: 'acct-text' },
        el('b', { text: 'Finish signing in in your browser' }),
        el('span', { text: 'Allow bfstats Sidecar on bfstats.io' })),
      el('button', { class: 'btn small ghost', type: 'button', onclick: () => api.account('cancel') }, 'Cancel')),
    el('i', { class: 'acct-sweep', 'aria-hidden': 'true' }));
    return;
  }

  if (a.status !== 'signedIn') {
    box.replaceChildren(...[notice].filter(Boolean), el('div', { class: 'acct-row' },
      el('span', { class: 'avatar out', 'aria-hidden': 'true' }, svgUse('i-user')),
      el('div', { class: 'acct-text' },
        el('b', { text: 'Not signed in' }),
        el('span', { text: 'Play as your game profile' })),
      el('button', { class: 'btn small primary-soft', type: 'button', onclick: () => api.account('signIn') }, 'Sign in with bfstats.io')));
    return;
  }

  const user = a.username ?? 'Signed in';
  const n = a.profiles.length;
  let line;
  if (a.active) {
    const dim = a.active.renamed ? a.active.playerName : (a.active.name !== a.active.playsAs ? a.active.name : null);
    line = [el('span', { class: 'acct-label', text: 'Playing as' }), el('b', { text: a.active.playsAs }), dim ? el('em', { text: dim }) : null];
  }
  else if (!a.loaded) line = [el('span', { class: 'acct-label', text: a.error ? `Profiles: ${a.error}` : 'Loading profiles...' })];
  else line = [el('span', { class: 'acct-label', text: n ? 'No active profile' : 'No game profiles yet' })];

  const head = el('div', { class: 'acct-row' },
    el('span', { class: 'avatar', 'aria-hidden': 'true', text: user.trim().charAt(0).toUpperCase() || '?' }),
    el('button', {
      class: 'acct-switch', type: 'button', 'aria-expanded': String(profilesOpen), 'aria-controls': 'profiles',
      title: n ? 'Switch profile' : 'Import profiles',
      onclick: () => { profilesOpen = !profilesOpen; renderAccount(state); },
    },
    el('span', { class: 'acct-user' }, el('span', { text: user }), n ? el('span', { class: 'count', text: String(n) }) : null),
    el('span', { class: 'acct-profile' }, ...line),
    svgUse('i-chevron')),
    el('button', { class: 'icon-btn', type: 'button', title: 'Sign out of bfstats.io', 'aria-label': 'Sign out', onclick: () => api.account('signOut') }, svgUse('i-exit')));

  const prot = PROTECTION_NOTE[a.protection];
  const extras = [
    a.error && a.loaded ? el('div', { class: 'acct-warn', text: `Profiles not refreshed: ${a.error}` }) : null,
    prot ? el('div', { class: 'acct-warn', title: prot[1] }, svgUse('i-key'), el('span', { text: prot[0] })) : null,
  ];

  let list = null;
  if (profilesOpen) {
    list = el('div', { class: 'profiles', id: 'profiles' },
      n ? el('div', { class: 'prof-list', role: 'radiogroup', 'aria-label': 'Game profiles' }, ...a.profiles.map(profileRow))
        : el('div', { class: 'prof-empty', text: 'Import your profiles from the game on bfstats.io; the active one names you here.' }),
      el('button', { class: 'link import', type: 'button', onclick: () => api.account('import') }, 'Import profiles on bfstats.io', svgUse('i-external')));
  }
  box.replaceChildren(...[head, list, ...extras].filter(Boolean));
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
  renderAccount(s);
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
  // The profile list opens on demand; each showing starts compact.
  if (profilesOpen) { profilesOpen = false; editing = null; accountKey = ''; if (state) renderAccount(state); }
  document.body.dataset.shown = 'false';
  void document.body.offsetWidth;            // restart the entrance
  document.body.dataset.shown = 'true';
});
api.onState(render);
api.state().then(render);
