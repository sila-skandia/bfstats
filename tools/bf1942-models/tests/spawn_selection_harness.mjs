// The spawn screen's selection, retail's way (`viewer/spawning.js`, ledger
// SPAWNGRP-12): nothing is chosen until a click on a ring, a click away from
// every ring keeps the selection (none after a change of side), the close
// commits it, a death asks the server for the committed group again with no
// click, a level change keeps the group, and a sidecar page's offer is the
// server's spawn table, not the page's own capture state.
//
// Drives the page's own `createSpawning` against a stand-in page: clicks go
// through the canvas listener the module registers, the server's side
// through `netSendAction`. Run by `tests/test_spawn_selection.py`; prints one
// JSON object.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks, routeConsole } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const { createSpawning } = await import(path.join(viewer, 'spawning.js'));
routeConsole(true);

const noop = () => {};
const element = () => ({ addEventListener: noop, blur: noop, setAttribute: noop, disabled: false,
  classList: { add: noop, remove: noop }, dataset: {} });

/** A page with Wake-like flags: two Allied land points (groups 3 and 4), an
 *  Axis land point (group 1), and the Axis carrier with deck groups 64 and
 *  65. The map is 1000 m square and the canvas 1000 px, so a ring at world
 *  (x, z) is at canvas pixel (x, z). */
