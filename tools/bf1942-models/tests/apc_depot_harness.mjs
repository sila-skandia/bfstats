// Drives a half-track's own supply depot outside a browser and prints one JSON
// blob: `world-fields.js` `supplyFieldTick` over a stand-in world, the real
// `supply.js` depot and `SupplyField.seatedIcons`.
//
// The depot words are vanilla's, as the exporter writes them to a hull's
// `extras.supply`: `Objects/Vehicles/Land/M3A1/Objects.con` and
// `Objects/Vehicles/Land/Hanomag/Objects.con`. The positions are the baked
// hull's (Bocage's `scene.glb`): the depot and the SeatObjects in the hull's
// own space, metres. A node is a stand-in with an identity-free `matrixWorld`.

import { SupplyDepot, SupplyField } from './supply.js';
import { supplyFieldTick, SOLDIER_ORIGIN_OVER_FEET } from './world-fields.js';

const TICK = 1 / 30;
const M3A1_LOCKER = { radius: 1.3, health: [-1, 4, 0],
  ammoTypes: [[1, -1, 15, 0], [2, -1, 1.2, 0], [3, -1, 1.2, 0]] };
const HANOMAG_LOCKER = { radius: 1.4, team: 0, health: [-1, 4, 0],
  ammoTypes: [[1, -1, 15, 0], [2, -1, 1.2, 0], [3, -1, 1.2, 0]] };
const M3A1_SEATS = { driver: [-0.419, 0.3, -0.95], gunner: [0.5, 1.25, -0.67],
  rear: [[-0.549, 0.85, 0.299], [0.55, 0.85, 0.829], [-0.549, 0.85, 1.359], [0.55, 0.85, 1.899]] };
const HANOMAG_SEATS = { gunner: [0, 1.2, -0.27],
  rear: [[-0.299, 1.0, 0.199], [0.3, 1.0, 0.699], [0, 1.0, 1.199], [0, 1.0, 1.699]] };

const node = at => ({
  matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, at[0], at[1], at[2], 1] },
  updateWorldMatrix() {},
});

/** One hull at `hullAt` (a node whose matrix the test moves), its locker, and
 *  one soldier: on foot at `feet`, or in a seat whose SeatObject is `seatAt`
 *  in the hull's space. */
function makeWorld({ locker, depotLocal, hullAt = [100, 20, 50], feet = null, seatLocal = null, hp = 10 }) {
  const root = node(hullAt);
  const lockerAt = () => [hullAt[0] + depotLocal[0], hullAt[1] + depotLocal[1], hullAt[2] + depotLocal[2]];
  const depot = new SupplyDepot({ x: lockerAt()[0], y: lockerAt()[1], z: lockerAt()[2] }, locker, 'locker', {
    root, locate: () => { const a = lockerAt(); return { x: a[0], y: a[1], z: a[2] }; },
  });
  const armor = { hitPoints: hp, maxHitPoints: 30, destroyed: false,
    applyDamage(n) { this.hitPoints = Math.min(30, this.hitPoints - n); } };
  const gives = [];
  const seatObj = seatLocal ? node([hullAt[0] + seatLocal[0], hullAt[1] + seatLocal[1], hullAt[2] + seatLocal[2]]) : null;
  const occ = seatLocal ? { root, activeSeatId: 's', seatInfo: () => ({ seatObjects: [seatObj] }) } : null;
  const player = {
    soldier: feet ? { x: feet[0], y: feet[1], z: feet[2] } : {}, armor,
    occupancy: occ,
    // What the registry publishes for a seat: the hull's own origin.
    position: seatLocal ? hullAt.slice() : null,
    supply: { team: 2, refillAmmo: types => gives.push(types.map(t => t.units)) }, team: 2,
    supplyResult: { gaveAmmo: false, healed: false },
  };
  const world = {
    players: new Map([[1, player]]), nodeOwners: new Map(), vehicleDamage: new Map(),
    isWrecked: () => false, bodyWorld: null, positions: new Map(),
    supplyField: new SupplyField([depot]),
  };
  return { world, depot, armor, gives, player, root, seatObj, move(to) {
    hullAt[0] = to[0]; hullAt[1] = to[1]; hullAt[2] = to[2];
    root.matrixWorld.elements[12] = to[0]; root.matrixWorld.elements[13] = to[1]; root.matrixWorld.elements[14] = to[2];
    if (seatObj) {
      seatObj.matrixWorld.elements[12] = to[0] + seatLocal[0];
      seatObj.matrixWorld.elements[13] = to[1] + seatLocal[1];
      seatObj.matrixWorld.elements[14] = to[2] + seatLocal[2];
    }
  }, run(seconds) { for (let s = 0; s < seconds - 1e-9; s += TICK) supplyFieldTick(world, TICK); } };
}

