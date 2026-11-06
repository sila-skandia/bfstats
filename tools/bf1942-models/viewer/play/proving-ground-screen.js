// The PROVING GROUND tab (features/proving-ground): the front end's way into
// the construct. What the front end draws behind every tab (`menu/Background`
// and the navigation strip, PROVING GROUND lit on CREDITS' plate), with the
// tab's own panel laid into the frame where a menu page sits, as REPLAY lays
// its feed: a battle to borrow kits and vehicles from, the side to stand on,
// how many of the enemy's soldiers walk up the range, and ENTER, which opens
// `map.html?proving=1` on that battle (`proving-ground.js`).
//
// The battles are the Instant Battle list's, for the mod the CUSTOM GAME tab
// picked (`skirmish.js` `levelRows`), and each battle's vehicles are read from
// the models catalogue's `levels` (`models.json`), the mod's tree first.

import { createNavStrip } from './nav-strip.js';
import { createMenuPack } from './menu-pack.js';
import { elementVisible, inRect, paintElement, stageScale, toVirtual } from './menu-screen.js';
import { hudPaths as plainHudPaths } from '../hud-pack.js';
import { provingGroundUrl, START_POINTS, vehiclesByLevel } from '../proving-ground.js';

export { provingGroundUrl, vehiclesByLevel };

/** The panel's box in the menu's 800x600, as REPLAY's feed. */
const BOX = [24, 90, 752, 492];
const GUTTER = 8;
/** How many of the enemy's soldiers the range offers. */
export const SOLDIER_STEPS = [0, 4, 8, 16];

