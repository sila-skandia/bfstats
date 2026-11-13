// A soldier throws through a portal of the house the target stands in (AI-195),
// in the headless runner on a real level whose cover objects have portals.
//   node tests/sim_portal_harness.mjs <maps> <models> <map> <vehicle-ai.json with coverPortalPlanes> [trace.json]
// Prints one JSON object (and writes the trace for a drawing when given).
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIM = path.join(HERE, '..', 'sim');
const { viewerDir, loadViewerModules, seedMathRandom, routeConsole } = await import(path.join(SIM, 'env.mjs'));
const { realLevel } = await import(path.join(SIM, 'level.mjs'));
const { Match } = await import(path.join(SIM, 'match.mjs'));
const [maps, models, map, aiFile, traceFile] = process.argv.slice(2);
// The maps tree with this vehicle-ai.json in its _shared.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-'));
fs.symlinkSync(path.join(maps, map), path.join(tmp, map));
fs.mkdirSync(path.join(tmp, '_shared'));
for (const f of fs.readdirSync(path.join(maps, '_shared'))) {
  if (f !== 'vehicle-ai.json') fs.symlinkSync(path.join(maps, '_shared', f), path.join(tmp, '_shared', f));
}
fs.copyFileSync(aiFile, path.join(tmp, '_shared', 'vehicle-ai.json'));
const M = await loadViewerModules(viewerDir(path.join(HERE, '..', 'viewer')));
routeConsole(true);
seedMathRandom(3);
// A thrower's grenade carries real weapon data when `GRENADE_GLB` names a
// weapon glb (its `c_PIFire` FireArms' throw, round and magazine): the models
// tree is then a directory of links to `models` and that file.
let modelsDir = models;
const grenadeGlb = process.env.GRENADE_GLB;
if (grenadeGlb) {
  modelsDir = path.join(tmp, '_models');
  fs.mkdirSync(modelsDir);
  for (const f of fs.readdirSync(models)) fs.symlinkSync(path.join(models, f), path.join(modelsDir, f));
  fs.symlinkSync(path.resolve(grenadeGlb), path.join(modelsDir, path.basename(grenadeGlb)));
}
const level = await realLevel(M, { maps: tmp, models: modelsDir, map });
seedMathRandom(3);
const match = new Match({ M, level, botsPerSide: 4, duration: 3600, seed: 3, sink: null });
match.setup();
for (let i = 0; i < 5; i++) match.step();
const ref = match.referee;
const planes = match.stage.botUnits.aiCoverPortalPlanes;
const portal = await import(path.join(HERE, '..', 'viewer', 'bot-portal.js'));
const wanted = Number(process.env.COVER_INDEX ?? 0);
const cover = ref.covers.filter(c => c.node && planes?.[c.template]?.length && c.width > 4)[wanted];
const out = { cover: cover?.template, portals: planes?.[cover?.template]?.length };
const m = cover.node.matrixWorld.elements;
// A door a soldier can walk through: the portal whose bottom is at the ground.
const all = planes[cover.template].map(pl => portal.portalInWorld(pl, m));
const door = Math.max(0, all.findIndex(q => Math.abs(q.yMin - match.groundAt(q.centre[0], q.centre[2])) < 1.0));
const w = all[door];
out.door = door;
const plant = (b, x, z) => {
  const y = match.groundAt(x, z);
  if (b.vehicle) match.referee.leaveVehicle(b, { silent: true });
  match.world.player(b.playerId).soldier.spawn(x, y, z, 0);
  b.setPosition(x, y, z); b.route = null; b.onRespawn(); b.tick = () => {};
};
const at = (k) => [w.centre[0] + w.normal[0] * k, w.centre[2] + w.normal[2] * k];
// On foot, not seated: a seated player's position is the hull's.
const onFoot = b => !b.vehicle && !match.world.players.get(b.playerId)?.occupancy?.root;
const A = match.bots.find(b => b.team === 1 && onFoot(b)), T = match.bots.find(b => b.team === 2 && onFoot(b));
const trace = { centre: w.centre, normal: w.normal, footprint: cover.footprint, steps: [] };
// The target walks in through the door.
for (const k of [8, 4, 1.5, -1, -3]) {
  const [x, z] = at(k);
  plant(T, x, z);
  match.step();
  (out.walk ??= []).push([k, +T.position[0].toFixed(1), +T.position[1].toFixed(1), +T.position[2].toFixed(1), ref.portals.insideOf(T.playerId)]);
}
out.w = { c: w.centre.map(v => +v.toFixed(1)), n: w.normal.map(v => +v.toFixed(2)), yMin: w.yMin, yMax: w.yMax, l: w.left, r: w.right, id: cover.id };
out.targetInside = ref.portals.insideOf(T.playerId) === cover.id;
// The thrower stands 30 m out in front, with one grenade and nothing else.
const OUT = Number(process.env.OUT ?? 30);
const [ax, az] = at(OUT);
plant(A, ax, az);
A.tick = () => {};
const GRENADE = grenadeGlb ? path.basename(grenadeGlb, '.glb') : 'Grenade';
A.weapons = [{ name: GRENADE, burst: 0, indirect: 1, isThrown: true, deviation: 5, deviationCorrectionTime: 10,
               minRange: 5, maxRange: 40, weaponFire: 'PIFire', strength: { Infantry: 5, LightArmour: 5 }, ammo: 3, healing: false,
               shotsFired: 0, hits: 0 }];
