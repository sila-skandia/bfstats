// One vehicle instance per hull (features/vehicle-instance-refactor).
//
// A hull is one object however many people sit in it: one seat model
// (`seats.js VehicleOccupancy`: the survey, the seat order and one aim rig
// per seat), one drivetrain, one body adoption, one set of gun groups per
// seat, and the seat map (`seatId -> playerId`). The human and every bot hold
// a `SeatHandle` -- `{ instance, seatId }` -- and nothing else, and the
// registry's three mutations (`enter`, `leave`, `switchSeat`) are the only
// way into, out of or across a hull, for both.
//
// What used to go wrong without this: each occupant built its own
// `VehicleOccupancy` and its own drivetrain, so a human gunner behind a bot
// driver owned a second, idle drive on the same node. The bot's integrated
// and fed the audio, the human's wrote the node (the camera stayed put while
// the tank was heard moving), and on exit the bot's `applyTransform` put the
// hull back where it really was.
//
// The drive is built when someone takes the root seat of a drivable hull
// and is kept until the last occupant leaves: a gunner left behind by his
// driver rides a coasting hull, and a gunner alone in a parked hull sits on
// a parked body. The world steps the drive once a tick, from the root seat
// holder's input (`world.js #assignIntegrators`).
//
// Nothing here knows about the page: the drive options, the body world, the
// guns, the audio rack and the scene freeze are handed in as `env`.

import { VehicleOccupancy, DRIVE_KINDS } from './seats.js';

/** The options every seat's gun groups are collected with (the page's). */
export const SEAT_GUN_OPTIONS = {
  replace: false,
  speedScale: 1,
  maxRange: 1500,
  roundLifetime: 'data',
  tracerLength: 'data',
};

/**
 * What an occupant holds: the hull and the seat. It answers the questions the
 * world, the HUD and the camera used to ask a per-occupant `VehicleOccupancy`
 * (`activeSeatId`, `turret`, `isActiveRoot`, `cameraNode`, ...), for its own
 * seat, from the hull's one seat model.
 */
export class SeatHandle {
  constructor(instance, seatId, playerId) {
    this.instance = instance;
    this.seatId = seatId;
    this.playerId = playerId;
  }

  get root() { return this.instance.root; }
  get rootId() { return this.instance.rootId; }
  get rootKind() { return this.instance.rootKind; }
  get order() { return this.instance.occupancy.order; }
  get survey() { return this.instance.occupancy.survey; }
  get turrets() { return this.instance.occupancy.turrets; }
  get drive() { return this.instance.drive; }
  /** The seat this occupant sits in (the old per-occupant name). */
  get activeSeatId() { return this.seatId; }
  /** This seat's aim rig, or null for a seat with none. */
  get turret() { return this.instance.occupancy.turrets.get(this.seatId) ?? null; }
  /** This seat's gun groups: `driven` (the drivetrain root's own FireArms,
   *  fired from the drive's inputs) and `manned` (the seat's own). */
  get groups() { return this.instance.groupsOf(this.seatId); }

  seatInfo(id) { return this.instance.occupancy.seatInfo(id); }
  seatKind(id) { return this.instance.occupancy.seatKind(id); }
  seatIdAt(position) { return this.instance.occupancy.seatIdAt(position); }
  isActiveRoot() { return this.seatId === this.instance.rootId; }
  applyTurrets() { this.instance.occupancy.applyTurrets(); }
  cameraNode() { return this.instance.occupancy.cameraNodeOf(this.seatId); }
  activeFireArmsNodes() { return this.instance.occupancy.fireArmsNodesOf(this.seatId); }
  activeHud() { return this.instance.occupancy.hudOf(this.seatId); }
  showsTurretIcon(insideView) { return this.instance.occupancy.showsTurretIconAt(this.seatId, insideView); }
  seatDots(occupants = [], localTeam = 0) {
    return this.instance.occupancy.seatDotsAt(this.seatId, occupants, localTeam);
  }
  exitLocationNode() { return this.instance.occupancy.exitLocationNodeOf(this.seatId); }
}