const STYLE = `
.pgm-root { position: fixed; z-index: 20; display: flex; min-width: 0; min-height: 0;
  --pgm-plate: rgba(26, 26, 22, .94); --pgm-deep: rgba(14, 14, 12, .72); --pgm-edge: rgba(200, 194, 152, .30);
  --pgm-khaki: #a39c6c; --pgm-khaki-ink: #15150e; --pgm-ink: #eeecd9; --pgm-muted: #a9a690; --pgm-faint: #7d7a66;
  --pgm-gold: #e8c35a; --pgm-green: #3ddc8a;
  font: 13px/1.4 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif; color: var(--pgm-ink); }
.pgm-root[hidden] { display: none !important; }
.pgm-root *, .pgm-root *::before, .pgm-root *::after { box-sizing: border-box; }
.pgm-panel { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden;
  background: var(--pgm-plate); border: 1px solid var(--pgm-edge); border-radius: 8px; box-shadow: 0 18px 48px rgba(0,0,0,.55); }
.pgm-head { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 0 14px; flex: none;
  background: var(--pgm-khaki); color: var(--pgm-khaki-ink); font: 800 12px/1 'Trebuchet MS', 'Segoe UI', sans-serif;
  letter-spacing: .16em; text-transform: uppercase; }
.pgm-head h1 { margin: 0; font: inherit; }
.pgm-head .pgm-mod { margin-left: auto; font-weight: 700; letter-spacing: .08em; opacity: .7; }
.pgm-body { display: grid; grid-template-columns: minmax(200px, 1fr) minmax(260px, 1.25fr); flex: 1 1 auto; min-height: 0; }
.pgm-list { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--pgm-edge); background: var(--pgm-deep); }
.pgm-search { margin: 10px; height: 30px; padding: 0 10px; border: 1px solid var(--pgm-edge); border-radius: 5px;
  background: rgba(0,0,0,.35); color: var(--pgm-ink); font: inherit; }
.pgm-search:focus-visible { outline: 1px solid var(--pgm-gold); outline-offset: 1px; }
.pgm-levels { list-style: none; margin: 0; padding: 0 0 8px; overflow: auto; flex: 1 1 auto; min-height: 0;
  scrollbar-width: thin; scrollbar-color: rgba(200,194,152,.38) transparent; }
.pgm-levels button { display: block; width: 100%; appearance: none; text-align: left; padding: 7px 14px; border: 0;
  border-left: 3px solid transparent; background: transparent; color: var(--pgm-muted); font: 700 12px/1.3 'Trebuchet MS', sans-serif;
  letter-spacing: .06em; text-transform: uppercase; cursor: pointer; }
.pgm-levels button:hover { color: var(--pgm-ink); background: rgba(255,255,255,.05); }
.pgm-levels button[aria-pressed="true"] { color: var(--pgm-ink); border-left-color: var(--pgm-green); background: rgba(61,220,138,.08); }
.pgm-levels button:focus-visible { outline: 1px solid var(--pgm-gold); outline-offset: -1px; }
.pgm-detail { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; overflow: auto; min-height: 0; }
.pgm-battle { margin: 0; font: 800 20px/1.1 'Trebuchet MS', sans-serif; letter-spacing: .06em; text-transform: uppercase; }
.pgm-lede { margin: 0; color: var(--pgm-muted); max-width: 60ch; }
.pgm-field { display: flex; flex-direction: column; gap: 6px; }
.pgm-label { color: var(--pgm-faint); font: 700 10px/1 'Trebuchet MS', sans-serif; letter-spacing: .16em; text-transform: uppercase; }
.pgm-seg { display: inline-flex; align-self: flex-start; border: 1px solid var(--pgm-edge); border-radius: 6px; overflow: hidden; }
.pgm-seg button { appearance: none; height: 30px; min-width: 56px; padding: 0 14px; border: 0; background: transparent;
  color: var(--pgm-muted); font: 700 11px/1 'Trebuchet MS', sans-serif; letter-spacing: .1em; text-transform: uppercase; cursor: pointer; }
.pgm-seg button + button { border-left: 1px solid var(--pgm-edge); }
.pgm-seg button:hover { color: var(--pgm-ink); background: rgba(255,255,255,.06); }
.pgm-seg button[aria-pressed="true"] { background: var(--pgm-khaki); color: var(--pgm-khaki-ink); }
.pgm-seg button:focus-visible, .pgm-enter:focus-visible { outline: 1px solid var(--pgm-gold); outline-offset: 1px; }
.pgm-vehicles { display: flex; flex-wrap: wrap; gap: 5px; margin: 0; padding: 0; list-style: none; }
.pgm-vehicles li { padding: 3px 8px; border: 1px solid var(--pgm-edge); border-radius: 4px; color: var(--pgm-ink);
  font: 700 11px/1.2 'Trebuchet MS', sans-serif; letter-spacing: .04em; }
.pgm-vehicles li[data-cls="air"] { border-color: rgba(120, 170, 220, .5); }
.pgm-vehicles li[data-cls="sea"] { opacity: .5; text-decoration: line-through; }
.pgm-note { color: var(--pgm-faint); font-size: 12px; }
.pgm-keys { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 0; color: var(--pgm-muted); font-size: 12px; }
.pgm-keys kbd { justify-self: start; min-width: 18px; padding: 1px 5px; border: 1px solid var(--pgm-green); border-radius: 3px;
  color: #d9ffec; font: 700 11px/1.3 'Courier New', monospace; text-align: center; }
.pgm-enter { appearance: none; align-self: flex-start; display: inline-flex; align-items: center; gap: 10px; height: 38px; padding: 0 20px;
  margin-top: auto; border: 1px solid var(--pgm-green); border-radius: 5px; background: rgba(61,220,138,.14); color: #d9ffec;
  font: 800 12px/1 'Trebuchet MS', sans-serif; letter-spacing: .18em; text-transform: uppercase; cursor: pointer;
  transition: background-color .15s ease, box-shadow .15s ease; }
.pgm-enter:hover { background: rgba(61,220,138,.26); box-shadow: 0 0 0 3px rgba(61,220,138,.14); }
.pgm-enter:disabled { opacity: .45; cursor: default; box-shadow: none; }
.pgm-enter svg { width: 14px; height: 14px; }
.pgm-go { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; }
.pgm-go .pgm-enter { margin-top: 0; }
.pgm-school { border-color: #e2a33b; background: rgba(226,163,59,.14); color: #ffe8bd; }
.pgm-school:hover { background: rgba(226,163,59,.26); box-shadow: 0 0 0 3px rgba(226,163,59,.14); }
@media (max-width: 640px) {
  .pgm-body { grid-template-columns: 1fr; grid-template-rows: minmax(160px, 38%) 1fr; }
  .pgm-list { border-right: 0; border-bottom: 1px solid var(--pgm-edge); }
}
`;

