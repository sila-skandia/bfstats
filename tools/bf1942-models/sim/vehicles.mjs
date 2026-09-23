// Land vehicles in the headless match: a STAND-IN, not the page's vehicles.
//
// The page seats a bot through `botEnterVehicle` (map.html): a real
// `VehicleOccupancy` over the vehicle's glb node, the drivetrain
// `occ.ensureDrive` builds from the node's physics extras (ground.js /
// tracked vehicles), the body world, and `guns.collect` for the FireArms
// groups. None of that is loaded headless (it needs the vehicle's glb node
// with its rig, and the page's gun and body machinery). What the sim keeps
// is everything the BOT sees of a vehicle, which is what the runner is for:
//
//  * the Change candidates in the page's own shape (`botVehicleCandidates`):
//    every seat of every land vehicle the level spawns with AI data
//    (`vehicle-ai.json`), its strengths, value, maxSpeed, the seat list for
//    the shares, the driver, the door; rebuilt every 0.5 s as the page does;
//  * the mount and the dismount as `botEnterVehicle` / `botLeaveVehicle` do
//    them to the bot (`bot.mount(...)`, `world.setPlayerVehicle(...)`,
//    `bot.dismount(...)`, the soldier placed 3.5 m to the hull's side);
//  * the enemy tables' occupied units and a target's unit info.
//
// SIM INVENTIONS, all here and all named SIM_*:
//  * `SimDrive` is a kinematic hull: throttle to a speed at `SIM_ACCEL`, the
//    yaw channel to a turn rate (a tracked hull pivots, a wheeled one turns
//    on `speed / turnRadius`), ground height from the collider, and a cell
//    the vehicle map blocks stops it dead. It is driven by the bot's own
//    input word through `World`'s occupied-vehicle tick, like the page's.
//  * `SimTurret`: the look pair turns the turret (3 deg a count in yaw, 1
//    deg in pitch, the soldier's `soldierLookDegrees` gains) with no limits.
//  * doors at 2.5 m either side of the hull; hull hit points and what a
//    round does to a hull (`SIM_HULL`); a gun's rate and damage by its
//    `burst` flag (`SIM_GUN`), hitscan from the turret like a hand weapon's.

export const SIM_ACCEL = 4.0;           // m/s^2
export const SIM_PIVOT_RATE = 0.7;      // rad/s, a tracked hull on the spot
export const SIM_MIN_TURN_SPEED = 2.0;  // m/s, the least speed a wheeled hull turns on
export const SIM_DOOR_OFFSET = 2.5;     // m
export const SIM_DOOR_RADIUS = 3.0;     // m
export const SIM_EXIT_OFFSET = 3.5;     // m, `botLeaveVehicle`'s
export const SIM_HULL = {
  hitPoints: { HeavyArmour: 400, LightArmour: 100 },
  smallArmsFactor: { HeavyArmour: 0.02, LightArmour: 0.3 },
  shellFactor: { HeavyArmour: 0.5, LightArmour: 1.0 },
};
export const SIM_GUN = {
  shell: { roundsPerSecond: 0.25, damage: 100 },
  mg: { roundsPerSecond: 8, damage: 15 },
};

function quatFromForward(fx, fz) {
  // A yaw-only quaternion whose q * (0, 0, -1) is (fx, 0, fz).
  const phi = Math.atan2(-fx, -fz);
  return { x: 0, y: Math.sin(phi / 2), z: 0, w: Math.cos(phi / 2) };
}

/** The kinematic hull (SIM). `yaw` is the bot's convention: forward is
 *  `(sin yaw, cos yaw)` on x/z. */
export class SimDrive {
  constructor({ position, yaw, maxSpeed, turnRadius, tracked, groundAt, blocked }) {
    this.maxSpeed = maxSpeed > 0 ? maxSpeed : 10;
    this.turnRadius = turnRadius > 0 ? turnRadius : 5;
    this.tracked = tracked;
    this.groundAt = groundAt;
    this.blocked = blocked;
    this.yaw = yaw;
    this.speed = 0;
    this.inputs = {};
    this.grounded = true;
    this.state = {
      position: { x: position[0], y: position[1], z: position[2] },
      velocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      orientation: quatFromForward(Math.sin(yaw), Math.cos(yaw)),
      throttle: 0,
    };
  }

  setInput(name, value) { this.inputs[name] = value; }
  input(name) { return this.inputs[name] ?? 0; }