/** One hull. */
export class VehicleInstance {
  constructor(root, classes) {
    this.root = root;
    /** The seat model: survey, seat order, one aim rig per seat. Its own
     *  `activeSeatId` is unused; a seat belongs to a `SeatHandle`. */
    this.occupancy = new VehicleOccupancy(root, classes);
    /** seatId -> playerId */
    this.seats = new Map();
    /** playerId -> SeatHandle */
    this.handles = new Map();
    /** seatId -> { driven, manned } gun groups, while the seat is held. */
    this.guns = new Map();
  }

  get drive() { return this.occupancy.drive; }
  get rootId() { return this.occupancy.rootId; }
  get rootKind() { return this.occupancy.rootKind; }
  get empty() { return this.seats.size === 0; }
  holder(seatId) { return this.seats.get(seatId) ?? null; }
  /** The player at the wheel, or null. */
  get driver() { return this.seats.get(this.rootId) ?? null; }
  /** Does this hull's root seat build a drivetrain? */
  get drivable() { return DRIVE_KINDS.includes(this.rootKind); }
  groupsOf(seatId) { return this.guns.get(seatId) ?? EMPTY_GROUPS; }
}

const EMPTY_GROUPS = Object.freeze({ driven: Object.freeze([]), manned: Object.freeze([]) });

/**
 * Put a released drive's wheels back on the pose it found them in. A land
 * drive lifts each `Spring` node by its compression every frame
 * (`#applyWheels`), and the next drive built on the hull reads its axles' rest
 * off those same nodes (`collectChassis`: the node's matrix against the
 * root's). Left lifted, every boarding after the first started from axles
 * 0.14 m higher up the hull, and the Sherman sank that much each time it was
 * taken: 60.675, 60.539, 60.402 on El Alamein's Sherman_2 (Brief F item 2).
 * The parked body poses no wheels, so the rest pose is also what a parked hull
 * shows.
 */
function restWheels(drive) {
  for (const wheel of drive.wheels ?? []) {
    if (!wheel?.node || !wheel.basePosition || !wheel.baseQuaternion) continue;
    wheel.node.position.copy(wheel.basePosition);
    wheel.node.quaternion.copy(wheel.baseQuaternion);
    wheel.node.updateMatrix?.();
  }
}

/**
 * Every occupied hull, keyed by its root node, and every seated player.
 *
 * `env`:
 *  - `classes`: `{ Aircraft, GroundVehicle, TrackedVehicle, Ship }` for the seat
 *    model's `ensureDrive`;
 *  - `buildDrive(instance)`: build the hull's drivetrain (the page passes its
 *    drive options through `instance.occupancy.ensureDrive`) and return it, or
 *    null when the root builds none;
 *  - `world()`: the World the occupants are mounted in (null: none yet);
 *  - `guns`: a GunFire (collect / release / setFiring), or null headless;
 *  - `adopt(drive)` / `release(drive)`: the body world takes the drive over /
 *    gets the hull back as a parked body;
 *  - `thaw(root)` / `freeze(root)`: the scene's matrix walk;
 *  - `claimAudio(playerId, root, drive, groups)` / `releaseAudio(playerId, root)`;
 *  - `onChange(instance)`: a seat, the drive or the guns changed.
 * Every hook is optional.
 */
export class VehicleRegistry {
  constructor(env = {}) {
    this.env = env;
    /** root node -> VehicleInstance */
    this.instances = new Map();
    /** playerId -> SeatHandle */
    this.seated = new Map();
  }

  /** The hull whose root is `root`, if anyone sits in it. */
  instanceOf(root) { return this.instances.get(root) ?? null; }
  /** The seat `playerId` holds, or null. */
  seatOf(playerId) { return this.seated.get(playerId) ?? null; }
  /** Who holds `seatId` of the hull at `root`. */
  holder(root, seatId) { return this.instances.get(root)?.holder(seatId) ?? null; }
  /** Who drives the hull at `root`. */
  driverOf(root) { return this.instances.get(root)?.driver ?? null; }

