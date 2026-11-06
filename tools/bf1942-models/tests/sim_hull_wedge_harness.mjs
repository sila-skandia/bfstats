// A bot-driven hull wedged on a prop the vehicle map does not show, on the
// real Wake Island bake, under the headless runner (`sim/`). Run by
// `tests/test_bot_hull_wedge.py`, which finds the untracked maps tree.
//
//   node tests/sim_hull_wedge_harness.mjs <viewer assets dir> [viewer dir]
//
// The scene is the one `sim/run.mjs --map wake --seed 1 --doctrine garrison`
// played at 753 s (features/browser-play-feedback-2026-11-06 #5): an Allied
// bot drives the Chi-ha from the Airfield's supply depot toward CrossRoads
// (1146.5, -762.9), cuts the corner between the depot and an abandoned
// Sherman, and puts its front-left corner on a steel barrel
// (`stebarrel1_m1`, contact at about (1361.6, -737.7)). Before the hull touch
// rule it held full throttle there for 146 s. Here the hull starts on its
// approach (where it stood at 752.3 s, at speed along its heading) and also
// already pressed on the barrel, and the run reports where it is after 15 s
// and after 40 s. Prints one JSON line.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIM = path.join(HERE, '..', 'sim');
const { viewerDir, loadViewerModules, seedMathRandom, routeConsole } = await import(path.join(SIM, 'env.mjs'));
const { realLevel } = await import(path.join(SIM, 'level.mjs'));
const { Match } = await import(path.join(SIM, 'match.mjs'));

const [assets, viewer = null] = process.argv.slice(2);
const SEED = 1;
const M = await loadViewerModules(viewerDir(viewer ?? path.join(HERE, '..', 'viewer')));
routeConsole(true);

/** The wedge: where the Chi-ha's centre stood pressed on the barrel. */
const WEDGE = [1363.93, -739.64];
const WEDGE_FORWARD = [-0.44, 0.90];
/** Its approach 1.5 s earlier, at 9 m/s along its heading. */
const APPROACH = [1376.02, -745.41];
const APPROACH_FORWARD = [-0.86, 0.51];
const ORDER = { point: [1146.54, -762.92], radius: 10.1 };
const TEMPLATE = 'Sherman';

async function start() {
  seedMathRandom(SEED);
  const level = await realLevel(M, { maps: path.join(assets, 'maps'), models: path.join(assets, 'models'), map: 'wake' });
  seedMathRandom(SEED);
  const match = new Match({ M, level, botsPerSide: 4, duration: 3600, seed: SEED, sink: null, doctrine: 'garrison' });
  match.setup();
  return match;
}

/** Point a bot's order at `goal`, one held object a bot as the SAI holds
 *  one (sim_vehicles_harness.mjs `redirectOrders`). */
function redirectOrder(match, id, goal) {
  const sai = match.referee.strategy;
  const waypointsOf = sai.waypointsOf.bind(sai);
  let held = null;
  sai.waypointsOf = pid => {
    const wp = waypointsOf(pid);
    if (pid !== id || !wp) return wp;
    if (held?.from !== wp) held = { from: wp, order: { ...wp, ...goal } };
    return held.order;
  };
}

const round = v => Math.round(v * 100) / 100;

async function scenario(from, forward, speed) {
  const match = await start();
  // The Chi-ha spawns only once the Axis hold the Airfield (its pad's
  // ownership gate), so the harness takes the Allies' Sherman, the same
  // driving law and a hull of the same class, and puts it where the Chi-ha
  // stood.
  const b = match.bots.find(o => o.team === 2);
  const p = b.getPosition();
  const cands = match.stage.units.candidates().filter(c => !c.occupiedBy && c.template === TEMPLATE && c.isRoot)
    .sort((x, y) => Math.hypot(x.pos[0] - p[0], x.pos[2] - p[2]) - Math.hypot(y.pos[0] - p[0], y.pos[2] - p[2]));
  if (!cands.length || !match.referee.enterVehicle(b, cands[0])) throw new Error(`could not seat the ${TEMPLATE} driver`);
  for (const o of match.bots) if (o !== b) o.tick = () => {};
  redirectOrder(match, b.playerId, ORDER);
  // The order's flag held by the other side, as Landing_Beach was in the
  // round: an Allied bot's move to a flag his side owns weighs half as much
  // (`WPMoveTo::getUrgency`'s factor), and Scout outbid it.
  const beach = match.world.flags.find(f => f.name === 'Landing_Beach');
  if (beach) beach.team = 1;
  const s = b.vehicle.drive.state;
  const [x, z] = from;
  const y = match.groundAt(x, z) + 1.0;
  s.position.set(x, y, z);
  s.velocity.set(forward[0] * speed, 0, forward[1] * speed);
  s.angularVelocity.set(0, 0, 0);
  // The nose (-z in the model) along `forward`.
  s.orientation.setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.atan2(-forward[0], -forward[1]));
  b.setPosition(x, y, z);
  b.route = null;
  const t0 = match.clock;
  const away = () => Math.hypot(b.position[0] - WEDGE[0], b.position[2] - WEDGE[1]);
  let wedgedAt = null, leftAt = null, maxPressed = 0, pressed = 0, contactCircles = 0, reversed = false;
  const at = {};
  while (match.clock - t0 < 40) {
    match.step();
    const t = match.clock - t0;
    const st = b.vehicle?.drive?.state;
    const v = st ? Math.hypot(st.velocity.x, st.velocity.z) : 0;
    // "Pressed": the throttle held while the hull stands still.
    if (Math.abs(b.moveForward) > 0.5 && v < 0.5) { pressed += 1 / 30; maxPressed = Math.max(maxPressed, pressed); } else pressed = 0;
    if (b.moveForward < -0.1) reversed = true;
    if (wedgedAt === null && away() < 2.0) wedgedAt = round(t);
    if (leftAt === null && t > 1 && away() > 4.0) leftAt = round(t);
    for (const mark of [15, 40]) {
      if (at[mark] === undefined && t >= mark - 1e-6) at[mark] = { away: round(away()), pos: [round(b.position[0]), round(b.position[2])] };
    }
    contactCircles = Math.max(contactCircles, b.obstacles.filter(o => o.unit !== undefined).length);
    if (process.env.WEDGE_TRACE && Math.round(t * 30) % 10 === 0) {
      process.stderr.write(JSON.stringify({ t: round(t), pos: [round(b.position[0]), round(b.position[2])], v: round(v),
        f: b._vehicleForward().map(round), mf: round(b.moveForward), ms: round(b.moveStrafe), beh: b.currentBehaviour,
        asd: b._asd?.state, stp: b._dbgSteer?.map(round), st: round(b._stalledTicks ?? 0),
        r: b.route && { f: b.route.failed, bo: b.route.backOut, p: b.route.points.slice(0, 3).map(q => q.map(round)) },
        obs: b.obstacles.map(o => [round(o.x), round(o.z), round(o.r)]),
        hc: (b.vehicle?.drive?.hullContacts ?? []).map(c => [round(c.x), round(c.z), round(c.normalY)]) }) + '\n');
    }
  }
  return { at15: at[15], at40: at[40], wedgedAt, leftAt, maxPressed: round(maxPressed), reversed, contactCircles,
           mounted: !!b.vehicle, template: b.vehicle?.template ?? null };
}

const out = {
  approach: await scenario(APPROACH, APPROACH_FORWARD, 9.0),
  pressed: await scenario(WEDGE, WEDGE_FORWARD, 0.0),
};
process.stdout.write(JSON.stringify(out) + '\n');
