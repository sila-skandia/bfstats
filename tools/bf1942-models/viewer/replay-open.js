// Opening a recording from disk (features/round-replay-ux, "Opening a
// recording"). A bf42plus recording, `replay_*.ndjson` (with its `ev_*.xml`
// server log if there is one), picked with Open recording or dropped anywhere
// on map.html, plays on its own level: the page reloads as
//
//   map.html?mod=<mod>&map=<level>&replay=local:<file name>
//
// so the recording's mod, level and game type load behind the game's loading
// screen exactly as a `?replay=` URL does. Nothing leaves the machine. The
// file is held in the browser (IndexedDB) only to cross that reload: the page
// that plays it reads it and lets it go, and every other page clears whatever
// a reload that never finished left there. Recordings run to tens of
// megabytes, so the browser never keeps one: you open it, watch the round,
// and it is gone; watching it again means opening the file again.
//
// A recording that does not say which level it was made on (one begun
// mid-round) is recognised by its flags (replay-level.js); one whose flags
// match no level asks which it was, from the levels the viewer has.
//
// Also here: what the loading screen and the replay bar say about a recording
// (when it was recorded, on which server), and the bar's Open button.

import { parseRecording } from './replay-recording.js';
import { recogniseLevel } from './replay-level.js';
import { loadMods, servable, VANILLA } from './mods.js';

/** `?replay=local:<key>` names a recording this browser keeps. */
export const LOCAL_PREFIX = 'local:';
const DB_NAME = 'bf42-mesh-replays';
const STORE = 'recordings';
/** The viewer's root, where map.html and the maps manifests are, whichever
 *  page imported this. */
const ROOT = new URL('./', import.meta.url);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const isLocalReplay = url => String(url ?? '').startsWith(LOCAL_PREFIX);

/**
 * When a recording was made, from its header's `start` (`2026-09-27T14:09:21`,
 * the recording PC's local time): `27 Sep 2026, 14:09`, or '' without one.
 * Read off the string rather than through Date: it names no zone, and the
 * clock it gives is the recording PC's whatever this one's zone is.
 */
export function recordedAt(start, { seconds = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(start ?? ''));
  const month = m && MONTHS[Number(m[2]) - 1];
  if (!month) return '';
  const [, year, , day, hour, minute, second] = m;
  return `${Number(day)} ${month} ${year}, ${hour}:${minute}${seconds && second ? `:${second}` : ''}`;
}

/** A level's folder or display name in words: `el_alamein` is `El Alamein`,
 *  `BATTLE OF THE BULGE` is `Battle of the Bulge`. */
export const titled = name => String(name ?? '').replace(/_/g, ' ').toLowerCase()
  .replace(/\S+/g, (word, at) => (at && /^(of|the|and|in|on|at|to|for|a|an)$/.test(word)
    ? word : word[0].toUpperCase() + word.slice(1)));

/** What the page needs of a recording before its level loads, and what it
 *  says about it: `{ level, mode, mod, start, server, duration, version }`,
 *  `mode` the game type that picks the level's layer (`coop.con` is `coop`;
 *  '' for a recording that joined without one). */
export function recordingSummary(rec) {
  return {
    level: rec.level,
    mode: rec.modeFile.replace(/\.con$/i, ''),
    mod: rec.mod ?? '',
    start: rec.start,
    server: rec.server,
    duration: rec.duration,
    version: rec.version,
  };
}

/** The loading screen's line for a replay (progress.js `note`, which
 *  upper-cases it): `Replay · 27 Sep 2026, 14:09 · <server>`. */
export function loadingNote(info) {
  return ['Replay', recordedAt(info?.start), info?.server].filter(Boolean).join('  ·  ');
}

/** `Recorded 27 Sep 2026, 14:09 on <server>`, or '' for neither. */
function recordedLine(start, server, options) {
  const when = recordedAt(start, options);
  return [when && `Recorded ${when}`, server && `${when ? 'on' : 'Recorded on'} ${server}`].filter(Boolean).join(' ');
}

// --- the store ---------------------------------------------------------------------