  /** The player whose seat fired `group`, or null. */
  firerOf(group) {
    if (!group) return null;
    for (const handle of this.seated.values()) {
      const g = handle.groups;
      if (g.driven.includes(group) || g.manned.includes(group)) return handle.playerId;
    }
    return null;
  }

  /**
   * `playerId` takes `seatId` (the root seat when omitted) of the hull at
   * `root`. Returns the SeatHandle, or null when the seat is held, or when it
   * is the root seat of a drivable hull whose drive cannot be built and
   * `requireDrive` is set.
   */
  enter(root, seatId, playerId, { requireDrive = false } = {}) {
    if (!root || playerId == null) return null;
    const current = this.seated.get(playerId);
    if (current) {
      if (current.root === root) return this.switchSeat(playerId, seatId ?? current.rootId);
      this.leave(playerId);
    }
    let inst = this.instances.get(root);
    const fresh = !inst;
    if (fresh) inst = new VehicleInstance(root, this.env.classes ?? {});
    const seat = seatId || inst.rootId;
    if (inst.holder(seat) != null) return null;
    if (fresh) this.instances.set(root, inst);
    inst.seats.set(seat, playerId);
    const handle = new SeatHandle(inst, seat, playerId);
    inst.handles.set(playerId, handle);
    this.seated.set(playerId, handle);
    if (fresh) this.env.thaw?.(root);
    this.#ensureDrive(inst, seat);
    if (requireDrive && seat === inst.rootId && inst.drivable && !inst.drive) {
      this.leave(playerId);
      return null;
    }
    inst.occupancy.rigFor(seat);
    this.#collect(inst, seat);
    this.#mountAll(inst);
    this.env.onChange?.(inst);
    return handle;
  }

  /**
   * `playerId` moves to `seatId` of the hull he is in (`c_PIMenuSelect1..9`,
   * the bots' seat swap). The hull does not move: its drive, body and every
   * other seat stay as they are. Returns the handle, or null when the seat is
   * held or `playerId` is not seated.
   */
  switchSeat(playerId, seatId) {
    const handle = this.seated.get(playerId);
    if (!handle || seatId == null) return null;
    const inst = handle.instance;
    if (seatId === handle.seatId) return handle;
    if (!inst.occupancy.seatInfo(seatId) || inst.holder(seatId) != null) return null;
    this.#vacate(inst, handle.seatId);
    inst.seats.delete(handle.seatId);
    inst.seats.set(seatId, playerId);
    handle.seatId = seatId;
    this.#ensureDrive(inst, seatId);
    inst.occupancy.rigFor(seatId);
    this.#collect(inst, seatId);
    this.#mountAll(inst);
    this.env.onChange?.(inst);
    return handle;
  }

  /**
   * `playerId` gets out. The last one out parks the hull where it stands: its
   * controls released, its pose written, the body world given a parked body
   * carrying the drive's velocity, and the node frozen again. Returns
   * `{ instance, seatId, drive, emptied }`, or null when not seated.
   */
  leave(playerId) {
    const handle = this.seated.get(playerId);
    if (!handle) return null;
    const inst = handle.instance;
    const seatId = handle.seatId;
    const drive = inst.drive;
    this.#vacate(inst, seatId);
    inst.seats.delete(seatId);
    inst.handles.delete(playerId);
    this.seated.delete(playerId);
    this.env.world?.()?.clearPlayerVehicle(playerId);
    this.env.releaseAudio?.(playerId, inst.root);
    const emptied = inst.empty;
    if (emptied) {
      if (drive) {
        drive.applyTransform?.();
        drive.applyRig?.();
        restWheels(drive);
        this.env.release?.(drive);
      }
      this.env.freeze?.(inst.root);
      this.instances.delete(inst.root);
    }
    this.env.onChange?.(inst);
    return { instance: inst, seatId, drive, emptied };
  }

