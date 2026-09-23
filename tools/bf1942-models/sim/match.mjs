// One headless match: the viewer's World, BotControllers, nav map, strategic
// AI and bot referee, stepped at the engine's 30 Hz with no renderer.
//
// The per-tick order is `map.html frame()`'s with the human taken out:
//
//   world.step(1/30)          the world consumes each bot's last input word
//   referee.tick(1/30)        the bots' clock; the strategic pass (every
//                             `SAI.updateFrequency`); the enemy tables; the
//                             seat requests; per bot: the respawn timer, the
//                             order, `bot.tick`, the no-progress redeploy;
//                             then the bots' rounds
//   referee.captureTick       the per-bot capture law
//   tickets, trace, samples   the runner's own bookkeeping
//
// The referee is the page's own (`viewer/bot-referee.js`, imported, not
// copied): rounds, damage, death and respawn, capture, seating and the enemy
// tables are the code the page runs. On a real level the vehicles are the
// page's too (`stage.mjs`: the hulls' instances, their real drives and
// bodies, the guns flying real rounds, the wrecks, `bot-units.js` as the
// referee's `units`), stepped in the page frame's order around the referee:
//
//   world.step, referee.tick, syncVehicleSpawnOwnership, referee.captureTick,
//   stepVehicleBodies, stepSinkingHulls, stepVehicleDamage, the matrix walk
//
// The synthetic level has no vehicle nodes, so there the runner hands the
// referee its stand-in vehicles (`SimVehicles`) and a mounted bot's gun is
// the runner's hitscan stand-in (`SIM_GUN`). Either way each event becomes a
// trace line and a statistic.
//
// Runner-only (the page has no such thing, labelled SIM):
//   tickets: one per death (`Game.setTicketLosePerDeath`, the Conquest
//   default in features/bf1942-3d-models/tickets-hud.md), and `lossPerMin`
//   while the other side holds more than half the control points (same
//   document); the viewer's ticket counter does not move.

import { createHash } from 'node:crypto';
import { SimVehicles, SIM_GUN } from './vehicles.mjs';
import { createStage } from './stage.mjs';

const BEHAVIOURS = ['Avoid', 'MoveTo', 'Idle', 'Fire', 'Special', 'Scout', 'TakeCover', 'Change'];

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : v);
const v2 = (a) => (a ? a.map(r2) : null);

