// One headless match: the viewer's World, BotControllers, nav map and
// strategic AI, stepped at the engine's 30 Hz with no renderer, plus the
// page-side referee the bots need around them.
//
// The per-frame order is `map.html frame()`'s with the human taken out:
//
//   world.step(1/30)          the world consumes each bot's last input word
//   tickBots(1/30)            botClock += dt; the strategic pass (every
//                             `SAI.updateFrequency`); the enemy tables; the
//                             vehicle requests; per bot: the respawn timer,
//                             the order, `bot.tick`, the no-progress redeploy;
//                             then the bots' rounds (`botFireTick`)
//   botCaptureTick(1)         the per-bot capture law
//   tickets, trace, samples   the runner's own bookkeeping
//
// Referee functions mirrored from map.html (page names in brackets; each is
// a copy because map.html is a page, not a module):
//   [spawnBotsForLevel]  the nav map seeded from every flag's spawn points, the
//                        bots (`spawnBots`, teams alternating), the strategic
//                        AI on `extras.ai`, the cover list, Armor per bot
//   [tickBots]           the order of the per-frame bot work above
//   [botRespawnTick]     8 s down, then a random own flag, `spawnPlayer(advance)`
//   [botFireTick] / [resolveBotShot] / [botMagazineTick]
//                        rate of fire, magazine and reload, the deviation
//                        cone rolled `theta = spread * sqrt(u)`, the soldier
//                        capsule (r 0.6 m at +1.0 m), the terrain LOS march
//   [applyDamageToBot] / [botDamageLanded]
//                        HP, incoming fire (x10 as a hit), death, the order freed
//   [resolveBotHeal] / [applyHealToPlayer]   0.3 HP a MedPack round
//   [botCaptureTick]     a bot inside a flag's radius that its side does not
//                        hold takes it after `timeToGetControl` (8 s fallback),
//                        the timer per bot. As on the page, a dead bot's
//                        position still counts (the corpse stands on the flag
//                        until the respawn moves it).
//   [buildBotCovers]     collider owners whose name has a `coverValue`
//   [botOccupiedUnits] / [botUnitInfo]       the enemy tables' input, a target's info
// Runner-only (the page has no such thing, labelled SIM):
//   tickets: one per death (`Game.setTicketLosePerDeath`, the Conquest
//   default in features/bf1942-3d-models/tickets-hud.md), and `lossPerMin`
//   while the other side holds more than half the control points (same
//   document); the viewer's ticket counter does not move.

import { createHash } from 'node:crypto';
import { SimVehicles, SIM_GUN } from './vehicles.mjs';

const BOT_RESPAWN_DELAY = 8;
const BOT_FALLBACK_ROF = 8;
const BOT_BODY_RADIUS = 0.6;
const BOT_BODY_HEIGHT = 1.0;          // physics.js CHARACTER_HEIGHT
const BOT_FIRE_RANGE = 600;
const BOT_HEAL_PER_ROUND = 0.3;
const CAPTURE_FALLBACK_SECONDS = 8;
const DEG_TO_RAD = Math.PI / 180;
const BOT_SOLDIER_TABLE = { Infantry: 4.0, LightArmour: 2.0, HeavyArmour: 1.0, NavalArmour: 0.0, Submarine: 0.0, Air: 1.0 };
const BEHAVIOURS = ['Avoid', 'MoveTo', 'Idle', 'Fire', 'Special', 'Scout', 'TakeCover', 'Change'];

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : v);
const v2 = (a) => (a ? a.map(r2) : null);

export class Match {
  constructor({ M, level, botsPerSide = 4, botSkill = 0.75, duration = 120, seed = 1, traceEvery = 1,
                sampleEvery = 1, vehicles = true, sink = null }) {
    this.M = M;
    this.level = level;
    this.botsPerSide = botsPerSide;
    this.botSkill = botSkill;
    this.duration = duration;
    this.seed = seed;
    this.traceEvery = Math.max(1, Math.round(traceEvery));
    this.sampleEvery = sampleEvery;
    this.useVehicles = vehicles;
    this.sink = sink;
    this.hash = createHash('sha256');
    this.lines = 0;
    this.clock = 0;
    this.tickIndex = 0;
    this.events = [];
    this.pendingEvents = [];
    this.samples = [];
    this.nextSample = 0;
    this.stats = new Map();
    this.ended = null;
  }

  // --- output -----------------------------------------------------------------

  emit(obj) {
    const line = JSON.stringify(obj);
    this.hash.update(line + '\n');
    this.lines++;
    this.sink?.(line);
  }

  event(ev) {
    const e = { k: 'ev', t: r2(this.clock), ...ev };
    this.events.push(e);
    this.emit(e);
  }

  // --- setup (`spawnBotsForLevel`) ---------------------------------------------