function openStore() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) throw new Error('this browser keeps no local data');
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('stored', 'stored');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('the browser would not open its local store'));
  });
}

function settled(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('the browser would not keep it'));
    tx.onabort = () => reject(tx.error ?? new Error('the browser would not keep it'));
  });
}

/** Hold `entry` for the reload that plays it: the one recording in the
 *  store, whatever was there before let go. */
async function holdRecording(entry) {
  const db = await openStore();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear();
    store.put({ ...entry, stored: Date.now() });
    await settled(tx);
  } finally {
    db.close();
  }
}

/** Let go of every held recording but `except`'s: what a reload that never
 *  got to play one (a tab closed on the loading screen) left behind. */
async function dropLeftovers(except = null) {
  if (!globalThis.indexedDB) return;
  const db = await openStore();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    if (except === null) {
      store.clear();
    } else {
      const walk = store.openKeyCursor();
      walk.onsuccess = () => {
        const cursor = walk.result;
        if (!cursor) return;
        if (cursor.primaryKey !== except) store.delete(cursor.primaryKey);
        cursor.continue();
      };
    }
    await settled(tx);
  } finally {
    db.close();
  }
}

const reads = new Map();

/** A held recording, `{ key, name, text, log: { name, text } | null, info }`,
 *  for `local:<key>`. The first read takes it out of the store: this page
 *  keeps it in memory for as long as the round is watched, and the browser
 *  keeps nothing. Rejects when it is not there: a recording is held only for
 *  the page that opens it. */
export function readLocalRecording(url) {
  const key = String(url).slice(LOCAL_PREFIX.length);
  if (!reads.has(key)) {
    reads.set(key, (async () => {
      const db = await openStore();
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const entry = await new Promise((resolve, reject) => {
          const request = store.get(key);
          request.onsuccess = () => {
            // Let go in the same transaction, while it is still open.
            if (request.result) store.delete(key);
            resolve(request.result);
          };
          request.onerror = () => reject(request.error);
        });
        if (!entry) throw new Error(`${key} was only held for the page that opened it. Open the file again to watch it`);
        await settled(tx).catch(error => console.warn('replay-open: a watched recording was not let go', error));
        return entry;
      } finally {
        db.close();
      }
    })());
  }
  return reads.get(key);
}

// --- opening a file ----------------------------------------------------------------

/** A file whose first line is a bf42plus header, `{"k":"h",...}`. A folder
 *  dropped with the files cannot be read and is not one. */
async function isRecording(file) {
  try {
    const head = await file.slice(0, 4096).text();
    return JSON.parse(head.split('\n', 1)[0])?.k === 'h';
  } catch {
    return false;
  }
}

/** The recording among what was picked or dropped, and its server log. */
async function sortFiles(files) {
  const logs = files.filter(f => /\.xml$/i.test(f.name));
  for (const file of files) {
    if (!logs.includes(file) && await isRecording(file)) return { recording: file, log: logs[0] ?? null };
  }
  const named = files.find(f => /\.ndjson$/i.test(f.name));
  if (named) throw new Error(`${named.name} is not a bf42plus recording.`);
  if (logs.length) throw new Error(`${logs[0].name} is a server log. Open it together with its recording, a replay_*.ndjson.`);
  throw new Error('That is not a bf42plus recording. Open a replay_*.ndjson file.');
}

/** The viewer's mod a recording was made in: the one its server named, else
 *  the page's own. */
async function modFor(named, current) {
  const mods = servable(await loadMods(), 'maps');
  if (!named) return mods.find(m => m.id === current) ?? VANILLA;
  const mod = mods.find(m => m.id === named.toLowerCase());
  if (!mod) throw new Error(`It was recorded in ${named}, which has no maps in this viewer.`);
  return mod;
}

const manifests = new Map();

