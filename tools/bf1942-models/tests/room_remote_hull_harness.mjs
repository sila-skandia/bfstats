// A room's remote hulls on the page (`netcode-render.js`): the replica drawn
// for a hull another player sits in, the seat a snapshot's `seatIndex` names
// on it, and which hulls are replicas at all.
//
// Wake, 2026-11-13, two pages at The_Airfield: one player walked to the pad's
// Willy and pressed E. The other page drew the jeep with nobody in it, and
// the pad's own jeep stayed by the hut after the driven one left. The replica
// is the template's glb under a wrapper group, and the seat survey was taken
// from the wrapper: it counted the wrapper as seat 0, so the driver's index
// named a seat with no SeatObject (nobody drawn) and every other index named
// the seat before it (a gunner drawn in the driver's place).
//
// The templates here are trees shaped like the exporter's (`assemble.py`
// stamps `templateKind` and `control`), wrapped the way GLTFLoader wraps a
// glb's nodes in `gltf.scene`: a Willy (a driver and a passenger, each with a
// SeatObject), a Sherman (an enclosed driver with none, a hull gunner whose
// node name carries the level's `_1` suffix) and an SBD (a pilot and a rear
// gunner).
//
// Run by tests/test_room_remote_hull.py, which copies the viewer modules into
// a temp dir (three shimmed).
import * as THREE from 'three';
import { createRemoteRenderer, heldHullIds, replicaHullRoot } from './netcode-render.js';
import { surveyVehicle } from './seat-survey.js';
import { carriedWheels, turnCarriedRunningGear } from './carried-wheels.js';

function node(name, userData = {}, children = []) {
  const o = new THREE.Object3D();
  o.name = name;
  o.userData = userData;
  for (const c of children) o.add(c);
  return o;
}
const pco = (name, control, children) => node(name, { templateKind: 'PlayerControlObject', control }, children);
const seatObject = control => node(`${control}_seat`, { templateKind: 'SeatObject', control, seat: { control, flags: [] } });
const door = control => node(`${control}_entry`, { templateKind: 'EntryPoint', control, seat: { control } });
const part = (name, control) => node(name, { templateKind: 'Bundle', control });

const TEMPLATES = {
  Willy: () => pco('Willy', 'Willy', [
    part('lodWilly', 'Willy'), door('Willy'), seatObject('Willy'),
    pco('WillyPassengerPCO', 'WillyPassengerPCO', [door('WillyPassengerPCO'), seatObject('WillyPassengerPCO')]),
  ]),
  Sherman: () => pco('Sherman', 'Sherman', [
    part('lodSherman', 'Sherman'), door('Sherman'),
    pco('shermanBrowning_PCO1_1', 'shermanBrowning_PCO1', [door('shermanBrowning_PCO1'), seatObject('shermanBrowning_PCO1')]),
  ]),
  SBD: () => pco('SBD', 'SBD', [
    part('lodSBD', 'SBD'), door('SBD'), seatObject('SBD'),
    pco('SBD_PCO1', 'SBD_PCO1', [door('SBD_PCO1'), seatObject('SBD_PCO1')]),
  ]),
};

/** What GLTFLoader hands back: the glb's nodes under an unnamed scene group. */
function gltfOf(template) {
  const scene = new THREE.Group();
  scene.add(TEMPLATES[template]());
  return { scene, animations: [] };
}

globalThis.fetch = async () => { throw new Error('offline'); };
const loader = {
  load: () => {},
  loadAsync: async url => {
    const m = /\/([A-Za-z0-9_-]+)\.glb/.exec(url);
    if (m && TEMPLATES[m[1]]) return gltfOf(m[1]);
    throw new Error('offline');
  },
};

