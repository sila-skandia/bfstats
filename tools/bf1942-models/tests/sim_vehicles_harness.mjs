// The headless runner's vehicle path (`sim/stage.mjs`) on a real extracted
// level: one recipe per run, printed as one JSON line. Run by
// `tests/test_sim_vehicles.py`, which finds the untracked maps tree.
//
//   node tests/sim_vehicles_harness.mjs <viewer assets dir> <recipe>
//
// The recipes are the live ones from features/bf1942-ai-research-2026-09-21/
// PARITY_STATUS_2026-09-23.md (a bot seated with the page's `__botMount`
// law: the nearest free seat of a template; a target frozen with
// `soldier.spawn` + `setPosition` + `tick = () => {}`), played in the runner.

import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIM = path.join(HERE, '..', 'sim');
const { viewerDir, loadViewerModules, seedMathRandom, routeConsole } = await import(path.join(SIM, 'env.mjs'));
const { realLevel } = await import(path.join(SIM, 'level.mjs'));
const { Match } = await import(path.join(SIM, 'match.mjs'));

const [assets, recipe] = process.argv.slice(2);
const SEED = 7;
const M = await loadViewerModules(viewerDir(path.join(HERE, '..', 'viewer')));
routeConsole(true);

async function start(map, botsPerSide = 4) {
  seedMathRandom(SEED);
  const level = await realLevel(M, { maps: path.join(assets, 'maps'), models: path.join(assets, 'models'), map });
  seedMathRandom(SEED);
  const match = new Match({ M, level, botsPerSide, duration: 3600, seed: SEED, sink: null });
  match.setup();
  return match;
}

const bot = (match, id) => match.bots.find(b => b.playerId === id);

/** `__botMount`: the nearest free seat of `template` (`driver`: its root). */
function mount(match, b, template, seat = 'driver') {
  const p = b.getPosition();
  const cands = match.stage.units.candidates().filter(c => !c.occupiedBy && c.template === template
    && (seat === 'driver' ? c.isRoot : c.seatId === seat));
  cands.sort((x, y) => Math.hypot(x.pos[0] - p[0], x.pos[2] - p[2]) - Math.hypot(y.pos[0] - p[0], y.pos[2] - p[2]));
  if (!cands.length) throw new Error(`no free ${template} ${seat}`);
  if (!match.referee.enterVehicle(b, cands[0])) throw new Error(`could not seat ${b.playerId} in ${template}`);
  return cands[0];
}

/** Every other bot stops thinking, out of the way (the recipes' freeze). */
function freezeOthers(match, keep) {
  for (const b of match.bots) if (!keep.includes(b.playerId)) b.tick = () => {};
}

/** A frozen soldier at (x, z) on the ground, facing `yaw`. */
function plant(match, b, x, z, yaw = 0) {
  const y = match.groundAt(x, z);
  match.world.player(b.playerId).soldier.spawn(x, y, z, yaw);
  b.setPosition(x, y, z);
  b.route = null;
  b.onRespawn();
  b.tick = () => {};
}

/** The hull's forward on x/z (its -z column), and its position. */
function hullFrame(match, b) {
  const node = b.vehicle.node;
  node.updateWorldMatrix(true, false);
  const e = node.matrixWorld.elements;
  const f = [-e[8], -e[10]];
  const len = Math.hypot(f[0], f[1]) || 1;
  return { x: e[12], y: e[13], z: e[14], fx: f[0] / len, fz: f[1] / len };
}

function run(match, seconds, until = null) {
  const end = match.clock + seconds;
  while (match.clock < end - 1e-9) {
    match.step();
    if (until?.()) break;
  }
}

const eventsOf = (match, type) => match.events.filter(e => e.type === type);
const round = v => Math.round(v * 1000) / 1000;

const recipes = {
  /** A bot takes a tank's wheel: the hull's one drive is the real
   *  `TrackedVehicle`, adopted into the body world, and it moves the node. */
  async drive() {
    const match = await start('el_alamein');
    const b = bot(match, 'bot_1');
    const cand = mount(match, b, 'Sherman');
    const drive = b.vehicle.drive;
    const owner = match.stage.ownerOf(b.vehicle.node);
    const from = { ...drive.state.position };
    const bodyWorld = match.world.bodyWorld;
    const parked = [...bodyWorld.entries.values()].filter(e => e.parked).length;
    const adopted = !!bodyWorld.get(owner)?.driven;
    const trail = createHash('sha256');
    for (let i = 0; i < 40 * 30; i++) {
      match.step();
      const s = drive.state.position;
      trail.update(`${round(s.x)},${round(s.y)},${round(s.z)};`);
    }
    const s = drive.state.position;
    const node = b.vehicle.node;
    node.updateWorldMatrix(true, false);
    const e = node.matrixWorld.elements;
    return {
      template: cand.template, driveClass: drive.constructor.name, adopted, parkedBodies: parked,
      moved: Math.hypot(s.x - from.x, s.z - from.z), nodeOff: Math.hypot(e[12] - s.x, e[13] - s.y, e[14] - s.z),
      stillMounted: !!b.vehicle, trail: trail.digest('hex'),
    };
  },
};

const fn = recipes[recipe];
if (!fn) throw new Error(`unknown recipe ${recipe} (${Object.keys(recipes).join(', ')})`);
process.stdout.write(JSON.stringify(await fn()) + '\n');