  setup() {
    const { M, level } = this;
    const extras = level.extras;
    const world = new M.World({ collider: level.collider, extras });
    this.world = world;
    const worldSize = extras?.worldSize || 2048;
    const seeds = [];
    for (const flag of world.flags ?? []) for (const s of flag.spawns ?? []) if (s?.position) seeds.push([s.position[0], s.position[2]]);
    const navStarted = performance.now();
    this.nav = M.buildNavMap(world.collider, worldSize, { waterLevel: world.collider?.waterLevel, seeds });
    this.navMs = Math.round(performance.now() - navStarted);

    this.bots = M.spawnBots({
      world, count: 2 * this.botsPerSide, botSkill: this.botSkill, teams: [1, 2], flags: world.flags,
      kitFor: (team, i) => level.kits.kitFor(team, i),
      viewDistance: extras?.ai?.settings?.viewDistance ?? null,
    });
    this.strategy = extras?.ai?.strategicAreas?.length
      ? new M.StrategicAI(new M.StrategicLayer(extras.ai, world.flags), { isWalkable: (x, z) => M.isWalkable(this.nav, x, z) })
      : null;
    this.covers = this.buildCovers();
    this.vehicles = this.useVehicles
      ? new SimVehicles({ M, level, world, groundAt: (x, z) => this.groundAt(x, z),
                          events: this.pendingEvents, clock: () => this.clock })
      : null;
    this.enemyTables = { 1: new M.EnemyStrengthTables(), 2: new M.EnemyStrengthTables() };
    this.tablesAt = -Infinity;
    this.tickets = {
      1: Number.isFinite(extras?.tickets?.team1) ? extras.tickets.team1 : 100,
      2: Number.isFinite(extras?.tickets?.team2) ? extras.tickets.team2 : 100,
    };
    this.lossPerMin = { 1: extras?.tickets?.lossPerMin?.team1 ?? 0, 2: extras?.tickets?.lossPerMin?.team2 ?? 0 };
    this.controlPoints = world.flags.filter(f => !f.standalone && f.controlPointName);

    for (const bot of this.bots) {
      bot.navGrid = this.nav;
      bot.covers = this.covers;
      bot.unitInfoOf = (id) => this.unitInfo(id);
      bot.vehicleCandidates = [];
      this.strategy?.addBot(bot.playerId, bot.team);
      world.setPlayerArmor(bot.playerId, new M.Armor(level.kits.maxHp(bot.kit)));
      const names = new Set((bot.weapons ?? []).map(w => w.name).filter(Boolean));
      if (bot.kitPrimary) names.add(bot.kitPrimary);
      for (const name of names) {
        const fire = level.weaponFire(name);
        if (fire) bot.setWeaponData(name, fire);
      }
      this.stats.set(bot.playerId, {
        side: bot.team, kit: bot.kit, kills: 0, deaths: 0, shots: 0, hits: 0, captures: 0, routeFailures: 0,
        redeploys: 0, mounts: 0, aliveSeconds: 0, mountedSeconds: 0, behaviourSeconds: {},
      });
      this.instrument(bot);
    }

    this.emit({
      k: 'match', version: 1, level: level.name, seed: this.seed, botsPerSide: this.botsPerSide,
      behaviours: BEHAVIOURS,
      botSkill: this.botSkill, duration: this.duration, tickHz: Math.round(1 / M.WORLD_TICK_DT),
      traceEvery: this.traceEvery, sampleEvery: this.sampleEvery, worldSize,
      nav: { width: this.nav.width, height: this.nav.height, cellSize: this.nav.cellSize },
      strategic: this.strategy ? this.strategy.layer.areas.map(a => a.name) : null,
      flags: world.flags.map(f => ({ name: f.name, team: f.team ?? 0, pos: v2(f.position), radius: f.radius,
                                     uncapturable: !!f.uncapturable, controlPoint: !!f.controlPointName })),
      tickets: { ...this.tickets }, lossPerMin: { ...this.lossPerMin },
      covers: this.covers.length, vehicles: this.vehicles?.count ?? 0,
      bots: this.bots.map(b => ({ id: b.playerId, side: b.team, name: b.name, kit: b.kit,
                                  weapons: b.weapons.map(w => w.name) })),
    });
    this.sample();
  }

  /** Record, per tick, the modifier each behaviour was evaluated with. */
  instrument(bot) {
    const rec = { mods: {} };
    bot._simRec = rec;
    const generate = bot._generate.bind(bot);
    bot._generate = (name, mod, now, dt, planned) => {
      rec.mods[name] = mod;
      return generate(name, mod, now, dt, planned);
    };
  }

  groundAt(x, z) {
    const h = this.world.collider?.surfaceHeight?.(x, z);
    return Number.isFinite(h) ? h : NaN;
  }