const occupy = [];
let own = null;
const renderer = createRemoteRenderer({
  scene: new THREE.Scene(), loader, modelsBase: 'models', bust: () => '',
  onOccupyChange: (id, occupied) => occupy.push([id, occupied]),
  ownVehicleId: () => own,
  // The hull the page's own player sits in: its copy, with its own survey
  // (`net-room.js` hands `page.occupancy`'s).
  serverEntity: id => (ownCopy && id === own ? ownCopy : null) ?? (shipCopy && id === shipCopy.id ? shipCopy : null),
  // A ship another player crews stays the page's own copy (`net-room.js`).
  pageDrawsHull: id => !!shipCopy && id === shipCopy.id,
  onReplicaReady: id => ready.push(id),
});
const ready = [];
let ownCopy = null;
let shipCopy = null;

// The room: three hulls, and the rows of the other players.
const hulls = new Map([[2, { id: 2, template: 'Willy' }], [15, { id: 15, template: 'Sherman' }],
                       [14, { id: 14, template: 'SBD' }]]);
let rows = [];
const client = {
  vehicles: hulls,
  remoteSlots: () => rows.map(r => r.slot),
  remotePlayer: slot => rows.find(r => r.slot === slot) ?? null,
  remoteVehicle: id => ({ id, x: id * 10, y: 0, z: 0, q: [0, 0, 0, 1], occupied: true }),
};
const seated = (slot, vehicleId, seatIndex) => ({
  slot, team: 2, alive: true, seated: true, inVehicle: true, vehicleId, seatIndex,
  x: vehicleId * 10, y: 0, z: 0, yaw: NaN, pitch: NaN, crouch: false, prone: false,
});
const onFoot = slot => ({
  slot, team: 2, alive: true, seated: false, inVehicle: false, vehicleId: 0, seatIndex: null,
  x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: false, prone: false,
});

