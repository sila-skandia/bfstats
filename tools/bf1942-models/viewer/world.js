// The headless simulation world the netcode round steps: N soldiers, the
// vehicle bodies, the guns, the combat area, the supply depots, the tickets
// and the collider, advanced at the engine's fixed 30 Hz from one buffered
// input per player per tick.
//
// This is the simulation core of map.html's `frame()`: the page builds it
// from the level data it already loads (extras, damage tables, the collider,
// the parked vehicles), feeds it the local player's input, calls `step(dt)`
// once per display frame and keeps everything presentational — the camera,
// the HUD, the audio, the deploy screen, the effects and the scene graphs.
// Nothing in this file renders, plays a sound or touches the DOM, so the
// whole class runs headless under node (`tests/test_world.py` drives it with
// scripted input). "the same World code" is the point: the browser page's
// single local player goes through exactly the per-player path a future
// server feeds for every remote one (features/netcode-play-multiplayer/
// README.md, P1).
//
// THE TICK LAW (the decision this file pins):
//
//   * The world steps at ENGINE_TICK_RATE = 30 Hz, dt = 1/30 exactly (the
//     engine's own tick, physics.js -- the dedicated server's
//     `g_simulationFps = 30` and the netcode loop's fixed tick, LOOP-1).
//   * Each world tick consumes EXACTLY ONE buffered input per player ("one
//     buffered PlayerInput per tick per player" -- the engine's `Setup:
//     dispatchPlayerInput`; `simulatePlayerUpdate` 0x0815bd00 consumes one
//     and emits a ZEROED PlayerInput for a tick with no packet, never the
//     last one). The buffer trims to FOUR, dropping the oldest (the server's
//     `clearPlayerActions` 0x0815bb90), and a drained buffer's tick yields
//     the engine's idle word. The page's own per-player stage stays at 0-1
//     entries -- `setInput` without a sequence replaces the un-consumed
//     entry (freshest device state), so the display-rate feed never binds
//     the cap. That un-sequenced word is the frame's DEVICE STATE, not a
//     packet: a frame longer than one tick runs every one of its ticks
//     against it, which is the client's own law (`InputManager::update`
//     0x0049cff7 samples the devices once for `nTicks`, and mouse-input.js
//     divides the counts by `nTicks / 30` on the promise that each tick
//     applies the axis). It is held for that one `step()` only; a step the
//     page fed nothing for idles. Every channel of the word is a level --
//     the one edge it implies, the jump press, is derived by soldier.js from
//     the level -- so there is nothing in it to consume once. Sequenced packets (the future wire) append instead and dedupe
//     on `seq > lastSeen`, the receive rule (`processRcvdPlayerActions`
//     0x08148470). A backlog beyond the sim's tolerance collapses: the
//     world's clock is a FixedStep capped at MAX_CATCH_UP_TICKS, the same
//     catch-up cap the soldier physics uses (the page's old look accumulator
//     carried the same collapse -- GameClient::update 0x0048fca8, both
//     binaries -- and is now a single clock, see `lookTicks`).
//   * The tick is the SIM's cadence, never the PAGE's. `step()` reports the
//     clock's `alpha` — how far the frame has carried past the last tick —
//     and fires `onTick` at the end of every tick it runs, so the page can
//     keep the previous tick's pose beside the current one and draw between
//     them. Nothing presentational may reach back the other way: the hook is
//     called with no arguments and its return value is ignored, so a page
//     that does not register one is bit-identical to one that does.
//   * On foot, the soldier runs its own 60 Hz FixedStep inside the world
//     tick (soldier.js): a 1/30 world tick is exactly two 1/60 body ticks
//     with the same input, and tests/test_soldier.py has already pinned that
//     the body's trajectory is frame-rate independent (23.7/30/60/144 fps).
//     The single local player maps onto the 30 Hz step by feeding setInput
//     every display frame; at 60 fps the world ticks every other frame, with
//     the page's look pump (mouse-input.js) once per frame -- the axis is a
//     rate, so the per-tick application is the engine's own law (GUN-2b).
//
// Composition, not physics: every constant and formula used here is imported
// from the module that owns it. No constant or formula is restated, scaled or
// "improved"; the only numbers peculiar to this file are the tick rate above
// and the axis smoothing spring (`STICK_RATE`/`STICK_RETURN`), both moved
// verbatim from map.html where the aircraft path already owned them.

import {
  FixedStep, ENGINE_TICK_RATE, MAX_CATCH_UP_TICKS,
} from './physics.js';
import { Soldier, spawnFlags, pickSpawn, spawnYaw } from './soldier.js';
import { fallDamageFor } from './fall-damage.js';
import { soldierLookDegrees } from './mouse-input.js';
import { BodyWorld, touchesWater } from './body-world.js';
import { buildParkedVehicle, collisionPartsFor, DrivenBody, quaternionFromAxes } from './vehicle-bodies.js';
import { CombatArea } from './combat-area.js';
import { SupplyField } from './supply.js';
import { VehicleDamageSet, inputGate } from './vehicle-damage.js';
import { FireState } from './seats.js';

/** The world's tick: the engine's own 30 Hz (physics.js, LOOP-1). */
export const WORLD_TICK_RATE = ENGINE_TICK_RATE;
export const WORLD_TICK_DT = 1 / WORLD_TICK_RATE;

const DEG_TO_RAD = Math.PI / 180;

/**
 * Stick spring rates, moved verbatim from map.html (before this file owned
 * the aircraft drivetrain's input shaping): full deflection in ~0.4 s, and
 * back to centre a little faster.
 */
export const STICK_RATE = 2.4;
export const STICK_RETURN = 3.2;

/**
 * Move an axis toward a held key's demand, and spring it back when released.
 * A digital key on an analogue surface needs this or every input is a slam.
 * The page's aircraft path applied this per frame at the display rate; the
 * world applies the same law per 30 Hz tick with the world's own dt, which
 * is the engine's arrangement (the server shaped the stick at its tick).
 */
function axisToward(current, demand, dt) {
  const rate = (demand === 0 ? STICK_RETURN : STICK_RATE) * dt;
  const gap = demand - current;
  return Math.abs(gap) <= rate ? demand : current + Math.sign(gap) * rate;
}

