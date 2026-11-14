// A seat a real server gives, taken by the page (`tests/test_relay_seat_adoption.py`).
// Prints one JSON blob.
//
// 1. The frame's cameras read the seat as it stands after the step
//    (`local-player.js` `frameCameras`): a seat the page takes inside the step
//    (`net-room.js` `adoptServerSeat` from `syncHulls`) is the seated camera's
//    that frame, so the foot camera's `footFire` never puts the holstered
//    weapon back in hand.
// 2. The relay client ties a gunner's seat to its hull when the server sends
//    the seat as an object of its own with no template (class `Seat`): the
//    Calliope's rocket seat, netId 542 under Sherman_T34 541.
// 3. A pad's other-side vehicle is a copy a server's hull can bind to
//    (`relay-copies.js`): Mimoyecques' R75 stands only as one.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { createLocalPlayer }, { createRelayClient }, { indexRelayCopies, indexSceneCopies }] = await Promise.all([
  imp('vendor/three.module.js'), imp('local-player.js'), imp('net-relay.js'), imp('relay-copies.js'),
]);

const out = {};

// --- 1. the cameras after the step ----------------------------------------------
{
  const calls = [];
  let seat = null;
  const page = {
    camera: new THREE.PerspectiveCamera(), replayCamera: false,
    optPilot: { checked: false }, optOnFoot: { checked: true },
    seatedCamera: () => calls.push('seat'), onFootCamera: () => calls.push('foot'),
    flyFreeCamera: () => calls.push('fly'), applyLook: () => {},
    followSeat: () => {}, syncFootBody: () => {}, stepSeatIk: () => {}, killOccupantInSeat: () => {},
    vehicles: { seatOf: () => seat }, LOCAL_PLAYER: 'local',
  };
  const local = createLocalPlayer(page);
  local.soldier = { alive: true };
  // On foot, as sampled and as it stands.
  local.frameCameras(1 / 60);
  const onFoot = calls.splice(0);
  // Sampled on foot, then the step seats him: the server's seat taken from
  // `syncHulls`, the pilot box ticked and the seat held.
  page.optPilot.checked = true;
  seat = { root: {}, seatId: 'Sherman_T34_PCO1' };
  local.frameCameras(1 / 60);
  const seatedInStep = calls.splice(0);
  // And the other way: out of the seat inside the step.
  page.optPilot.checked = false;
  seat = null;
  local.frameCameras(1 / 60);
  const leftInStep = calls.splice(0);
  out.cameras = { onFoot, seatedInStep, leftInStep };
}

// --- 2. a gunner's seat sent as an object of its own ----------------------------
{
  const client = createRelayClient({ ws: { readyState: 1, send() {}, close() {}, addEventListener() {} }, now: () => 0 });
  const feed = rec => client.handleMessage(JSON.stringify(rec));
  const rows = [
    { k: 'h', v: 5, plus: 'relay', start: '2026-11-14T11:03:04', hz: 10 },
    { k: 'live' },
    { k: 'server', state: 'connecting', server: '127.0.0.1:14567' },
    { k: 'e', t: 0.3, e: 'setLevel', level: 'bf1942/levels/Peenemunde/', mode: 'conquest.con' },
    { k: 'e', t: 2.37, e: 'createObject', tid: 3951, netId: 541, tmpl: 'Sherman_T34', pos: [1152.58, 104.69, 431.7], rot: [0, 0.14, 0], cls: 'SimpleObjectNetworkable' },
    { k: 'e', t: 2.37, e: 'createObject', tid: 4078, netId: 543, tmpl: 'T95', pos: [1140.54, 105.46, 431.62], rot: [0, 0.76, -0.07], cls: 'SimpleObjectNetworkable' },
    { k: 'e', t: 2.6, e: 'createPlayer', pid: 0, name: 'player', team: 1, ai: 0, netId: 1, vehNetId: 2, camNetId: 2, kitNetId: 0 },
    { k: 'server', state: 'joined', server: '127.0.0.1:14567' },
    { k: 'me', pid: 0 },
    { k: 'e', t: 25.3, e: 'control', pid: 0, netId: 557 },
    { k: 's', t: 25.3, tick: 100, o: [[557, 1150.3, 104.8, 434.8, 0, 0, 0, 1]] },
    // The wheel, then the rocket seat: the server's exit and enter, and the
    // seat's own scope-in row with no template, class Seat.
    { k: 'e', t: 41.004, e: 'enterVehicle', pid: 0, netId: 541 },
  ];
  for (const r of rows) feed(r);
  const self = () => {
    const p = client.selfPlayer?.();
    return p ? { inVehicle: p.inVehicle, vehicleId: p.vehicleId, seatIndex: p.seatIndex } : null;
  };
  const driver = self();
  for (const r of [
    { k: 'e', t: 41.604, e: 'exitVehicle', pid: 0 },
    { k: 'e', t: 41.604, e: 'control', pid: 0, netId: 557, derived: 1 },
    { k: 'e', t: 41.604, e: 'enterVehicle', pid: 0, netId: 542 },
    { k: 'o', t: 41.604, id: 542, tid: 0, tmpl: '', team: 0, cls: 'Seat' },
    { k: 'd', t: 41.604, id: 542 },
  ]) feed(r);
  const rockets = self();
  // The T95 two ids up is another hull, never this seat's.
  out.seat = { driver, rockets, isHull542: client.vehicles?.has?.(542) ?? null };
}

// --- 3. the copies a server's hull binds to ---------------------------------------
{
  const root = new THREE.Group();
  const spawners = new THREE.Group();
  spawners.name = 'spawners';
  root.add(spawners);
  const node = (name, userData, levelNode = null) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.userData = { control: name, templateKind: 'PlayerControlObject', ...userData };
    if (levelNode != null) o.levelNode = levelNode;
    spawners.add(o);
    return o;
  };
  node('HD_XA42', {}, 17);                                             // baked on the pad
  node('R75', { padVariant: true, objectSpawn: 4 });                    // the pad's other side
  node('R75', { padVariant: true, objectSpawn: 5 });
  node('Stuka', { roundSpawned: 'Stuka', roundMould: true });          // the pool's mould
  node('Stuka', { roundSpawned: 'Stuka' });                            // a pooled copy
  node('Daihatsu', { padVariant: true, heldSlot: 1 });                 // a ship's second craft
  const relay = indexRelayCopies(root);
  const again = indexRelayCopies(root);
  const room = indexSceneCopies(new THREE.Group().add(node('Willy', {}, 3)));
  out.copies = {
    relay: [...relay.entries()].map(([k, v]) => [String(k), v.name]),
    stable: [...again.keys()].map(String),
    room: [...room.entries()].map(([k, v]) => [String(k), v.name]),
  };
}

console.log(JSON.stringify(out));