  stop() {
    this.speed = 0;
    this.inputs = {};
    const s = this.state;
    s.velocity.x = s.velocity.y = s.velocity.z = 0;
    s.angularVelocity.y = 0;
  }

  integrate(dt) {
    const t = Math.max(-1, Math.min(1, this.input('c_PIThrottle')));
    const steer = Math.max(-1, Math.min(1, this.input('c_PIYaw')));
    const want = t >= 0 ? t * this.maxSpeed : t * 0.5 * this.maxSpeed;
    const step = SIM_ACCEL * dt * (Math.sign(want - this.speed) !== Math.sign(this.speed) && this.speed !== 0 ? 2 : 1);
    if (Math.abs(want - this.speed) <= step) this.speed = want;
    else this.speed += Math.sign(want - this.speed) * step;
    // A positive `c_PIYaw` turns the hull toward -yaw (bot.js VEHICLE_YAW_SIGN).
    // A wheeled hull turns on `speed / turnRadius`, taken at no less than
    // `SIM_MIN_TURN_SPEED` so a car nosed into a wall is not locked there.
    const rate = this.tracked ? SIM_PIVOT_RATE
      : Math.min(SIM_PIVOT_RATE, Math.max(Math.abs(this.speed), SIM_MIN_TURN_SPEED) / this.turnRadius);
    const yawRate = -steer * rate * (this.speed < 0 ? -1 : 1);
    this.yaw += yawRate * dt;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const s = this.state;
    const nx = s.position.x + fx * this.speed * dt;
    const nz = s.position.z + fz * this.speed * dt;
    // A blocked cell of the vehicle map is a wall: slide along it on one
    // axis when that is free, else stop.
    if (!this.blocked?.(nx, nz)) {
      s.position.x = nx; s.position.z = nz;
    } else if (!this.blocked(nx, s.position.z)) {
      s.position.x = nx; this.speed *= 0.5;
    } else if (!this.blocked(s.position.x, nz)) {
      s.position.z = nz; this.speed *= 0.5;
    } else {
      this.speed = 0;
    }
    const gy = this.groundAt?.(s.position.x, s.position.z);
    if (Number.isFinite(gy)) s.position.y = gy;
    s.velocity.x = fx * this.speed; s.velocity.y = 0; s.velocity.z = fz * this.speed;
    s.angularVelocity.y = yawRate;
    s.orientation = quatFromForward(fx, fz);
    s.throttle = t;
  }
}

/** The look pair turns the turret (SIM). */
export class SimTurret {
  constructor() { this.heading = 0; this.elevation = 0; this.inputScale = 1; }
  aim(lookX, lookY) {
    this.heading += -(lookX * 3) * Math.PI / 180 * this.inputScale;
    this.heading = Math.atan2(Math.sin(this.heading), Math.cos(this.heading));
    this.elevation += -(lookY * 1) * Math.PI / 180 * this.inputScale;
    this.elevation = Math.max(-0.35, Math.min(0.35, this.elevation));
  }
  step() {}
  headingRadians() { return this.heading; }
  elevationRadians() { return this.elevation; }
  yawLimitsRadians() { return null; }
}

/** One parked or driven land vehicle. */
class SimHull {
  constructor(id, spawn, ai, { groundAt, blocked, Armor, now }) {
    this.id = id;
    this.spawn = spawn;
    this.ai = ai;
    this.template = ai.name ?? ai.aiTemplate ?? spawn.vehicle;
    this.kind = ai.strType === 'HeavyArmour' ? 'tank' : 'ground';
    this.strType = ai.strType ?? 'LightArmour';
    this.rootId = this.template;
    this.spawnedAt = now;
    this.destroyed = false;
    this.respawnAt = null;
    // Engine yaw in degrees, forward (sin, cos) on the engine's x/z; the
    // exporter negates z, so the viewer's forward is (sin, -cos).
    const deg = (spawn.rotation?.[0] ?? 0) * Math.PI / 180;
    const yaw = Math.atan2(Math.sin(deg), -Math.cos(deg));
    this.drive = new SimDrive({
      position: spawn.position, yaw, maxSpeed: ai.maxSpeed ?? 10, turnRadius: ai.turnRadius ?? 5,
      tracked: this.kind === 'tank', groundAt, blocked,
    });
    this.armor = new Armor(SIM_HULL.hitPoints[this.strType] ?? 100);
    this.node = { name: this.template, userData: { control: this.template }, matrixWorld: { elements: new Float64Array(16) } };
    this.seatHolders = new Map();
    this.turret = Object.keys(ai.aiWeapons ?? {}).length ? new SimTurret() : null;
    this._syncNode();
  }