/** A mod's maps.json, or null when it could not be read; read once a page. */
function levelsOf(mod) {
  if (!manifests.has(mod.id)) {
    const read = fetch(new URL(`${mod.paths.maps}/maps.json`, ROOT), { cache: 'no-cache' })
      .then(response => (response.ok ? response.json() : null))
      .then(list => (Array.isArray(list) ? list : null))
      .catch(() => null);
    manifests.set(mod.id, read);
    // A list that could not be read is asked for again next time.
    read.then(list => { if (!list) manifests.delete(mod.id); });
  }
  return manifests.get(mod.id);
}

/** The mod's maps.json entry for `level`: false when the mod has no such
 *  level, null when the list could not be read (the page will say). */
async function levelEntry(mod, level) {
  const levels = await levelsOf(mod);
  if (!levels) return null;
  return levels.find(e => e.name.toLowerCase() === level.toLowerCase()) ?? false;
}

/** A level's scene.json, where its flags are (replay-level.js). */
async function sceneOf(mod, entry) {
  const report = entry.report ?? String(entry.glb ?? '').replace(/\.glb$/i, '.json');
  if (!report) return null;
  const response = await fetch(new URL(`${mod.paths.maps}/${report}`, ROOT));
  return response.ok ? response.json() : null;
}

/** The vanilla game and its packs, which every recording that names no level
 *  is looked for in after its own mod. */
const VANILLA_PACKS = ['bf1942', 'xpack1', 'xpack2'];

/** `[{ mod, levels }]`: `first`'s levels, then `also`'s mods' that the viewer
 *  has maps for, each once. */
async function treesFrom(first, also) {
  const mods = servable(await loadMods(), 'maps');
  const trees = [];
  for (const mod of [first, ...mods.filter(also)]) {
    if (!mod || trees.some(tree => tree.mod.id === mod.id)) continue;
    const levels = await levelsOf(mod);
    if (levels?.length) trees.push({ mod, levels });
  }
  return trees;
}

/** A held recording's key: its file name without the extension, as a URL
 *  carries it. */
export const keyFor = name => String(name).replace(/\.ndjson$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 96)
  || 'recording';

/** Where the page goes to play a held recording: its mod and level named, so
 *  the right ones load even when the recording is gone (a refresh). The
 *  page's own switches carry over; its side, room and game type do not. */
export function replayHref(key, mod, level, search = globalThis.location?.search ?? '') {
  const query = [`mod=${encodeURIComponent(mod)}`];
  if (level) query.push(`map=${encodeURIComponent(level)}`);
  query.push(`replay=${LOCAL_PREFIX}${encodeURIComponent(key)}`);
  const params = new URLSearchParams(search);
  for (const name of ['dev', 'nocache']) {
    if (params.has(name)) query.push(`${name}=${encodeURIComponent(params.get(name))}`);
  }
  const url = new URL('map.html', ROOT);
  url.search = query.join('&');
  return url.href;
}

// --- the page's side ---------------------------------------------------------------

const UPLOAD_ICON = '<path d="M8 10.6V2.8M4.7 6 8 2.7 11.3 6" fill="none" stroke="currentColor" stroke-width="1.6" '
  + 'stroke-linecap="round" stroke-linejoin="round"/><path d="M2.6 9.8v3.6h10.8V9.8" fill="none" '
  + 'stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>';
const CLOSE_ICON = '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.6"/>';
export const uploadIcon = () => `<svg viewBox="0 0 16 16" aria-hidden="true">${UPLOAD_ICON}</svg>`;