  /** Every seat's world position into the world's player records: the seat
   *  node's, which is where a rider senses from and where the combat area
   *  finds a bare gun's gunner. */
  publishSeatPositions(scratch) {
    const world = this.env.world?.();
    if (!world) return;
    for (const [playerId, handle] of this.seated) {
      const node = handle.seatInfo(handle.seatId)?.node ?? handle.root;
      if (!node?.getWorldPosition) continue;
      const p = node.getWorldPosition(scratch);
      world.setPlayerPosition(playerId, [p.x, p.y, p.z]);
    }
  }

  /** A level change: the scene these hulls lived in is gone. */
  clear() {
    this.instances.clear();
    this.seated.clear();
  }

  // --- internals -------------------------------------------------------------

  /** The drive, built the first time the root seat of a drivable hull is
   *  taken and adopted into the body world. */
  #ensureDrive(inst, seatId) {
    if (seatId !== inst.rootId || inst.drive || !inst.drivable) return;
    const drive = this.env.buildDrive ? this.env.buildDrive(inst) : null;
    if (drive) this.env.adopt?.(drive);
  }

  /** The seat's gun groups: the root seat's own FireArms from the drive when
   *  there is one, then whatever else the seat declares. */
  #collect(inst, seatId) {
    const guns = this.env.guns;
    if (!guns) { inst.guns.set(seatId, { driven: [], manned: [] }); return; }
    const options = {
      ...SEAT_GUN_OPTIONS,
      platformVelocity: () => inst.drive?.state?.velocity ?? null,
    };
    let driven = [];
    if (seatId === inst.rootId && inst.drive) {
      driven = guns.collect(inst.drive.node, options);
      // `drive.node` is the whole vehicle, root plus every nested seat, so the
      // collect also builds a group for a nested seat's own FireArms (the
      // Sherman's hull Browning). Only the root seat's own are the driver's:
      // a nested gun answers to whoever sits in its seat, never to the
      // driver's trigger.
      const rootFireArms = new Set(inst.occupancy.seatInfo(inst.rootId)?.fireArms ?? []);
      const foreign = driven.filter(group => !rootFireArms.has(group.node));
      if (foreign.length) {
        driven = driven.filter(group => rootFireArms.has(group.node));
        for (const group of foreign) guns.release(group);
      }
    }
    const drivenNodes = new Set(driven.map(group => group.node));
    const manned = inst.occupancy.fireArmsNodesOf(seatId)
      .filter(node => !drivenNodes.has(node))
      .flatMap(node => guns.collect(node, options));
    inst.guns.set(seatId, { driven, manned });
  }

  /** The seat is being left: its guns stop and leave the index (rounds in
   *  the air finish their flight), and a vacated root seat lets go of the
   *  controls so a hull nobody drives coasts rather than holding a throttle. */
  #vacate(inst, seatId) {
    const groups = inst.guns.get(seatId);
    if (groups && this.env.guns) {
      for (const group of [...groups.driven, ...groups.manned]) this.env.guns.release(group);
    }
    inst.guns.delete(seatId);
    const drive = inst.drive;
    if (seatId === inst.rootId && drive) {
      if (drive.state) drive.state.throttle = 0;
      drive.setInput?.('c_PIThrottle', 0);
      drive.setInput?.('c_PIYaw', 0);
      drive.setInput?.('c_PIFire', 0);
      drive.setInput?.('c_PIAltFire', 0);
    }
  }

  /** Every occupant's world mount and audio claim, fresh: the drive or a
   *  seat's groups may have changed under all of them. */
  #mountAll(inst) {
    const world = this.env.world?.();
    for (const [playerId, handle] of inst.handles) {
      const groups = handle.groups;
      world?.setPlayerVehicle(playerId, {
        occupancy: handle,
        vehicle: inst.drive ?? null,
        kind: inst.rootKind,
        groups: groups.driven,
        manned: groups.manned,
      });
      this.env.claimAudio?.(playerId, inst.root, inst.drive ?? null, [...groups.driven, ...groups.manned]);
    }
  }
}