  get position() { return this.drive.state.position; }

  _syncNode() {
    const e = this.node.matrixWorld.elements;
    const fx = Math.sin(this.drive.yaw), fz = Math.cos(this.drive.yaw);
    // Column-major; the -z column is the forward (bot.js `_vehicleForward`).
    e.fill(0);
    e[0] = -fz; e[2] = fx;           // x column (right)
    e[5] = 1;                        // y column
    e[8] = -fx; e[10] = -fz;         // z column: -forward
    e[12] = this.position.x; e[13] = this.position.y; e[14] = this.position.z; e[15] = 1;
  }

  /** The seats: the root (the driver) first, then the secondary seats. */
  seatIds() {
    const seats = Object.entries(this.ai.seatsAi ?? {});
    if (!seats.length) return [this.rootId];
    const root = seats.find(([, s]) => !s.secondary)?.[0] ?? this.rootId;
    this.rootId = root;
    return [root, ...seats.filter(([id]) => id !== root).map(([id]) => id)];
  }

  driver() { return this.seatHolders.get(this.rootId) ?? null; }
}

/** The land vehicles of a level and the page's bot-side vehicle functions. */
export class SimVehicles {
  constructor({ M, level, world, groundAt, events, clock }) {
    this.M = M;
    this.level = level;
    this.world = world;
    this.groundAt = groundAt;
    this.events = events;
    this.clock = clock;
    this.hulls = [];
    this.nav = null;
    this._cache = { at: -Infinity, list: [] };
    const spawns = level.extras?.objectSpawns ?? [];
    let n = 0;
    for (const spawn of spawns) {
      const ai = level.vehicleAi?.(spawn.vehicle);
      if (!ai || ai.class !== 'Land' || !spawn.position) continue;
      const hull = new SimHull(`v${n++}`, spawn, { ...ai, name: ai.name ?? ai.aiTemplate ?? spawn.vehicle }, {
        groundAt, blocked: (x, z) => this._blocked(x, z), Armor: M.Armor, now: clock(),
      });
      this.hulls.push(hull);
    }
  }

  get count() { return this.hulls.length; }

  /** The land vehicles' map (`botVehicleNav`): the level's `Tank*` search map. */
  vehicleNav() {
    if (this.nav || !this.world) return this.nav;
    const extras = this.level.extras;
    const sm = (extras?.ai?.searchMaps ?? []).find(m => /^Tank/i.test(m.name)) ?? null;
    const seeds = [];
    for (const spawn of extras?.objectSpawns ?? []) if (spawn?.position) seeds.push([spawn.position[0], spawn.position[2]]);
    for (const flag of this.world.flags ?? []) for (const s of flag.spawns ?? []) if (s?.position) seeds.push([s.position[0], s.position[2]]);
    this.nav = this.M.buildNavMap(this.world.collider, extras?.worldSize || 2048, {
      waterLevel: this.world.collider?.waterLevel,
      waterDepth: sm?.waterDepth ?? 0.0, maxSlopeDeg: sm?.maxSlope ?? 30, brush: sm?.brush ?? 3.0,
      lowClip: sm?.lowClip ?? 0.3, hiClip: sm?.hiClip ?? 2.5, seeds,
    });
    return this.nav;
  }

  _blocked(x, z) {
    const nav = this.nav;
    if (!nav) return false;
    return this.M.gridAt(nav, x, z) !== this.M.CELL_FREE;
  }

  hullOf(vehicleId) { return this.hulls.find(h => h.id === vehicleId) ?? null; }

