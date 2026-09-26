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
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIM = path.join(HERE, '..', 'sim');
const { viewerDir, loadViewerModules, seedMathRandom, routeConsole } = await import(path.join(SIM, 'env.mjs'));
const { realLevel } = await import(path.join(SIM, 'level.mjs'));
const { Match } = await import(path.join(SIM, 'match.mjs'));

const [assets, recipe] = process.argv.slice(2);
const SEED = 7;
/** The loader the stage hands the wreck path. A run that only wants the fall
 *  leaves it null (`stage.mjs` then never resolves a load). */
let wreckLoader = null;
const M = await loadViewerModules(viewerDir(path.join(HERE, '..', 'viewer')));
routeConsole(true);

async function start(map, botsPerSide = 4, seed = SEED) {
  seedMathRandom(seed);
  const level = await realLevel(M, { maps: path.join(assets, 'maps'), models: path.join(assets, 'models'), map });
  seedMathRandom(seed);
  const match = new Match({ M, level, botsPerSide, duration: 3600, seed, sink: null, wreckLoader });
  match.setup();
  return match;
}

const bot = (match, id) => match.bots.find(b => b.playerId === id);

/** The wreck glb the page would fetch, read off disk and parsed through the
 *  viewer's own `GLTFLoader` the way the level's scene is (`sim/level.mjs`).
 *  `placeWreck` awaits `loadAsync` and takes `.scene` off it, so this does what
 *  the page's loader does when the file is there and the network is not.
 *
 *  Textures are stripped before the parse: three's loader decodes images
 *  through `self`, which node does not have, and a model glb carries them
 *  (the scene glb does not — which is why `sim/level.mjs` can parse one).
 *  What this run has to answer is whether the graph arrives and what it is
 *  parented to, not what it looks like. */
async function realWreckLoader() {
  const GLTFLoader = await M.loadGltfLoader();
  const dir = path.join(assets, 'models');
  return {
    async loadAsync(url) {
      const name = path.basename(String(url).split('?')[0]);
      const buf = await fs.readFile(path.join(dir, name));
      const data = stripTextures(buf).buffer.slice(0);
      return await new Promise((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject));
    },
  };
}

/** The same glb with every material reference and image/texture table gone,
 *  the JSON chunk re-padded to its original length (trailing spaces are legal
 *  padding, and the new JSON is always shorter). */
function stripTextures(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      delete prim.material;
      for (const key of ['extensions', 'extras']) if (key in prim) delete prim[key];
    }
  }
  json.images = [];
  json.textures = [];
  json.samplers = [];
  delete json.materials;
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  if (text.length > jsonLen) throw new Error(`stripped JSON grew: ${text.length} > ${jsonLen}`);
  if (text.length < jsonLen) text = Buffer.concat([text, Buffer.alloc(jsonLen - text.length, 0x20)]);
  const out = Buffer.concat([buf.subarray(0, 20), text, buf.subarray(20 + jsonLen)]);
  return out;
}

/** Whether a hull's pad is a free cell of the vehicle map. The viewer's map
 *  paints the pad of El Alamein's nearest Allied Sherman (1685, -736) inside
 *  a 30 x 25 m blocked patch (nav-map.js fills an object's clip band per
 *  cell, an INVENTION; the engine draws outlines), so a bot seated there has
 *  never stood on a valid cell, `actionStatusDecision` has no box of its own,
 *  and its route out ends pressed on a static 1.8 m off the bow that the
 *  map does not show (ledger AI-85). */
function padFree(match, cand) {
  const nav = match.stage.units.vehicleNav();
  if (!nav) return true;
  const gx = Math.floor(cand.pos[0] / nav.cellSize), gz = Math.floor(-cand.pos[2] / nav.cellSize);
  return nav.blocked[gz * nav.width + gx] === 0;
}

/** `__botMount`: the nearest free seat of `template` (`driver`: its root);
 *  `freePad` skips a hull whose pad the vehicle map paints blocked. */