const ENTER_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l10 6-10 6z" fill="currentColor"/></svg>';

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {string} [options.root]
 * @param {Array} [options.tabs]
 * @param {(id: string) => void} [options.onTab]
 * @param {() => Array<{map: string, title: string}>} options.levels  the battles
 * @param {() => {id: string, vanilla: boolean, models: string}} options.mod  the active mod
 * @param {(url: string) => void} [options.onStart]
 */
export function createProvingGroundScreen({
  canvas, root = '../', tabs = null, onTab = () => {}, levels = () => [], mod = () => null,
  onStart = url => location.assign(url),
} = {}) {
  const params = new URLSearchParams(location.search);
  const bust = () => (params.has('nocache') ? `?t=${Date.now()}` : '');
  const hudPaths = plainHudPaths('bf1942', null, { root });
  const packUrl = rel => hudPaths.menuUrl(rel);
  const ctx = canvas.getContext('2d');
  let layout = null;
  let strip = null;
  let hover = null;
  const pack = createMenuPack({ url: packUrl, bust, onImage: () => paintSoon(), env: { get hover() { return hover; } } });

  const state = { map: null, team: 1, soldiers: 4, filter: '', spawn: 'FiringLine' };
  const catalogues = new Map();   // models base -> Promise<Map>

  // --- the panel ----------------------------------------------------------------
  if (!document.getElementById('pgm-style')) {
    const style = document.createElement('style');
    style.id = 'pgm-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  const rootEl = document.createElement('section');
  rootEl.className = 'pgm-root';
  rootEl.hidden = true;
  rootEl.setAttribute('aria-label', 'Proving ground');
  rootEl.innerHTML = `
    <div class="pgm-panel">
      <div class="pgm-head"><h1>Proving ground</h1><span class="pgm-mod"></span></div>
      <div class="pgm-body">
        <div class="pgm-list">
          <input class="pgm-search" type="search" placeholder="Find a battle" aria-label="Find a battle">
          <ul class="pgm-levels" role="list"></ul>
        </div>
        <div class="pgm-detail">
          <h2 class="pgm-battle"></h2>
          <p class="pgm-lede">An empty white floor with this battle's arsenal: either side's kits and every vehicle it
            fields. Press B on the range, pick a faction, then a kit, and it is in your hands; pick a vehicle and you are
            in its seat. Fire at the same vehicles parked at 100 and 250 metres. Each round you fire draws its path, and
            the hit log says what it met, where, and what it cost.</p>
          <div class="pgm-field"><span class="pgm-label">Your side</span>
            <div class="pgm-seg" data-field="team"><button type="button" data-v="1">Axis</button><button type="button" data-v="2">Allied</button></div></div>
          <div class="pgm-field"><span class="pgm-label">Start at (you stand up there at once; M on the range to move)</span>
            <div class="pgm-seg" data-field="spawn">${START_POINTS.map(p => `<button type="button" data-v="${p.id}">${p.label}</button>`).join('')}</div></div>
          <div class="pgm-field"><span class="pgm-label">Enemy soldiers down range (they move and shoot, and cannot hurt you)</span>
            <div class="pgm-seg" data-field="soldiers">${SOLDIER_STEPS.map(n => `<button type="button" data-v="${n}">${n || 'None'}</button>`).join('')}</div></div>
          <div class="pgm-field"><span class="pgm-label">Vehicles on the floor</span>
            <ul class="pgm-vehicles" role="list"></ul><span class="pgm-note" hidden></span></div>
          <div class="pgm-field"><span class="pgm-label">On the range</span>
            <dl class="pgm-keys">
              <kbd>B</kbd><span>the arsenal: a faction, a kit, a vehicle</span>
              <kbd>H</kbd><span>the collision mesh, coloured by how many hits of your weapon each part takes</span>
              <kbd>U</kbd><span>mark where your next round lands</span>
              <kbd>J</kbd><span>clear the paths and the hit log</span>
              <kbd>V</kbd><span>the dogfight school: air combat moves replayed, then flown against an ace</span>
            </dl></div>
          <div class="pgm-go">
            <button type="button" class="pgm-enter">${ENTER_ICON}<span>Enter the proving ground</span></button>
            <button type="button" class="pgm-enter pgm-school" title="Air combat moves and their counters, replayed and then flown against an ace">${ENTER_ICON}<span>Dogfight school</span></button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(rootEl);
  const $ = sel => rootEl.querySelector(sel);
  const ui = {
    mod: $('.pgm-mod'), search: $('.pgm-search'), list: $('.pgm-levels'), battle: $('.pgm-battle'),
    vehicles: $('.pgm-vehicles'), note: $('.pgm-note'), enter: $('.pgm-enter'), school: $('.pgm-school'),
  };

  function rows() {
    const all = levels() ?? [];
    const f = state.filter.trim().toLowerCase();
    return f ? all.filter(r => r.title.toLowerCase().includes(f) || r.map.toLowerCase().includes(f)) : all;
  }

  function renderList() {
    const list = rows();
    if (!state.map || !(levels() ?? []).some(r => r.map === state.map)) state.map = (levels() ?? [])[0]?.map ?? null;
    ui.list.innerHTML = '';
    for (const row of list) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = row.title;
      b.dataset.map = row.map;
      b.setAttribute('aria-pressed', String(row.map === state.map));
      li.appendChild(b);
      ui.list.appendChild(li);
    }
    renderDetail();
  }

  async function catalogue(base) {
    if (!catalogues.has(base)) {
      catalogues.set(base, fetch(`${root}${base}/models.json${bust()}`)
        .then(r => (r.ok ? r.json() : []))
        .then(vehiclesByLevel)
        .catch(() => new Map()));
    }
    return catalogues.get(base);
  }

  let detailToken = 0;
  async function renderDetail() {
    const row = (levels() ?? []).find(r => r.map === state.map) ?? null;
    ui.battle.textContent = row ? row.title : 'No battles in this game yet';
    ui.enter.disabled = !row;
    ui.school.disabled = true;
    for (const seg of rootEl.querySelectorAll('.pgm-seg')) {
      const value = String(state[seg.dataset.field]);
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === value));
    }
    const info = mod();
    ui.mod.textContent = info && !info.vanilla ? info.id : '';
    const token = ++detailToken;
    ui.vehicles.innerHTML = '';
    ui.note.hidden = true;
    if (!row) return;
    const bases = [...new Set([info?.models || 'models', 'models'])];
    const found = [];
    for (const base of bases) {
      const map = await catalogue(base);
      for (const v of map.get(row.map.toLowerCase()) ?? []) {
        if (!found.some(f => f.name.toLowerCase() === v.name.toLowerCase())) found.push(v);
      }
    }
    if (token !== detailToken) return;
    found.sort((a, b) => a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name));
    // The school needs aircraft on the floor: the battle's own fighters.
    ui.school.disabled = !found.some(v => v.cls === 'air');
    for (const v of found) {
      const li = document.createElement('li');
      li.textContent = v.name.replace(/_/g, ' ');
      li.dataset.cls = v.cls;
      if (v.cls === 'sea') li.title = 'No water on the proving ground: ships stay in harbour';
      ui.vehicles.appendChild(li);
    }
    if (!found.length) {
      ui.note.hidden = false;
      ui.note.textContent = 'The battle names its vehicles when you arrive.';
    } else if (found.some(v => v.cls === 'sea')) {
      ui.note.hidden = false;
      ui.note.textContent = 'Ships are left out: the floor has no water.';
    }
  }

  /**
   * Straight into the construct from the CONTROLS preview (`controls-screen.js`
   * `onTryIt`), for its tab: the battle that fields the machine the preview
   * showed (`controls-preview.js`: a Spitfire on AIR, a Sherman on LAND &
   * SEA), else the one fielding the most of that kind, else the battle this
   * tab has picked. The preview's machines are the Allies'.
   */
  async function launchFor(kind, { vehicle = null } = {}) {
    const rowsNow = levels() ?? [];
    if (!rowsNow.length) return null;
    const info = mod();
    // The battle that fields the machine asked for, else the preview's own.
    const want = vehicle ? { name: String(vehicle).toLowerCase(), cls: kind === 'air' ? 'air' : 'land' }
      : kind === 'air' ? { name: 'spitfire', cls: 'air' } : kind === 'landSea' ? { name: 'sherman', cls: 'land' } : null;
    let pick = null;
    if (want) {
      const bases = [...new Set([info?.models || 'models', 'models'])];
      const counts = new Map();
      for (const base of bases) {
        const map = await catalogue(base);
        for (const row of rowsNow) {
          const list = map.get(row.map.toLowerCase()) ?? [];
          const has = list.some(v => v.name.toLowerCase() === want.name);
          const n = list.filter(v => v.cls === want.cls).length;
          const prev = counts.get(row.map) ?? { has: false, n: 0 };
          counts.set(row.map, { has: prev.has || has, n: prev.n + n });
        }
      }
      const ranked = rowsNow.map(r => ({ r, ...(counts.get(r.map) ?? { has: false, n: 0 }) }))
        .filter(x => x.n > 0)
        .sort((a, b) => Number(b.has) - Number(a.has) || b.n - a.n);
      pick = ranked[0]?.r ?? null;
    }
    const row = pick ?? rowsNow.find(r => r.map === state.map) ?? rowsNow[0];
    // In the air there is someone to fight: two enemy pilots at the far end
    // take the enemy's aircraft and fly (they shoot blanks).
    const soldiers = kind === 'air' ? Math.max(2, state.soldiers) : state.soldiers;
    const url = provingGroundUrl(root, { map: row.map, team: 2, soldiers, vehicle, spawn: 'FiringLine',
                                         mod: info && !info.vanilla ? info.id : null });
    onStart(url);
    return url;
  }

  function start() {
    const info = mod();
    if (!state.map) return;
    onStart(provingGroundUrl(root, {
      map: state.map, team: state.team, soldiers: state.soldiers, spawn: state.spawn,
      mod: info && !info.vanilla ? info.id : null,
    }));
  }

  ui.list.addEventListener('click', e => {
    const b = e.target.closest('button[data-map]');
    if (!b) return;
    state.map = b.dataset.map;
    for (const other of ui.list.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === b));
    renderDetail();
  });
  ui.list.addEventListener('dblclick', e => { if (e.target.closest('button[data-map]')) start(); });
  ui.search.addEventListener('input', () => { state.filter = ui.search.value; renderList(); });
  rootEl.addEventListener('click', e => {
    const b = e.target.closest('.pgm-seg button');
    if (!b) return;
    const field = b.closest('.pgm-seg').dataset.field;
    state[field] = field === 'spawn' ? b.dataset.v : Number(b.dataset.v);
    renderDetail();
  });
  ui.enter.addEventListener('click', start);
  // The dogfight school (features/dogfight-school): the range on this
  // battle with one enemy pilot to be the ace, the theatre open on arrival.
  ui.school.addEventListener('click', () => {
    const info = mod();
    if (!state.map) return;
    onStart(provingGroundUrl(root, {
      map: state.map, team: state.team, soldiers: 1, mod: info && !info.vanilla ? info.id : null, school: '',
    }));
  });

  // --- the menu behind it -------------------------------------------------------
  async function load() {
    layout = await pack.load(await pack.json(packUrl('main-menu-layout.json')));
    if (tabs) strip = createNavStrip({ layout, env: pack.env, rows: tabs, active: 'proving', onPick: onTab });
    paint();
  }

  const stage = () => stageScale(canvas.clientWidth, canvas.clientHeight, layout?.virtual ?? [800, 600]);

  function box() {
    const r = canvas.getBoundingClientRect();
    const s = stage();
    const [x, y, w, h] = BOX;
    const out = { left: r.left + s.ox + x * s.sx, top: r.top + s.oy + y * s.sy, width: w * s.sx, height: h * s.sy };
    if (r.height - (s.oy + 600 * s.sy) > 1) {
      const mute = document.querySelector('.ld-mute-btn')?.getBoundingClientRect();
      if (mute?.height) out.top = Math.max(out.top, mute.bottom + GUTTER);
      out.left = r.left + GUTTER;
      out.width = r.width - 2 * GUTTER;
      out.height = r.bottom - GUTTER - out.top;
    }
    return out;
  }

  function place() {
    const b = box();
    Object.assign(rootEl.style, {
      left: `${Math.round(b.left)}px`, top: `${Math.round(b.top)}px`,
      width: `${Math.round(b.width)}px`, height: `${Math.round(b.height)}px`,
    });
  }

  let pending = false;
  function paintSoon() {
    if (pending || !layout) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; paint(); });
  }

  function paint() {
    if (!layout || canvas.hidden) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const s = stage();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.setTransform(s.sx * dpr, 0, 0, s.sy * dpr, s.ox * dpr, s.oy * dpr);
    const table = layout.variables || {};
    for (const el of layout.pages?.background?.elements || []) {
      if (elementVisible(el, table)) paintElement(ctx, el, layout, null, pack.env);
    }
    strip?.paint(ctx);
    ctx.globalAlpha = 1;
    place();
  }

  new ResizeObserver(() => paint()).observe(canvas);
  const at = event => {
    const r = canvas.getBoundingClientRect();
    return toVirtual(stageScale(r.width, r.height, layout.virtual), event.clientX - r.left, event.clientY - r.top);
  };
  canvas.addEventListener('pointermove', event => {
    if (!layout) return;
    const [x, y] = at(event);
    const next = strip?.hover(x, y) ?? null;
    const changed = JSON.stringify(next) !== JSON.stringify(hover);
    hover = next;
    canvas.style.cursor = next ? 'pointer' : 'default';
    if (changed) paintSoon();
  });
  canvas.addEventListener('pointerleave', () => { hover = null; paintSoon(); });
  canvas.addEventListener('click', event => {
    if (!layout) return;
    const [x, y] = at(event);
    if (strip?.click(x, y)) return;
    if (!inRect(BOX, x, y)) canvas.focus();
  });

  return {
    load,
    paint,
    show(query = new URLSearchParams(location.search)) {
      const asked = query.get('battle');
      if (asked && (levels() ?? []).some(r => r.map.toLowerCase() === asked.toLowerCase())) {
        state.map = (levels() ?? []).find(r => r.map.toLowerCase() === asked.toLowerCase()).map;
      }
      if (query.get('side') === '2' || query.get('side') === '1') state.team = Number(query.get('side'));
      rootEl.hidden = false;
      renderList();
      paint();
      ui.search.focus({ preventScroll: true });
    },
    hide() { rootEl.hidden = true; },
    keydown() { return false; },
    start,
    launchFor,
    launchUrl: () => (state.map ? provingGroundUrl(root, {
      map: state.map, team: state.team, soldiers: state.soldiers, spawn: state.spawn,
      mod: mod() && !mod().vanilla ? mod().id : null,
    }) : null),
    get state() { return { ...state }; },
    get strip() { return strip; },
  };
}
