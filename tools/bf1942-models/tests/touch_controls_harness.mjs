// Drives `viewer/touch-controls.js` outside a browser and prints one JSON
// blob: the minimap as the MAP button, the SPAWN pill, the contextual PICKUP
// pill, the camera pill on foot, and the absence of the old MORE sheet. The
// DOM is stubbed; `tests/test_touch_controls.py` copies the modules in under
// their own names, so the file under test is the file the page loads.

const elements = new Map();
const clickListeners = [];
function element(id) {
  const listeners = {};
  const classes = new Set();
  const el = {
    id,
    hidden: true,
    disabled: false,
    textContent: '',
    innerHTML: '',
    style: {},
    dataset: {},
    className: '',
    offsetWidth: 0,
    offsetHeight: 0,
    rect: { left: 0, top: 0, width: 0, height: 0 },
    listeners,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, on) => { const v = on === undefined ? !classes.has(c) : !!on; if (v) classes.add(c); else classes.delete(c); return v; },
      contains: c => classes.has(c),
    },
    addEventListener(type, fn) {
      if (type === 'click') clickListeners.push(id);
      (listeners[type] ??= []).push(fn);
    },
    getBoundingClientRect() { return { ...el.rect, right: el.rect.left + el.rect.width, bottom: el.rect.top + el.rect.height }; },
    getAttribute: name => (name === 'style' ? JSON.stringify(el.style) : null),
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
    querySelector: () => element(`${id}>child`),
    querySelectorAll: () => [element(`${id}>a`), element(`${id}>b`)],
    insertBefore() {}, append() {}, replaceChildren() {},
    parentElement: null,
    nextSibling: null,
    firstElementChild: null,
  };
  return el;
}
function byId(id) {
  if (!elements.has(id)) elements.set(id, element(id));
  return elements.get(id);
}
const stage = byId('stage');
stage.rect = { left: 0, top: 0, width: 874, height: 402 };
byId('mobile-controls').parentElement = stage;
byId('mobile-aim-btn').parentElement = byId('aim-home');
byId('side').classList.add('side-collapsed');
const minimap = byId('minimap');
minimap.hidden = false;
minimap.className = 'is-disk';
minimap.classList.add('is-disk');
minimap.rect = { left: 764, top: 30, width: 100, height: 100 };
minimap.firstElementChild = byId('minimap-canvas');
byId('mobile-spawn-btn').offsetWidth = 56;
byId('mobile-spawn-btn').offsetHeight = 24;

globalThis.document = {
  getElementById: byId,
  querySelector: sel => byId(`q:${sel}`),
  createElement: tag => element(`new:${tag}`),
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.innerWidth = 874;
globalThis.innerHeight = 402;
globalThis.location = { search: '' };

const { createTouchControls } = await import('./touch-controls.js');

const triggers = [];
let kitPicked = 0;
let viewCycled = 0;
const state = {
  soldier: { x: 0, y: 0, z: 0 },
  soldierDead: false,
  occupancy: null,
  kit: null,
  pilot: false,
  footModes: ['inside', 'chase'],
  mapZ: 0,
};
const page = {
  isTouchDevice: true,
  captured: true,
  get soldier() { return state.soldier; },
  get soldierDead() { return state.soldierDead; },
  get occupancy() { return state.occupancy; },
  optOnFoot: { checked: true },
  get optPilot() { return { checked: state.pilot }; },
  get footView3p() { return { modes: state.footModes }; },
  get bfmap() { return { z: state.mapZ }; },
  kitOffer: () => state.kit,
  nearEntry: null,
  handWeapon: null,
  kitWeaponSlots: [],
  hudPack: null,
  padTriggerDown: t => triggers.push(t),
  pickupKit: () => { kitPicked++; },
  cycleView: () => { viewCycled++; },
  setFly() {}, ensureAudioContext() {}, releaseButtons() {},
  aircraft: null, car: null, view: null,
  mannedActive: () => false,
};
const tc = createTouchControls(page);
const tap = id => {
  const ev = { pointerId: 1, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} };
  for (const fn of byId(id).listeners.pointerdown ?? []) fn(ev);
};