/** A player's idle input: no queue entry yet, or a silent tick. */
const IDLE_INPUT = Object.freeze({
  forward: 0, strafe: 0, forwardKeys: 0, rudder: 0,
  walk: false, crouch: false, prone: false,
  jump: false, fire: false, altFire: false, roll: 0, pitch: 0, pad: false,
  deploy: false, dead: false,
});

/**
 * The engine's "no packet this tick" word: every channel zeroed. `simulate-
 * PlayerUpdate` 0x0815bd00 consumes one buffered input per tick and delivers
 * a fresh empty PlayerInput for a tick with no packet -- it never replays the
 * last one. `lookX/lookY` are zeroed with it (`c_PIMouseLookX/Y` are channels
 * like any other), so a tick the page had nothing to say about turns nobody.
 */
const ENGINE_IDLE = Object.freeze({
  input: IDLE_INPUT,
  lookX: 0,
  lookY: 0,
  idle: true,
});

/** A full player input is the engine's own word, named by its actions. */
function shapeInput(input) {
  const i = input || IDLE_INPUT;
  const clamp11 = v => Math.max(-1, Math.min(1, v));
  return {
    forward: clamp11(i.forward ?? 0),
    strafe: clamp11(i.strafe ?? 0),
    // The raw W/S and A/D pairs: the aircraft's throttle latch and rudder
    // spring take the keys alone — the pad's Y is the stick's pitch and its
    // X is roll, so folding the pad in would be double-paying it. Ground
    // vehicles and the on-foot body use `forward`/`strafe`, pad included,
    // exactly as the page always split them.
    forwardKeys: clamp11(i.forwardKeys ?? 0),
    rudder: clamp11(i.rudder ?? 0),
    walk: !!i.walk,
    crouch: !!i.crouch,
    prone: !!i.prone,
    jump: !!i.jump,
    // `c_PIMenuSelect9` on a falling soldier: the ripcord. The engine gives
    // item slot 9 a second job through TemplateMessage 18
    // (`BFSoldier::handleMessage` lnxded 0x0827728b) and `parachute.js`
    // carries the rest; `dead` is what stops a corpse pulling it.
    deploy: !!i.deploy,
    dead: !!i.dead,
    // The vehicle triggers: the same c_PIFire/c_PIAltFire the engine's
    // PlayerInput carries. The page folds Space and its seatFire/seatAltFire
    // latches into these before setInput.
    fire: !!i.fire,
    altFire: !!i.altFire,
    // The aircraft stick axes (c_PIRoll/c_PIPitch), arrows on the page and a
    // touch pad's deflection on mobile. `pad` is the page's mobile override:
    // the pad feeds the stick directly, bypassing the spring, which is what
    // the page always did for it.
    roll: clamp11(i.roll ?? 0),
    pitch: clamp11(i.pitch ?? 0),
    pad: !!i.pad,
  };
}

/**
 * The headless world. Construction is cheap and takes only what the page has
 * already loaded at that point; the level's build sequence fills the rest in
 * (`setCollider`, `addDamageable` per parked object, `setupBodies`).
 */
export class World {
  constructor({
    collider = null,
    extras = {},
    damageTables = null,
    guns = null,
    groundHeight = null,
    fireStates = null,
    onCrash = null,
    isWrecked = null,
    onTick = null,
  } = {}) {
    this.collider = collider;
    this.extras = extras;
    this.damageTables = damageTables;
    this.guns = guns;
    /** A float callback for pickSpawn (which needs to skip a spawn hovering
     *  above the ground); the page passes the same groundHeight it already
     *  owns, otherwise the collider's own surface height answers. */
    this.groundHeight = groundHeight || ((x, z) => {
      const h = collider?.surfaceHeight ? collider.surfaceHeight(x, z) : NaN;
      return Number.isFinite(h) ? h : NaN;
    });
    /** Called after a body-world crash has cost `owner` hit points; the page
     *  plays the effect library there. */
    this.onCrash = onCrash;
    /** The world's water pass must skip wrecks the page has faded out of the
     *  scene; the page passes `owner => visual.wrecked || visual.removed`. */
    this.isWrecked = isWrecked || (() => false);
    /** Called at the END of every tick this world runs, after the bodies and
     *  the damage pass — i.e. with every piece of tick state final. The page
     *  registers its pose snapshot here (map.html's render interpolation): a
     *  tick boundary is the only place the previous and the current tick pose
     *  can be told apart, and a frame that runs several ticks needs the hook
     *  per tick or its "previous" is N ticks old. Presentation only; the
     *  simulation neither passes it anything nor reads anything back. */
    this.onTick = onTick;

    /** The level's flags, the engine's join of control points to spawn
     *  groups (soldier.js). The page's deploy screen reads this. */
    this.flags = spawnFlags(extras);
    /** The level's initial tickets, held raw. P3 owns the bleed; owning the
     *  table here is what lets that land without a page change. */
    this.tickets = extras?.tickets ?? null;

    this.combatArea = new CombatArea(extras);
    this.supplyField = new SupplyField();
    this.vehicleDamage = new VehicleDamageSet();
    this.bodyWorld = null;
    this.nodeOwners = new WeakMap();
    /** owner -> [x, y, z] for the water pass: the registration pose for
     *  static furniture, refreshed from the body world after each body tick. */
    this.positions = new Map();
    /** The shared FireState table: the page's HUD reads the same instances. */
    this.fireStates = fireStates || new WeakMap();

    /** One buffered input per player per tick (LOOP-1); see the header. */
    this.clock = new FixedStep({ rate: WORLD_TICK_RATE, maxTicks: MAX_CATCH_UP_TICKS });
    this.players = new Map();
    this.report = this.#emptyReport();
  }

  // --- level bindings ------------------------------------------------------

  /** The page's collider lands after construction (buildCollider). */
  setCollider(collider) { this.collider = collider; }

