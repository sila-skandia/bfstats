// A standing target for hit-registration probes: a node client joins the lab,
// spawns in a spawn group and stands still, zero input, until SIGINT (then it
// leaves cleanly, so the server drops its player at once).
//
//   node lab/hit_target.mjs 127.0.0.1:14568 tgt1 [team=2] [group=1] [kit=0]
//
// The page (or a probe) then shoots at him: the server's hit raises this
// side's HitFromPos and the shooter's crosshair bool (ledger XHIT-6), which is
// what `lab/hit_reg_probe.cjs` times. Prints one JSON line per event of
// interest: joined, spawned (netId), hitFrom, died.
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence } from '../sidecar/input.mjs';

const [target = '127.0.0.1:14568', name = 'tgt1', team = '2', group = '1', kit = '0'] = process.argv.slice(2);
const [host, port] = target.split(':');
const log = (kind, rec = {}) => console.log(JSON.stringify({ kind, t: Date.now(), ...rec }));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const s = new Session(host, Number(port), { name, team: Number(team) });
let netId = null;
s.on('event', (ev) => {
  // His soldier, not the free camera a death hands him (same event).
  if ((ev.type === 'SetDefaultVehicle' || ev.type === 'SetVehicle') && ev.playerId === s.me.playerId && ev.netId
      && s.bodies.classOf(ev.netId) === 'BFSoldierNetworkable') {
    if (netId !== ev.netId) { netId = ev.netId; tries = 0; found = true; log('spawned', { netId, playerId: s.me.playerId, group: g }); }
  }
  if (ev.type === 'HitFromPos') log('hitFrom', { sector: ev.sector, strength: ev.strength });
  if (ev.type === 'ScoreMsg' && ev.playerId === s.me.playerId && (ev.scoreType === 4 || ev.scoreType === 5)) {
    log('died'); netId = null;
  }
});
const joined = new Promise((r) => s.once('joined', r));
await s.start();
log('joined', await joined);
const sender = new InputSender(s, { idle: 'zero' });
sender.start();
const pump = setInterval(() => sender.enqueue({ buttons: 0 }), 1000 / 30);
let stop = false;
process.on('SIGINT', () => { stop = true; });
// A group of the other side's is refused without a word (no spawn event), so
// a try that does not spawn moves on to the next group.
let g = Number(group), tries = 0, found = false;
while (!stop) {
  if (netId == null) {
    if (tries++ > 0 && tries % 10 === 0 && !found) g = g % 8 + 1;
    await spawnSequence(s, { team: Number(team), kit: Number(kit), spawnGroup: g });
    for (let k = 0; k < 30 && netId == null && !stop; k++) await delay(100);
  } else await delay(200);
}
clearInterval(pump);
sender.stop();
s.leave();
await delay(300);
process.exit(0);
