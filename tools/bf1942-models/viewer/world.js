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
import { spawnFlags } from './soldier.js';
import { CombatArea } from './combat-area.js';
import { SupplyField } from './supply.js';
import { VehicleDamageSet } from './vehicle-damage.js';
import { FireState } from './seats.js';
import { bufferInput } from './world-input.js';
import * as roster from './world-players.js';
import * as reads from './world-snapshot.js';
import * as hulls from './world-bodies.js';
import { soldierTick } from './world-soldier-tick.js';
import { assignIntegrators, vehicleTick } from './world-vehicle-tick.js';
import { combatTick, supplyTick, supplyTarget } from './world-fields.js';
import { damageTick } from './world-damage.js';

// The world is split one subsystem to a module, each a set of plain
// functions of the `World` below, which keeps every public method:
//
//   world-input.js         the input word, its buffer and the one-per-tick consume
//   world-players.js       the player records and spawning
//   world-snapshot.js      the room server's reads (P2)
//   world-bodies.js        the BodyWorld and the parked/driven hull swap
//   world-soldier-tick.js  an on-foot player's tick
//   world-vehicle-tick.js  a seated player's tick and the one-drive-one-integration rule
//   world-fields.js        the combat area and the supply depots
//   world-damage.js        crash damage and the water and tier pass

export { STICK_RATE, STICK_RETURN } from './world-input.js';

/** The world's tick: the engine's own 30 Hz (physics.js, LOOP-1). */
export const WORLD_TICK_RATE = ENGINE_TICK_RATE;
export const WORLD_TICK_DT = 1 / WORLD_TICK_RATE;

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

  /** The level's parked hulls, once the collider has handed out owner ids
   *  (`world-bodies.js`). */
  setupBodies(options) { return hulls.setupBodies(this, options); }
  addParkedBody(owner, spec, pose) { return hulls.addParkedBody(this, owner, spec, pose); }
  adoptDriven(owner, vehicle, spec) { return hulls.adoptDriven(this, owner, vehicle, spec); }
  releaseDriven(owner, vehicle, spec, pose, wheelState = null) {
    return hulls.releaseDriven(this, owner, vehicle, spec, pose, wheelState);
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

  /** A new player, human or bot, and a spawn for either (`world-players.js`). */
  addPlayer(playerId, options) { return roster.addPlayer(this, playerId, options); }

  removePlayer(playerId) {
    this.players.delete(playerId);
  }

  addBotPlayer(playerId, options) { return roster.addBotPlayer(this, playerId, options); }

  player(playerId) { return this.players.get(playerId) ?? null; }
  soldierOf(playerId) { return this.players.get(playerId)?.soldier ?? null; }
  armorOf(playerId) { return this.players.get(playerId)?.armor ?? null; }

  spawnPlayer(playerId, options) { return roster.spawnPlayer(this, playerId, options); }

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

  /** The room server's reads (`world-snapshot.js`). */
  playersSnapshot() { return reads.playersSnapshot(this); }
  vehiclePose(owner) { return reads.vehiclePose(this, owner); }
  vehicles() { return reads.vehicles(this); }

  /** The page's deploy screen restarts a flag's spawn cycle on a fresh
   *  choice (the old `spawnIndex = 0` resets). */
  setSpawnIndex(playerId, index) {
    const player = this.players.get(playerId);
    if (player && Number.isInteger(index)) player.spawnIndex = index;
  }

  /** Buffer one tick's input, engine-FIFO semantics (`world-input.js`'s
   *  `bufferInput`, and the header). */
  setInput(playerId, input, look = null, seq = null) {
    const player = this.players.get(playerId);
    if (!player) return;
    bufferInput(player, input, look, seq);
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
    const target = supplyTarget(this, player);
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
    assignIntegrators(this, this.#integrators);
    for (const player of this.players.values()) {
      const before = { ...player.lookApplied };
      if (player.occupancy) vehicleTick(this, player, dt, this.#integrators);
      else soldierTick(this, player, dt);
      if (combatTick(this, player, dt)) combatStepped = true;
      supplyTick(this, player, dt);
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
    damageTick(this, dt);
    // Last, so the snapshot a renderer takes here is this tick's FINAL state:
    // after the contact solver has pushed a hull and after the damage pass,
    // not the mid-tick pose `integrate` left on the scene graph.
    this.onTick?.();
  }

  /** drive -> the player whose tick integrates it (`world-vehicle-tick.js`'s
   *  `assignIntegrators`). */
  #integrators = new Map();
}