  /** `botVehicleCandidates`: every seat of every live hull, rebuilt twice a second. */
  candidates() {
    const now = this.clock();
    if (now - this._cache.at < 0.5) return this._cache.list;
    const list = [];
    for (const h of this.hulls) {
      if (h.destroyed) continue;
      const ai = h.ai;
      const p = h.position;
      const fx = Math.sin(h.drive.yaw), fz = Math.cos(h.drive.yaw);
      const driver = h.driver();
      const health = h.armor.maxHitPoints > 0 ? h.armor.hitPoints / h.armor.maxHitPoints : 1;
      const hullYaw = Math.atan2(-h.node.matrixWorld.elements[8], -h.node.matrixWorld.elements[10]);
      const seats = [];
      const entries = [];
      h.seatIds().forEach((seatId, i) => {
        const isRoot = seatId === h.rootId;
        const seatAi = ai.seatsAi?.[seatId] ?? (isRoot ? ai.seatsAi?.[ai.name] : null) ?? null;
        const weapons = Object.entries(seatAi?.aiWeapons ?? (isRoot ? ai.aiWeapons : {}) ?? {}).map(([name, w]) => ({ ...w, name }));
        const strengths = {};
        for (const w of weapons) for (const [k, v] of Object.entries(w.strength ?? {})) strengths[k] = Math.max(strengths[k] ?? 0, v ?? 0);
        const drives = isRoot;
        const seatFactor = 1;
        const holder = h.seatHolders.get(seatId) ?? null;
        const side = isRoot ? -1 : 1;
        // SIM: the doors, 2.5 m left (driver) and right (other seats) of the
        // hull; right is the forward turned a quarter to (fz, -fx).
        const entry = [p.x + side * fz * SIM_DOOR_OFFSET, p.z - side * fx * SIM_DOOR_OFFSET];
        seats.push({ seatId, table: strengths, occupied: !!holder, strType: h.strType, isRoot });
        entries.push({
          id: `${h.id}:${seatId}`, vehicleId: h.id, node: h.node, template: h.template, kind: h.kind,
          seatId, isRoot, drives, seats, turnRadius: ai.turnRadius ?? null,
          pos: [p.x, p.y, p.z], entry, entryRadius: SIM_DOOR_RADIUS, health, upright: true,
          maxSpeed: drives ? (ai.maxSpeed ?? 0) : (driver ? (ai.maxSpeed ?? 0) : 0),
          movedByBot: !drives && !!driver,
          strengths, weapons,
          value: ((seatAi?.strategicStrength ?? ai.strategicStrength)?.['0'] ?? 0) * seatFactor,
          seatFactor, occupiedBy: holder, strType: h.strType, driver, hullYaw, yawLimits: null,
          spawnAge: now - h.spawnedAt,
        });
        void i;
      });
      list.push(...entries);
    }
    this._cache = { at: now, list };
    return list;
  }

  invalidate() { this._cache.at = -Infinity; }

  /** `botEnterVehicle`. */
  enter(bot, cand) {
    const h = this.hullOf(cand.vehicleId);
    if (!h || h.destroyed || h.seatHolders.get(cand.seatId)) return false;
    const drive = cand.drives ? h.drive : null;
    if (drive) this.vehicleNav();
    const occupancy = {
      root: h.node, activeSeatId: cand.seatId, rootKind: h.kind,
      turret: cand.isRoot ? h.turret : null,
      isActiveRoot: () => !!drive,
      applyTurrets() {},
      activeFireArmsNodes: () => [],
    };
    this.world.setPlayerVehicle(bot.playerId, { occupancy, vehicle: drive, kind: h.kind, groups: [], manned: [] });
    const record = this.world.player(bot.playerId);
    if (record) record.vehicleStrType = cand.strType;
    h.seatHolders.set(cand.seatId, bot.playerId);
    bot.mount({
      id: cand.id, vehicleId: h.id, node: h.node, drive, occupancy, kind: h.kind,
      seatId: cand.seatId, drives: !!drive, groups: [], manned: [],
      nav: drive ? this.nav : null,
      turnRadius: h.ai.turnRadius ?? null, strType: cand.strType, seats: cand.seats, isRoot: cand.isRoot,
      hullVelocity: () => (h.driver() ? h.drive.state.velocity : null),
      radius: 3.0, maxSpeed: cand.maxSpeed, weapons: cand.weapons, template: h.template,
      hullMaxSpeed: h.ai.maxSpeed ?? 0,
      driverOf: () => h.driver(),
    }, this.clock());
    this.invalidate();
    this.events.push({ type: 'mount', bot: bot.playerId, side: bot.team, vehicle: h.id, template: h.template,
                       seat: cand.seatId, driver: !!drive });
    return true;
  }