// The replay chrome's look (replay-ui.js): a translucent dark plate, a khaki
// heading strip, olive-edged buttons with upper-case labels.
const STYLE = `
.ro-shade { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px;
  background: rgba(6, 6, 5, .58); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  font: 12px/1.4 'Trebuchet MS', 'Geist Variable', 'Segoe UI', system-ui, sans-serif; color: #eeecd9;
  opacity: 0; transition: opacity .16s ease; }
.ro-shade[hidden] { display: none; }
.ro-shade.show { opacity: 1; }
.ro-panel { width: min(430px, 100%); background: rgba(28, 28, 24, .95); border: 1px solid rgba(200, 194, 152, .34);
  border-radius: 8px; box-shadow: 0 18px 48px rgba(0, 0, 0, .6); overflow: hidden; }
.ro-shade.drag .ro-panel, .ro-shade.busy .ro-panel { pointer-events: none; }
.ro-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; height: 30px; padding: 0 4px 0 12px;
  background: #a39c6c; color: #15150e; font: 800 11px/1 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .14em;
  text-transform: uppercase; }
.ro-close { appearance: none; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; margin: 0;
  border: 0; border-radius: 4px; background: none; color: inherit; cursor: pointer; }
.ro-close:hover { background: rgba(0, 0, 0, .12); }
.ro-shade:not(.error):not(.choose) .ro-close { visibility: hidden; }
.ro-close svg { width: 14px; height: 14px; }
.ro-zone { margin: 14px; padding: 22px 18px 20px; border: 1.5px dashed rgba(200, 194, 152, .38); border-radius: 6px;
  text-align: center; transition: border-color .15s ease, background-color .15s ease; }
.ro-shade.drag .ro-zone { border-color: #e8c35a; background: rgba(232, 195, 90, .07); }
.ro-icon { display: block; width: 30px; height: 30px; margin: 0 auto 10px; color: #b9b38a; }
.ro-shade.drag .ro-icon { color: #e8c35a; animation: ro-bob 1.1s ease-in-out infinite; }
.ro-shade.error .ro-icon, .ro-shade.choose .ro-icon { color: #8f8a68; }
@keyframes ro-bob { 50% { transform: translateY(-3px); } }
.ro-message { margin: 0; font: 700 15px/1.3 'Trebuchet MS', 'Segoe UI', sans-serif; overflow-wrap: anywhere; text-wrap: balance; }
.ro-shade.error .ro-message, .ro-shade.choose .ro-message { color: #f2c25a; font-size: 13px; }
.ro-detail { margin: 6px 0 0; color: #a9a690; font-size: 11.5px; overflow-wrap: anywhere; text-wrap: balance; }
.ro-detail:empty { display: none; }
.ro-busy { display: none; position: relative; width: 160px; height: 3px; margin: 14px auto 0; border-radius: 2px;
  background: rgba(255, 255, 255, .12); overflow: hidden; }
.ro-shade.busy .ro-busy { display: block; }
.ro-busy i { position: absolute; top: 0; bottom: 0; left: -40%; width: 38%; background: #a39c6c;
  animation: ro-sweep 1s ease-in-out infinite; }
@keyframes ro-sweep { to { left: 100%; } }
.ro-actions { display: none; justify-content: center; gap: 8px; margin-top: 16px; }
.ro-shade.error .ro-actions, .ro-shade.choose .ro-actions { display: flex; }
.ro-shade.error .ro-play, .ro-shade.choose .ro-choose { display: none; }
.ro-pick { display: none; max-width: 320px; margin: 14px auto 0; }
.ro-shade.choose .ro-pick { display: block; }
.ro-select { appearance: none; -webkit-appearance: none; display: block; width: 100%; height: 30px; margin: 0;
  padding: 0 30px 0 10px; border: 1px solid rgba(200, 194, 152, .45); border-radius: 5px; color: #eeecd9;
  background: rgba(0, 0, 0, .25) no-repeat right 10px center / 10px 10px
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='M1.5 3.5 5 7l3.5-3.5' fill='none' stroke='%23b9b38a' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  font: 700 12px/1 'Trebuchet MS', 'Segoe UI', sans-serif; text-overflow: ellipsis; cursor: pointer; }
.ro-select:hover { border-color: #b9b38a; }
.ro-select option, .ro-select optgroup { background: #1c1c18; color: #eeecd9; }
.ro-btn { appearance: none; height: 28px; padding: 0 12px; margin: 0; border: 1px solid rgba(200, 194, 152, .45);
  border-radius: 5px; background: rgba(0, 0, 0, .25); color: #eeecd9; font: 700 11px/1 'Trebuchet MS', 'Segoe UI', sans-serif;
  letter-spacing: .08em; text-transform: uppercase; cursor: pointer; }
.ro-btn:hover { background: rgba(255, 255, 255, .08); border-color: #b9b38a; }
.ro-btn.primary { background: #a39c6c; border-color: #a39c6c; color: #15150e; }
.ro-btn.primary:hover { background: #b9b38a; border-color: #b9b38a; }
.ro-btn:disabled { opacity: .45; cursor: default; }
.ro-btn:focus-visible, .ro-close:focus-visible, .ro-select:focus-visible { outline: 1px solid #e8c35a; outline-offset: 1px; }
.ro-when { overflow: hidden; text-overflow: ellipsis; min-width: 0; cursor: default; }
@media (prefers-reduced-motion: reduce) {
  .ro-shade, .ro-zone { transition: none; }
  .ro-icon, .ro-busy i { animation: none !important; }
}
`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Open recording, and a recording dropped anywhere on the page. `mod()` is the
 * page's mod id and `levelName()` the level on screen ('' before one is): a
 * recording that names neither is played in that mod, on that level.
 *
 * Returns `{ pick(), fail(message), decorate(player) }`: the file picker, the
 * panel's error for a recording the page could not open, and the replay bar's
 * additions once a replay's chrome is up.
 */