function mount(match, b, template, seat = 'driver', { freePad = false } = {}) {
  const p = b.getPosition();
  const cands = match.stage.units.candidates().filter(c => !c.occupiedBy && c.template === template
    && (seat === 'driver' ? c.isRoot : c.seatId === seat) && (!freePad || padFree(match, c)));
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
    const cand = mount(match, b, 'Sherman', 'driver', { freePad: true });
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

  /** Parked hulls are obstacles: a Sherman on its pad is in the static
   *  index (a round's ray stops on it) and is a parked body; driven away, it
   *  answers where it stands (`setMovedOwner`) and not on its pad. */
  async obstacle() {
    const match = await start('el_alamein');
    const b = bot(match, 'bot_1');
    const cand = match.stage.units.candidates().filter(c => c.template === 'Sherman' && c.isRoot && padFree(match, c))
      .sort((x, y) => Math.hypot(x.pos[0] - b.position[0], x.pos[2] - b.position[2])
        - Math.hypot(y.pos[0] - b.position[0], y.pos[2] - b.position[2]))[0];
    const owner = match.stage.ownerOf(cand.node);
    const collider = match.stage.collider;
    // A ray straight down onto the hull's origin from 20 m up.
    const rayAt = (x, y, z) => {
      const hit = collider.cast(x, y + 20, z, 0, -1, 0, 40, -1);
      return hit ? { owner: hit.owner, t: round(hit.t) } : null;
    };
    const pad = [...cand.pos];
    const before = rayAt(...pad);
    const parked = !!match.world.bodyWorld.get(owner)?.parked;
    const bodyOwner = !!collider.statics._body?.[owner];
    if (!match.referee.enterVehicle(b, cand)) throw new Error('could not seat the driver');
    run(match, 40);
    const s = b.vehicle.drive.state.position;
    const moved = Math.hypot(s.x - pad[0], s.z - pad[2]);
    return {
      owner, parked, bodyOwner, before, moved: round(moved),
      atPad: rayAt(...pad), atHull: rayAt(s.x, s.y, s.z),
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
   *  `gun` roots; it has no drive) and fires at a frozen soldier down its
   *  rest line. The gun sits in a sandbag pit whose lip is above its
   *  muzzle. A Fixed unit's Fire is `BBFireInfantery` (Brief R, ledger
   *  AI-124): it scores only what its side has spotted, and in range only
   *  with a clear line from its camera, so the soldier stands at the first
   *  spot 40 m or more out (and within 30 m of the rest line) that the
   *  seat's camera sees at 0.3 m (the lowest of the page's soldier sense
   *  heights): the lip hides the flat, a rise 100 m out does not (`hidden`
   *  plants him 60 m out behind the lip instead: no spot, no round). The
   *  rounds fly and land, which is the page's flight and impact. */
  async fixedGun(hidden = false) {
    const match = await start('el_alamein');
    const b = bot(match, 'bot_1');
    const target = match.bots.find(o => o.team !== b.team);
    const cand = mount(match, b, 'AA_Allies');
    freezeOthers(match, [b.playerId]);
    run(match, 1);
    const h = hullFrame(match, b);
    const seat = b.vehicle.occupancy;
    const cam = seat.seatInfo(seat.seatId)?.camera;
    cam.updateWorldMatrix(true, false);
    const eye = [cam.matrixWorld.elements[12], cam.matrixWorld.elements[13], cam.matrixWorld.elements[14]];
    const collider = match.stage.collider;
    const sees = (x, z, up = 0.3) => {
      const to = [x, match.groundAt(x, z) + up, z];
      const d = [to[0] - eye[0], to[1] - eye[1], to[2] - eye[2]];
      const len = Math.hypot(...d);
      return !collider.cast(eye[0], eye[1], eye[2], d[0] / len, d[1] / len, d[2] / len, len - 0.05, b._selfOwner());
    };
    let spot = null;
    for (let r = 40; !hidden && r <= 200 && !spot; r += 5) {
      for (const s of [0, 10, -10, 20, -20, 30, -30]) {
        const x = h.x + h.fx * r - h.fz * s, z = h.z + h.fz * r + h.fx * s;
        if (sees(x, z)) { spot = [x, z]; break; }
      }
    }
    spot ??= [h.x + h.fx * 60, h.z + h.fz * 60];
    plant(match, target, spot[0], spot[1], Math.atan2(-h.fx, -h.fz));
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
    // The gun first finds him by its Scout sweep (about 20 s here).
    run(match, 45, () => armor.destroyed);
    const kill = eventsOf(match, 'kill').find(e => e.victim === target.playerId) ?? null;
    return {
      kind: cand.kind, seat: b.vehicle?.seatId ?? null, drive: !!b.vehicle?.drive,
      rounds: match.stats.get(b.playerId).vehicleRounds, landed: Object.fromEntries(landed), bodyHits,
      lost: round(hp - armor.hitPoints), killed: armor.destroyed, kill,
      fired: eventsOf(match, 'vehicle_fire').map(e => `${e.kind}:${e.template}:${e.gun}`),
      spot: round(Math.hypot(spot[0] - h.x, spot[1] - h.z)), spotted: !!b.senses.memory.get(target.playerId),
    };
  },

  async fixedGunHidden() { return recipes.fixedGun(true); },

  /** Brief K item 1: a bot takes a fixed gun by itself. An Allied bot stands
   *  30 m from the free AA gun by the airfield (the only unit within the
   *  Change radius); an Axis bot's Bf 109 is held 40 m up, 80 m out,
   *  crossing at 50 m/s, where the Allied bot sees it (`spottedAt`). Nothing seats him:
   *  his own Change weighs the gun (`basicTemp` 9 plus its fire strength)
   *  against staying on foot. Before the fix the gun scored its strategic
   *  strength 0 and its door, inside its own footprint, failed the map
   *  test, so no bot ever took one. */
  async takeAA() {
    const match = await start('el_alamein');
    const gunner = match.bots.find(o => o.team === 2);
    const pilot = match.bots.find(o => o.team === 1);
    const gun = match.stage.units.candidates().find(c => c.template === 'AA_Allies' && c.isRoot && !c.occupiedBy
      && Math.hypot(c.pos[0] - 1575, c.pos[2] + 679) < 5);
    if (!gun) throw new Error('no AA_Allies_1');
    const plane = mount(match, pilot, 'bf109');
    freezeOthers(match, [gunner.playerId]);
    pilot.tick = () => {};
    const drive = pilot.vehicle.drive;
    const [gx, gy, gz] = gun.pos;
    const hold = () => {
      const t = match.clock;
      const s = drive.state;
      s.position.set(gx - 100 + ((t * 50) % 200), gy + 40, gz - 80);
      s.velocity.set(50, 0, 0);
    };
    hold();
    // The gunner 30 m from the gun, facing the plane's pass.
    const ax = gx - 30, az = gz;
    const ay = match.groundAt(ax, az);
    match.world.player(gunner.playerId).soldier.spawn(ax, ay, az, Math.atan2(30, -80));
    gunner.setPosition(ax, ay, az);
    gunner.route = null;
    gunner.onRespawn();
    let best = null, took = null, spottedAt = null;
    run(match, 30, () => {
      hold();
      const r = gunner._changeResult;
      if (r?.best?.cand && !best) best = { template: r.best.cand.template, t: round(match.clock), u: round(r.urgency ?? 0) };
      if (gunner.vehicle && !took) took = { template: gunner.vehicle.template, seat: gunner.vehicle.seatId, t: round(match.clock) };
      if (spottedAt === null && gunner.senses.spottedEnemies().some(m => m.id === pilot.playerId)) spottedAt = round(match.clock);
      return !!took;
    });
    return { gunDist: round(Math.hypot(ax - gx, az - gz)), plane: plane.template, best, took, spottedAt,
             value: gun.value, noPathfinding: gun.noPathfinding };
  },

  /** Brief K item 2: two Allied Spitfires head-on. Both bots' planes are put
   *  in the air 600 m apart at 150 m, each flying at 55 m/s toward the other
   *  and ordered to the other's start; every other bot is frozen. The pilots
   *  see each other's hull as their own side's and `BBAvoid` predicts the
   *  collision 5 s out; `avoid` counts their ticks in Avoid, `closest` is the
   *  least distance between the hulls. `headOnNoAvoid` is the control, the
   *  Avoid behaviour switched off. */
  async headOn(noAvoid = false) {
    const match = await start('el_alamein');
    const allies = match.bots.filter(o => o.team === 2);
    const [a, b] = allies;
    mount(match, a, 'Spitfire');
    mount(match, b, 'Spitfire');
    freezeOthers(match, [a.playerId, b.playerId]);
    const cx = 1000, cz = -1000;
    const gy = match.groundAt(cx, cz) + 150;
    const place = (bot, x, z, dirX) => {
      const s = bot.vehicle.drive.state;
      s.position.set(x, gy, z);
      s.velocity.set(55 * dirX, 0, 0);
      // The nose (-z in the model) along +x or -x: a yaw of -90 or +90 deg.
      s.orientation.setFromAxisAngle({ x: 0, y: 1, z: 0 }, dirX > 0 ? -Math.PI / 2 : Math.PI / 2);
      s.angularVelocity?.set?.(0, 0, 0);
      bot._airborne = true;
    };
    place(a, cx - 300, cz, 1);
    place(b, cx + 300, cz, -1);
    const sai = match.referee.strategy;
    const waypointsOf = sai.waypointsOf.bind(sai);
    const goal = { [a.playerId]: [cx + 600, cz], [b.playerId]: [cx - 600, cz] };
    sai.waypointsOf = id => {
      const wp = waypointsOf(id);
      return goal[id] && wp ? { ...wp, point: goal[id], radius: 40 } : wp;
    };
    // They fly their orders: nothing to shoot at, no seat to change to.
    for (const bot of [a, b]) { bot._urgencyFire = () => 0; bot._urgencyChange = () => 0; bot._urgencyScout = () => 0; }
    if (noAvoid) for (const bot of [a, b]) bot._urgencyAvoid = () => 0;
    let closest = Infinity, avoid = 0;
    run(match, 15, () => {
      const pa = a.vehicle?.drive?.state?.position, pb = b.vehicle?.drive?.state?.position;
      if (pa && pb) closest = Math.min(closest, Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z));
      for (const bot of [a, b]) if (bot.currentBehaviour === 'Avoid') avoid++;
      return !a.vehicle || !b.vehicle;
    });
    return { closest: round(closest), avoid, destroyed: eventsOf(match, 'vehicle_destroyed').map(e => e.vehicle),
             mounted: [!!a.vehicle, !!b.vehicle] };
  },

  async headOnNoAvoid() { return recipes.headOn(true); },

  /** Brief K item 3: a Sherman and a PanzerIV ordered onto North outpost
   *  (874, -1816, radius 50) from their bases, every other bot frozen.
   *  While both are within 250 m of the flag each second samples each
   *  driver's behaviour, its Fire and MoveTo urgencies, whether it holds the
   *  other as its target, and the line between them from the eye
   *  (`_eye()`, the sensing ray) and from the gun (`_aimOrigin()`): blocked
   *  by the terrain or a static. Reports the captures, the rounds each side
   *  fired and who died. */
  async tankDuel() {
    const match = await start('el_alamein');
    const axis = match.bots.find(o => o.team === 1);
    const allied = match.bots.find(o => o.team === 2);
    mount(match, axis, 'PanzerIV');
    mount(match, allied, 'Sherman', 'driver', { freePad: true });
    freezeOthers(match, [axis.playerId, allied.playerId]);
    const flag = [874.005, 51.59, -1815.98];
    const sai = match.referee.strategy;
    const waypointsOf = sai.waypointsOf.bind(sai);
    sai.waypointsOf = id => {
      const wp = waypointsOf(id);
      return (id === axis.playerId || id === allied.playerId) && wp ? { ...wp, point: [flag[0], flag[2]], radius: 20 } : wp;
    };
    const collider = match.stage.collider;
    const blocked = (from, to, self = -1) => {
      const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const len = Math.hypot(...d);
      const hit = collider.cast(from[0], from[1], from[2], d[0] / len, d[1] / len, d[2] / len, len - 3, self);
      return hit ? (collider.statics.ownerNodes?.[hit.owner]?.name ?? (hit.owner < 0 ? 'terrain' : `owner ${hit.owner}`)) : null;
    };
    const samples = [];
    let next = 0;
    const near = b => b.vehicle && Math.hypot(b.position[0] - flag[0], b.position[2] - flag[2]) < 250;
    run(match, 240, () => {
      if (match.clock >= next && near(axis) && near(allied)) {
        next = match.clock + 1;
        const row = { t: round(match.clock), d: round(Math.hypot(axis.position[0] - allied.position[0], axis.position[2] - allied.position[2])) };
        for (const [name, b, o] of [['axis', axis, allied], ['allied', allied, axis]]) {
          const target = [o.position[0], o.position[1] + 1.5, o.position[2]];
          row[name] = { beh: b.currentBehaviour, fire: round(b.urgency.Fire), moveTo: round(b.urgency.MoveTo), target: b.firingTarget,
                        eyeBlocked: blocked(b._eye(), target, b._selfOwner()), gunBlocked: blocked(b._aimOrigin(), target, b._selfOwner()),
                        seen: b.senses.memory.get(o.playerId)?.seen ?? null };
        }
        samples.push(row);
      }
      return !axis.vehicle || !allied.vehicle;
    });
    const stats = id => match.stats.get(id);
    return {
      samples: samples.length, first: samples[0] ?? null, last: samples[samples.length - 1] ?? null,
      captures: eventsOf(match, 'capture').map(e => `${round(e.t)} ${e.flag} ${e.from}->${e.to} ${e.by}`),
      rounds: { axis: stats(axis.playerId).vehicleRounds, allied: stats(allied.playerId).vehicleRounds },
      destroyed: eventsOf(match, 'vehicle_destroyed').map(e => `${round(e.t)} ${e.vehicle} by ${e.killer}`),
      share: (() => {
        const out = { axis: {}, allied: {} };
        for (const r of samples) for (const k of ['axis', 'allied']) out[k][r[k].beh] = (out[k][r[k].beh] ?? 0) + 1;
        return out;
      })(),
      blockedShare: (() => {
        const out = { axisEye: 0, axisGun: 0, alliedEye: 0, alliedGun: 0, axisSeen: 0, alliedSeen: 0, axisTarget: 0, alliedTarget: 0 };
        for (const r of samples) {
          if (r.axis.eyeBlocked) out.axisEye++; if (r.axis.gunBlocked) out.axisGun++;
          if (r.allied.eyeBlocked) out.alliedEye++; if (r.allied.gunBlocked) out.alliedGun++;
          if (r.axis.seen) out.axisSeen++; if (r.allied.seen) out.alliedSeen++;
          if (r.axis.target === allied.playerId) out.axisTarget++; if (r.allied.target === axis.playerId) out.alliedTarget++;
        }
        return out;
      })(),
      end: { axis: axis.position.map(round), allied: allied.position.map(round), alliedRouteFailures: stats(allied.playerId).routeFailures, alliedBeh: allied.currentBehaviour, alliedMounted: !!allied.vehicle },
    };
  },

  /** Brief P item 3: K's North outpost pair (`tankDuel`, 2026-09-24 at
   *  363d6dc1: both in Fire 158.7 m apart for 68 of 75 samples, the line
   *  blocked by `Stones_Africa_L_M1_4` one way and the terrain the other, 0
   *  rounds) set down where K's run left them, facing each other, every
   *  other bot frozen and both ordered onto the flag. Each second: the gap,
   *  each driver's behaviour and approach move; then the rounds each side
   *  fired and who died. `noApproach` holds both in the old plan (the
   *  approach's S forced true) as the control. */
  async tankApproach(noApproach = false) {
    const match = await start('el_alamein');
    const axis = match.bots.find(o => o.team === 1);
    const allied = match.bots.find(o => o.team === 2);
    mount(match, axis, 'PanzerIV');
    mount(match, allied, 'Sherman', 'driver', { freePad: true });
    freezeOthers(match, [axis.playerId, allied.playerId]);
    const flag = [874.005, 51.59, -1815.98];
    const sai = match.referee.strategy;
    const waypointsOf = sai.waypointsOf.bind(sai);
    sai.waypointsOf = id => {
      const wp = waypointsOf(id);
      return (id === axis.playerId || id === allied.playerId) && wp ? { ...wp, point: [flag[0], flag[2]], radius: 20 } : wp;
    };
    const at = { [axis.playerId]: [869.492, -1806.509], [allied.playerId]: [987.678, -1700.602] };
    const place = (b, other) => {
      const [x, z] = at[b.playerId], [ox, oz] = at[other.playerId];
      const s = b.vehicle.drive.state;
      s.position.set(x, match.groundAt(x, z) + 1.0, z);
      s.velocity?.set?.(0, 0, 0);
      s.angularVelocity?.set?.(0, 0, 0);
      // The nose (-z in the model) toward the other hull.
      s.orientation.setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.atan2(-(ox - x), -(oz - z)));
      b.setPosition(x, match.groundAt(x, z) + 1.0, z);
      b.route = null;
    };
    place(axis, allied);
    place(allied, axis);
    if (noApproach) for (const b of [axis, allied]) b._noApproach = true;
    const gap = () => Math.hypot(axis.position[0] - allied.position[0], axis.position[2] - allied.position[2]);
    const start0 = gap();
    let closest = start0, firstRound = null;
    const moves = { axis: {}, allied: {} };
    const behs = { axis: {}, allied: {} };
    const trace = [];
    let next = 0;
    const roundsOf = id => match.stats.get(id).vehicleRounds;
    run(match, 120, () => {
      closest = Math.min(closest, gap());
      if (firstRound === null && (roundsOf(axis.playerId) || roundsOf(allied.playerId))) firstRound = round(match.clock);
      if (match.clock >= next) {
        next = match.clock + 1;
        if (Math.round(match.clock) % 5 === 0) {
          trace.push([round(match.clock), round(gap()), axis._fireApproachDbg?.move ?? axis.currentBehaviour,
                      allied._fireApproachDbg?.move ?? allied.currentBehaviour,
                      !!axis._fireApproachDbg?.seen, !!allied._fireApproachDbg?.seen,
                      ...[axis, allied].map(b => { const a = match.world.occupiedDamageable?.(b.playerId); return a ? round(a.hitPoints) : null; })]);
        }
        for (const [k, b] of [['axis', axis], ['allied', allied]]) {
          const m = b._fireApproachDbg?.move ?? '-';
          moves[k][m] = (moves[k][m] ?? 0) + 1;
          behs[k][b.currentBehaviour] = (behs[k][b.currentBehaviour] ?? 0) + 1;
          b._fireApproachDbg = null;
        }
      }
      return !axis.vehicle || !allied.vehicle;
    });
    return {
      start: round(start0), closest: round(closest), end: round(gap()), firstRound,
      rounds: { axis: roundsOf(axis.playerId), allied: roundsOf(allied.playerId) },
      destroyed: eventsOf(match, 'vehicle_destroyed').map(e => `${round(e.t)} ${e.vehicle} by ${e.killer}`),
      moves, behs, clock: round(match.clock), trace,
      mounted: [!!axis.vehicle, !!allied.vehicle],
      hp: [axis, allied].map(b => { const a = match.world.occupiedDamageable?.(b.playerId); return a ? round(a.hitPoints) : null; }),
      left: eventsOf(match, 'dismount').map(e => `${round(e.t)} ${e.bot ?? e.id} ${e.reason ?? ''}`),
    };
  },

  async tankApproachControl() { return recipes.tankApproach(true); },

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

  /** A landing craft to a beach under the SAI's own order: an Axis bot at a
   *  Daihatsu's helm and one in its passenger seat, every other bot frozen;
   *  the helm gets the SAI's beach order to WesternMainBaseExit
   *  (`CentreLanding`) once. The crew bails only aground in the zone
   *  (`BBChangeLandingCraft` 0x085602b0), the ramp's `PIPitch` is held on the
   *  beach leg, and the beached craft, off its water map, is offered to
   *  nobody afterwards (`BBChange` 0x0855ee25 -> 0x0855f0f0): no bot climbs
   *  back in over the next 30 s. */
  async beach() {
    const { pathToFileURL } = await import('node:url');
    const strat = await import(pathToFileURL(path.join(viewerDir(path.join(HERE, '..', 'viewer')), 'strategic.js')).href);
    let order = null;
    strat.registerDoctrine('beachpin', ({ side, sai }) => ({
      name: 'beachpin',
      orders(view) {
        const out = new Map();
        const drv = view.bots.find(x => x.seat?.drives);
        if (side !== 1 || order || !drv) return out;
        sai._alive = view.alive;
        order = sai._order(sai.bots.get(drv.id), sai.layer.areas.find(a => a.name === 'WesternMainBaseExit'), side);
        out.set(drv.id, order);
        return out;
      },
    }));
    seedMathRandom(SEED);
    const level = await realLevel(M, { maps: path.join(assets, 'maps'), models: path.join(assets, 'models'), map: 'wake' });
    seedMathRandom(SEED);
    const match = new Match({ M, level, botsPerSide: 4, duration: 3600, seed: SEED, sink: null, doctrine: 'axis=beachpin' });
    match.setup();
    const [helm, rider] = match.bots.filter(o => o.team === 1);
    const cand = mount(match, helm, 'Daihatsu');
    const seat = match.stage.units.candidates().find(c => c.vehicleId === cand.vehicleId && !c.isRoot && !c.occupiedBy);
    if (!match.referee.enterVehicle(rider, seat)) throw new Error('could not seat the rider');
    freezeOthers(match, [helm.playerId, rider.playerId]);
    const units = match.stage.units;
    const root = () => { units.invalidate(); return units.candidates().find(c => c.vehicleId === cand.vehicleId && c.isRoot); };
    let pitchHeld = 0, pitchSeen = 0, bail = null, beachLegAt = null;
    run(match, 200, () => {
      if (helm.waypoints?.insideZone && beachLegAt === null) beachLegAt = match.clock;
      pitchHeld = Math.max(pitchHeld, helm._heldPitch ?? 0);
      const pending = match.world.players.get(helm.playerId)?.pending?.input;
      if (helm.vehicle && pending) pitchSeen = Math.max(pitchSeen, pending.pitch ?? 0);
      if (!helm.vehicle && !rider.vehicle) {
        const r = root();
        bail = { t: round(match.clock), touchingLand: r?.touchingLand ?? null, onOwnMap: r?.onOwnMap ?? null,
                 pos: helm.position.map(round) };
        return true;
      }
      return false;
    });
    const zone = level.extras?.ai?.landingZones?.find(z => z.name === 'CentreLanding');
    const inZone = (p) => zone && p[0] >= zone.min[0] && p[0] <= zone.max[0] && p[2] >= zone.min[1] && p[2] <= zone.max[1];
    const mountsBefore = eventsOf(match, 'mount').length;
    run(match, 30);
    const remounts = eventsOf(match, 'mount').slice(mountsBefore).filter(e => e.vehicle === cand.template || e.vehicle?.startsWith?.('Daihatsu'));
    const after = root();
    return {
      order: order ? { kind: order.kind, zone: order.zone?.name } : null,
      beachLegAt: beachLegAt === null ? null : round(beachLegAt), pitchHeld, pitchSeen,
      bail: bail ? { ...bail, inZone: inZone(bail.pos) } : null,
      remounts: remounts.map(e => `${e.bot}:${e.seat}`),
      after: after ? { onOwnMap: after.onOwnMap, touchingLand: after.touchingLand, occupied: !!after.occupiedBy } : null,
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

/** A plane with an AI pilot — which is what an enemy plane is — killed in the
 *  air. The crew dies with the hull, so nothing is left on the stick: the wreck
 *  has to fly itself down on the zeroed control word (`world.falling`, one
 *  integration a tick, HP-15) and the crash at the bottom is what places the
 *  wreck, under the hull's own template name — the model the viewer will fetch
 *  as `models/<Template>.wreck.glb`. The list of air templates the level places
 *  comes back with it, so the test can check that file exists for every one. */
recipes.downedAir = async function downedAir() {
  return downedAirOn('el_alamein', 'Spitfire');
};

/** The same run on the planes the reports come from: a BF109 over Bocage. The
 *  owner's own report is that a 109 killed in the air keeps its intact model
 *  while his Mustang does not, which is a template the Spitfire run does not
 *  exercise. */
recipes.downedAir109 = async function downedAir109() {
  return downedAirOn('bocage', 'bf109');
};

async function downedAirOn(map, template) {
  wreckLoader = await realWreckLoader();
  const match = await start(map);
  const b = bot(match, 'bot_1');
  const attacker = match.bots.find(o => o.team !== b.team) ?? b;
  const cand = mount(match, b, template);
  freezeOthers(match, [b.playerId]);
  const node = cand.node;
  const wrecked = [];
  match.stage.hooks.onWreck = (owner, n, killer) => wrecked.push({
    owner, template: n.userData?.control ?? n.name, killer, t: round(match.clock),
  });
  // The drive the hull was last flown by, which is where its position is read
  // from once the crew has left it (the instance is gone with them).
  const drive = () => match.stage.vehicles.lastFlightOf(node)?.drive ?? b.vehicle?.drive ?? null;
  const at = () => drive()?.state?.position ?? null;

  // Put it in LEVEL flight at 200 m before the kill. A dead airframe's descent
  // is decided by the energy it had, so the run has to set one: taken from the
  // AI's own climb it stalls and drops quickly, and the case that was reported
  // -- a 109 at cruise, killed, gliding for three quarters of a minute -- never
  // happens. `__plane().place` sets exactly this on the live page.
  const cruise = drive();
  if (cruise?.state?.position?.set && cruise.state.velocity?.set) {
    const ground = match.groundAt(cruise.state.position.x, cruise.state.position.z);
    cruise.state.position.set(cruise.state.position.x, ground + 200, cruise.state.position.z);
    cruise.state.velocity.set(60, 0, 0);
  }
  match.step();
  let topAgl = -Infinity;
  run(match, 6, () => {
    const p = at();
    if (!p) return false;
    topAgl = Math.max(topAgl, p.y - match.groundAt(p.x, p.z));
    return false;
  });
  const death = at() ? { x: at().x, y: at().y, z: at().z } : null;
  match.stage.damageHull(b, 1e6, { attackerId: attacker.playerId });
  match.step();
  const flying = !!drive() && match.world.falling.has(drive());
  const frozen = Object.hasOwn(node, 'updateMatrixWorld');

  // Until the fall ends: the wreck list hands the drive back on the crash.
  let minY = Infinity, crashAfter = null, crashY = null, crashX = null, crashZ = null;
  const span = match.clock;
  run(match, 300, () => {
    const d = drive();
    const p = at();
    if (p) minY = Math.min(minY, p.y);
    if (!d || !match.world.falling.has(d)) {
      crashAfter = round(match.clock - span);
      if (p) { crashY = round(p.y); crashX = p.x; crashZ = p.z; }
      return true;
    }
    return false;
  });

  // The wreck model itself. `placeWreck` awaits the loader, so the swap lands a
  // macrotask after the crash; step a few frames, then ask the hull node what it
  // is carrying: the wreck under `wreck:<Template>` and the intact mesh hidden.
  await new Promise(r => setTimeout(r, 60));
  for (let i = 0; i < 3; i++) match.step();
  const childNames = node.children.map(c => c.name);
  const wreckNode = node.children.find(c => c.name?.startsWith('wreck:'))?.name ?? null;
  const shownChildren = node.children.filter(c => c.visible).map(c => c.name);
  // Diagnostic: what the loader hands back for this template, and whether
  // `placeWreck`'s guards are satisfied for this hull's owner.
  let loadError = null;
  let loadedScene = false;
  // The URL `placeWreck` builds: the hull's own template (its scene node's
  // control), not the AI table's spelling the seat search was given.
  const wreckTemplate = node.userData?.control ?? node.name.replace(/_\d+$/, '');
  try {
    const g = await wreckLoader.loadAsync(`models/${wreckTemplate}.wreck.glb`);
    loadedScene = !!g?.scene;
  } catch (e) {
    loadError = String(e?.message ?? e).slice(0, 300);
  }
  const visual = match.stage.wrecks.damageVisuals.get(b.playerId);
  const rec = match.stage.world.vehicleDamage?.get?.(b.playerId) ?? null;
  const guardVisual = match.stage.wrecks.damageVisuals.get(rec?.owner) === visual;

  return {
    template: cand.template, topAgl: round(topAgl), stillMounted: !!b.vehicle, flying, frozen,
    deathY: death ? round(death.y) : null,
    deathAgl: death ? round(death.y - match.groundAt(death.x, death.z)) : null,
    fellBy: death && Number.isFinite(minY) ? round(death.y - minY) : null,
    crashAfter, crashY,
    crashAgl: crashY === null ? null : round(crashY - match.groundAt(crashX, crashZ)),
    drift: death && crashX !== null
      ? round(Math.hypot(crashX - death.x, crashZ - death.z))
      : null,
    wrecked,
    wreckNode, shownChildren, childCount: childNames.length,
    loadedScene, loadError, hasDamageRecord: !!rec, guardVisual,
    // Every plane this level places, off the page's own candidate scan.
    airTemplates: [...new Set(match.stage.units.candidates().filter(c => c.isRoot && c.kind === 'air').map(c => c.template))],
    destroyed: eventsOf(match, 'vehicle_destroyed').map(e => `${round(e.t)} ${e.vehicle} by ${e.killer}`),
  };
};

/** Brief Q on Midway, seed 1: a bot takes each carrier's first deck plane
 *  (the Corsair on the Enterprise, the Zero on the Shokaku) and takes off; the
 *  carriers do not move. Then a frozen bot drives the Enterprise at full
 *  throttle and the parked SBD the spawner still holds rides her deck. */
recipes.deckAir = async function deckAir() {
  const match = await start('midway', 8, 1);
  const hb = match.stage.hullBodies;
  const V = () => new M.THREE.Vector3();
  const held = hb.heldCraft.map(r => ({ plane: r.node.name, ship: r.host.name }));
  const side = name => match.stage.units.candidates().find(c => c.template === name && c.isRoot);
  const pilots = {};
  for (const template of ['Corsair', 'Zero']) {
    const team = side(template)?.team;
    const b = match.bots.find(o => !o.vehicle && (team == null || o.team === team)) ?? match.bots.find(o => !o.vehicle);
    mount(match, b, template);
    pilots[template] = b;
  }
  freezeOthers(match, Object.values(pilots).map(b => b.playerId));
  const recs = Object.fromEntries(Object.keys(pilots).map(t => [t, hb.heldCraft.find(r => r.node.name === t)]));
  const shipAt = Object.fromEntries(Object.values(recs).map(r => [r.host.name, r.host.getWorldPosition(V()).clone()]));
  const pad = Object.fromEntries(Object.entries(recs).map(([t, r]) => [t, r.node.getWorldPosition(V()).clone()]));
  const out = {};
  for (const t of Object.keys(recs)) out[t] = { ship: recs[t].host.name, releasedAt: null, leftDeckAt: null, top: -Infinity, padDriftHeld: 0 };
  run(match, 40, () => {
    for (const [t, r] of Object.entries(recs)) {
      const o = out[t];
      const p = r.node.getWorldPosition(V());
      if (!r.released) o.padDriftHeld = Math.max(o.padDriftHeld, p.distanceTo(pad[t]));
      else if (o.releasedAt === null) o.releasedAt = round(match.clock);
      o.top = Math.max(o.top, p.y - pad[t].y);
      const e = r.host.matrixWorld.elements;
      if (o.leftDeckAt === null && Math.hypot(p.x - e[12], p.z - e[14]) > 150) o.leftDeckAt = round(match.clock);
    }
    return false;
  });
  for (const [t, r] of Object.entries(recs)) {
    out[t].top = round(out[t].top);
    out[t].padDriftHeld = round(out[t].padDriftHeld);
    out[t].shipMoved = round(r.host.getWorldPosition(V()).distanceTo(shipAt[r.host.name]));
  }
  // The Enterprise under way with her SBD parked on the deck.
  const sbd = hb.heldCraft.find(r => r.node.name === 'SBD');
  const helm = match.bots.find(o => !o.vehicle && !Object.values(pilots).includes(o));
  mount(match, helm, 'Enterprise');
  helm.tick = () => {};
  const shipStart = sbd.host.getWorldPosition(V()).clone();
  let sbdOff = 0;
  run(match, 90, () => {
    match.world.setInput(helm.playerId, { forward: 1, forwardKeys: 1 });
    const m = sbd.host.matrixWorld.clone().multiply(sbd.local);
    const want = new M.THREE.Vector3().setFromMatrixPosition(m);
    sbdOff = Math.max(sbdOff, sbd.node.getWorldPosition(V()).distanceTo(want));
    return sbd.host.getWorldPosition(V()).distanceTo(shipStart) > 200;
  });
  const sp = sbd.node.getWorldPosition(V());
  const deck = hb.shipDeckAt(sp.x, sp.z, sp.y + 0.5, 6);
  return {
    held, planes: out,
    enterprise: { moved: round(sbd.host.getWorldPosition(V()).distanceTo(shipStart)), seconds: round(match.clock - 40),
                  sbdHeld: !sbd.released, sbdOffPad: round(sbdOff), sbdAboveDeck: deck ? round(sp.y - deck.y) : null },
  };
};

const fn = recipes[recipe];
if (!fn) throw new Error(`unknown recipe ${recipe} (${Object.keys(recipes).join(', ')})`);
process.stdout.write(JSON.stringify(await fn()) + '\n');
