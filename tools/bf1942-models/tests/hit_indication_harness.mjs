// Drives `viewer/vehicle-hits.js`'s share of the crosshair's hit marks outside
// a browser and prints one JSON blob: which landings raise the local player's
// `CrossHair/HitIndicationTime` (ledger XHIT-4, XHIT-5), and which soldiers a
// round may meet on its way (`roundBodyCast`). The module is imported from the
// viewer tree in place, the way the headless runner (`sim/env.mjs`) loads it,
// so the file under test is the file the page loads.

import { createVehicleHits } from '../viewer/vehicle-hits.js';
import { BOT_BODY_HEIGHT } from '../viewer/bot-referee.js';

const LOCAL = 'local';

/** A hull's node: all `splashTargets` asks of it is where it is. */
function hullNode(name) {
  return { name, getWorldPosition: v => v.set(0, 0, 500) };
}

/**
 * The page stub. `seats` maps a gun group to the player in its seat (what
 * `VehicleRegistry.firerOf` answers), `manned` is the set of hull nodes with
 * someone in them (`instanceOf`), `hulls` maps a collider owner to
 * `{ node, destroyed }`.
 */
function makePage({ seats = new Map(), manned = new Set(), hulls = new Map(), players = new Map() } = {}) {
  const raised = [];
  const visuals = new Map([...hulls].map(([owner, h]) => [owner, { node: h.node }]));
  const page = {
    LOCAL_PLAYER: LOCAL,
    raiseHitIndication: () => raised.push(true),
    vehicles: {
      firerOf: group => seats.get(group) ?? null,
      instanceOf: node => (manned.has(node) ? { seats: new Map([['driver', 'b9']]) } : null),
    },
    damageVisuals: visuals,
    vehicleDamage: {
      get: owner => (hulls.has(owner) ? { destroyed: !!hulls.get(owner).destroyed } : null),
      applyHit: () => null,
      applySplash: () => [],
    },
    world: {
      players,
      player: id => players.get(id) ?? null,
      armorOf: () => null,
    },
    bots: [],
    bodyAt: id => players.get(id)?.soldier ?? null,
    capsulesOf: () => null,
    soldier: null,
    soldierArmor: null,
    soldierDead: false,
    optOnFoot: { checked: true },
    optPilot: { checked: false },
    guns: { materials: null, modifiers: null },
    camera: { position: { toArray: () => [0, 0, 0] } },
    applyDamage: () => {},
    applyDamageToPlayer: () => {},
  };
  return { hits: createVehicleHits(page), raised };
}

const out = { marks: {}, cast: {} };

// --- which landings mark ------------------------------------------------------

const handGroup = { firer: LOCAL };          // hand-weapon.js tags the human's
const localSeatGroup = {};                   // a seat the human holds
const botSeatGroup = {};                     // a seat a bot holds
const untaggedGroup = {};                    // a replayed round, or an orphan
const emptyHull = hullNode('empty');
const mannedHull = hullNode('manned');
const wreckHull = hullNode('wreck');
const world = {
  seats: new Map([[localSeatGroup, LOCAL], [botSeatGroup, 'b3']]),
  manned: new Set([mannedHull, wreckHull]),
  hulls: new Map([[5, { node: emptyHull }], [6, { node: mannedHull }],
                  [7, { node: wreckHull, destroyed: true }]]),
};

function marks(record) {
  const { hits, raised } = makePage(world);
  hits.applyVehicleHit(record);
  return raised.length > 0;
}

const soldierHit = group => ({ kind: 'soldier', target: 'b1', owner: -1, damage: 0, firerGroup: group });
const hullHit = (group, owner) => ({ kind: 'object', owner, damage: 10, firerGroup: group });

// A soldier, from the human's hand weapon, with no damage at all: the engine
// asks before it prices the round, so no floor.
out.marks.handOnSoldierNoDamage = marks(soldierHit(handGroup));
out.marks.localSeatOnSoldier = marks(soldierHit(localSeatGroup));
out.marks.botSeatOnSoldier = marks(soldierHit(botSeatGroup));
out.marks.untaggedOnSoldier = marks(soldierHit(untaggedGroup));
out.marks.handOnEmptyHull = marks(hullHit(handGroup, 5));
out.marks.handOnMannedHull = marks(hullHit(handGroup, 6));
out.marks.handOnWreck = marks(hullHit(handGroup, 7));
out.marks.handOnScenery = marks(hullHit(handGroup, 42));
out.marks.botOnMannedHull = marks(hullHit(botSeatGroup, 6));
// The end of a fuse, splash only: the engine's explosions never reach
// `giveDamage`, so they never mark.
out.marks.handSplashOnly = marks({ kind: 'endOfLife', target: null, owner: -1, damage: null,
                                   firerGroup: handGroup, splashRadius: 6, x: 0, y: 0, z: 0 });
out.marks.nothing = (() => { makePage(world).hits.applyVehicleHit(null); return 'no throw'; })();

// --- which soldiers a round meets ----------------------------------------------

// Down +z from the origin at chest height: a teammate of the shooter's at 10 m,
// an enemy at 20 m. Team 2 is the shooter's side.
const body = z => ({ x: 0, y: 0, z });
const players = new Map([
  [LOCAL, { team: 2, soldier: body(0) }],
  ['b3', { team: 2, soldier: body(-5), occupancy: { root: {} } }],
  ['friend', { team: 2, soldier: body(10) }],
  ['enemy', { team: 1, soldier: body(20) }],
]);
function firstMet(group) {
  const { hits } = makePage({ ...world, players });
  return hits.roundBodyCast(0, BOT_BODY_HEIGHT, 0, 0, 0, 1, 100, group)?.target ?? null;
}
out.cast.handRound = firstMet(handGroup);
out.cast.localSeatRound = firstMet(localSeatGroup);
out.cast.botSeatRound = firstMet(botSeatGroup);
out.cast.untaggedRound = firstMet(untaggedGroup);

console.log(JSON.stringify(out));