function makePage({ sidecar = false } = {}) {
  const flags = [
    { name: 'South', team: 2, group: 3, groups: [3], position: [100, 0, 100], spawns: [{ group: 3 }] },
    { name: 'North', team: 2, group: 4, groups: [4], position: [300, 0, 100], spawns: [{ group: 4 }] },
    { name: 'Beach', team: 1, group: 1, groups: [1], position: [500, 0, 500], spawns: [{ group: 1 }] },
    { name: 'Shokaku', team: 1, group: 64, vehicle: true,
      groups: [{ group: 64, position: [800, 0, 800] }, { group: 65, position: [820, 0, 800] }],
      position: [800, 0, 800], spawns: [{ group: 64 }, { group: 65 }] },
  ];
  const select = {
    value: '', selectedIndex: -1, hidden: false, options: [],
    set innerHTML(_) { this.options = []; this.value = ''; },
    appendChild(option) { this.options.push(option); if (this.value === '') this.value = option.value; },
  };
  globalThis.document = { createElement: () => ({}), activeElement: null, body: {} };
  let clickListener = null;
  const canvas = {
    ...element(),
    addEventListener: (type, fn) => { if (type === 'click') clickListener = fn; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
  };
  let up = false;
  const sent = [];
  // The server's spawn table, as `server-spawn-groups.js` answers it.
  const rows = new Map();
  const table = {
    live: true,
    team: (g) => (rows.has(g) ? rows.get(g)[0] : null),
    active: (g) => (rows.has(g) ? !!rows.get(g)[1] : null),
  };
  const page = {
    flags,
    refreshFlags: () => flags.length,
    spawnFlagSelect: select,
    world: { setSpawnIndex: noop },
    worldReady: true, soldier: null, soldierDead: false,
    params: new URLSearchParams(''), deployTabs: [], deployKitHits: [],
    deploySuicideBtn: element(), deployResumeBtn: element(), deployScoreBtn: element(),
    fullmapCanvas: canvas, fullmapBox: element(),
    deployActive: () => up, toggleFullMap: (on) => { up = !!on; },
    paintDeployChrome: noop, drawFullMap: noop, layoutDeploy: noop,
    kitRowLabelFor: () => '', kitRowLayoutText: () => '',
    markOnFoot: noop, placeCamera: noop, capture: noop, logToConsole: noop,
    setOnFoot: (on) => { page.soldier = on ? {} : null; },
    projectToArt: (x, z) => ({ u: x / 1000, v: z / 1000 }),
    shipFlagInactive: () => false,
    LOCAL_PLAYER: 0,
    noteServerSpawnAsked: noop,
    netSendAction: (row) => sent.push(row),
    serverOwnsSpawn: () => sidecar,
    get serverSpawnGroups() { return sidecar ? table : null; },
  };
  const spawning = createSpawning(page);
  const click = (x, z) => clickListener({ clientX: x, clientY: z, stopPropagation: noop });
  return { page, spawning, click, sent, rows, flags, isUp: () => up };
}

const state = (h) => ({
  unchosen: h.spawning.deployUnchosen,
  choice: h.spawning.deployChoice ? { ...h.spawning.deployChoice } : null,
  committed: h.spawning.deployCommitted ? { ...h.spawning.deployCommitted } : null,
  index: h.spawning.deployChoiceIndex(),
});
const results = {};

// --- the page's own modes (solo, own room server) ---------------------------
{
  const h = makePage();
  h.page.params = new URLSearchParams('team=2');
  const s = h.spawning;
  s.openDeploy();
  const fresh = state(h);
  // Commit with nothing chosen: the free camera, no body, nothing sent.
  const freeRoam = { spawned: s.deploySpawn(), soldier: !!h.page.soldier, up: h.isUp(), sent: h.sent.length };
  s.openDeploy();
  const reopened = state(h);
  // A click on open ground before any ring: still nothing.
  h.click(600, 200);
  const missFirst = state(h);
  // A click on North's ring (within the finger's width).
  h.click(305, 104);
  const clicked = state(h);
  // A click away keeps it.
  h.click(600, 200);
  const missKeeps = state(h);
  const spawned = s.deploySpawn();
  const afterCommit = state(h);
  // A death: the screen opens on the same choice, no click needed.
  h.page.soldierDead = true;
  s.openDeploy();
  const dead = state(h);
  const respawned = s.deploySpawn();
  h.page.soldierDead = false;
  results.solo = { fresh, freeRoam, reopened, missFirst, clicked, missKeeps, spawned, afterCommit, dead, respawned,
    select: h.page.spawnFlagSelect.value };

  // A change of side: the commit and the click base go, the selection stays
  // (and is the other side's now, so it is not on the screen); a click on
  // open ground then clears it.
  h.page.soldierDead = true;
  s.openDeploy();
  s.chooseTeam(1);
  const sideChanged = { ...state(h), offered: s.deployFlagIndices() };
  h.click(600, 200);
  const missAfterSide = state(h);
  // The deck: a click on the second ring picks group 65.
  h.click(821, 799);
  const deck = { ...state(h), group: s.activeDeployGroup(h.flags[3]) };
  results.side = { sideChanged, missAfterSide, deck };

  // A level change keeps the group (retail's map outlives the level), drops
  // the commit; the group resolves on the new level's flag that holds it.
  s.deploySpawn();
  const committedBefore = state(h).committed;
  s.forgetFlagChoice();
  const level = state(h);
  results.level = { committedBefore, level };

  // Script and number-key selection names a flag: its first drawn ring.
  const h2 = makePage();
  h2.spawning.openDeploy();
  const ship = h2.spawning.selectDeployFlag(3);
  results.select = { ship, ...state(h2), team: h2.spawning.deployTeamId,
    land: (h2.spawning.selectDeployFlag(0), state(h2)) };
}

// --- a sidecar page ----------------------------------------------------------
{
  const h = makePage({ sidecar: true });
  h.page.params = new URLSearchParams('team=2');
  const s = h.spawning;
  // The server's table: South (3) and North (4) Allied and on, the Beach (1)
  // Axis, the deck groups Axis and on.
  for (const [g, row] of [[3, [2, 1]], [4, [2, 1]], [1, [1, 1]], [64, [1, 1]], [65, [1, 1]]]) h.rows.set(g, row);
  s.openDeploy();
  const fresh = { ...state(h), offered: s.deployFlagIndices() };
  // Commit with nothing chosen: no spawn row reaches the server.
  s.deploySpawn();
  const noClick = { sent: h.sent.length, waiting: s.deployWaiting, up: h.isUp() };
  s.openDeploy();
  h.click(102, 98);
  s.deploySpawn();
  const asked = { sent: h.sent.map((r) => ({ type: r.type, group: r.spawnGroup, flag: r.flag })), waiting: s.deployWaiting,
    up: h.isUp(), committed: state(h).committed };
  // The server stands him.
  const stood = s.standServerSpawn();
  // He dies: the screen opens, and the committed group is asked for again
  // with no click and no close.
  h.page.soldierDead = true;
  s.openDeploy();
  const deathAsk = { sent: h.sent.slice(1).map((r) => r.spawnGroup), waiting: s.deployWaiting, up: h.isUp() };
  const restood = s.standServerSpawn();
  h.page.soldierDead = false;

  // The page's capture state says South is Allied; the server's table says
  // the Axis took it: the Allied tab no longer offers it, the Axis tab does.
  h.rows.set(3, [1, 1]);
  const taken = { allied: s.deployFlagIndices() };
  // A point whose spawns are off while it is being taken (still Allied):
  // not offered.
  h.rows.set(3, [2, 0]);
  taken.off = s.deployFlagIndices();
  h.rows.set(3, [2, 1]);
  // The page's own flag team wrong the other way: Beach (page Axis) held by
  // the Allies per the table: offered to the Allies.
  h.rows.set(1, [2, 1]);
  taken.beachAllied = s.deployFlagIndices();
  h.rows.set(1, [1, 1]);

  // The committed group goes off: the selection and the commit stay, the
  // ring is not drawn, and the commit still asks for it (the server refuses).
  h.page.soldierDead = true;
  h.rows.set(3, [2, 0]);
  const offState = { ...state(h), spots: s.deploySpots(h.flags[0]).length, lost: s.watchCommitted() };
  // It passes to the other side while he waits with the screen closed: the
  // commit goes, the selection stays, and the screen opens once.
  h.page.toggleFullMap(false);
  h.rows.set(3, [1, 1]);
  const lost = s.watchCommitted();
  const lostState = { ...state(h), lost, up: h.isUp() };
  h.page.toggleFullMap(false);
  h.rows.set(3, [2, 1]);
  s.deployCommitted = { group: 3, index: 0 };
  h.rows.set(3, [1, 1]);
  const lostAgain = { lost: s.watchCommitted(), up: h.isUp() };

  results.sidecar = { fresh, noClick, asked, stood, deathAsk, restood, taken, offState, lostState, lostAgain };
}

process.stdout.write(JSON.stringify(results, null, 1));