const out = {};
out.noClickListeners = clickListeners.length === 0;
out.moreGone = !('setMobileSheet' in tc) && !('mobileSheetOpen' in tc);

tc.updateMobileControls();
const hit = byId('mobile-map-hit');
const spawn = byId('mobile-spawn-btn');
out.hitShown = !hit.hidden;
out.hitRect = [hit.style.left, hit.style.top, hit.style.width, hit.style.height];
out.hitRound = hit.classList.contains('is-disk');
out.spawnShown = !spawn.hidden;
out.spawnPos = [spawn.style.left, spawn.style.top];
// The pill sits outside the disk's circle: its nearest corner to the centre
// (the top-right one) is further than the radius.
{
  const left = parseFloat(spawn.style.left), top = parseFloat(spawn.style.top);
  const cx = 764 + 50, cy = 30 + 50;
  out.spawnClearOfDisk = Math.hypot(left + 56 - cx, top - cy) > 50;
  out.spawnFootLevel = top + 24 === 130;
}

tap('mobile-map-hit');
out.aliveMapTap = triggers.splice(0);
tap('mobile-spawn-btn');
out.spawnTap = triggers.splice(0);

// The map open: the pill steps aside, the target follows the box.
state.mapZ = 1;
minimap.rect = { left: 482, top: 30, width: 382, height: 382 };
minimap.style = { '--mm-size': '382px' };
minimap.classList.remove('is-disk');
minimap.className = '';
tc.updateMobileControls();
out.openHidesSpawn = spawn.hidden;
out.openHitRect = [hit.style.left, hit.style.width];
state.mapZ = 0;
minimap.rect = { left: 764, top: 30, width: 100, height: 100 };
minimap.style = {};
minimap.classList.add('is-disk');
minimap.className = 'is-disk';

// Nobody alive: the minimap brings the spawn screen back.
state.soldier = null;
state.soldierDead = true;
tc.updateMobileControls();
tap('mobile-map-hit');
out.deadMapTap = triggers.splice(0);
out.deadSpawnShown = !spawn.hidden;

// Seated (the pilot box set): Enter does nothing there, so no SPAWN.
state.soldier = { x: 0, y: 0, z: 0 };
state.soldierDead = false;
state.pilot = true;
tc.updateMobileControls();
out.pilotHidesSpawn = spawn.hidden;
state.pilot = false;

// PICKUP: a contextual pill, only with a kit in reach.
tc.updateMobileControls();
out.pickupHiddenWithoutKit = byId('mobile-pickup-btn').hidden;
state.kit = { kit: 'Japanese_Assault' };
tc.updateMobileControls();
out.pickupShownWithKit = !byId('mobile-pickup-btn').hidden;
tap('mobile-pickup-btn');
out.kitPicked = kitPicked;
// ENTER and PICKUP together stack.
page.nearEntry = { control: 'door' };
tc.updateMobileControls();
out.enterStacked = !byId('mobile-use-btn').hidden && byId('mobile-use-btn').classList.contains('is-stacked');

// The camera pill on foot, only with more than one view.
out.footViewShown = !byId('mobile-claw-view-btn').hidden;
tap('mobile-claw-view-btn');
out.viewCycled = viewCycled;
state.footModes = ['inside'];
page.nearEntry = null;
tc.updateMobileControls();
out.footViewHiddenSingle = byId('mobile-claw-view-btn').hidden;

// No minimap on the level: the target hides, SPAWN keeps the corner.
minimap.hidden = true;
tc.updateMobileControls();
out.noMinimapHit = hit.hidden;
out.noMinimapSpawn = !spawn.hidden && spawn.classList.contains('is-unanchored');

console.log(JSON.stringify(out));
