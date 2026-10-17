// Sidecar soldiers on a lab server run timed input scripts, so the server's
// own recorder (a scenario with `preload`) logs what FireArms and the upper
// animation machine do with each press: rounds (`f`), states (`st`).
//
//   node lab/firearms_probe.mjs 127.0.0.1:14568 probe.ndjson
//   SCRIPT=knife|bayonet|stab TEAM=1|2 SPAWN_GROUP=n KIT_A=n TURN=x node lab/firearms_probe.mjs ...
//
// Default: two US soldiers on FHSW Battle_Of_Foy (kit 0 the Greasegun and
// Knife_M1Bayonet, kit 1 the bayonet Garand, Knife_M1Bayonet_ID2 and
// GrenadeAllies; scenarios/fhsw-battle_of_foy-cq-firearms-rec.json). The
// buttons are level bits held for the stated time; the retail client sends a
// fireOnce / altFireOnce weapon's button only on a fresh press (ledger
// ZOOM-1), so only the taps stand for what a player can do. The log's `ms`
// is wall clock from the start; a `down` row's `ms` is the hold length.
// features/fh-fhsw-open-issues/lab-firearms.md has what the runs showed.
import fs from 'node:fs';
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence, BUTTON } from '../sidecar/input.mjs';

const [target, outPath] = process.argv.slice(2);
const [host, portStr] = target.split(':');
const port = Number(portStr);
const out = fs.createWriteStream(outPath);
const T0 = Date.now();
const log = (who, kind, rec = {}) => {
  const line = JSON.stringify({ who, kind, ms: Date.now() - T0, ...rec });
  out.write(line + '\n');
  if (!['ev'].includes(kind)) console.log(line);
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const TEAM = Number(process.env.TEAM ?? 2);

async function soldier(name, kit, spawnGroup, script) {
  const s = new Session(host, port, { name, team: TEAM, animStates: Number(process.env.ANIM_STATES ?? 0) });
  let spawned = false;
  s.on('event', (ev) => {
    if (['SetVehicle', 'SetDefaultVehicle', 'CreatePlayer', 'DestroyPlayer', 'HandlePickup', 'StatsShots', 'Suicide'].includes(ev.type))
      log(name, 'ev', { type: ev.type, playerId: ev.playerId, netId: ev.netId });
    if ((ev.type === 'SetVehicle' || ev.type === 'SetDefaultVehicle') && ev.playerId === s.me.playerId && ev.netId) spawned = true;
  });
  s.on('denied', (i) => log(name, 'denied', i));
  s.on('disconnected', (i) => log(name, 'disconnected', i));
  const joined = new Promise((r) => s.once('joined', r));
  await s.start();
  const j = await joined;
  log(name, 'joined', j);
  const sender = new InputSender(s, { idle: 'zero' });
  sender.start();
  let held = 0;
  // TURN=<mouseLookX> turns the soldier a little on every word, so his `st`
  // row (it carries his yaw) is written on every server tick and the rows
  // count ticks: the recorder's `t` is a wall clock, and the lab's ticks are
  // not evenly spaced in it.
  const turn = Number(process.env.TURN ?? 0);
  // `toggling` bits go on and off on alternate words: a press on every
  // other tick, to find the first tick a weapon takes one.
  let toggling = 0;
  let phase = 0;
  const pump = setInterval(() => {
    phase ^= 1;
    const buttons = held | (phase ? toggling : 0);
    sender.enqueue(turn ? { buttons, mouseLookX: turn } : { buttons });
  }, 33);
  // Spawn, retrying through the pregame.
  for (let tries = 0; !spawned && tries < 40; tries++) {
    await spawnSequence(s, { team: TEAM, kit, spawnGroup });
    log(name, 'spawnRequest', { kit, spawnGroup, tries });
    for (let k = 0; k < 30 && !spawned; k++) await delay(100);
  }
  if (!spawned) { log(name, 'noSpawn'); return; }
  log(name, 'spawned');
  await delay(2500);
  const api = {
    async hold(button, ms) { log(name, 'down', { b: button, ms }); held |= BUTTON[button]; await delay(ms); held &= ~BUTTON[button]; log(name, 'up', { b: button }); },
    async tap(button) { return api.hold(button, 70); },
    async toggle(button, ms) { log(name, 'toggle', { b: button, ms }); toggling |= BUTTON[button]; await delay(ms); toggling &= ~BUTTON[button]; log(name, 'untoggle', { b: button }); },
    wait: delay,
    mark: (label) => log(name, 'mark', { label }),
  };
  await script(api);
  clearInterval(pump);
  sender.stop();
  log(name, 'done');
  await delay(500);
  s.leave();
}

// A: kit 0 on Foy is 1Us_ClosequartersGreasegunSmoke2R: the Greasegun (no autoReload), then Knife_M1Bayonet.
async function scriptA(a) {
  a.mark('A select 3'); await a.tap('MENU3'); await a.wait(2000);
  a.mark('A1 hold fire 10 s from a full magazine'); await a.hold('FIRE', 10000); await a.wait(3000);
  a.mark('A2 three pulls on the empty magazine');
  for (let i = 0; i < 3; i++) { await a.hold('FIRE', 300); await a.wait(700); }
  await a.wait(6000);
  a.mark('A3 reload key'); await a.tap('RELOAD'); await a.wait(7000);
  a.mark('A4 hold fire 1 s after the reload'); await a.hold('FIRE', 1000); await a.wait(2000);
  a.mark('A5 select 1 (Knife_M1Bayonet)'); await a.tap('MENU1'); await a.wait(2000);
  a.mark('A6 three knife clicks 1.5 s apart'); for (let i = 0; i < 3; i++) { await a.hold('FIRE', 100); await a.wait(1400); }
  await a.wait(1000);
}

// B: the Garand with the bayonet, the knife, the Allied grenade.
async function scriptB(b) {
  b.mark('B select 1'); await b.tap('MENU1'); await b.wait(2000);
  b.mark('B1 ten clicks 0.4 s apart from a full clip');
  for (let i = 0; i < 10; i++) { await b.hold('FIRE', 100); await b.wait(300); }
  await b.wait(4000);
  b.mark('B2 reload key'); await b.tap('RELOAD'); await b.wait(5500);
  b.mark('B3 fire then alt 50 ms later (tap)'); await b.hold('FIRE', 70); await b.wait(0); await b.hold('ALT_FIRE', 70); await b.wait(2500);
  b.mark('B4 fire then alt held 600 ms from 50 ms'); await b.hold('FIRE', 70); await b.hold('ALT_FIRE', 600); await b.wait(2500);
  b.mark('B5 alt then fire 200 ms later (tap)'); await b.hold('ALT_FIRE', 70); await b.wait(130); await b.hold('FIRE', 70); await b.wait(2500);
  b.mark('B6 alt then fire held 1200 ms from 200 ms'); await b.hold('ALT_FIRE', 70); await b.wait(130); await b.hold('FIRE', 1200); await b.wait(2500);
  b.mark('B7 alt alone'); await b.hold('ALT_FIRE', 70); await b.wait(2500);
  b.mark('B8 empty the clip'); for (let i = 0; i < 8; i++) { await b.hold('FIRE', 70); await b.wait(400); }
  await b.wait(1500);
  b.mark('B9 reload, alt at +1 s (tap) and +2 s held 600 ms, +5.5 s tap');
  await b.tap('RELOAD'); await b.wait(1000); await b.hold('ALT_FIRE', 70); await b.wait(930); await b.hold('ALT_FIRE', 600); await b.wait(2900); await b.hold('ALT_FIRE', 70); await b.wait(2500);
  b.mark('B10 select 2 (knife)'); await b.tap('MENU2'); await b.wait(2000);
  b.mark('B11 three knife clicks 1.5 s apart'); for (let i = 0; i < 3; i++) { await b.hold('FIRE', 100); await b.wait(1400); }
  await b.wait(1500);
  b.mark('B12 lie, knife click'); await b.tap('LIE'); await b.wait(2500); await b.hold('FIRE', 100); await b.wait(2000); await b.tap('LIE'); await b.wait(2500);
  b.mark('B13 select 4 (grenade)'); await b.tap('MENU4'); await b.wait(2000);
  b.mark('B14 throw'); await b.hold('FIRE', 200); await b.wait(4000);
  b.mark('B15 throw'); await b.hold('FIRE', 200); await b.wait(4000);
}

const spawnGroup = Number(process.env.SPAWN_GROUP ?? 2);
// SCRIPT=knife: one soldier, item 1, eight clicks standing and four lying.
async function scriptKnife(k) {
  k.mark('K select 1'); await k.tap('MENU1'); await k.wait(2000);
  k.mark('K8 eight clicks 1.2 s apart'); for (let i = 0; i < 8; i++) { await k.hold('FIRE', 100); await k.wait(1100); }
  k.mark('K lie'); await k.tap('LIE'); await k.wait(2500);
  k.mark('K4 four prone clicks 1.5 s apart'); for (let i = 0; i < 4; i++) { await k.hold('FIRE', 100); await k.wait(1400); }
}
// SCRIPT=bayonet: item 1 (the bayonet rifle): the right button held 3 s,
// tapped, then the left held 2 s, then the right held through a reload.
async function scriptBayonet(k) {
  k.mark('Y select 1'); await k.tap('MENU1'); await k.wait(2000);
  k.mark('Y1 alt held 3 s'); await k.hold('ALT_FIRE', 3000); await k.wait(2000);
  k.mark('Y2 alt tap'); await k.tap('ALT_FIRE'); await k.wait(2000);
  k.mark('Y3 fire held 2 s'); await k.hold('FIRE', 2000); await k.wait(2000);
  k.mark('Y4 alt held 1.5 s then fire tapped at +0.3 s inside it');
  const h = k.hold('ALT_FIRE', 1500); await k.wait(300); await k.tap('FIRE'); await h; await k.wait(2000);
}
// SCRIPT=stab: Secret Weapons' commando (scenarios/xpack2-raid_on_agheila-
// cq-knife-rec.json, kit 1): item 1 is CommandoKnife, whose right button is
// CommandoKnifeStab (`fireDelay 0.3`) and left the throw (`fireDelay 0.43`).
// Taps only (both are fireOnce / altFireOnce), each 2 s from the last, run
// with TURN so the ticks from each press to its round can be counted.
async function scriptStab(k) {
  k.mark('S select 1'); await k.tap('MENU1'); await k.wait(2000);
  k.mark('S1 eight stabs 2 s apart'); for (let i = 0; i < 8; i++) { await k.tap('ALT_FIRE'); await k.wait(1930); }
  k.mark('S2 three throws 2.5 s apart'); for (let i = 0; i < 3; i++) { await k.tap('FIRE'); await k.wait(2430); }
}
// SCRIPT=delay: vanilla `fireDelay` weapons (scenarios/bf1942-berlin-cq-
// firedelay-rec.json, TEAM=1). A, kit 4 (engineer): ExpPack (item 4) and
// Landmine (item 5), `fireDelay 0.4`, 12 ticks in real numbers and 13 in a
// float32 countdown; B, kit 1 (assault): GrenadeAxis (item 4), `fireDelay
// 0.8`, 24 either way, the control. Taps only, run with TURN.
async function scriptDelayA(a) {
  a.mark('D select 4 (ExpPack)'); await a.tap('MENU4'); await a.wait(2000);
  a.mark('D1 four packs 2 s apart'); for (let i = 0; i < 4; i++) { await a.tap('FIRE'); await a.wait(1930); }
  a.mark('D select 5 (Landmine)'); await a.tap('MENU5'); await a.wait(2000);
  a.mark('D2 four mines 2 s apart'); for (let i = 0; i < 4; i++) { await a.tap('FIRE'); await a.wait(1930); }
}
async function scriptDelayB(b) {
  b.mark('G select 4 (GrenadeAxis)'); await b.tap('MENU4'); await b.wait(2000);
  b.mark('G1 three throws 3 s apart'); for (let i = 0; i < 3; i++) { await b.tap('FIRE'); await b.wait(2930); }
}
// SCRIPT=delayhold: the engineer holds the left button on ExpPack for 5 s
// (it placed one pack: a held button is not a new press for it), then
// presses it on every other tick for 6 s, so the gap between rounds is the
// delay plus the fire timer of a round the delay fired, to a tick's parity.
async function scriptDelayHold(a) {
  a.mark('H select 4 (ExpPack)'); await a.tap('MENU4'); await a.wait(2000);
  a.mark('H1 fire held 5 s'); await a.hold('FIRE', 5000); await a.wait(1000);
  a.mark('H2 fire pressed on every other tick for 6 s'); await a.toggle('FIRE', 6000); await a.wait(1000);
}
if (process.env.SCRIPT === 'delayhold') {
  await soldier(process.env.NAME_A ?? 'probeH', Number(process.env.KIT_A ?? 4), spawnGroup, scriptDelayHold);
} else if (process.env.SCRIPT === 'delay') {
  await Promise.all([
    soldier(process.env.NAME_A ?? 'probeD', Number(process.env.KIT_A ?? 4), spawnGroup, scriptDelayA),
    delay(1500).then(() => soldier(process.env.NAME_B ?? 'probeG', Number(process.env.KIT_B ?? 1), spawnGroup, scriptDelayB)),
  ]);
} else if (process.env.SCRIPT === 'stab') {
  await soldier(process.env.NAME_A ?? 'probeS', Number(process.env.KIT_A ?? 1), spawnGroup, scriptStab);
} else if (process.env.SCRIPT === 'bayonet') {
  await soldier(process.env.NAME_A ?? 'probeY', Number(process.env.KIT_A ?? 1), spawnGroup, scriptBayonet);
} else if (process.env.SCRIPT === 'knife') {
  await soldier(process.env.NAME_A ?? 'probeK', Number(process.env.KIT_A ?? 0), spawnGroup, scriptKnife);
} else {
  await Promise.all([
    soldier(process.env.NAME_A ?? 'probeA', Number(process.env.KIT_A ?? 0), spawnGroup, scriptA),
    delay(1500).then(() => soldier(process.env.NAME_B ?? 'probeB', Number(process.env.KIT_B ?? 1), spawnGroup, scriptB)),
  ]);
}
out.end();
setTimeout(() => process.exit(0), 300);
