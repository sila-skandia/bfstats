// The state of the hull and seat the player holds, as the server has it
// (features/udp-sidecar/wire.md section 48): the driven hull's hit points
// and the controlled guns' ammunition reach the page only in the control
// state, never in a ghost record (the lab, 2026-10-25: an M3A1 the probe
// drove was scoped out the tick it took the seat and back in on the exit).
//
//   - the sidecar's half: `GhostWriter.controlHp` turns the control state's
//     hit points into the ghost's own k:"a" row, once per change, and
//     `controlMagazines` reads the FireArms children's counters;
//   - the page's client (`net-sidecar.js`): a k:"a" row is a `hull` event,
//     an ack's `hmag` the player's `selfMags`;
//   - the page's laws (`server-seat.js`): the driven copy's hit points
//     (`hullHpChange`), a seat gun's magazines (`takeServerMagazines`) and
//     which server gun each page gun is (`matchServerGuns`).
//
// Run by tests/test_sidecar_seat_state.py (viewer modules copied to a temp
// dir; the sidecar dir passed in).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSidecarClient } from './net-sidecar.js';
import { hullHpChange, matchServerGuns, seatHost, takeServerMagazines } from './server-seat.js';

const [sidecarDir] = process.argv.slice(2);
const { GhostWriter, controlMagazines } = await import(pathToFileURL(path.join(sidecarDir, 'ghost-writer.mjs')).href);

const out = {};

// ---- the sidecar: control-state hit points --------------------------------
{
  const rows = [];
  const w = new GhostWriter({ write: (r) => rows.push(r), objInfo: new Map() });
  const said = [w.controlHp(1, 555, 100), w.controlHp(1.03, 555, 100), w.controlHp(2, 555, 62.5),
                w.controlHp(2.03, 555, NaN), w.controlHp(3, 555, 70)];
  out.controlHp = { said, rows };
}

// ---- the sidecar: the wheel taken, the hull scoped out --------------------
// The ghost wrote the hull's 100 while it was a ghost; the server scopes it
// out the tick he takes the wheel (k:"d", which drops the snapshot's k:"a"),
// and his control state carries the same 100: it is written again, so a
// page that joins now still hears the hull's hit points.
{
  const rows = [];
  const w = new GhostWriter({ write: (r) => rows.push(r), objInfo: new Map([[555, { tid: 1, tmpl: 'M3A1', team: 1 }]]) });
  w.block(1, [{ action: 1, netId: 555, cls: 'SimpleObjectNetworkable', body: { hp: 100 } }]);
  w.block(1.05, [{ action: 3, netId: 555 }]);
  const again = w.controlHp(1.06, 555, 100);
  out.scopeOutHp = { again, kinds: rows.map((r) => r.k), hp: rows.filter((r) => r.k === 'a').map((r) => r.a) };
}

// ---- the sidecar: control-state magazines (the M3A1 .50's, as measured) ---
{
  // Raw counters as the wire carries them, each value plus one: 501/2 is 500
  // rounds in the one magazine; a delta that leaves magB out carries it.
  const first = controlMagazines([{ type: 'R' }, { type: 'R' }, { type: 'F', magA: 501, magB: 2 }], null, 1, null);
  const next = controlMagazines([{ type: 'R' }, { type: 'F', magA: 497 }], null, 1, first);
  const none = controlMagazines([{ type: 'S' }, { type: 'E' }], 'M3A1', 0, null);
  out.controlMagazines = { first, next, none };
}

// ---- the page's client ----------------------------------------------------
{
  const client = createSidecarClient({ ws: { send() {}, close() {} }, now: () => 0 });
  const events = [];
  client.onevent = (row) => events.push(row);
  const send = (r) => client.handleMessage(JSON.stringify(r));
  send({ k: 'h', v: 5, name: 'p' });
  send({ k: 'live' });
  send({ k: 'me', pid: 0 });
  send({ k: 'e', t: 1, e: 'createObject', tid: 2916, netId: 555, tmpl: 'M3A1', pos: [10, 100, 20], rot: [0, 0, 0] });
  send({ k: 'a', t: 2, a: [[555, 62.5]] });
  send({ k: 'ack', t: 2.1, seq: 40, tick: 100, serial: 9, id: 556, hmag: [['Browning', 496, 1]] });
  send({ k: 's', t: 2.2, tick: 101, o: [] });
  out.client = {
    hull: events.filter((e) => e.type === 'hull'),
    selfMags: client.selfMags(),
  };
}

