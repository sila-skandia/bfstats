// A bot in a guided-missile launcher, in the headless runner (`sim/stage.mjs`):
// the launcher's gun throws a round that is a vehicle (ledger FA-29), and the
// bot is put in it, as `FireArms::fireBarrel` puts a player there. The page's
// own `rocket-ride.js` and `round-spawners.js` do it; the runner hands them the
// pool `sim/level.mjs` parks. Run by `tests/test_sim_missile.py`.
//
//   node tests/sim_missile_harness.mjs <maps dir> <models dir> <map> <launcher template>
//
// Prints one JSON object: the template the bot is in after the launch and
// 2 s on, whether it flew (moved, gained speed), and where it is after the
// warhead (back in the launcher, alive).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIM = path.join(HERE, '..', 'sim');
const { viewerDir, loadViewerModules, seedMathRandom, routeConsole } = await import(path.join(SIM, 'env.mjs'));
const { realLevel } = await import(path.join(SIM, 'level.mjs'));
const { Match } = await import(path.join(SIM, 'match.mjs'));

const [maps, models, map, launcher] = process.argv.slice(2);
const M = await loadViewerModules(viewerDir(path.join(HERE, '..', 'viewer')));
routeConsole(true);
seedMathRandom(7);
const level = await realLevel(M, { maps, models, map });
seedMathRandom(7);
const match = new Match({ M, level, botsPerSide: 4, duration: 3600, seed: 7, sink: null,
                          seats: [{ bot: 'bot_1', template: launcher, seat: null }] });
match.setup();
const stage = match.stage;
const bot = match.bots.find(b => b.playerId === 'bot_1');
const rootName = () => {
  const root = stage.vehicles.seatOf(bot.playerId)?.root;
  return root ? String(root.userData?.control ?? root.name) : null;
};
const out = { pool: (stage.statics.roundRecords ?? []).map(r => r.template), seatedIn: rootName() };

// The bot's launcher gun, the one whose round is a vehicle.
const groups = stage.vehicles.seatOf(bot.playerId)?.groups;
const group = [...(groups?.driven ?? []), ...(groups?.manned ?? [])].find(g => g.stats?.projectile?.vehicle === true);
out.gun = !!group;
if (group) {
  const { fireBarrel } = await import(path.join(HERE, '..', 'viewer', 'round-launch.js'));
  fireBarrel(stage.guns, group, group.muzzles[0]);
  const where = () => stage.vehicles.seatOf(bot.playerId)?.drive?.state?.position?.toArray?.() ?? null;
  for (let i = 0; i < 4; i++) match.step();
  out.rodeIn = rootName();
  const a = where();
  for (let i = 0; i < 60; i++) match.step();
  const b = where();
  out.after2s = rootName();
  out.moved = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) : 0;
  out.speed = stage.vehicles.seatOf(bot.playerId)?.drive?.state?.velocity?.length?.() ?? 0;
  // Up to 90 s more for the round to end (the pilot's warhead, a crash, its
  // motor and the area): the bot is back in its launcher, alive.
  for (let i = 0; i < 90 * 30 && rootName() !== launcher; i++) match.step();
  out.finally = rootName();
  out.alive = !match.world.armorOf(bot.playerId)?.destroyed;
  out.shotsOfShell = match.stats.get('bot_1')?.vehicleRounds ?? null;
}
process.stdout.write(JSON.stringify(out) + "\n");