export function installRecordingOpener({ mod = () => VANILLA.id, levelName = () => '' } = {}) {
  if (!document.getElementById('ro-style')) {
    const style = el('style');
    style.id = 'ro-style';
    style.textContent = STYLE;
    document.head.append(style);
  }
  // A recording is held only for the reload that plays it; whatever a
  // reload that never finished left behind goes now, bar the one this page
  // is about to play.
  const playing = new URLSearchParams(globalThis.location?.search ?? '').get('replay');
  dropLeftovers(isLocalReplay(playing) ? playing.slice(LOCAL_PREFIX.length) : null)
    .catch(error => console.warn('replay-open: the held recordings were not cleared', error));
  const input = el('input');
  input.type = 'file';
  input.accept = '.ndjson,.xml';
  input.multiple = true;
  input.hidden = true;

  const shade = el('div', 'ro-shade');
  shade.hidden = true;
  const panel = el('div', 'ro-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Open a recording');
  const close = el('button', 'ro-close');
  close.type = 'button';
  close.title = 'Close (Esc)';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${CLOSE_ICON}</svg>`;
  const head = el('div', 'ro-head');
  head.append(el('span', '', 'Open a recording'), close);
  const zone = el('div', 'ro-zone');
  zone.insertAdjacentHTML('beforeend', `<svg class="ro-icon" viewBox="0 0 16 16" aria-hidden="true">${UPLOAD_ICON}</svg>`);
  const message = el('p', 'ro-message');
  message.setAttribute('aria-live', 'polite');
  const detail = el('p', 'ro-detail');
  const busy = el('div', 'ro-busy');
  busy.append(el('i'));
  // The level a recording that does not say was made on, when its flags
  // match none (`askLevel`): every level the viewer has, its own mod's first.
  const pickRow = el('div', 'ro-pick');
  const levelSelect = el('select', 'ro-select');
  levelSelect.setAttribute('aria-label', 'Level');
  pickRow.append(levelSelect);
  const choose = el('button', 'ro-btn primary ro-choose', 'Choose a file');
  choose.type = 'button';
  const play = el('button', 'ro-btn primary ro-play', 'Play');
  play.type = 'button';
  const dismiss = el('button', 'ro-btn', 'Close');
  dismiss.type = 'button';
  const actions = el('div', 'ro-actions');
  actions.append(choose, play, dismiss);
  zone.append(message, detail, busy, pickRow, actions);
  panel.append(head, zone);
  shade.append(panel);
  document.body.append(input, shade);

  /** 'drag' while files are held over the page, 'busy' while one is read and
   *  held for the reload, 'choose' while it asks which level a recording was
   *  made on, 'error' when it could not be opened; null with the panel down. */
  let state = null;
  /** Answers the level question (`askLevel`): a place, or null for none. */
  let answer = null;
  const settle = place => {
    const done = answer;
    answer = null;
    done?.(place);
  };
  function show(next, text, more = '') {
    message.textContent = text;
    detail.textContent = more;
    if (state === next) return;
    // Already up, it changes state in place; coming up, it fades in.
    const up = state !== null;
    state = next;
    shade.className = `ro-shade ${next}${up ? ' show' : ''}`;
    shade.hidden = false;
    if (!up) requestAnimationFrame(() => { if (state === next) shade.classList.add('show'); });
    if (next === 'error') choose.focus({ preventScroll: true });
    if (next === 'choose') levelSelect.focus({ preventScroll: true });
  }
  function hide() {
    state = null;
    shade.hidden = true;
    shade.className = 'ro-shade';
    settle(null);
  }

  /** Which level `name` was recorded on, from every level the viewer has
   *  (`first`'s, the mod it will play in, first; the one on screen chosen):
   *  `{ mod, level }`, or null when the panel is closed or another file
   *  opened instead. */
  async function askLevel(name, first, why) {
    // Its own mod's levels, then the vanilla game's and its packs', then the rest.
    const rank = tree => (tree.mod.id === first.id ? 0 : VANILLA_PACKS.includes(tree.mod.id) ? 1 : 2);
    const trees = (await treesFrom(first, () => true)).sort((a, b) => rank(a) - rank(b));
    if (!trees.length) throw new Error(`${name} does not say which level it was recorded on.`);
    const mods = new Map(trees.map(tree => [tree.mod.id, tree.mod]));
    const here = String(levelName() ?? '').toLowerCase();
    levelSelect.replaceChildren();
    const prompt = el('option', '', 'Choose the level');
    prompt.value = '';
    prompt.disabled = true;
    levelSelect.append(prompt);
    let chosen = '';
    for (const { mod: tree, levels } of trees) {
      const group = el('optgroup');
      group.label = tree.name;
      for (const entry of levels) {
        const option = el('option', '', titled(entry.loading?.title || entry.name));
        option.value = `${tree.id}/${entry.name}`;
        if (!chosen && tree.id === first.id && entry.name.toLowerCase() === here) chosen = option.value;
        group.append(option);
      }
      levelSelect.append(group);
    }
    levelSelect.value = chosen;
    play.disabled = !chosen;
    return new Promise(resolve => {
      settle(null);
      answer = value => {
        if (!value) return resolve(null);
        const at = value.indexOf('/');
        resolve({ mod: mods.get(value.slice(0, at)), level: value.slice(at + 1) });
      };
      show('choose', `${name} does not say which level it was recorded on.`, why);
    });
  }

  async function open(files) {
    if (state === 'busy' || !files.length) return;
    // A file opened while the panel asks which level the last one was on
    // replaces the question.
    settle(null);
    show('busy', 'Reading the recording');
    try {
      const { recording, log } = await sortFiles(files);
      show('busy', `Reading ${recording.name}`);
      const text = await recording.text();
      const rec = parseRecording(text);
      const info = recordingSummary(rec);
      const target = await modFor(info.mod, mod());
      let place = info.level ? { mod: target, level: info.level } : null;
      if (!place) {
        show('busy', `Finding the level of ${recording.name}`, "It does not say, so its flags are matched against each level's.");
        const found = await recogniseLevel(rec, await treesFrom(target, m => VANILLA_PACKS.includes(m.id)), sceneOf)
          .catch(error => { console.warn('replay-open: the level search failed', error); return null; });
        if (found) place = { mod: found.mod, level: found.entry.name };
      }
      if (!place) {
        place = await askLevel(recording.name, target,
          rec.controlPoints.size ? 'Its flags match no level here. Choose the level to play it on.' : 'Choose the level to play it on.');
        // Closed, or another file opened in its place.
        if (!place) return;
        show('busy', `Reading ${recording.name}`);
      }
      const entry = await levelEntry(place.mod, place.level);
      if (entry === false) {
        throw new Error(`${titled(place.level)} has not been extracted for ${place.mod.name}, so this recording cannot play here.`);
      }
      const key = keyFor(recording.name);
      await holdRecording({
        key, name: recording.name, text, info,
        log: log ? { name: log.name, text: await log.text() } : null,
      }).catch(error => { throw new Error(`The browser would not hold ${recording.name} for the reload: ${error.message}.`); });
      show('busy', `Loading ${titled(entry?.loading?.title || place.level)}`, recordedLine(info.start, info.server));
      location.assign(replayHref(key, place.mod.id, entry?.name ?? place.level));
    } catch (error) {
      console.warn('recording not opened', error);
      show('error', error?.message || String(error));
    }
  }

  function pick() {
    if (state === 'busy') return;
    input.click();
  }

  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    open(files);
  });
  choose.addEventListener('click', pick);
  close.addEventListener('click', hide);
  dismiss.addEventListener('click', hide);
  levelSelect.addEventListener('change', () => { play.disabled = !levelSelect.value; });
  play.addEventListener('click', () => {
    if (state === 'choose' && levelSelect.value) settle(levelSelect.value);
  });
  shade.addEventListener('pointerdown', e => {
    if (e.target === shade && (state === 'error' || state === 'choose')) hide();
  });
  // A page brought back by the back button, as it was when it left: not
  // still loading the recording it left for.
  window.addEventListener('pageshow', e => {
    if (e.persisted && state === 'busy') hide();
  });
  // Ahead of the replay's own keys (both on the window's capture phase, this
  // one added first): Escape takes the panel down and goes no further.
  window.addEventListener('keydown', e => {
    if (e.code !== 'Escape' || (state !== 'error' && state !== 'choose')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    hide();
  }, true);

  // The drop, anywhere on the page. A surface with a drop of its own (the
  // controls screen takes a profile folder) prevents the drag's default
  // first, so it is left alone; everywhere else, holding files over the page
  // brings the panel up. Without the dragover's preventDefault, a dropped
  // file would open in the tab instead.
  const carriesFiles = e => [...(e.dataTransfer?.types ?? [])].includes('Files');
  let depth = 0;
  let dragTimer = 0;
  const endDrag = () => {
    depth = 0;
    clearTimeout(dragTimer);
    if (state === 'drag') hide();
  };
  window.addEventListener('dragenter', e => {
    if (carriesFiles(e)) depth += 1;
  });
  window.addEventListener('dragleave', e => {
    if (!carriesFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) endDrag();
  });
  window.addEventListener('dragover', e => {
    if (!carriesFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = state === 'busy' ? 'none' : 'copy';
    if (state !== 'busy' && state !== 'drag') {
      show('drag', 'Drop to watch the recording', 'A bf42plus replay_*.ndjson, and its ev_*.xml server log if you have it');
    }
    // A drag cancelled outside the window ends with no leave: dragover
    // repeats while it is over the page, so its stopping is the end.
    clearTimeout(dragTimer);
    dragTimer = setTimeout(endDrag, 1500);
  });
  window.addEventListener('drop', e => {
    if (!carriesFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    depth = 0;
    clearTimeout(dragTimer);
    open([...(e.dataTransfer?.files ?? [])]);
  });

  /** The replay bar's line on when the round was recorded (its tooltip the
   *  server and the file), and its Open button beside the log's. */
  function decorate(player) {
    const ui = player?.ui;
    if (!ui?.bar || ui.bar.querySelector('.ro-open')) return;
    const { rec } = player;
    const when = recordedAt(rec.start);
    if (when) {
      const stamp = el('span', 'rp-round rp-hide-narrow ro-when', `RECORDED ${when.toUpperCase()}`);
      stamp.title = [recordedLine(rec.start, rec.server, { seconds: true }), player.label].filter(Boolean).join('\n');
      ui.roundText.after(stamp);
    }
    const button = ui.button('ro-open', null, 'Open another recording', pick);
    button.innerHTML = uploadIcon();
    ui.logBtn.before(button);
    // A recording that does not say its level plays on the one it was
    // recognised as, or chosen for: the page's.
    const level = rec.level || levelName();
    document.title = [level && `${titled(level)} replay`, when].filter(Boolean).join(' · ') || document.title;
  }

  return {
    pick,
    fail: text => show('error', text),
    decorate,
  };
}