// ---- the page's laws ------------------------------------------------------
{
  const armor = (hitPoints, destroyed = false) => ({ hitPoints, destroyed });
  out.hullHpChange = {
    damaged: hullHpChange(armor(100), { hp: 62.5, destroyed: false }),
    repaired: hullHpChange(armor(40), { hp: 55, destroyed: false }),
    same: hullHpChange(armor(62.5), { hp: 62.52, destroyed: false }),
    serverKilled: hullHpChange(armor(30), { hp: 0, destroyed: true }),
    zeroNotDestroyed: hullHpChange(armor(30), { hp: 0, destroyed: false }),
    copyWrecked: hullHpChange(armor(0, true), { hp: 50, destroyed: false }),
    unknown: hullHpChange(armor(100), { hp: NaN, destroyed: false }),
  };

  const gun = (o) => ({ unlimited: false, ammo: 500, magsLeft: 0, reloadRemaining: 0, ...o });
  const a = gun({});
  const takenA = takeServerMagazines(a, 496, 1);
  const b = gun({ ammo: 0, magsLeft: 2, reloadRemaining: 3.2 });
  const takenB = takeServerMagazines(b, 30, 2);
  const c = gun({ ammo: 12, magsLeft: 1 });
  const takenC = takeServerMagazines(c, 12, 2);
  const d = gun({ ammo: 4, magsLeft: 0 });
  const takenD = takeServerMagazines(d, 7, 0);
  const e = gun({ unlimited: true, ammo: Infinity, magsLeft: Infinity });
  const takenE = takeServerMagazines(e, 3, 1);
  const f = gun({ ammo: 20, magsLeft: Infinity });
  const takenF = takeServerMagazines(f, 18, 5);
  out.takeServerMagazines = {
    rounds: { taken: takenA, ammo: a.ammo, magsLeft: a.magsLeft },
    reloadOver: { taken: takenB, ammo: b.ammo, magsLeft: b.magsLeft, reload: b.reloadRemaining },
    same: { taken: takenC },
    empty: { taken: takenD, ammo: d.ammo, magsLeft: d.magsLeft },
    unlimited: { taken: takenE, ammo: e.ammo },
    unlimitedSpares: { taken: takenF, ammo: f.ammo, magsLeft: f.magsLeft },
  };

  out.matchServerGuns = {
    byName: matchServerGuns(['Coaxial_browning', 'ShermanGunBarrel'], [['ShermanGunBarrel', 29, 1], ['Coaxial_browning', 380, 1]]),
    suffixed: matchServerGuns(['Browning_1'], [['Browning', 400, 1]]),
    unnamedByOrder: matchServerGuns(['A', 'B'], [[null, 1, 1], [null, 2, 1]]),
    unknown: matchServerGuns(['Elsewhere'], [['Browning', 400, 1]]),
  };
}

out.seatHost = {
  driverOfTank: seatHost({ drivable: true, seatIndex: 0, entityReady: true }),
  gunnerOfTank: seatHost({ drivable: true, seatIndex: 1, entityReady: true }),
  gunnerBeforeModel: seatHost({ drivable: true, seatIndex: 1, entityReady: false }),
  stationaryGun: seatHost({ drivable: false, seatIndex: 0, entityReady: true }),
  stationaryGunBeforeModel: seatHost({ drivable: false, seatIndex: 0, entityReady: false }),
  unknownSeat: seatHost({ drivable: true, seatIndex: null, entityReady: true }),
  gunnerEntityFailed: seatHost({ drivable: true, seatIndex: 1, entityReady: false, entityGiven: true }),
};

console.log(JSON.stringify(out));