const out = { originOverFeet: SOLDIER_ORIGIN_OVER_FEET };

// A hurt soldier standing on the ground at the back of a parked M3A1: the
// hull's origin is 1.36 m over the ground (Bocage), the locker sits at the
// origin's height, 1.1 m back. His feet are 1.36 m under the locker: his
// origin is 0.36 m under it.
{
  const hull = [100, 21.36, 50];
  const w = makeWorld({ locker: M3A1_LOCKER, depotLocal: [0, 0, 1.1], hullAt: hull,
    feet: [100, 20, 51.1] });
  w.run(10);
  out.m3a1Standing = { hp: w.armor.hitPoints, gives: w.gives.length, lastUnits: w.gives.at(-1) ?? null };
  // The same man two metres further back is out of its 1.3.
  const far = makeWorld({ locker: M3A1_LOCKER, depotLocal: [0, 0, 1.1], hullAt: hull.slice(),
    feet: [100, 20, 53.1] });
  far.run(10);
  out.m3a1TooFar = { hp: far.armor.hitPoints, gives: far.gives.length };
}

// Each seat of both half-tracks, one at a time, a hurt soldier in it.
for (const [name, locker, depotLocal, seats] of [
  ['m3a1', M3A1_LOCKER, [0, 0, 1.1], M3A1_SEATS], ['hanomag', HANOMAG_LOCKER, [0, 0.484, 1.38], HANOMAG_SEATS]]) {
  const row = { rear: [], originReach: Math.hypot(...depotLocal) };
  for (const seat of seats.rear) {
    const w = makeWorld({ locker, depotLocal, seatLocal: seat });
    w.run(5);
    row.rear.push({ hp: w.armor.hitPoints, gives: w.gives.length,
      seatReach: Math.hypot(seat[0] - depotLocal[0], seat[1] - depotLocal[1], seat[2] - depotLocal[2]) });
  }
  const gun = makeWorld({ locker, depotLocal, seatLocal: seats.gunner });
  gun.run(5);
  row.gunner = { hp: gun.armor.hitPoints, gives: gun.gives.length };
  if (seats.driver) {
    const drv = makeWorld({ locker, depotLocal, seatLocal: seats.driver });
    drv.run(5);
    row.driver = { hp: drv.armor.hitPoints, gives: drv.gives.length };
  }
  out[name] = row;
}

// The rates: 4 hit points a second to a rider (`setHealth -1 4.0 0`), the
// guns' row at 15 a second in whole units per 0.5 s cycle.
{
  const w = makeWorld({ locker: M3A1_LOCKER, depotLocal: [0, 0, 1.1], seatLocal: M3A1_SEATS.rear[1], hp: 2 });
  w.run(5.1);
  out.rates = { hp: w.armor.hitPoints, units: w.gives.map(g => g[0]), pouch: w.gives.map(g => g[1]) };
}

// Moving: the hull drives 40 m and the locker, the seat and the rider go with it.
{
  const w = makeWorld({ locker: M3A1_LOCKER, depotLocal: [0, 0, 1.1], seatLocal: M3A1_SEATS.rear[0], hp: 5 });
  w.run(2);
  const before = w.armor.hitPoints;
  w.move([140, 20, 90]);
  w.run(2);
  out.moving = { before, after: w.armor.hitPoints, depotAt: [w.depot.x, w.depot.y, w.depot.z] };
}

// The HUD icons of a seat: the heal and reload icons light by the soldier's
// seat, not the PlayerControlObject's place.
{
  const field = new SupplyField([new SupplyDepot({ x: 0, y: 0.484, z: 1.38 }, HANOMAG_LOCKER, 'h', { root: 'hull' })]);
  const probe = (bodyAt, at = [0, 0, 0]) => field.seatedIcons({
    team: 2, root: 'hull', x: at[0], y: at[1], z: at[2], rootX: 0, rootY: 0, rootZ: 0,
    bodyX: bodyAt?.[0], bodyY: bodyAt?.[1], bodyZ: bodyAt?.[2], template: 'Hanomag_Passanger_PCO2', ammoTags: [],
  }, { repair: false, heal: false, reload: false });
  out.icons = { rearSeat: probe([0, 1.0, 1.199]), gunnerSeat: probe([0, 1.2, -0.27]),
    hullOriginOnly: probe(undefined) };
}

console.log(JSON.stringify(out));