A.weaponIndex = 0;
A.weaponAi = A.weapons[0];
const fire = level.weaponFire(GRENADE);
if (fire) A.setWeaponData(GRENADE, fire);
out.weaponData = !!fire && !!fire.throw;
A.firingTarget = T.playerId;
A.targetPosition = [...match.world.player(T.playerId).soldier.position ?? [T.position[0], T.position[1], T.position[2]]];
A.targetPosition = [T.position[0], T.position[1], T.position[2]];
const states = [];
out.dbg = { type: A._unitInfo?.(T.playerId)?.type, dist: Math.hypot(A.position[0]-T.position[0], A.position[2]-T.position[2]), vehicle: !!A.vehicle };
let plan = null;
for (let i = 0; i < 40 && !plan; i++) {
  A._fireData = null; A.currentPlan = [];
  const p = A._planFire(match.clock + i * 10);
  states.push(A._fireData?.history?.[0] ?? null);
  if (p.some(a => a.type === 'InfanteryMoveTo')) plan = p;
}
out.states = states;
out.plan = plan?.map(a => a.type);
const goal = plan?.find(a => a.type === 'InfanteryMoveTo')?.waypoint;
out.goal = goal;
if (goal) {
  out.goalDistanceToPortal = Math.hypot(goal[0] - w.centre[0], goal[2] - w.centre[2]);
  out.goalInFront = (goal[0] - w.centre[0]) * w.normal[0] + (goal[2] - w.centre[2]) * w.normal[2] > 0;
  // Let the bot run the plan: its own tick, the target held where it stands.
  delete A.tick;
  A._decisionMaking = () => {};    // the plan is the only thing the bot does
  A.currentPlan = plan; A.planBehaviour = M.BEHAVIOUR?.Fire ?? A.planBehaviour;
  const first = A.position.slice();
  for (let i = 0; i < 30 * 40; i++) {
    // The target stays where it was put: the world's soldier is held there.
    if (i % 15 === 0) { const [tx, tz] = at(-3); plant(T, tx, tz); }
    // The runner does not tick the planted target's body, so the thrower's
    // sensed bone on it is stale: aim at the soldier where he stands.
    A.senses?.memory?.delete?.(T.playerId);
    A.firingTarget = T.playerId; A.targetPosition = [T.position[0], T.position[1], T.position[2]];
    match.step();
    if (i % 15 === 0) trace.steps.push([A.position[0], A.position[2]]);
    if (i % 150 === 0) (out.log ??= []).push([i / 30, A.currentPlan.map(a => a.type).join('>'), +A.position[0].toFixed(1), A.moveForward]);
    const shots = match.stats.get(A.playerId)?.shots ?? 0;
    if (shots > 0) {
      // The throw: where the thrower stood, how far from the firing position,
      // and the round in the air.
      out.threwAfter = i / 30;
      out.threwFrom = [+A.position[0].toFixed(2), +A.position[2].toFixed(2)];
      out.threwFromGoal = Math.hypot(A.position[0] - goal[0], A.position[2] - goal[2]);
      out.shots = shots;
      trace.throwAt = [A.position[0], A.position[2]];
      break;
    }
  }
  out.finalToGoal = Math.hypot(A.position[0] - goal[0], A.position[2] - goal[2]);
  out.moveDone = !!plan[0].done; out.ammo = A.weapons[0].ammo; out.planLeft = A.currentPlan.map(a => a.type);
  out.moved = Math.hypot(A.position[0] - first[0], A.position[2] - first[2]);
  out.end = [A.position[0], A.position[2]];
}
// States 6 and 7 (no throw to make: its clock has not run). A thrower out in
// front of the door with the target inside draws 6 (walk to the portal's firing
// position) or 5; the same thrower inside the house with the target outside
// draws 7 (walk to the first free point behind the portal).
if (process.env.ADVANCE) {
  const probe = (who, label, plantAt) => {
    const seen = {};
    for (let i = 0; i < 60; i++) {
      who._fireData = { targetId: T.playerId, time: match.clock, history: [], lastThrow: match.clock, throwWait: 8 };
      who.currentPlan = []; who.firingTarget = T.playerId;
      who.targetPosition = [T.position[0], T.position[1], T.position[2]];
      const p = who._planFire(match.clock + 1);
      const st = who._fireData?.history?.[0] ?? 0;
      (seen[st] ??= { n: 0 }).n++;
      if (p.advance && !seen[st].plan) {
        const mv = p.find(a => a.type === 'InfanteryMoveTo');
        seen[st].plan = p.map(a => a.type);
        seen[st].arrive = mv?.arrive;
        if (mv) {
          seen[st].point = mv.waypoint.map(v => +v.toFixed(2));
          seen[st].frontOfPortal = (mv.waypoint[0] - w.centre[0]) * w.normal[0] + (mv.waypoint[2] - w.centre[2]) * w.normal[2];
          seen[st].toPortal = Math.hypot(mv.waypoint[0] - w.centre[0], mv.waypoint[2] - w.centre[2]);
        }
      }
    }
    out[label] = seen;
  };
  const [tx, tz] = at(-3);
  plant(T, tx, tz);
  // Register the passing of each: the walk in through the door.
  const walkIn = (b) => { for (const k of [8, 4, 1.5, -1, -3]) { const [x, z] = at(k); plant(b, x, z); match.step(); } };
  // The thrower outside, the target inside (state 6).
  plant(A, ...at(OUT));
  A.tick = () => {};
  probe(A, 'advanceOutside');
  // The thrower inside the house, the target outside (state 7).
  const [ox, oz] = at(25);
  plant(T, ox, oz);
  walkIn(A);
  out.thrower7Inside = ref.portals.insideOf(A.playerId) === cover.id;
  probe(A, 'advanceInside');
}
trace.goal = goal; trace.half = [w.left, w.right]; trace.cover = cover.template; trace.end = out.end ?? [A.position[0], A.position[2]]; trace.start = [ax, az]; trace.target = [T.position[0], T.position[2]];
if (traceFile) fs.writeFileSync(traceFile, JSON.stringify(trace));
process.stdout.write(JSON.stringify(out) + '\n');