  /**
   * One damageable parked object: the world's registration is the same
   * `vehicleDamage.add` the page used to own, plus the node->owner lookup and
   * a world position so the water pass needs no scene graph. Pass `position`
   * for furniture (static roots); hulls get their position refreshed from the
   * body world. Returns the DamageableVehicle, or null for a node with no
   * Armor, which is exactly what `registerDamageables`' caller wants.
   */
  addDamageable(owner, node = null, armorExtras = null, { name = null, position = null } = {}) {
    if (node) this.nodeOwners.set(node, owner);
    const vehicle = this.vehicleDamage.add(owner, armorExtras, { name });
    if (vehicle && position) this.positions.set(owner, position);
    return vehicle;
  }

  /** The level's parked hulls, once the collider has handed out owner ids.
   *  `terrain` is the body world's ground (page's `bodyTerrain` glue); the
   *  world owns the BodyWorld and the crash-damage accounting from here on. */
  setupBodies({ tables, terrain, statics = null }) {
    if (this.bodyWorld || !tables || !terrain) return;
    this.bodyWorld = new BodyWorld({
      tables,
      terrain,
      statics,
      onDamage: (owner, result, at, other) => this.#onBodyDamage(owner, result, at, other),
    });
  }

  /** One parked hull enters the body world, exactly as the page used to. */
  addParkedBody(owner, spec, pose) {
    if (!this.bodyWorld) return;
    this.bodyWorld.addParked(owner, buildParkedVehicle(spec, pose), spec);
  }

  /** The player has taken a drivable vehicle: its drive model stands in for
   *  the parked body, the way `adoptDrivenBody` used to arrange it. */
  adoptDriven(owner, vehicle, spec) {
    if (!this.bodyWorld || !vehicle) return;
    this.bodyWorld.remove(owner);
    const driven = new DrivenBody(vehicle, spec);
    this.bodyWorld.addDriven(owner, driven,
      collisionPartsFor(spec, driven, { hullOnly: true }), spec);
    // The solver now owns this hull's contacts with the static world, so the
    // drive model's own swept sphere stands down (`ground.js` `hullSolved`).
    // Only when there IS a static world to probe: without one a building is
    // still the sweep's business.
    if (this.bodyWorld.statics && 'hullSolved' in vehicle) vehicle.hullSolved = true;
  }

  /** ... and has left it: it stands on its own springs again, where it was
   *  left, trading the driven pose for a parked one at the given world pose. */
  releaseDriven(owner, vehicle, spec, pose, wheelState = null) {
    if (!this.bodyWorld || !vehicle) return;
    if (!this.bodyWorld.get(owner)?.driven) return;
    if ('hullSolved' in vehicle) vehicle.hullSolved = false;
    this.bodyWorld.remove(owner);
    const parked = buildParkedVehicle(spec, {
      ...pose,
      asleep: false,
      wheelState,
    });
    const v = vehicle.state.velocity;
    parked.body.v[0] = v.x; parked.body.v[1] = v.y; parked.body.v[2] = v.z;
    const w = vehicle.state.angularVelocity;
    for (let i = 0; i < 3; i++) {
      parked.body.w[i] = w.x * pose.axes[0][i]
        + w.y * pose.axes[1][i] + w.z * pose.axes[2][i];
    }
    this.bodyWorld.addParked(owner, parked, spec);
  }

  removeBody(owner) {
    this.bodyWorld?.remove(owner);
  }

  /** A wreck is scenery and a respawn is a fresh vehicle on its pad: either
   *  way the wrecked hull stops simulating. */
  retireBody(owner) {
    this.bodyWorld?.remove(owner);
  }

  setSupplyDepots(depots) {
    this.supplyField = new SupplyField(depots);
  }

  // --- players -------------------------------------------------------------

  /**
   * A new player: a Soldier built the engine's way and parked on the first
   * spawn the given team/flag owns, plus the per-player input queue. The
   * page passes its own team (`deployTeamId`), or a specific flag it has
   * already chosen in its deploy UI, and the group for a vehicle-borne flag.
   * Returns the player record; the page reads `soldierOf(id)` for the camera.
   */
  addPlayer(playerId, { team = null, flag = null, spawnIndex = 0, group = null } = {}) {
    const soldier = new Soldier({ collider: this.collider, worldSize: this.extras?.worldSize || 0 });
    const player = {
      id: playerId,
      team: team ?? flag?.team ?? null,
      soldier,
      armor: null,
      spawnIndex,
      flag: null,
      spawn: null,
      // occupied vehicle state, mounted by the page (setPlayerVehicle)
      occupancy: null,
      vehicle: null,
      kind: null,
      groups: [],
      manned: [],
      gate: { blocked: false, rotationalScale: 1 },
      stick: { roll: 0, pitch: 0 },
      // world position, page-fed for a bare seat (no drivetrain to hold one)
      position: null,
      supply: { team: null, refillAmmo: null },
      supplyResult: { gaveAmmo: false, healed: false },
      // the input word, engine-FIFO semantics (see the header):
      buffer: [],              // sequenced packets, appended, cap 4 drop-oldest
      pending: null,           // the page's un-sequenced freshest state (0-1)
      held: null,              // that state, for the rest of its frame's ticks
      lastSeen: -1,            // highest sequence accepted (receive dedupe)
      last: null,              // the entry the last tick consumed (or idle)
      lookApplied: { yaw: 0, pitch: 0 },
    };
    this.players.set(playerId, player);
    if (flag || team !== null) this.spawnPlayer(playerId, { flag, group });
    return player;
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
  }

  /**
   * Add a bot player to the world without spawning a soldier. Bots are
   * placed directly on spawn points and do not go through the deploy flow.
   * Returns the player record.
   */
  addBotPlayer(playerId, { team = null } = {}) {
    const player = {
      id: playerId,
      team: team ?? null,
      soldier: null,
      armor: null,
      spawnIndex: 0,
      flag: null,
      spawn: null,
      occupancy: null,
      vehicle: null,
      kind: null,
      groups: [],
      manned: [],
      gate: { blocked: false, rotationalScale: 1 },
      stick: { roll: 0, pitch: 0 },
      position: null,
      supply: { team: null, refillAmmo: null },
      supplyResult: { gaveAmmo: false, healed: false },
      buffer: [],
      pending: null,
      held: null,
      lastSeen: -1,
      last: null,
      lookApplied: { yaw: 0, pitch: 0 },
    };
    this.players.set(playerId, player);
    return player;
  }