let t = 0;
async function frames(n = 3) {
  for (let i = 0; i < n; i++) {
    t += 33;
    renderer.update(0.033, client, t);
    // The template loads between frames.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
const seatsOf = () => Object.fromEntries(renderer.debugSoldiers().map(s => [s.slot, s.seatId]));
const replicas = () => renderer.debugVehicles().map(v => v.id).sort((a, b) => a - b);

const out = {};

// The survey's root, on its own.
{
  const wrapped = new THREE.Group();
  wrapped.name = 'remote vehicle 2 Willy';
  wrapped.add(gltfOf('Willy').scene);
  const root = replicaHullRoot(wrapped);
  const bare = new THREE.Group();
  bare.add(node('crate'));
  out.root = {
    name: root.name, kind: root.userData.templateKind,
    order: surveyVehicle(root).order,
    // What the wrapper gave: a seat of its own in front of the hull's.
    wrapperOrder: surveyVehicle(wrapped).order,
    unstamped: replicaHullRoot(bare) === bare,
  };
}

// Every seat kind, one remote at a time: the driver and the passenger of a
// jeep, a tank's driver and its hull gunner, a pilot and a rear gunner.
out.seats = {};
for (const [label, id, index] of [
  ['willyDriver', 2, 0], ['willyPassenger', 2, 1],
  ['shermanDriver', 15, 0], ['shermanGunner', 15, 1],
  ['sbdPilot', 14, 0], ['sbdGunner', 14, 1], ['pastTheLast', 2, 7],
]) {
  rows = [seated(3, id, index)];
  await frames();
  const v = renderer.debugVehicles().find(r => r.id === id);
  out.seats[label] = { seat: seatsOf()[3], seats: v?.seats ?? null, seatObjects: v?.seatObjects ?? null,
                       replicas: replicas() };
}

// Two players in one hull, a third in another, a fourth on foot.
rows = [seated(3, 2, 0), seated(4, 2, 1), seated(5, 15, 1), onFoot(6)];
await frames();
out.crew = { seats: seatsOf(), replicas: replicas(), held: [...heldHullIds(rows)].sort((a, b) => a - b) };

// The page's own player gets into the jeep: its replica goes, the page draws
// that hull itself.
own = 2;
await frames();
out.own = { replicas: replicas(), held: [...heldHullIds(rows, own)].sort((a, b) => a - b) };
own = null;

// A second player's way in: the replica's own root and doors, and the id a
// door's hull answers to (`vehicle-entry.js` reads both through `net-room.js`).
{
  await frames();
  const r = renderer.replica(2);
  out.doors = {
    root: r?.root.name ?? null, id: r ? renderer.replicaIdOf(r.root) : null,
    seats: r ? r.survey.order.map(id => r.survey.seats.get(id).entryPoints.length) : null,
    none: renderer.replica(99), ready: [...new Set(ready)].sort((a, b) => a - b),
  };
}

// Aboard a friend's jeep: the page's hull is its own copy (no replica), and
// the friend is drawn in the copy's seat his row names.
{
  const copy = TEMPLATES.Willy();
  ownCopy = { id: 2, group: copy, survey: surveyVehicle(copy) };
  own = 2;
  rows = [seated(3, 2, 0), seated(5, 15, 1)];
  await frames();
  const driver = seatsOf()[3];
  rows = [seated(3, 2, 1), seated(5, 15, 1)];
  await frames();
  out.shared = { replicas: replicas(), driver, passenger: seatsOf()[3] };
  own = null;
  ownCopy = null;
}

// A ship a friend crews: no replica of her (players stand on her deck, which
// only the page's copy has), and her crew in the copy's own seats.
{
  const sbd = TEMPLATES.SBD();   // any two-seat tree stands in for the hull
  shipCopy = { id: 14, group: sbd, survey: surveyVehicle(sbd) };
  rows = [seated(3, 14, 1), seated(5, 15, 1)];
  await frames();
  out.ship = { replicas: replicas(), gunner: seatsOf()[3] };
  shipCopy = null;
}

// Everyone out: no replica is left, and the page was told to stand each hull's
// own copy down and then up again, once each.
rows = [];
await frames();
occupy.length = 0;
rows = [seated(3, 2, 0)];
await frames();
rows = [onFoot(3)];
await frames();
out.left = { replicas: replicas(), occupy: occupy.slice(), held: [...heldHullIds(rows)] };

// A hull carried on the server's pose turns its own wheels: a jeep with four
// 0.4 m wheels (Springs with a drawn mesh) and a Spring with none, carried
// 2 m forward (-Z) in 0.1 s, then left standing, then put 500 m away.
{
  const wheel = name => {
    const spring = node(name, { templateKind: 'Spring', control: 'Willy' });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.8));
    spring.add(mesh);
    return spring;
  };
  const jeep = pco('Willy', 'Willy', [wheel('fl'), wheel('fr'), wheel('rl'), wheel('rr'),
                                      node('hook', { templateKind: 'Spring', control: 'Willy' })]);
  const was = { pos: jeep.position.clone(), quat: jeep.quaternion.clone() };
  jeep.position.set(0, 0, -2);
  const motion = turnCarriedRunningGear(jeep, was, 0.1);
  const wheels = carriedWheels(jeep);
  const rolled = wheels.map(w => +w.angle.toFixed(4));
  const turned = wheels.map(w => +(2 * Math.acos(Math.min(1, Math.abs(w.node.quaternion.w)))).toFixed(4));
  was.pos.copy(jeep.position);
  turnCarriedRunningGear(jeep, was, 0.1);
  const still = wheels.map(w => +w.angle.toFixed(4));
  jeep.position.set(0, 0, -502);
  const jump = turnCarriedRunningGear(jeep, was, 0.1);
  out.wheels = { count: wheels.length, radius: wheels.map(w => w.radius), forward: +motion.forward.toFixed(3),
                 rolled, turned, still, jump: jump.forward, afterJump: wheels.map(w => +w.angle.toFixed(4)) };
}

// The law on its own: a row with no hull, a dead row's stale id, a null row.
out.heldLaw = [...heldHullIds([
  seated(1, 9, 0), { ...seated(2, 9, 1) }, { ...onFoot(3), vehicleId: 4 }, null,
  { ...seated(5, 0, 0) }, seated(6, 11, 2),
], 11)];

console.log(JSON.stringify(out));