export class Match {
  constructor({ M, level, botsPerSide = 4, botSkill = 0.75, duration = 120, seed = 1, traceEvery = 1,
                sampleEvery = 1, vehicles = true, sink = null, doctrine = null }) {
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
    // Each side's doctrine (viewer/doctrine.js); 'sai' both sides is the
    // engine's SAI, and a baseline run's trace names none (it is byte for
    // byte the trace from before the interface).
    this.doctrine = M.parseDoctrineSpec(doctrine);
    this.baseline = this.doctrine[1] === 'sai' && this.doctrine[2] === 'sai';
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

  /** The referee's state, read where the runner used to keep its own copy. */
  get bots() { return this.referee.bots; }
  get strategy() { return this.referee.strategy; }
  get nav() { return this.referee.navGrid; }
  get covers() { return this.referee.covers; }

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
    // A real level: the page's stage (the World, the collider, the bodies,
    // the hulls, the guns). The synthetic level: a World over its collider
    // and the stand-in vehicles.
    this.stage = level.stage ? createStage(M, level, { vehicles: this.useVehicles, seed: this.seed }) : null;
    const world = this.stage ? this.stage.world : new M.World({ collider: level.collider, extras });
    this.world = world;
    const worldSize = extras?.worldSize || 2048;
    this.referee = M.createBotReferee(this.refereeEnv());
    if (this.stage) {
      this.stage.referee = this.referee;
      this.stageHooks();
    }
    this.vehicles = this.useVehicles && !this.stage
      ? new SimVehicles({ M, level, world, groundAt: (x, z) => this.groundAt(x, z),
                          events: this.pendingEvents, clock: () => this.clock })
      : null;
    this.navMs = Math.round(this.referee.spawn({
      count: 2 * this.botsPerSide, botSkill: this.botSkill, teams: [1, 2],
      kitFor: (team, i) => level.kits.kitFor(team, i),
      viewDistance: extras?.ai?.settings?.viewDistance ?? null,
    }));
    this.tickets = {
      1: Number.isFinite(extras?.tickets?.team1) ? extras.tickets.team1 : 100,
      2: Number.isFinite(extras?.tickets?.team2) ? extras.tickets.team2 : 100,
    };
    this.lossPerMin = { 1: extras?.tickets?.lossPerMin?.team1 ?? 0, 2: extras?.tickets?.lossPerMin?.team2 ?? 0 };
    this.controlPoints = world.flags.filter(f => !f.standalone && f.controlPointName);

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
      covers: this.covers.length, vehicles: this.vehicleCount(),
      bots: this.bots.map(b => ({ id: b.playerId, side: b.team, name: b.name, kit: b.kit,
                                  weapons: b.weapons.map(w => w.name) })),
      ...(this.baseline ? {} : { doctrine: { ...this.doctrine } }),
    });
    this.sample();
  }


  /** What the referee needs from the runner: the world, the stand-in
   *  vehicles, and a hook per event the trace and the statistics record. */
  refereeEnv() {
    const level = this.level;
    const match = this;
    const stat = id => this.stats.get(id);
    const stage = this.stage;
    return {
      world: () => this.world,
      doctrine: this.doctrine,
      // Read live: the stand-in vehicles are built after the referee.
      get units() { return stage ? stage.units : match.vehicles; },
      groundAt: (x, z, fromY) => this.groundAt(x, z, fromY),
      armorFor: (bot) => new this.M.Armor(level.kits.maxHp(bot.kit)),
      // The page's `botRoundDamage` on a real level.
      roundDamage: stats => (stage ? stage.vehicleHits.botRoundDamage(stats) : level.roundDamage(stats)),
      onBotCreated: bot => {
        const names = new Set((bot.weapons ?? []).map(w => w.name).filter(Boolean));
        if (bot.kitPrimary) names.add(bot.kitPrimary);
        for (const name of names) {
          const fire = level.weaponFire(name);
          if (fire) bot.setWeaponData(name, fire);
        }
        this.stats.set(bot.playerId, {
          side: bot.team, kit: bot.kit, kills: 0, deaths: 0, shots: 0, hits: 0, captures: 0, routeFailures: 0,
          redeploys: 0, mounts: 0, aliveSeconds: 0, mountedSeconds: 0, behaviourSeconds: {},
          vehicleRounds: 0, vehicleKills: 0,
        });
        this.instrument(bot);
      },
      onStrategyChange: (side, from, to) => this.event({ type: 'strategy', side, from, to }),
      // One bot's tick, with the runner's bookkeeping around it. An exception
      // in a bot's tick would stop the page's frame loop; the runner records
      // it as an event (once per bot and message) and goes on with the next
      // bot, so one throwing path does not end the match.
      tickBot: (bot, dt, now) => {
        const st = stat(bot.playerId);
        st.aliveSeconds += dt;
        if (bot.vehicle) st.mountedSeconds += dt;
        const failuresBefore = bot._pathFailures ?? 0;
        bot._simRec.mods = {};
        try {
          bot.tick(dt, now);
        } catch (err) {
          this.botError(bot, err);
        }
        const failures = bot._pathFailures ?? 0;
        if (failures > failuresBefore) {
          st.routeFailures += failures - failuresBefore;
          this.event({ type: 'route_failed', bot: bot.playerId, side: bot.team, count: failures,
                       pos: v2(bot.position), goal: v2(bot.objectiveGoal), mounted: !!bot.vehicle });
        }
        const b = bot.currentBehaviour ?? 'none';
        st.behaviourSeconds[b] = (st.behaviourSeconds[b] ?? 0) + dt;
      },
      onRedeploy: (bot, flag) => {
        stat(bot.playerId).redeploys++;
        this.event({ type: 'redeploy', bot: bot.playerId, side: bot.team, flag: flag.name, pos: v2(bot.position) });
      },
      onRespawned: (bot, flag) => {
        this.event({ type: 'respawn', bot: bot.playerId, side: bot.team, flag: flag?.name ?? null,
                     pos: v2(bot.position) });
      },
      onShot: bot => { stat(bot.playerId).shots++; },
      onHit: bot => { stat(bot.playerId).hits++; },
      // SIM, the synthetic level only: a mounted bot's gun, hitscan from the
      // turret: a `burst` gun 8 rounds a second at 15, any other one round
      // per 4 s at 100. On a real level the world fires the seat's groups.
      mountedFire: stage ? undefined : (bot, dt) => this.mountedFire(bot, dt),
      damageHull: (bot, damage, { shell = false, attackerId = null } = {}) => {
        if (stage) return stage.damageHull(bot, damage, { attackerId });
        if (!this.vehicles?.damageHull(bot, damage, shell)) return false;
        const h = this.vehicles.hullOf(bot.vehicle.vehicleId);
        if (h) h.lastAttacker = attackerId;
        return true;
      },
      onDeath: (bot, attackerId, opts) => {
        const victim = stat(bot.playerId);
        victim.deaths++;
        const killer = attackerId ? stat(attackerId) : null;
        if (killer && killer.side !== victim.side) killer.kills++;
        this.tickets[victim.side] -= 1;
        this.event({ type: 'kill', killer: attackerId ?? null, killerSide: killer?.side ?? null, victim: bot.playerId,
                     victimSide: victim.side, weapon: opts?.weapon ?? opts?.via ?? null, dist: r2(opts?.dist ?? null),
                     pos: v2(bot.position) });
      },
      onCapture: (bot, flag, prevTeam) => {
        stat(bot.playerId).captures++;
        this.event({ type: 'capture', flag: flag.name, from: prevTeam ?? 0, to: bot.team, by: bot.playerId,
                     alive: !this.world.armorOf(bot.playerId)?.destroyed,
                     // The unit he took it in (the page logs "in the Sherman").
                     ...(bot.vehicle ? { veh: bot.vehicle.template ?? bot.vehicle.kind ?? null } : {}) });
      },
      onMounted: (bot, cand, mount) => {
        this.pendingEvents.push({ type: 'mount', bot: bot.playerId, side: bot.team, vehicle: this.vehicleLabel(mount),
                                  template: mount.template, seat: cand.seatId, driver: !!mount.drives });
      },
      onSeatSwitched: (bot, cand, mount) => {
        this.pendingEvents.push({ type: 'mount', bot: bot.playerId, side: bot.team, vehicle: this.vehicleLabel(mount),
                                  template: mount.template, seat: cand.seatId, driver: !!mount.drives });
      },
      onDismounted: (bot, m, { killed }) => {
        this.pendingEvents.push({ type: 'dismount', bot: bot.playerId, side: bot.team, vehicle: this.vehicleLabel(m),
                                  template: m.template ?? null, killed });
      },
    };
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

  groundAt(x, z, fromY) {
    if (this.stage) return this.stage.terrain.groundHeight(x, z, fromY);
    const h = this.world.collider?.surfaceHeight?.(x, z);
    return Number.isFinite(h) ? h : NaN;
  }

  /** A hull's name in the trace: the scene node's (GLTFLoader's unique
   *  name, `sherman_2`) on a real level, the stand-in's id otherwise. */
  vehicleLabel(m) {
    if (!m) return null;
    return this.stage ? (m.node?.name ?? m.vehicleId ?? null) : (m.vehicleId ?? null);
  }

  vehicleCount() {
    return this.stage ? this.stage.countVehicles() : (this.vehicles?.count ?? 0);
  }

  /** The stage's events: a wreck (with the player whose round last hurt
   *  it), a hull back on its pad. */
  stageHooks() {
    const stage = this.stage;
    const templateOf = node => stage.botUnits?.aiOf(node)?.name ?? stage.wrecks.templateNameOf(node);
    stage.hooks.onWreck = (owner, node, attackerId) => {
      const killer = attackerId ? this.stats.get(attackerId) : null;
      if (killer) killer.vehicleKills = (killer.vehicleKills ?? 0) + 1;
      this.pendingEvents.push({ type: 'vehicle_destroyed', vehicle: node?.name ?? String(owner), template: templateOf(node),
                                killer: attackerId ?? null, killerSide: killer?.side ?? null });
    };
    // A seat's gun fired (`guns.onShot`, the pull and its projectile count):
    // counted per bot, and the first pull of each seating is an event.
    this.vehicleFire = { rounds: 0, byKind: {}, byTemplate: {} };
    stage.hooks.onRounds = (group, rounds, firerId) => {
      const bot = firerId ? this.bots.find(b => b.playerId === firerId) : null;
      const m = bot?.vehicle;
      if (!m) return;
      const st = this.stats.get(firerId);
      st.vehicleRounds += rounds;
      const vf = this.vehicleFire;
      vf.rounds += rounds;
      vf.byKind[m.kind] = (vf.byKind[m.kind] ?? 0) + rounds;
      vf.byTemplate[m.template] = (vf.byTemplate[m.template] ?? 0) + rounds;
      if (bot._simFiredMount === m) return;
      bot._simFiredMount = m;
      this.pendingEvents.push({ type: 'vehicle_fire', bot: firerId, side: bot.team, vehicle: this.vehicleLabel(m),
                                template: m.template, kind: m.kind, seat: m.seatId,
                                gun: group?.node?.name ?? null });
    };
    stage.hooks.onRespawn = owner => {
      const node = stage.wrecks.damageVisuals.get(owner)?.node ?? null;
      this.pendingEvents.push({ type: 'vehicle_respawn', vehicle: node?.name ?? String(owner), template: templateOf(node) });
    };
  }

  // --- the per-tick bot work ---------------------------------------------------

  step() {
    const dt = this.M.WORLD_TICK_DT;
    const report = this.world.step(dt);
    this.clock += dt;
    this.tickIndex++;
    this.referee.tick(dt);
    this.stage?.afterBots();
    this.referee.captureTick(dt);
    this.stage?.afterCapture(report, dt);
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

  /** A throwing bot tick: counted per bot, an event the first time each
   *  message is seen for that bot. */
  botError(bot, err) {
    const st = this.stats.get(bot.playerId);
    st.errors = (st.errors ?? 0) + 1;
    const message = String(err?.message ?? err);
    const at = String(err?.stack ?? '').split('\n').slice(1)
      .map(l => l.match(/([\w.-]+\.(?:m?js)):(\d+)/)).filter(Boolean).slice(0, 3)
      .map(m => `${m[1]}:${m[2]}`);
    st.errorMessages ??= new Set();
    if (st.errorMessages.has(message)) return;
    st.errorMessages.add(message);
    this.event({ type: 'bot_error', bot: bot.playerId, side: bot.team, message, at,
                 beh: bot.currentBehaviour ?? null });
  }

  /** SIM: a mounted bot's stand-in gun (the referee's `mountedFire` hook). */
  mountedFire(bot, dt) {
    const st = this.stats.get(bot.playerId);
    bot._fireCooldown = Math.max(0, (bot._fireCooldown ?? 0) - dt);
    if (!bot.isFiring || bot._fireCooldown > 0) return;
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
    const hit = this.referee.resolveShot(bot, gun.damage, tp);
    if (!hit) return;
    bot.recordHit(hit.targetId);
    st.hits++;
    this.referee.applyDamage(hit.targetId, hit.damage, bot.playerId, at,
                             { weapon: w?.name ?? 'gun', shell: !w?.burst, dist: hit.dist });
  }

  // --- tickets ----------------------------------------------------------------------

  /** SIM: one ticket a death (the referee's `onDeath`), and the bleed while the other
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
        order: wp ? { point: v2(wp.point), radius: r2(wp.radius), src: bot.waypoints ? 'order' : 'fallback',
                      // A doctrine run names the kind (WPFollow, WPBoard, ...); a
                      // baseline trace stays as it was.
                      ...(this.baseline ? {} : { kind: wp.kind ?? null, leader: wp.leaderId ?? undefined }) } : null,
        beh: bot.currentBehaviour, since: r2(this.clock - (bot.behaviourChosenAt ?? 0)),
        u, act, mod,
        plan: head?.type ?? null, planLen: plan.length,
        ctl: [r4(bot.moveForward), r4(bot.moveStrafe), r4(bot.lookX), r4(bot.lookY), bot.isFiring ? 1 : 0],
        stall: bot._stalledTicks ?? 0,
        target: bot.firingTarget ?? null,
        veh: bot.vehicle ? { id: this.vehicleLabel(bot.vehicle), template: bot.vehicle.template, seat: bot.vehicle.seatId,
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
        const src = bot.waypoints ? 'order' : 'fallback';
        const area = wp.area?.name ?? wp.flag?.name ?? null;
        if (wp.kind === 'WPAltitudeMoveTo') {
          // `WPAltitudeMoveTo::getUrgency`: 1 outside the radius or the 120 m band.
          t.moveTo = { src, kind: wp.kind, area, dist: r2(dist), dy: r2(pos[1] - wp.y), radius: r2(wp.radius) };
          break;
        }
        // `WPMoveTo::getUrgency` as strategic.js `_order` computes it; the
        // fallback (no strategic data) uses R + r and factor 2.
        const layer = this.strategy?.layer;
        const pathR = typeof bot._pathRadius === 'function' ? bot._pathRadius() : 1.0;
        const Rr = src === 'order' ? Math.round(wp.radius) + pathR : wp.radius + 1.0;
        let d2 = dist * dist, factor = 2, arrived = false;
        if (src === 'order' && d2 < Rr * Rr) { arrived = true; factor = 0; }
        else if (src === 'order' && typeof wp.owned === 'function' && wp.owned()) {
          if (layer?.isInside?.(wp.area, pos[0], pos[2])) { factor = 0; d2 = 0; }
          else { factor = 1; d2 -= (layer?.sideRadius?.(wp.area, bot.team) ?? 0) ** 2; }
        }
        t.moveTo = { src, kind: wp.kind ?? 'WPMoveTo', area, dist: r2(dist), radius: r2(wp.radius), pathRadius: r2(pathR),
                     Rr: r2(Rr), arrived, factor, q: r4(d2 / (4 * Rr * Rr)),
                     shaped: r4(arrived ? 0 : Math.min(1, Math.max(0.1, d2 / (4 * Rr * Rr)))) };
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
                     behaviourSeconds: Object.fromEntries(Object.entries(s.behaviourSeconds).map(([k, v]) => [k, r2(v)])),
                     errors: s.errors ?? 0, errorMessages: s.errorMessages ? [...s.errorMessages] : [] };
    }
    const captureEvents = this.events.filter(e => e.type === 'capture');
    for (const e of captureEvents) captures[e.to] = (captures[e.to] ?? 0) + 1;
    const first = captureEvents[0] ?? null;
    const totalDeaths = deaths[1] + deaths[2];
    const mounts = this.events.filter(e => e.type === 'mount');
    const wrecked = this.events.filter(e => e.type === 'vehicle_destroyed');
    const vehicleKills = { total: wrecked.length, 1: 0, 2: 0, unattributed: 0, byTemplate: {} };
    for (const e of wrecked) {
      if (e.killerSide === 1 || e.killerSide === 2) vehicleKills[e.killerSide]++;
      else vehicleKills.unattributed++;
      vehicleKills.byTemplate[e.template] = (vehicleKills.byTemplate[e.template] ?? 0) + 1;
    }
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
          vehicles: this.vehicleCount(),
          mountedShare: aliveSeconds > 0 ? r4(mountedSeconds / aliveSeconds) : 0,
          mountedBotSeconds: r2(mountedSeconds), aliveBotSeconds: r2(aliveSeconds),
          mounts: mounts.length, mountsByTemplate: byTemplate,
          destroyed: wrecked.length,
        },
        // Hulls destroyed, by the side of the lethal hit's attacker (the page's
        // `killedBy`; a crash or a burn-down has none: unattributed).
        vehicleKills,
        vehicleFire: this.vehicleFire ?? null,
        routeFailures: { total: routeFailures, perBot: Object.fromEntries([...this.stats].map(([id, s]) => [id, s.routeFailures])) },
        redeploys: this.events.filter(e => e.type === 'redeploy').length,
        strategyChanges: this.events.filter(e => e.type === 'strategy').length,
        botErrors: [...this.stats.values()].reduce((a, s) => a + (s.errors ?? 0), 0),
        behaviourShare,
      },
      perBot,
      trace: { lines: this.lines, sha256: this.hash.copy().digest('hex') },
      level_info: this.level.info,
      runtime: { wallMs: Math.round(runtimeMs), navMs: this.navMs },
      doctrine: this.doctrineSummary(captureEvents),
    };
  }

  /**
   * The doctrine comparison's per-side numbers (sim/compare.mjs): which
   * doctrine each side ran, what it counted, each side's first capture and
   * the control points it held on average. In summary.json only: the trace's
   * summary line leaves it out, so a baseline trace is unchanged.
   */
  doctrineSummary(captureEvents) {
    const firstCapture = { 1: null, 2: null };
    for (const e of captureEvents) if (firstCapture[e.to] === null) firstCapture[e.to] = e.t;
    const held = { 0: 0, 1: 0, 2: 0 };
    for (const smp of this.samples) for (const k of [0, 1, 2]) held[k] += smp.flags[k];
    const n = this.samples.length || 1;
    return {
      sides: { ...this.doctrine },
      firstCapture,
      flagsHeldMean: { 0: r4(held[0] / n), 1: r4(held[1] / n), 2: r4(held[2] / n) },
      controlPoints: this.controlPoints.length,
      stats: this.strategy?.stats?.() ?? null,
    };
  }
}