  player(playerId) { return this.players.get(playerId) ?? null; }
  soldierOf(playerId) { return this.players.get(playerId)?.soldier ?? null; }
  armorOf(playerId) { return this.players.get(playerId)?.armor ?? null; }

  /**
   * Put the player on the next of a flag's spawn points (the page's deploy
   * screen picks the flag; `advance` walks the list), exactly as the page's
   * `spawnAtFlag` used to: pickSpawn, then the soldier's own spawn at the
   * spawn's yaw. Returns `{ flag, spawn }`, or null when the flag has no
   * spawn left to offer.
   */
  spawnPlayer(playerId, { flag = null, advance = false, group = null } = {}) {
    const player = this.players.get(playerId);
    if (!player) return null;
    const flags = this.flags;
    const pick = flag ?? (player.team === 1 || player.team === 2
      ? flags.find(f => f.team === player.team) : flags[0]);
    if (!pick && !flags.length) return null;
    const target = pick ?? flags[0];
    if (advance) player.spawnIndex++;
    const spawn = pickSpawn(target, player.spawnIndex, {
      groundAt: this.groundHeight,
      group: target.vehicle ? (group ?? player.team) : null,
      // The collider, so a point inside a model is walked past rather than
      // stood on (`spawn-safety.js`). Absent on a page with no world
      // geometry, and then the pick is the authored point as before.
      world: this.collider,
    });
    if (!spawn) return null;
    player.soldier ??= new Soldier({ collider: this.collider, worldSize: this.extras?.worldSize || 0 });
    player.soldier.collider = this.collider;
    player.soldier.spawn(
      spawn.position[0], spawn.position[1], spawn.position[2], spawnYaw(spawn));
    player.team = target.team ?? player.team;
    player.flag = target;
    player.spawn = spawn;
    return { flag: target, spawn };
  }

  /** The fresh body's Armor, page-built from the kit's own template. */
  setPlayerArmor(playerId, armor) {
    const player = this.players.get(playerId);
    if (player) player.armor = armor;
  }