  /** `buildBotCovers`. */
  buildCovers() {
    const values = this.level.extras?.ai?.coverValues;
    const statics = this.world.collider?.statics;
    if (!values || !statics?.tris || !statics.ownerNodes) return [];
    const byOwner = new Map();
    const tris = statics.tris, owners = statics.owners;
    for (let t = 0; t < statics.count; t++) {
      const owner = owners[t];
      if (owner < 0) continue;
      let e = byOwner.get(owner);
      if (e === undefined) {
        const name = (statics.ownerNodes[owner]?.name ?? '').toLowerCase();
        const value = values[name] ?? values[name.replace(/_\d+$/, '')] ?? null;
        if (value == null) { byOwner.set(owner, null); continue; }
        e = { id: owner, value, minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
        byOwner.set(owner, e);
      }
      if (!e) continue;
      const o = t * 9;
      for (let k = 0; k < 3; k++) {
        const x = tris[o + k * 3], y = tris[o + k * 3 + 1], z = tris[o + k * 3 + 2];
        if (x < e.minX) e.minX = x; if (x > e.maxX) e.maxX = x;
        if (y < e.minY) e.minY = y; if (y > e.maxY) e.maxY = y;
        if (z < e.minZ) e.minZ = z; if (z > e.maxZ) e.maxZ = z;
      }
    }
    const out = [];
    for (const e of byOwner.values()) {
      if (!e) continue;
      const width = Math.max(e.maxX - e.minX, e.maxZ - e.minZ);
      out.push({ id: e.id, value: e.value, pos: [(e.minX + e.maxX) / 2, e.minY, (e.minZ + e.maxZ) / 2],
                 width, height: e.maxY - e.minY, radius: width / 2 });
    }
    return out;
  }

  // --- the page's per-frame bot work -------------------------------------------

  unitInfo(id) {
    const v = this.vehicles?.unitInfo(id);
    if (v) return v;
    const p = this.world.player(id);
    if (!p) return null;
    return { type: 'Infantry', air: false, table: BOT_SOLDIER_TABLE, maxSpeed: 5, seats: null, enemyManned: false,
             mobile: true, vehicle: false, extents: [0.6, 1.8, 0.6] };
  }

  occupiedUnits() {
    const units = [];
    const cands = this.vehicles?.candidates() ?? [];
    for (const [id, p] of this.world.players) {
      if (this.world.armorOf(id)?.destroyed) continue;
      const side = p.team;
      const seat = this.vehicles?.seatOf(id);
      if (seat) {
        const c = cands.find(x => x.vehicleId === seat.hull.id && x.seatId === seat.seatId);
        units.push({ side, table: c?.strengths ?? {}, type: seat.hull.strType, security: 1 });
      } else if (p.soldier) {
        units.push({ side, table: BOT_SOLDIER_TABLE, type: 'Infantry', security: 1 });
      }
    }
    return units;
  }

  step() {
    const dt = this.M.WORLD_TICK_DT;
    this.world.step(dt);
    this.clock += dt;
    this.tickIndex++;
    this.tickBots(dt);
    this.captureTick(dt);
    this.ticketTick(dt);
    for (const e of this.pendingEvents.splice(0)) {
      if (e.type === 'mount') { const s = this.stats.get(e.bot); if (s) s.mounts++; }
      this.event(e);
    }
    if ((this.tickIndex - 1) % this.traceEvery === 0) this.trace();
    if (this.clock + 1e-9 >= this.nextSample) this.sample();
    for (const side of [1, 2]) {
      if (this.tickets[side] <= 0 && !this.ended) this.ended = { reason: 'tickets', loser: side };
    }
    if (!this.ended && this.clock + 1e-9 >= this.duration) this.ended = { reason: 'time' };
    return !this.ended;
  }

  tickBots(dt) {
    const { world } = this;
    if (this.strategy) {
      const alive = new Map();
      for (const bot of this.bots) {
        if (world.armorOf(bot.playerId)?.destroyed) continue;
        alive.set(bot.playerId, bot.getPosition());
      }
      const before = { 1: this.strategy.sides[1].active?.strategy?.name, 2: this.strategy.sides[2].active?.strategy?.name };
      this.strategy.update(dt, alive);
      for (const side of [1, 2]) {
        const now = this.strategy.sides[side].active?.strategy?.name;
        if (now !== before[side]) this.event({ type: 'strategy', side, from: before[side] ?? null, to: now ?? null });
      }
    }
    if (this.clock - this.tablesAt >= this.M.SAI.updateFrequency) {
      this.tablesAt = this.clock;
      const units = this.occupiedUnits();
      for (const side of [1, 2]) this.enemyTables[side].update(units.filter(u => u.side !== side));
    }
    for (const bot of this.bots) bot.enemyTables = this.enemyTables[bot.team] ?? null;
    this.vehicleTick();
    for (const bot of this.bots) {
      const st = this.stats.get(bot.playerId);
      if (this.respawnTick(bot, dt)) continue;
      st.aliveSeconds += dt;
      if (bot.vehicle) st.mountedSeconds += dt;
      bot.waypoints = this.strategy?.waypointsOf(bot.playerId) ?? null;
      const failuresBefore = bot._pathFailures ?? 0;
      bot._simRec.mods = {};
      bot.tick(dt, this.clock);
      const failures = bot._pathFailures ?? 0;
      if (failures > failuresBefore) {
        st.routeFailures += failures - failuresBefore;
        this.event({ type: 'route_failed', bot: bot.playerId, side: bot.team, count: failures,
                     pos: v2(bot.position), goal: v2(bot.objectiveGoal), mounted: !!bot.vehicle });
      }
      const b = bot.currentBehaviour ?? 'none';
      st.behaviourSeconds[b] = (st.behaviourSeconds[b] ?? 0) + dt;
      if (bot._needsRespawn) {
        bot._needsRespawn = false;
        bot._stalledTicks = 0;
        bot._pathFailures = 0;
        bot.route = null;
        const record = world.player(bot.playerId);
        if (record?.flag && !bot.vehicle) {
          world.spawnPlayer(bot.playerId, { flag: record.flag, advance: true });
          bot.setPosition(record.soldier.x, record.soldier.y, record.soldier.z);
          bot._lastX = null;
          bot._lastZ = null;
          st.redeploys++;
          this.event({ type: 'redeploy', bot: bot.playerId, side: bot.team, flag: record.flag.name, pos: v2(bot.position) });
        }
      }
    }
    this.fireTick(dt);
  }

  /** `botVehicleTick`. */
  vehicleTick() {
    const V = this.vehicles;
    if (!V) return;
    V.tick();
    for (const { hull, crew } of V.collectDestroyed()) {
      for (const pid of crew) {
        const bot = this.bots.find(b => b.playerId === pid);
        if (!bot) continue;
        V.leave(bot, { killed: true });
        this.applyDamage(pid, 1e6, hull.lastAttacker ?? null, null, `hull ${hull.template}`);
      }
    }
    const cands = V.candidates();
    for (const bot of this.bots) {
      bot.vehicleCandidates = cands;
      if (bot.vehicle) {
        if (bot.exitRequest) {
          bot.exitRequest = false;
          V.leave(bot);
        } else if (bot.switchRequest) {
          const req = bot.switchRequest;
          bot.switchRequest = null;
          const cand = cands.find(c => c.vehicleId === req.vehicleId && c.seatId === req.seatId);
          if (cand && !cand.occupiedBy && cand.vehicleId === bot.vehicle.vehicleId) {
            V.leave(bot);
            V.enter(bot, cand);
          }
        }
        continue;
      }
      const req = bot.enterRequest;
      if (!req) continue;
      bot.enterRequest = null;
      const cand = cands.find(c => c.id === req.vehicleId);
      if (cand && !cand.occupiedBy && !this.world.armorOf(bot.playerId)?.destroyed) V.enter(bot, cand);
    }
  }

  /** `botRespawnTick`. */
  respawnTick(bot, dt) {
    const world = this.world;
    const armor = world.armorOf(bot.playerId);
    if (!armor?.destroyed) return false;
    bot._respawnIn = (bot._respawnIn ?? BOT_RESPAWN_DELAY) - dt;
    if (bot._respawnIn > 0) return true;
    const teamFlags = world.flags.filter(f => f.team === bot.team);
    const flag = teamFlags.length
      ? teamFlags[Math.floor(Math.random() * teamFlags.length)]
      : (world.player(bot.playerId)?.flag ?? null);
    world.spawnPlayer(bot.playerId, { flag, advance: true, group: bot.team });
    const record = world.player(bot.playerId);
    world.setPlayerArmor(bot.playerId, new this.M.Armor(this.level.kits.maxHp(bot.kit)));
    if (record?.soldier) bot.setPosition(record.soldier.x, record.soldier.y, record.soldier.z);
    bot._respawnIn = 0;
    bot.onRespawn();
    this.event({ type: 'respawn', bot: bot.playerId, side: bot.team, flag: record?.flag?.name ?? flag?.name ?? null,
                 pos: v2(bot.position) });
    return false;
  }

  // --- fire -----------------------------------------------------------------------

  weaponFireOf(bot) {
    const name = bot.weaponAi?.name ?? bot.kitPrimary ?? null;
    return name ? bot.weaponData?.[name] ?? null : null;
  }

  /** `botMagazineTick`. */
  magazineTick(bot, dt) {
    const stats = this.weaponFireOf(bot);
    const name = bot.weaponAi?.name ?? null;
    const size = stats?.magazine?.size > 0 ? stats.magazine.size : 0;
    if (!bot._mags) bot._mags = new Map();
    let mag = name ? bot._mags.get(name) : null;
    if (!mag && name) {
      mag = { rounds: size || Infinity, spare: size ? Math.max(0, (stats?.magazine?.magazines ?? 1) - 1) : 0,
              size, reloadTime: stats?.magazine?.reloadTime ?? 0, reloadLeft: 0 };
      bot._mags.set(name, mag);
    }
    if (!mag) return { canFire: true };
    if (mag.reloadLeft > 0) {
      mag.reloadLeft = Math.max(0, mag.reloadLeft - dt);
      if (mag.reloadLeft === 0) { mag.rounds = mag.size; mag.spare -= 1; }
    } else if (mag.rounds <= 0 && mag.spare > 0) {
      mag.reloadLeft = mag.reloadTime > 0 ? mag.reloadTime : 1e-6;
    }
    const canFire = mag.reloadLeft === 0 && mag.rounds > 0;
    bot.magazineEmpty = mag.rounds <= 0;
    if (bot.weaponAi && Number.isFinite(mag.rounds)) bot.weaponAi.ammo = mag.rounds + mag.spare * mag.size;
    mag.canFire = canFire;
    return mag;
  }

  /** `resolveBotShot`: one round down the aim, rolled into the cone, against
   *  the enemy soldier capsules. `aimAt` (SIM, mounted guns only) lays the
   *  round on the target's height (the stand-in turret's elevation). */
  resolveShot(bot, damage, aimAt = null) {
    const { origin, dir } = bot.aimRay();
    let d = dir;
    if (aimAt) {
      const dx = aimAt[0] - origin[0], dy = aimAt[1] + BOT_BODY_HEIGHT - origin[1], dz = aimAt[2] - origin[2];
      const h = Math.hypot(dx, dz) || 1;
      const pitch = Math.atan2(dy, h);
      const yaw = Math.atan2(dir[0], dir[2]);
      d = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    }
    let [rx, ry, rz] = d;
    const len = Math.hypot(rx, ry, rz) || 1;
    rx /= len; ry /= len; rz /= len;
    const spread = (bot.aimDeviation ?? 0) * DEG_TO_RAD;
    let cx = rx, cy = ry, cz = rz;
    if (spread > 0) {
      const theta = spread * Math.sqrt(Math.random());
      const phi = Math.random() * Math.PI * 2;
      // u = normalize(ref x r), v = r x u (the page's `_botFrameU/V`).
      let ux, uy, uz;
      if (Math.abs(ry) > 0.99) { ux = 0; uy = -rz; uz = ry; } else { ux = rz; uy = 0; uz = -rx; }
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      const vx = ry * uz - rz * uy, vy = rz * ux - rx * uz, vz = rx * uy - ry * ux;
      const c = Math.cos(theta), s = Math.sin(theta);
      cx = rx * c + ux * s * Math.cos(phi) + vx * s * Math.sin(phi);
      cy = ry * c + uy * s * Math.cos(phi) + vy * s * Math.sin(phi);
      cz = rz * c + uz * s * Math.cos(phi) + vz * s * Math.sin(phi);
    }
    const me = this.world.player(bot.playerId);
    let best = null, bestT = Infinity;
    for (const [id, player] of this.world.players) {
      if (id === bot.playerId) continue;
      if (me && player.team === me.team) continue;
      if (this.world.armorOf(id)?.destroyed) continue;
      const s = player.soldier;
      if (!s) continue;
      const px0 = s.x - origin[0], py0 = (s.y + BOT_BODY_HEIGHT) - origin[1], pz0 = s.z - origin[2];
      const t = px0 * cx + py0 * cy + pz0 * cz;
      if (t < 0 || t > BOT_FIRE_RANGE) continue;
      const px = px0 - t * cx, py = py0 - t * cy, pz = pz0 - t * cz;
      if (px * px + py * py + pz * pz > BOT_BODY_RADIUS * BOT_BODY_RADIUS) continue;
      const at = [origin[0] + t * cx, origin[1] + t * cy, origin[2] + t * cz];
      if (!this.lineOfSight(origin, at)) continue;
      if (t < bestT) { bestT = t; best = { targetId: id, damage, dist: t }; }
    }
    return best;
  }

  /** `botLineOfSight`: the terrain march. */
  lineOfSight(from, to) {
    const collider = this.world.collider;
    if (!collider?.surfaceHeight) return true;
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const distance = Math.hypot(dx, dy, dz);
    const steps = Math.min(10, Math.max(1, Math.ceil(distance / 0.8)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const surface = collider.surfaceHeight(from[0] + dx * t, from[2] + dz * t);
      if (!Number.isFinite(surface)) continue;
      if (surface > from[1] + dy * t + 0.5) return false;
    }
    return true;
  }

  /** `resolveBotHeal`. */
  resolveHeal(bot) {
    const { origin, dir } = bot.aimRay();
    const range = bot.weaponAi?.maxRange ?? 2.5;
    const me = this.world.player(bot.playerId);
    let best = null, bestD = Infinity;
    for (const [id, player] of this.world.players) {
      if (id === bot.playerId || !me || player.team !== me.team) continue;
      const armor = this.world.armorOf(id);
      if (!armor || armor.destroyed || armor.hitPoints >= armor.maxHitPoints) continue;
      const s = player.soldier;
      if (!s) continue;
      const dx = s.x - origin[0], dy = (s.y + 1.0) - origin[1], dz = s.z - origin[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > range + 0.5 || d >= bestD) continue;
      const cos = (dx * dir[0] + dy * dir[1] + dz * dir[2]) / Math.max(d, 1e-3);
      if (cos < Math.cos(20 * Math.PI / 180)) continue;
      best = id; bestD = d;
    }
    return best;
  }

  /** `botFireTick`, plus the SIM mounted gun. */
  fireTick(dt) {
    // Dead bots are not skipped, as on the page: their trigger is up (death
    // clears `isFiring` and their tick does not run), but a reload in
    // progress keeps running.
    for (const bot of this.bots) {
      const st = this.stats.get(bot.playerId);
      bot._fireCooldown = Math.max(0, (bot._fireCooldown ?? 0) - dt);
      if (bot.vehicle) {
        if (!bot.isFiring || bot._fireCooldown > 0) continue;
        const w = bot.weapons[bot.weaponIndex] ?? bot.weapons[0];
        const gun = w?.burst ? SIM_GUN.mg : SIM_GUN.shell;
        bot._fireCooldown = 1 / gun.roundsPerSecond;
        bot.deviation.onShot();
        bot.onShot(this.clock);
        st.shots++;
        const at = bot.getPosition();
        for (const other of this.bots) other.onShotFired(bot.playerId, bot.team, at, this.clock, 250);
        const target = bot.firingTarget ? this.world.player(bot.firingTarget) : null;
        const tp = target?.soldier ? [target.soldier.x, target.soldier.y, target.soldier.z] : null;
        const hit = this.resolveShot(bot, gun.damage, tp);
        if (!hit) continue;
        bot.recordHit(hit.targetId);
        st.hits++;
        this.applyDamage(hit.targetId, hit.damage, bot.playerId, at, w?.name ?? 'gun', !w?.burst, hit.dist);
        continue;
      }
      const mag = this.magazineTick(bot, dt);
      if (!bot.isFiring || bot._fireCooldown > 0 || !mag.canFire) continue;
      const stats = this.weaponFireOf(bot);
      const rof = stats?.roundOfFire > 0 ? stats.roundOfFire : BOT_FALLBACK_ROF;
      bot._fireCooldown = 1 / rof;
      if (mag && Number.isFinite(mag.rounds)) mag.rounds = Math.max(0, mag.rounds - 1);
      bot.deviation.onShot();
      bot.onShot(this.clock);
      st.shots++;
      const at = bot.getPosition();
      const radius = bot.weaponAi?.soundSphereRadius ?? null;
      for (const other of this.bots) other.onShotFired(bot.playerId, bot.team, at, this.clock, radius);
      if (bot.weaponAi?.healing) {
        const friend = this.resolveHeal(bot);
        if (friend) this.world.armorOf(friend)?.heal(BOT_HEAL_PER_ROUND);
        continue;
      }
      const hit = this.resolveShot(bot, this.level.roundDamage(stats));
      if (!hit) continue;
      bot.recordHit(hit.targetId);
      st.hits++;
      this.applyDamage(hit.targetId, hit.damage, bot.playerId, at, bot.weaponAi?.name ?? null, false, hit.dist);
    }
  }

  /** `applyDamageToBot` + `botDamageLanded`. */
  applyDamage(playerId, damage, attackerId, attackerPos, via = null, shell = false, dist = null) {
    const world = this.world;
    const armor = world.armorOf(playerId);
    if (!armor || armor.destroyed) return;
    const bot = this.bots.find(b => b.playerId === playerId);
    if (bot?.vehicle && damage < 1e5 && this.vehicles?.damageHull(bot, damage, shell)) {
      const h = this.vehicles.hullOf(bot.vehicle.vehicleId);
      if (h) h.lastAttacker = attackerId;
      return;
    }
    armor.damage(damage);
    if (bot) bot.onIncomingFire(attackerId, attackerPos ?? null, this.clock, true, 1);
    if (!armor.destroyed || !bot) return;
    if (bot.vehicle) this.vehicles?.leave(bot, { killed: true });
    bot.isFiring = false;
    bot.firingTarget = null;
    bot._respawnIn = BOT_RESPAWN_DELAY;
    this.strategy?.botDied(playerId);
    const victim = this.stats.get(playerId);
    victim.deaths++;
    const killer = attackerId ? this.stats.get(attackerId) : null;
    if (killer && killer.side !== victim.side) killer.kills++;
    this.tickets[victim.side] -= 1;
    this.event({ type: 'kill', killer: attackerId ?? null, killerSide: killer?.side ?? null, victim: playerId,
                 victimSide: victim.side, weapon: via, dist: r2(dist), pos: v2(bot.position) });
  }

  // --- capture and tickets --------------------------------------------------------

  captureRadius(flag) { return Number.isFinite(flag?.radius) && flag.radius > 0 ? flag.radius : 8; }
  captureDuration(flag) {
    return Number.isFinite(flag?.timeToGetControl) && flag.timeToGetControl > 0 ? flag.timeToGetControl : CAPTURE_FALLBACK_SECONDS;
  }

  /** `nearestEnemyFlag`. */
  nearestEnemyFlag(team, pos) {
    let nearest = null, distance = Infinity;
    for (const flag of this.world.flags) {
      if (flag.uncapturable || !flag.position || flag.team === team) continue;
      const d = Math.hypot(pos[0] - flag.position[0], pos[2] - flag.position[2]);
      if (d <= this.captureRadius(flag) && d < distance) { nearest = flag; distance = d; }
    }
    return nearest;
  }

  /** `botCaptureTick`. */
  captureTick(dt) {
    for (const bot of this.bots) {
      if (!bot.team) continue;
      const target = this.nearestEnemyFlag(bot.team, bot.getPosition());
      if (!target) { bot._capture = null; continue; }
      if (!bot._capture || bot._capture.flag !== target) bot._capture = { flag: target, elapsed: 0 };
      bot._capture.elapsed += dt;
      if (bot._capture.elapsed < this.captureDuration(target)) continue;
      const prev = target.team ?? 0;
      target.team = bot.team;
      bot._capture = null;
      this.stats.get(bot.playerId).captures++;
      this.event({ type: 'capture', flag: target.name, from: prev, to: bot.team, by: bot.playerId,
                   alive: !this.world.armorOf(bot.playerId)?.destroyed });
    }
  }

  /** SIM: one ticket a death (in `applyDamage`), and the bleed while the other
   *  side holds more than half the control points. */
  ticketTick(dt) {
    const n = this.controlPoints.length;
    if (!n) return;
    for (const side of [1, 2]) {
      const other = side === 1 ? 2 : 1;
      const held = this.controlPoints.filter(f => f.team === other).length;
      if (held > n / 2 && this.lossPerMin[side] > 0) this.tickets[side] -= this.lossPerMin[side] / 60 * dt;
    }
  }

  // --- the trace ------------------------------------------------------------------

  sample() {
    const flags = { 0: 0, 1: 0, 2: 0 };
    for (const f of this.controlPoints) flags[f.team === 1 || f.team === 2 ? f.team : 0]++;
    const alive = { 1: 0, 2: 0 }, mounted = { 1: 0, 2: 0 };
    for (const bot of this.bots) {
      if (this.world.armorOf(bot.playerId)?.destroyed) continue;
      alive[bot.team]++;
      if (bot.vehicle) mounted[bot.team]++;
    }
    const s = { k: 'sample', t: r2(this.clock), tickets: { 1: r2(this.tickets[1]), 2: r2(this.tickets[2]) },
                flags, alive, mounted, owners: this.controlPoints.map(f => f.team ?? 0) };
    this.samples.push(s);
    this.emit(s);
    this.nextSample += this.sampleEvery;
  }

  trace() {
    for (const bot of this.bots) {
      const armor = this.world.armorOf(bot.playerId);
      if (armor?.destroyed) {
        this.emit({ k: 'tick', t: r2(this.clock), n: this.tickIndex, bot: bot.playerId, side: bot.team, alive: false,
                    respawnIn: r2(bot._respawnIn ?? 0) });
        continue;
      }
      // In the header's `behaviours` order; `mod` is null for a behaviour the
      // bot's unit does not register or that was not evaluated this tick.
      const u = BEHAVIOURS.map(name => r4(bot.urgency[name] ?? 0));
      const act = BEHAVIOURS.map(name => r4(bot.activeUrgency[name] ?? 0));
      const mod = BEHAVIOURS.map(name => (name in bot._simRec.mods ? r4(bot._simRec.mods[name]) : null));
      const plan = bot.currentPlan ?? [];
      const head = plan.find(a => !a.done) ?? plan[0] ?? null;
      const wp = bot.waypoints ?? bot._fallback ?? null;
      this.emit({
        k: 'tick', t: r2(this.clock), n: this.tickIndex, bot: bot.playerId, side: bot.team, alive: true,
        hp: r2(armor?.hitPoints), pos: v2(bot.position), yaw: r4(bot.yaw), stance: bot.stance,
        area: wp?.area?.name ?? wp?.flag?.name ?? null,
        order: wp ? { point: v2(wp.point), radius: r2(wp.radius), src: bot.waypoints ? 'order' : 'fallback' } : null,
        beh: bot.currentBehaviour, since: r2(this.clock - (bot.behaviourChosenAt ?? 0)),
        u, act, mod,
        plan: head?.type ?? null, planLen: plan.length,
        ctl: [r4(bot.moveForward), r4(bot.moveStrafe), r4(bot.lookX), r4(bot.lookY), bot.isFiring ? 1 : 0],
        stall: bot._stalledTicks ?? 0,
        target: bot.firingTarget ?? null,
        veh: bot.vehicle ? { id: bot.vehicle.vehicleId, template: bot.vehicle.template, seat: bot.vehicle.seatId,
                             drives: !!bot.vehicle.drives } : null,
        route: bot.route ? { points: bot.route.points?.length ?? 0, failed: !!bot.route.failed } : null,
        terms: this.terms(bot),
      });
    }
  }

  /** The winning behaviour's inputs, read off the controller after its tick. */
  terms(bot) {
    const b = bot.currentBehaviour;
    const pos = bot.position;
    const t = {};
    if (bot.firingTarget) {
      t.fire = { target: bot.firingTarget, score: r4(bot.targetScore), weapon: bot.weaponAi?.name ?? null,
                 visible: !!bot.targetVisible,
                 dist: bot.targetPosition ? r2(Math.hypot(bot.targetPosition[0] - pos[0], bot.targetPosition[2] - pos[2])) : null };
    }
    switch (b) {
      case 'MoveTo': {
        const wp = bot.waypoints ?? bot._fallback;
        if (!wp) break;
        const dist = Math.hypot(wp.point[0] - pos[0], wp.point[1] - pos[2]);
        let factor = 2;
        let d2 = dist * dist;
        if (typeof wp.owned === 'function') {
          const areaR = wp.area?.radius ?? 0;
          if (!wp.owned()) factor = 2;
          else if (wp.inside(pos[0], pos[2])) { factor = 0; d2 = 0; }
          else { factor = 1; d2 = Math.max(0, d2 - areaR * areaR); }
        }
        const Rr = wp.radius + 1.0;
        t.moveTo = { src: bot.waypoints ? 'order' : 'fallback', area: wp.area?.name ?? wp.flag?.name ?? null,
                     dist: r2(dist), radius: r2(wp.radius), unitRadius: 1.0, factor,
                     q: r4(d2 / (4 * Rr * Rr)), shaped: r4(Math.min(1, Math.max(0.1, d2 / (4 * Rr * Rr)))) };
        break;
      }
      case 'Scout':
        t.scout = { dir: bot._scoutDir ? bot._scoutDir.map(r4) : null, accum: r4(bot.scout?.accum), quad: bot.scout?.lastQuad ?? null };
        break;
      case 'TakeCover': {
        const r = bot._coverResult;
        if (r) t.takeCover = { danger: v2(r.dangerPos), dangerId: r.dangerId ?? null, cover: r.cover?.id ?? -1,
                               goal: v2(r.goal), changed: !!r.changed };
        break;
      }
      case 'Special': {
        const r = bot._medicResult;
        if (r) t.special = { target: r.targetId, arrive: r2(r.arrive), weapon: bot.weapons?.[r.weaponIndex]?.name ?? null };
        break;
      }
      case 'Change': {
        const r = bot._changeResult;
        if (r) t.change = { best: r.best?.id ?? null, u: r4(r.best?.u), dist: r2(r.best?.dist), bail: !!r.bail, teleport: !!r.teleport };
        break;
      }
      case 'Avoid':
        t.avoid = { threat: bot._avoidThreatDir ? bot._avoidThreatDir.map(r4) : null };
        break;
      default:
        break;
    }
    return t;
  }

  // --- the summary ----------------------------------------------------------------

  summary(runtimeMs) {
    const deaths = { 1: 0, 2: 0 }, kills = { 1: 0, 2: 0 }, captures = { 1: 0, 2: 0 };
    let aliveSeconds = 0, mountedSeconds = 0, routeFailures = 0;
    const behaviour = {};
    const perBot = {};
    for (const [id, s] of this.stats) {
      deaths[s.side] += s.deaths;
      kills[s.side] += s.kills;
      aliveSeconds += s.aliveSeconds;
      mountedSeconds += s.mountedSeconds;
      routeFailures += s.routeFailures;
      for (const [b, sec] of Object.entries(s.behaviourSeconds)) behaviour[b] = (behaviour[b] ?? 0) + sec;
      perBot[id] = { ...s, aliveSeconds: r2(s.aliveSeconds), mountedSeconds: r2(s.mountedSeconds),
                     behaviourSeconds: Object.fromEntries(Object.entries(s.behaviourSeconds).map(([k, v]) => [k, r2(v)])) };
    }
    const captureEvents = this.events.filter(e => e.type === 'capture');
    for (const e of captureEvents) captures[e.to] = (captures[e.to] ?? 0) + 1;
    const first = captureEvents[0] ?? null;
    const totalDeaths = deaths[1] + deaths[2];
    const mounts = this.events.filter(e => e.type === 'mount');
    const byTemplate = {};
    for (const e of mounts) byTemplate[e.template] = (byTemplate[e.template] ?? 0) + 1;
    const behaviourShare = {};
    const totalB = Object.values(behaviour).reduce((a, b) => a + b, 0) || 1;
    for (const [b, sec] of Object.entries(behaviour)) behaviourShare[b] = r4(sec / totalB);
    let winner = null;
    if (this.tickets[1] !== this.tickets[2]) winner = this.tickets[1] > this.tickets[2] ? 1 : 2;
    const every = Math.max(1, Math.round(5 / this.sampleEvery));
    const series = this.samples.filter((_, i) => i % every === 0 || i === this.samples.length - 1);
    return {
      level: this.level.name, seed: this.seed, botsPerSide: this.botsPerSide, botSkill: this.botSkill,
      duration: r2(this.clock), requestedDuration: this.duration,
      result: { reason: this.ended?.reason ?? 'unfinished', winner, tickets: { 1: r2(this.tickets[1]), 2: r2(this.tickets[2]) } },
      metrics: {
        ticketsOverTime: series.map(s => [s.t, s.tickets[1], s.tickets[2]]),
        flagsHeldOverTime: series.map(s => [s.t, s.flags[0], s.flags[1], s.flags[2]]),
        timeToFirstCapture: first ? { t: first.t, flag: first.flag, side: first.to, by: first.by } : null,
        captures: { 1: captures[1] ?? 0, 2: captures[2] ?? 0, total: captureEvents.length },
        deaths, kills,
        deathsPerCapture: captureEvents.length ? r2(totalDeaths / captureEvents.length) : null,
        vehicleUtilisation: {
          vehicles: this.vehicles?.count ?? 0,
          mountedShare: aliveSeconds > 0 ? r4(mountedSeconds / aliveSeconds) : 0,
          mountedBotSeconds: r2(mountedSeconds), aliveBotSeconds: r2(aliveSeconds),
          mounts: mounts.length, mountsByTemplate: byTemplate,
          destroyed: this.events.filter(e => e.type === 'vehicle_destroyed').length,
        },
        routeFailures: { total: routeFailures, perBot: Object.fromEntries([...this.stats].map(([id, s]) => [id, s.routeFailures])) },
        redeploys: this.events.filter(e => e.type === 'redeploy').length,
        strategyChanges: this.events.filter(e => e.type === 'strategy').length,
        behaviourShare,
      },
      perBot,
      trace: { lines: this.lines, sha256: this.hash.copy().digest('hex') },
      level_info: this.level.info,
      runtime: { wallMs: Math.round(runtimeMs), navMs: this.navMs },
    };
  }
}
