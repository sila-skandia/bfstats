// A sidecar soldier joins a lab server, spawns, and shouts "Medic!" (radio
// 40, RADIO_LOCAL_MEDIC) then "Need repairs!" (54) every few seconds, so a
// page on the same side as a medic or an engineer can be checked for the
// call it marks (viewer/support-calls.js, ledger HUD-25).
//
//   node lab/support_call_probe.mjs 127.0.0.1:14568 out.ndjson
//
// Env: TEAM (2), NAME, MSG (40), EVERY (5000 ms), FOR (90000 ms).
import fs from 'node:fs';
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence, actionFor } from '../sidecar/input.mjs';

const [target, outPath] = process.argv.slice(2);
const [host, portStr] = target.split(':');
const out = fs.createWriteStream(outPath);
const T0 = Date.now();
const log = (kind, rec = {}) => {
  const line = JSON.stringify({ kind, ms: Date.now() - T0, ...rec });
  out.write(line + '\n');
  console.log(line);
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const TEAM = Number(process.env.TEAM ?? 2);
const NAME = process.env.NAME ?? `shout${Date.now() % 1000}`;
const MSG = Number(process.env.MSG ?? 40);
const EVERY = Number(process.env.EVERY ?? 5000);
const FOR = Number(process.env.FOR ?? 90000);

const s = new Session(host, Number(portStr), { name: NAME, team: TEAM });
s.on('disconnected', (i) => log('disconnected', i));
const joined = new Promise((r) => s.once('joined', r));
await s.start();
log('joined', await joined);
const sender = new InputSender(s, { idle: 'zero' });
const pump = setInterval(() => sender.enqueue(actionFor({ forward: 0, lookX: 0, buttons: 0 })), 33);
// The side's spawn group is not known here: ask each in turn (a request once
// alive is ignored by the server).
for (let g = 0; g < 6; g++) {
  await spawnSequence(s, { team: TEAM, kit: 0, spawnGroup: g });
  await delay(2500);
}
log('spawned', { pid: s.me.playerId });
const end = Date.now() + FOR;
while (Date.now() < end) {
  s.queue('RadioMessage', { message: MSG, broadcast: false, playerId: s.me.playerId });
  log('shout', { msg: MSG });
  await delay(EVERY);
}
clearInterval(pump);
sender.stop();
log('done');
await delay(500);
s.leave();
out.end();
setTimeout(() => process.exit(0), 300);