  /** The supply hook and the side the depot gives to (`deployTeamId`). The
   *  world owns the target's position (the soldier's) and armor (the
   *  player's); the page owns the refill itself -- a hand weapon's reload. */
  setPlayerSupply(playerId, { team = null, refillAmmo = null } = {}) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.supply.team = team ?? player.team;
    player.supply.refillAmmo = refillAmmo;
  }

  /** World position for a seated player whose seat has no drivetrain (a bare
   *  gun root): the page feeds the node's world position once per frame, the
   *  same read its combat-area check used to make. */
  setPlayerPosition(playerId, position) {
    const player = this.players.get(playerId);
    if (player) player.position = position;
  }

  /**
   * Mount the player on a vehicle. `mount` carries what the page owns and the
   * world steps: the VehicleOccupancy, the drive model (null for a bare
   * gun/seat root), the root kind (`air`/`ground`/`gun`/`seat`/...), and the
   * two FireArms group lists (the drivetrain's own and the active seat's
   * manned guns). Re-mount whenever the seat or the group lists change.
   */
  setPlayerVehicle(playerId, mount) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.occupancy = mount.occupancy ?? null;
    player.vehicle = mount.vehicle ?? null;
    player.kind = mount.kind ?? null;
    player.groups = mount.groups ?? [];
    player.manned = mount.manned ?? [];
  }

  clearPlayerVehicle(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.occupancy = null;
    player.vehicle = null;
    player.kind = null;
    player.groups = [];
    player.manned = [];
    player.gate.blocked = false;
    player.gate.rotationalScale = 1;
  }

  /** New FireArms group lists on a seat switch (the page's collectMannedGuns). */
  refreshMount(playerId, { groups = null, manned = null } = {}) {
    const player = this.players.get(playerId);
    if (!player) return;
    if (groups) player.groups = groups;
    if (manned) player.manned = manned;
  }

  /** The stick spring resets on leaving the aircraft, as the page's did. */
  resetStick(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.stick.roll = 0;
    player.stick.pitch = 0;
  }

  // --- room server reads (P2) -----------------------------------------------

  /**
   * Every connected player's state, in the room snapshot's terms
   * (`viewer/netcode.js` encodes exactly this). The room server reads this
   * at the snapshot cadence (the engine's 20 Hz, P-2); the page reads the
   * same player records directly for its own HUD, so there is one state
   * source per side. `hp` is the owning Armor's hitPoints (null for a
   * player carrying none -- the page does not attach armor to every
   * soldier); `yaw`/`pitch` are the soldier's own facing (NaN while seated:
   * the hull owns the facing, and the vehicle record carries it).
   */
  playersSnapshot() {
    const out = [];
    for (const [id, player] of this.players) {
      const soldier = player.soldier;
      const armor = player.armor;
      const occ = player.occupancy;
      const seated = !!occ?.root;
      let x = NaN, y = NaN, z = NaN, yaw = NaN, pitch = NaN;
      if (seated && player.vehicle) {
        const s = player.vehicle.state.position;
        x = s.x; y = s.y; z = s.z;
      } else if (soldier) {
        x = soldier.x; y = soldier.y; z = soldier.z;
        yaw = soldier.yaw; pitch = soldier.pitch;
      }
      out.push({
        id,
        team: player.team,
        alive: !(armor?.destroyed ?? false),
        seated,
        crouch: soldier?.stance === 'crouch',
        prone: soldier?.stance === 'prone',
        inVehicle: seated,
        x, y, z, yaw, pitch,
        hp: armor ? Math.max(0, armor.hitPoints) : null,
        // The room maps this to its own vehicle table id; the page's deploy
        // screen maps it to the scene node the same way (`nodeOwners`).
        vehicleOwner: occ?.root ? this.nodeOwners.get(occ.root) : null,
        // The seat's position in the occupancy's own survey order, root
        // first -- the same index the client's seat table reads on its side.
        seatIndex: occ && occ.activeSeatId != null
          ? Math.max(0, occ.order.indexOf(occ.activeSeatId)) : -1,
      });
    }
    return out;
  }

  /** A registered owner's hull pose for the snapshot: the driven vehicle's
   *  integrated state, or the parked body's rest pose. Returns
   *  `{ x, y, z, q: [x, y, z, w] }` in world space, or null for an owner
   *  the world holds no hull for (a static furniture root still answers
   *  from its registration pose).
   */
  vehiclePose(owner) {
    const entry = this.bodyWorld ? this.bodyWorld.get(owner) : null;
    if (entry?.driven) {
      const s = entry.driven.vehicle.state;
      return {
        x: s.position.x, y: s.position.y, z: s.position.z,
        q: [s.orientation.x, s.orientation.y, s.orientation.z, s.orientation.w],
      };
    }
    if (entry?.parked) {
      const b = entry.parked.body;
      return { x: b.pos[0], y: b.pos[1], z: b.pos[2],
               q: quaternionFromAxes(b.axes, [0, 0, 0, 0]) };
    }
    const at = this.positions.get(owner);
    return at ? { x: at[0], y: at[1], z: at[2], q: [0, 0, 0, 1] } : null;
  }

  /** The owner ids the world holds hull or position state for: the room
   *  server's vehicle table, one entry per seatable hull it registered.
   */
  vehicles() {
    const seen = new Set();
    if (this.bodyWorld) {
      for (const owner of this.bodyWorld.entries.keys()) seen.add(owner);
    }
    for (const owner of this.positions.keys()) seen.add(owner);
    return [...seen];
  }

  /** The page's deploy screen restarts a flag's spawn cycle on a fresh
   *  choice (the old `spawnIndex = 0` resets). */
  setSpawnIndex(playerId, index) {
    const player = this.players.get(playerId);
    if (player && Number.isInteger(index)) player.spawnIndex = index;
  }

  /**
   * Buffer one tick's input, engine-FIFO semantics (see the header).
   *
   * The local device stage (the page) calls without a `seq`: the freshest
   * un-consumed input REPLACES the previous one, so a display-rate feed
   * stays at 0-1 entries and every tick consumes this frame's newest state
   * -- the page never binds the cap. `look` is the pumped axis pair from
   * mouse-input.js (`MouseInput.pump`'s output, the engine's quantised,
   * +-16-clamped c_PIMouseLookX/Y); the page has already applied the weapon
   * zoom factor, exactly where `stepSoldierLook` used to.
   *
   * A sequenced packet (a P2 remote player's wire word) APPENDS instead,
   * dedupes on `seq > lastSeen` (`processRcvdPlayerActions` 0x08148470) and
   * trims to FOUR dropping the oldest (`clearPlayerActions` 0x0815bb90).
   * Whatever arrives, exactly one entry is consumed per tick, and a tick
   * with nothing buffered delivers the engine's zeroed idle word.
   */
  setInput(playerId, input, look = null, seq = null) {
    const player = this.players.get(playerId);
    if (!player) return;
    const entry = {
      input: shapeInput(input),
      lookX: Number.isFinite(look?.x) ? look.x : 0,
      lookY: Number.isFinite(look?.y) ? look.y : 0,
    };
    if (Number.isInteger(seq)) {
      if (seq <= player.lastSeen) return;
      player.lastSeen = seq;
      player.buffer.push({ ...entry, seq });
      if (player.buffer.length > 4) player.buffer.shift();
    } else {
      player.pending = entry;
    }
  }

  /**
   * The FireState instances, keyed by FireArms node, one per node for the
   * whole page: the HUD reads ammo/heat off the same objects the world steps.
   */
  fireStateFor(node) {
    let state = this.fireStates.get(node);
    if (!state) {
      state = new FireState(node.userData?.fireArms || {});
      this.fireStates.set(node, state);
    }
    return state;
  }

  /** The DamageableVehicle the player sits in, if any (HUD, console, gate). */
  occupiedDamageable(playerId) {
    const player = this.players.get(playerId);
    if (!player?.occupancy?.root) return null;
    const owner = this.nodeOwners.get(player.occupancy.root);
    return owner === undefined ? null : this.vehicleDamage.get(owner) ?? null;
  }

  /** Re-pick a just-damaged vehicle's tier on the spot (the page's old
   *  `reconcileDamaged`). Returns the change record, or null when the vehicle
   *  is gone. A zero dt cannot advance the burn accumulator, so this only
   *  re-picks the tier.
   */
  reconcile(vehicle) {
    const result = vehicle.update(0);
    return { vehicle, changed: result.changed, tier: result.tier, died: result.died };
  }

  /** The un-throttled HUD predicates (SUP-33/34): proximity and supply state
   *  every frame, independent of the depot's own 0.5 s action cadence. */
  supplyHud(playerId) {
    const player = this.players.get(playerId);
    if (!player?.soldier) return { heal: false, rearm: false };
    const target = this.#supplyTarget(player);
    return {
      heal: this.supplyField.canHeal(target),
      rearm: this.supplyField.canRearm(target),
    };
  }

  // --- stepping ------------------------------------------------------------

  /**
   * How many whole world ticks `step(dt)` will run, WITHOUT advancing the
   * clock. This is the one tick authority per player (Fix 5): the page's
   * look pump reads their frame's count from here instead of running a
   * second 30 Hz accumulator that can drift out of phase with the world's
   * FixedStep (a profile switch used to reset the page's clock and not the
   * world's). `pumpLook(ticks)` then feeds the input, `step(dt)` runs them,
   * and both read the same count because the arithmetic below mirrors
   * `this.clock.advance` exactly (computed on a copy of its accumulator, so
   * nothing moves).
   */
  lookTicks(dt) {
    const c = this.clock;
    const frameDt = dt > 0 ? dt : 0;
    let acc = c.accumulator + frameDt;
    let n = Math.floor(acc / c.dt);
    if (n > c.maxTicks) {
      acc -= (n - c.maxTicks) * c.dt;
      n = c.maxTicks;
    }
    return n;
  }

  /**
   * One display frame's worth of simulation. `dt` is whatever the page's
   * animation loop delivers (clamped to 0.1 s as the page already does); the
   * world advances whole 30 Hz ticks from it and runs the whole simulation
   * core on each: per-player soldiers and occupied vehicles, guns, combat
   * area, vehicle bodies, vehicle damage -- in the exact order frame() used,
   * and with nothing presentational inside. Returns the step report (see
   * #emptyReport); the page consumes it for camera, HUD, effects and scene
   * sync work.
   *
   * `report.alpha` is the clock's leftover fraction of a tick AFTER this
   * frame — what a renderer must interpolate by to draw the frame's own
   * instant rather than the last tick's. It is filled in on EVERY frame,
   * including the common 60 Hz one that owes no tick at all: `clock.advance`
   * has already run and moved the alpha even when it returned 0, and a frame
   * that drew the previous frame's alpha would be drawing the sim twice.
   */
  step(dt) {
    const report = this.#emptyReport();
    this.report = report;
    report.ticks = this.clock.advance(dt);
    report.alpha = this.clock.alpha;
    if (!report.ticks) return report;
    // A held local word belongs to the step that consumed it, never the next.
    for (const player of this.players.values()) player.held = null;
    const bodyBefore = this.bodyWorld?.ticks ?? 0;
    for (let i = 0; i < report.ticks; i++) this.#tick();
    report.bodyTicks = (this.bodyWorld?.ticks ?? 0) - bodyBefore;
    return report;
  }

  /** The same fraction outside a step report — `step()` fills `report.alpha`
   *  from exactly this — for a caller that holds the world but not the
   *  report it last returned. */
  get alpha() { return this.clock.alpha; }

  #emptyReport() {
    return { ticks: 0, bodyTicks: 0, alpha: 0, players: {}, damage: [], crashes: [] };
  }

  #tick() {
    const dt = WORLD_TICK_DT;
    let combatStepped = false;
    for (const player of this.players.values()) {
      const before = { ...player.lookApplied };
      if (player.occupancy) this.#vehicleTick(player, dt);
      else this.#soldierTick(player, dt);
      if (this.#combatTick(player, dt)) combatStepped = true;
      this.#supplyTick(player, dt);
      this.report.players[player.id] = {
        gate: { ...player.gate },
        look: { yaw: player.lookApplied.yaw - before.yaw,
                pitch: player.lookApplied.pitch - before.pitch },
        combat: player.combat,
        supply: player.supplyResult,
      };
    }
    // Free fly is the one state with no engine counterpart — no player object
    // to accrue against — so the accumulator is reset rather than frozen, and
    // no player gets a combat frame, which culls the warning group. With
    // several players, the reset only fires when NONE could have stepped the
    // area this tick (a dead or unmounted player must not clear a live one).
    if (!combatStepped && this.combatArea.active) this.combatArea.reset();
    if (this.guns) this.guns.advance(dt);
    if (this.bodyWorld) this.bodyWorld.step(dt);
    this.#damageTick(dt);
    // Last, so the snapshot a renderer takes here is this tick's FINAL state:
    // after the contact solver has pushed a hull and after the damage pass,
    // not the mid-tick pose `integrate` left on the scene graph.
    this.onTick?.();
  }

  // --- the per-player steps, in frame()'s own order ------------------------

  #soldierTick(player, dt) {
    const soldier = player.soldier;
    if (!soldier) return;
    // Definitely one input this tick: the engine turns the view by the
    // per-tick axis of the entry the tick consumed (GUN-2b); the body then
    // moves along the NEW facing, which is the page's own look-then-move
    // order. `soldier.look` owns the +-38 clamp, applied per tick as the
    // engine applies it per PlayerInput. An idle tick carries a zeroed axis,
    // so a missed packet turns nobody.
    const entry = this.#consume(player);
    const x = entry.lookX;
    const y = entry.lookY;
    const per = soldierLookDegrees(x, y);
    const yaw = -per.yaw * DEG_TO_RAD;
    const pitch = -per.pitch * DEG_TO_RAD;
    if (yaw || pitch) {
      soldier.look(yaw, pitch);
      player.lookApplied.yaw += yaw;
      player.lookApplied.pitch += pitch;
    }
    const input = entry.input;
    soldier.collider = this.collider;
    soldier.step(dt, input);
    // Fall damage -- HP-14, the whole formula in fall-damage.js -- applied
    // where the page applied it: the impact speed was sampled before the
    // ground clamp put the body back on the ground.
    if (soldier.landing && player.armor) {
      const hp = fallDamageFor(soldier.landing, this.damageTables);
      if (hp > 0) player.armor.applyDamage(hp);
    }
    // Drowning, applied where `Armor::update` applies it and for the same
    // reason the fall damage is applied here: the `Armor` is the player's, not
    // the soldier's. `swim.js`'s `DrownTimer` is the engine's water-damage
    // timer (`Armor::update` `0x08172f40`), armed by `c_AsmIsSwimming` through
    // the soldier-specific clause in `setLastHitMaterialIndex` (`0x08173700`).
    // A frame runs whole ticks and the timer can fire on more than one of them,
    // so the soldier sums it and this drains the sum.
    if (player.armor) {
      const drowned = soldier.drainDrowning?.() ?? 0;
      if (drowned > 0) player.armor.applyDamage(drowned);
    }
  }

  /**
   * The occupied-vehicle path: the HP-15 gate, the drivetrain's inputs and
   * integration, the turret rig's aim and step, and both fire loops -- the
   * seat's own `mannedGuns` and the drivetrain's `vehicleGuns`. What the
   * page's pilot()/drive()/manned() used to do between the look pump and the
   * camera; the camera, the FOV and the HUD wiring stay in the page.
   */
  #vehicleTick(player, dt) {
    const occ = player.occupancy;
    const vehicle = player.vehicle;
    // HP-15: a destroyed PCO receives no input at all
    // (`PlayerControlObject::handlePlayerInput`, lnxded 0x08318920); the gate
    // is forced false rather than returning, so the hull still integrates and
    // coasts, exactly as the page's comment on its own copy of this line says.
    inputGate(this.occupiedDamageable(player.id), player.gate);
    if (occ.turret) occ.turret.inputScale = player.gate.rotationalScale;
    const activeRoot = occ.isActiveRoot();
    const inControl = activeRoot && !player.gate.blocked;
    // Exactly one entry for this tick: the buffer's oldest, else the page's
    // pending freshest, else the engine's zeroed idle word.
    const entry = this.#consume(player);
    const input = entry.input;

    if (vehicle) {
      if (player.kind === 'air') {
        if (inControl) {
          // W/S throttle latches rather than springs — you set a power
          // setting and it stays there, which is what a throttle quadrant
          // does. `forwardKeys` is the page's raw pair: the pad's Y is the
          // stick's pitch, never the throttle.
          const power = input.forwardKeys;
          if (power !== 0) {
            vehicle.setInput('c_PIThrottle', Math.max(0, Math.min(1,
              vehicle.input('c_PIThrottle') + power * dt)));
          }
          // A/D rudder, pad X for roll, pad Y for pitch -- the same stick
          // spring the page applied at its own frame rate; the pad bypasses
          // it, which is the page's mobile arrangement.
          vehicle.setInput('c_PIYaw', axisToward(
            vehicle.input('c_PIYaw'), input.rudder, dt));
          player.stick.roll = input.pad
            ? input.roll : axisToward(player.stick.roll, input.roll, dt);
          player.stick.pitch = input.pad
            ? input.pitch : axisToward(player.stick.pitch, input.pitch, dt);
          vehicle.setInput('c_PIRoll', player.stick.roll);
          vehicle.setInput('c_PIPitch', player.stick.pitch);
          vehicle.setInput('c_PIFire', input.fire ? 1 : 0);
          vehicle.setInput('c_PIAltFire', input.altFire ? 1 : 0);
        }
        vehicle.integrate(dt);
      } else {
        // Ground vehicles take keyboard input directly -- the vehicle's own
        // RotationalBundle servo is the only governor (the page's comment on
        // why the aircraft-style spring made every land vehicle feel wrong).
        if (inControl) {
          vehicle.setInput('c_PIThrottle', input.forward);
          vehicle.setInput('c_PIYaw', input.strafe);
          // Ships ride this branch on player.kind (a Ship IS an Aircraft in
          // ship.js, but world.js branches on the seat kind, and c_ETShip
          // classifies to 'ship'). Their ramps (LCVP/Daihatsu) and dive
          // planes + float trim (Gato/Sub7C) all bind c_PIPitch, which no
          // ground/tank hull does -- so only ships read the pitch axis here.
          // The same stick spring the aircraft path uses (arrows on desktop,
          // the mobile pad's Y when held, bypassing the spring as the page
          // always did for it); W/S stays c_PIThrottle (ahead/astern) and
          // never drives the pitch.
          if (player.kind === 'ship') {
            player.stick.pitch = input.pad
              ? input.pitch : axisToward(player.stick.pitch, input.pitch, dt);
            vehicle.setInput('c_PIPitch', player.stick.pitch);
          }
          vehicle.setInput('c_PIFire', input.fire ? 1 : 0);
          vehicle.setInput('c_PIAltFire', input.altFire ? 1 : 0);
        }
        vehicle.integrate(dt);
      }
      // After `integrate`, never before: it ends in `applyRig`, which puts
      // every declared RotationalBundle back at hull-forward. Stepping the
      // aim rig afterwards is what leaves the traverse where the player
      // pointed it.
      occ.applyTurrets();
    }

    // The turret is stepped when the seat that owns it is the one active:
    // the drivetrain's root seat (`isActiveRoot`) or any manned seat -- a
    // bare gun/seat root has no drivetrain, and a passenger seat never has a
    // rig. The look stage was pumped once per frame by the page; per world
    // tick the latest axis pair aims the rig and the servo runs once, which
    // is exactly the page's `stepTurret` inner loop.
    if (occ.turret) {
      occ.turret.aim(entry.lookX, entry.lookY);
      occ.turret.step(dt);
    }

    // Kept unconditional for the same reason the page's copies are: a
    // vehicle's own weapon must stop the instant nobody is in the seat that
    // fires it, and gating the *value* passed to setFiring (not skipping the
    // call) is what turns it off the same tick the seat stops being active.
    for (const group of player.groups) {
      const state = this.fireStateFor(group.node);
      if (inControl) state.step(dt);
      this.guns?.setFiring(group, inControl
        && vehicle && vehicle.input(group.stats.input || 'c_PIFire') > 0
        && state.canFire);
    }
    // The active seat's own FireArms: per weapon, one trigger per declared
    // input (c_PIFire / c_PIAltFire), gated on the same HP-15 byte.
    // A drivetrain's root seat is its driver's, and its FireArms are the
    // `groups` the loop above has just stepped and triggered. Taking them
    // again here fired a second group on the same node: one pull of a
    // Sherman's trigger was two shells and two rounds off the HUD, and the
    // reload ran at twice its rate.
    const driven = new Set(player.groups.map(g => g.node));
    const fire = input.fire && !player.gate.blocked;
    for (const node of occ.activeFireArmsNodes()) {
      if (driven.has(node)) continue;
      const state = this.fireStateFor(node);
      state.step(dt);
      const group = player.manned.find(g => g.node === node);
      if (!group) continue;
      const trigger = node.userData?.fireArms?.input === 'c_PIAltFire'
        ? (input.altFire && !player.gate.blocked) : fire;
      this.guns?.setFiring(group, trigger && state.canFire);
    }
  }

  /** Exactly one input per tick (LOOP-1 / `simulatePlayerUpdate` 0x0815bd00):
   *  the buffer's oldest sequenced entry, or the local stage's pending entry
   *  when that is the only thing waiting, or the engine's zeroed idle word
   *  when both are empty -- a sequenced packet is never replayed.
   *
   *  The local stage's entry is the exception, and only within its own
   *  frame: it is the device state the page sampled for ALL of this step's
   *  ticks, so the catch-up ticks of a frame longer than 33 ms run against
   *  it too. Handing them the idle word instead ended every slow frame with
   *  the trigger released -- `group.firing` false at draw time, a vehicle
   *  MG's fire loop gated shut every frame, one round in n fired -- and
   *  dropped the throttle, the steer and the look axis on the same ticks;
   *  on foot it turned a held jump into a press per frame. `step()` clears
   *  the hold before its first tick, so nothing outlives the frame it was
   *  fed for.
   */
  #consume(player) {
    let entry = player.buffer.length ? player.buffer.shift() : null;
    if (!entry) {
      if (player.pending) {
        player.held = player.pending;
        player.pending = null;
      }
      entry = player.held;
    }
    player.last = entry ?? ENGINE_IDLE;
    return player.last;
  }

  #combatTick(player, dt) {
    if (!this.combatArea.active) {
      player.combat = null;
      return false;
    }
    const soldier = player.soldier;
    const occ = player.occupancy;
    let x, z;
    if (occ?.root) {
      if (player.vehicle) {
        x = player.vehicle.state.position.x;
        z = player.vehicle.state.position.z;
      } else if (player.position) {
        x = player.position[0];
        z = player.position[2];
      } else {
        player.combat = null;
        return false;
      }
    } else if (soldier && !player.armor?.destroyed) {
      x = soldier.x;
      z = soldier.z;
    } else {
      player.combat = null;
      return false;
    }
    const frame = this.combatArea.step(dt, x, z,
      this.#combatMaterial(x, z));
    if (frame.damage > 0) {
      if (occ?.root) {
        const hull = this.occupiedDamageable(player.id);
        // A wreck has already died; the engine's own giveDamage on a
        // destroyed object is a no-op for the same reason.
        if (hull && !hull.destroyed) hull.damage(frame.damage);
      } else if (player.armor) {
        player.armor.applyDamage(frame.damage);
      }
    }
    player.combat = frame;
    return true;
  }

  /** The terrain material id under a world position, for the combat area's
   *  second test (CA-5) -- the page's own `combatMaterial` glue. */
  #combatMaterial(x, z) {
    const field = this.collider?.heightfield;
    if (!field || !field.materials) return null;
    return field.material(x, z);
  }

  #supplyTick(player, dt) {
    // The tick law of the page's old hook, moved whole: the depot's 0.5 s
    // self-throttle (SUP-11) is what paces the give/heal, not this call rate.
    if (!player.soldier || !player.armor) return;
    player.supplyResult = this.supplyField.tick(dt, this.#supplyTarget(player));
  }

  #supplyTarget(player) {
    return {
      x: player.soldier.x,
      y: player.soldier.y,
      z: player.soldier.z,
      team: player.supply.team ?? player.team,
      armor: player.armor,
      refillAmmo: player.supply.refillAmmo,
    };
  }

  /** A body-world crash cost `owner` hit points: the callback hooks first so
   *  the page's console record reads the pre-damage hit points (the reading
   *  the old crashLog always made), then the damage itself lands on the same
   *  Armor a round would have hurt, and the change is reported for the tier
   *  pass a few lines below to pick up this very tick. */
  #onBodyDamage(owner, result, at, other) {
    const vehicle = this.vehicleDamage.get(owner);
    if (this.onCrash) this.onCrash(owner, result, at, other);
    if (vehicle && !vehicle.destroyed) {
      vehicle.damage(result.kill ? vehicle.hitPoints : result.damage);
    }
    this.report.crashes.push({
      owner, other, damage: result.damage, kill: result.kill,
      cell: result.effectCell, at: [at[0], at[1], at[2]],
      hp: vehicle?.hitPoints ?? null,
    });
  }

  /**
   * The water pass (HP-5) and the tier pass, in the page's own order. The
   * positions come from the world's own bodies (fresh from this tick's body
   * step) plus the registration poses of static furniture; wrecks the page
   * has faded out are skipped through the `isWrecked` predicate.
   */
  #damageTick(dt) {
    const changes = this.vehicleDamage.update(dt, {
      inWaterOwners: this.#inWaterOwners(),
    });
    for (const change of changes) this.report.damage.push(change);
  }

  #inWaterOwners() {
    const collider = this.collider;
    const waterLevel = collider?.waterLevel;
    if (!Number.isFinite(waterLevel)) return null;
    for (const [owner, entry] of this.bodyWorld?.entries ?? []) {
      if (entry.driven) {
        const s = entry.driven.vehicle.state.position;
        this.positions.set(owner, [s.x, s.y, s.z]);
      } else {
        this.positions.set(owner, entry.parked.body.pos);
      }
    }
    const owners = new Set();
    for (const [owner, pos] of this.positions) {
      if (this.isWrecked(owner)) continue;
      if (pos[1] <= waterLevel) {
        owners.add(owner);
        continue;
      }
      // Is there open water under this (x, z) at all? The body's own height is
      // the reference the deck query needs (see `WorldCollider.surfaceHeight`):
      // a tank on a bridge over a river is standing on the span, not in the
      // water, and a tank in the river UNDER the same span is in the water —
      // which the raster this replaced could not tell apart, because it lifted
      // the surface at an (x, z) for everyone.
      const surface = collider.surfaceHeight(pos[0], pos[2], pos[1]);
      if (Math.abs(surface - waterLevel) >= 0.01) continue;
      // ...and does the hull actually reach it? This second half is the whole
      // of the altitude test, and without it the answer above was the final
      // one: `surfaceHeight` is a function of x and z, so a plane at 400 m over
      // the sea read as "in water" and HP-5's drowning tick took
      // `hpLostWhileDamageFromWater` off it every second — 10 HP/s for every
      // vanilla aircraft, which kills a 100 HP Corsair over Wake in ten
      // seconds of ordinary flight with nothing shooting at it. `touchesWater`
      // is the engine's own geometric rule (collision-response §7).
      const entry = this.bodyWorld?.get(owner);
      // Furniture registered by position alone has no hull to test; its origin
      // is the only geometry there is, and the `<= waterLevel` test above has
      // already asked about it.
      if (entry && touchesWater(entry, pos[1], waterLevel)) owners.add(owner);
    }
    return owners;
  }
}