  /** `botLeaveVehicle`. */
  leave(bot, { killed = false } = {}) {
    const m = bot.vehicle;
    if (!m) return;
    const h = this.hullOf(m.vehicleId);
    if (h) {
      if (m.drive) m.drive.stop();
      h.seatHolders.delete(m.seatId);
    }
    this.world.clearPlayerVehicle(bot.playerId);
    const record = this.world.player(bot.playerId);
    if (record) { record.vehicleStrType = null; record.position = null; }
    const p = h ? h.position : { x: bot.position[0], y: bot.position[1], z: bot.position[2] };
    const soldier = record?.soldier;
    if (soldier) {
      const f = bot._vehicleForward();
      const x = p.x + f[1] * SIM_EXIT_OFFSET, z = p.z - f[0] * SIM_EXIT_OFFSET;
      const gy = this.groundAt(x, z);
      const y = Number.isFinite(gy) ? gy + 0.05 : p.y;
      soldier.spawn(x, y, z, Math.atan2(f[0], f[1]));
      bot.setPosition(x, y, z);
    }
    bot.dismount(this.clock());
    this.invalidate();
    this.events.push({ type: 'dismount', bot: bot.playerId, side: bot.team, vehicle: h?.id ?? null,
                       template: h?.template ?? null, killed });
  }

  /** Per tick, before the bots: riders and the soldier records follow the
   *  hulls; destroyed hulls respawn after their spawner's delay. */
  tick() {
    const now = this.clock();
    for (const h of this.hulls) {
      h._syncNode();
      if (h.destroyed && h.respawnAt !== null && now >= h.respawnAt) {
        h.destroyed = false;
        h.respawnAt = null;
        h.armor = new this.M.Armor(SIM_HULL.hitPoints[h.strType] ?? 100);
        const deg = (h.spawn.rotation?.[0] ?? 0) * Math.PI / 180;
        h.drive = new SimDrive({
          position: h.spawn.position, yaw: Math.atan2(Math.sin(deg), -Math.cos(deg)),
          maxSpeed: h.ai.maxSpeed ?? 10, turnRadius: h.ai.turnRadius ?? 5, tracked: h.kind === 'tank',
          groundAt: this.groundAt, blocked: (x, z) => this._blocked(x, z),
        });
        h.spawnedAt = now;
        h._syncNode();
        this.invalidate();
        this.events.push({ type: 'vehicle_respawn', vehicle: h.id, template: h.template });
      }
      if (h.destroyed) continue;
      for (const [, pid] of h.seatHolders) {
        const record = this.world.player(pid);
        if (!record) continue;
        const p = h.position;
        record.position = [p.x, p.y, p.z];
        // SIM: the seated soldier record rides at the hull, so a round aimed
        // at the hull finds the crew's record and bills the hull.
        const body = record.soldier?.body?.position;
        if (body) { body.x = p.x; body.y = p.y; body.z = p.z; }
      }
    }
  }

  /** A round's damage landing on a mounted bot's hull. Returns true when the
   *  hull was billed. */
  damageHull(bot, damage, shell = false) {
    const h = bot.vehicle ? this.hullOf(bot.vehicle.vehicleId) : null;
    if (!h || h.destroyed) return false;
    const f = (shell ? SIM_HULL.shellFactor : SIM_HULL.smallArmsFactor)[h.strType] ?? 1;
    h.armor.damage(damage * f);
    return true;
  }

  /** The hulls destroyed this tick: their crews to kill, the hull to respawn. */
  collectDestroyed() {
    const out = [];
    for (const h of this.hulls) {
      if (h.destroyed || !h.armor.destroyed) continue;
      h.destroyed = true;
      const lo = h.spawn.minSpawnDelay ?? 30, hi = h.spawn.maxSpawnDelay ?? lo;
      h.respawnAt = this.clock() + lo + Math.random() * Math.max(0, hi - lo);
      out.push({ hull: h, crew: [...h.seatHolders.values()] });
      this.events.push({ type: 'vehicle_destroyed', vehicle: h.id, template: h.template });
    }
    return out;
  }

  /** `botOccupiedUnits`' seated half and `botUnitInfo`'s vehicle half. */
  seatOf(playerId) {
    for (const h of this.hulls) for (const [seatId, pid] of h.seatHolders) if (pid === playerId) return { hull: h, seatId };
    return null;
  }

  unitInfo(playerId) {
    const s = this.seatOf(playerId);
    if (!s) return null;
    const cands = this.candidates().filter(c => c.vehicleId === s.hull.id);
    const c = cands.find(x => x.seatId === s.seatId) ?? cands[0] ?? null;
    return {
      type: s.hull.strType, air: false, table: c?.strengths ?? {}, maxSpeed: s.hull.ai.maxSpeed ?? 0,
      seats: c?.seats ?? [], enemyManned: true, mobile: true, vehicle: true, large: false, extents: [3, 2.5, 6],
    };
  }
}
