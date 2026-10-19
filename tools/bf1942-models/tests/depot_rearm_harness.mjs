// Drives a hull's rearm at a supply depot outside a browser and prints one
// JSON blob: `world-fields.js` `supplyFieldTick` over a stand-in world, the
// real `supply.js` depot and the real `fire-state.js` guns.
//
// The B17 on El Alamein's airfield: its bomb rack and one of its guns, as
// `viewer/models/B17.glb` carries them (`node.userData.fireArms`), plus the
// `AmmoType` words of `Objects/Vehicles/Air/B17/Weapons.con` (9 the rack, 10
// the guns), and the level's `AlliedAirplaneSupplyDepot` as its `scene.glb`
// node extras ship it.

import { SupplyDepot, SupplyField } from './supply.js';
import { FireState } from './fire-state.js';
import { supplyFieldTick, rearmTypeFor } from './world-fields.js';

const RACK = { magSize: 8, numOfMag: 10, reloadTime: 15.0, autoReload: true, roundOfFire: 4 };
const MG = { magSize: 900, numOfMag: 1, roundOfFire: 10 };
const AIRPLANE_DEPOT = { radius: 20.0, team: 2, health: [0.0, 0.0, 0.0],
  ammoTypes: [[10.0, -1.0, 100.0, 0.0], [9.0, -1.0, 4.0, 0.0], [8.0, -1.0, 100.0, 0.0], [7.0, -1.0, 4.0, 0.0]],
  workOnSoldiers: false, workOnVehicles: true };
const TICK = 1 / 30;

/** One crewed B17 at `at`, its pilot holding both guns, and the depot at the
 *  origin. `tags` false leaves the guns without `ammoType`, as the exporter
 *  ships them today. */
function makeWorld({ at = [0, 0, 0], tags = true } = {}) {
  const rackNode = { name: 'B17BombRack' }, mgNode = { name: 'B17_MG1_FB' };
  const states = new Map([
    [rackNode, new FireState(tags ? { ...RACK, ammoType: 9 } : RACK)],
    [mgNode, new FireState(tags ? { ...MG, ammoType: 10 } : MG)],
  ]);
  const root = { name: 'B17' };
  const owner = 7;
  const player = {
    soldier: {}, armor: { destroyed: false }, occupancy: { root }, position: at,
    supply: { team: 2 }, team: 2, supplyResult: { gaveAmmo: false, healed: false },
    groups: [{ node: rackNode }, { node: mgNode }], manned: [],
  };
  const world = {
    players: new Map([[1, player]]),
    nodeOwners: new Map([[root, owner]]),
    vehicleDamage: new Map([[owner, { isPco: true, destroyed: false, owner, template: 'B17',
      armor: { destroyed: false } }]]),
    isWrecked: () => false,
    bodyWorld: null,
    positions: new Map([[owner, at]]),
    fireStateFor: node => states.get(node),
    supplyField: new SupplyField([new SupplyDepot({ x: 0, y: 0, z: 0 }, AIRPLANE_DEPOT, 'AlliedAirplaneSupplyDepot')]),
  };
  return { world, rack: states.get(rackNode), mg: states.get(mgNode), player };
}

/** `seconds` of world ticks: the depot pass, then each gun's own step. */
function run(w, seconds) {
  for (let t = 0; t < seconds - 1e-9; t += TICK) {
    supplyFieldTick(w.world, TICK);
    w.rack.step(TICK);
    w.mg.step(TICK);
  }
}

const snap = s => ({ ammo: s.ammo, magsLeft: s.magsLeft, reloading: s.reloadRemaining > 0,
  reloadRemaining: Math.round(s.reloadRemaining * 100) / 100 });
const out = {};

// The owner's case: the whole rack dropped while parked on the airfield.
{
  const w = makeWorld();
  run(w, 1);                        // settle on the pad, full
  for (let i = 0; i < 8; i++) w.rack.registerShot(1);
  const dropped = snap(w.rack);
  run(w, 2);
  const after2s = snap(w.rack);
  run(w, 13.2);                     // 15.2 s from the last bomb
  const after15s = snap(w.rack);
  run(w, 3);                        // the spare rack the reload used comes back
  out.parkedDrop = { dropped, after2s, after15s, after18s: snap(w.rack) };
}

// Out of the depot's reach the reload is the same 15 s and no spare returns.
{
  const w = makeWorld({ at: [0, 0, 500] });
  for (let i = 0; i < 8; i++) w.rack.registerShot(1);
  run(w, 2);
  const after2s = snap(w.rack);
  run(w, 14);
  out.awayDrop = { after2s, after16s: snap(w.rack) };
}

// Every rack spent away from the field, then a landing: the depot puts
// racks back at the bomb row's 4 a second (one rack of 8 every 2 s), and the
// first one it gives starts the reload; the loaded rack is never filled in
// place.
{
  const w = makeWorld({ at: [0, 0, 500] });
  for (let rack = 0; rack < 10; rack++) {
    for (let i = 0; i < 8; i++) w.rack.registerShot(1);
    run(w, 15.1);
  }
  const spent = snap(w.rack);
  w.world.positions.set(7, [0, 0, 0]);
  w.player.position = [0, 0, 0];
  run(w, 2.05);
  const landed2s = snap(w.rack);
  run(w, 15);
  const landed17s = snap(w.rack);
  run(w, 30);
  out.emptyLanding = { spent, landed2s, landed17s, landed47s: snap(w.rack) };
}

// A one-magazine gun is topped up in place, at its own row's 100 a second.
{
  const w = makeWorld({ at: [0, 0, 500] });
  w.mg.registerShot(600);
  w.world.positions.set(7, [0, 0, 0]);
  w.player.position = [0, 0, 0];
  const before = snap(w.mg);
  run(w, 0.6);                      // one 0.5 s depot cycle (16 ticks)
  const oneCycle = snap(w.mg);
  run(w, 6.4);
  out.mgTopUp = { before, oneCycle, full: snap(w.mg) };
}

// Guns that carry no `ammoType` (today's exports) take the first row that
// gave units; the loaded rack is still never refilled by the depot.
{
  const w = makeWorld({ tags: false });
  for (let i = 0; i < 8; i++) w.rack.registerShot(1);
  run(w, 2);
  out.untagged = { after2s: snap(w.rack),
    pick: rearmTypeFor({}, [{ id: 10, units: 0 }, { id: 9, units: 2 }])?.id,
    tagged: rearmTypeFor({ ammoType: 9 }, [{ id: 10, units: 50 }, { id: 9, units: 2 }])?.id,
    none: rearmTypeFor({ ammoType: 3 }, [{ id: 10, units: 50 }]) };
}

// `FireState.rearm` on its own: what comes back.
{
  const full = new FireState(RACK);
  const oneShort = new FireState(RACK); oneShort.magsLeft = 8;
  const leftFromShort = oneShort.rearm(10);
  const pooled = new FireState(RACK); pooled.magsLeft = 7;
  const leftPooled = pooled.rearm(5);
  const mg = new FireState(MG); mg.ammo = 880;
  const unlimited = new FireState({ magSize: -1 });
  out.rearm = {
    fullLeft: full.rearm(4), fullMags: full.magsLeft,
    leftFromShort, shortMags: oneShort.magsLeft, shortPool: oneShort.rearmPool,
    leftPooled, pooledMags: pooled.magsLeft, pooledPool: pooled.rearmPool,
    mgLeft: mg.rearm(50), mgAmmo: mg.ammo,
    unlimitedLeft: unlimited.rearm(5),
  };
}

console.log(JSON.stringify(out));
