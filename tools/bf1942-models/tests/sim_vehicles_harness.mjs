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

  /** The same tank against a frozen soldier 40 m ahead: its guns are the
   *  page's `GunFire` groups, and the round that lands is billed through
   *  `applyVehicleHit` (the direct hit on a soldier body, or the splash). */
  async gun() {
    const match = await start('el_alamein');
    const b = bot(match, 'bot_1');
    const target = match.bots.find(o => o.team !== b.team);
    mount(match, b, 'Sherman');
    freezeOthers(match, [b.playerId]);
    run(match, 1);
    const h = hullFrame(match, b);
    plant(match, target, h.x + h.fx * 40, h.z + h.fz * 40, Math.atan2(-h.fx, -h.fz));
    const armor = match.world.armorOf(target.playerId);
    run(match, 30, () => armor.destroyed);
    const kill = eventsOf(match, 'kill').find(e => e.victim === target.playerId) ?? null;
    return {
      killed: armor.destroyed, kill, rounds: match.stats.get(b.playerId).vehicleRounds,
      fired: eventsOf(match, 'vehicle_fire').map(e => `${e.template}:${e.gun}`), t: round(match.clock),
    };
  },

  /** A fixed gun: a bot takes an AA gun (`bot-units.js` lists the level's
   *  `gun` roots; it has no drive) and fires at a frozen soldier 60 m down
   *  its rest line. The gun sits in a sandbag pit whose lip is above its
   *  muzzle, so a soldier on the flat is out of its reach: the rounds fly
   *  and land on the sandbags, which is the page's flight and impact. */
  async fixedGun() {
    const match = await start('el_alamein');
    const b = bot(match, 'bot_1');
    const target = match.bots.find(o => o.team !== b.team);
    const cand = mount(match, b, 'AA_Allies');
    freezeOthers(match, [b.playerId]);
    run(match, 1);
    const h = hullFrame(match, b);
    plant(match, target, h.x + h.fx * 60, h.z + h.fz * 60, Math.atan2(-h.fx, -h.fz));
    const armor = match.world.armorOf(target.playerId);
    const hp = armor.hitPoints;
    let bodyHits = 0;
    const landed = new Map();
    const onImpact = match.stage.guns.onImpact;
    match.stage.guns.onImpact = record => {
      const name = record?.target ?? match.stage.collider.statics.ownerNodes[record?.owner]?.name ?? 'terrain';
      landed.set(name, (landed.get(name) ?? 0) + 1);
      if (record?.target === target.playerId) bodyHits++;
      onImpact(record);
    };
    run(match, 20, () => armor.destroyed);
    const kill = eventsOf(match, 'kill').find(e => e.victim === target.playerId) ?? null;
    return {
      kind: cand.kind, seat: b.vehicle?.seatId ?? null, drive: !!b.vehicle?.drive,
      rounds: match.stats.get(b.playerId).vehicleRounds, landed: Object.fromEntries(landed), bodyHits,
      lost: round(hp - armor.hitPoints), killed: armor.destroyed, kill,
      fired: eventsOf(match, 'vehicle_fire').map(e => `${e.kind}:${e.template}:${e.gun}`),
    };
  },

  /** A landing craft: Wake's Daihatsus are split off their ships at load
   *  (`detachSpawnedCraft`); a bot at the helm drives the page's `Ship` on
   *  the level's landing-craft map (`bot-units.js waterNav`). The SAI sends
   *  no craft to a beach yet (Brief D), so the order is a point by hand, as
   *  in the live check: open water 150..300 m off the craft's bow. */
  async ship() {
    const match = await start('wake');
    const b = match.bots.find(o => o.team === 1);
    const cand = mount(match, b, 'Daihatsu');
    freezeOthers(match, [b.playerId]);
    const drive = b.vehicle.drive;
    const from = { ...drive.state.position };
    const nav = b.vehicle.nav;
    const h = hullFrame(match, b);
    let point = null;
    for (let d = 150; d <= 300 && !point; d += 10) {
      for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
        const fx = h.fx * Math.cos(turn) - h.fz * Math.sin(turn), fz = h.fx * Math.sin(turn) + h.fz * Math.cos(turn);
        const x = h.x + fx * d, z = h.z + fz * d;
        if (M.isWalkable(nav, x, z)) { point = [x, z]; break; }
      }
    }
    if (!point) throw new Error('no open water off the bow');
    const sai = match.referee.strategy;
    const waypointsOf = sai.waypointsOf.bind(sai);
    sai.waypointsOf = id => {
      const wp = waypointsOf(id);
      return id === b.playerId && wp ? { ...wp, point, radius: 15 } : wp;
    };
    let low = Infinity, high = -Infinity;
    run(match, 60, () => {
      const y = drive.state.position.y;
      low = Math.min(low, y); high = Math.max(high, y);
      return false;
    });
    const s = drive.state.position;
    return {
      template: cand.template, driveClass: drive.constructor.name, landingCraft: !!b.vehicle?.landingCraft,
      navWater: !!nav?.waterMap || nav === match.stage.botUnits.navWater.get('LandingCraft'),
      waterLevel: match.stage.collider.waterLevel, y: [round(low), round(high)],
      moved: round(Math.hypot(s.x - from.x, s.z - from.z)), stillMounted: !!b.vehicle,
      toGo: round(Math.hypot(s.x - point[0], s.z - point[1])),
      routeFailures: match.stats.get(b.playerId).routeFailures,
    };
  },

  /** A bot takes a Spitfire against a frozen soldier 260 m down its nose:
   *  the airframe is the page's `Aircraft`, it leaves the ground, and its
   *  guns' rounds are cast against the soldier's body. */
  async air() {
    const match = await start('el_alamein');
    const b = bot(match, 'bot_1');
    const target = match.bots.find(o => o.team !== b.team);
    const cand = mount(match, b, 'Spitfire');
    freezeOthers(match, [b.playerId]);
    const h = hullFrame(match, b);
    plant(match, target, h.x + h.fx * 260, h.z + h.fz * 260, Math.atan2(-h.fx, -h.fz));
    const armor = match.world.armorOf(target.playerId);
    let bodyHits = 0;
    const onImpact = match.stage.guns.onImpact;
    match.stage.guns.onImpact = record => { if (record?.target === target.playerId) bodyHits++; onImpact(record); };
    let top = -Infinity;
    const ground = () => {
      const s = b.vehicle?.drive?.state?.position;
      if (s) top = Math.max(top, s.y - match.groundAt(s.x, s.z));
      return false;
    };
    run(match, 60, ground);
    const kill = eventsOf(match, 'kill').find(e => e.victim === target.playerId) ?? null;
    return {
      driveClass: b.vehicle?.drive?.constructor.name ?? null, template: cand.template, topAgl: round(top),
      takeoff: eventsOf(match, 'takeoff').map(e => e.t), killed: armor.destroyed, kill, bodyHits,
      rounds: match.stats.get(b.playerId).vehicleRounds, stillMounted: !!b.vehicle,
    };
  },
};

const fn = recipes[recipe];
if (!fn) throw new Error(`unknown recipe ${recipe} (${Object.keys(recipes).join(', ')})`);
process.stdout.write(JSON.stringify(await fn()) + '\n');
