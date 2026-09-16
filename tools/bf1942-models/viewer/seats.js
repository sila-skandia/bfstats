// Entering, switching and leaving any seat -- including manned guns.
//
// Round 1 (`features/bf1942-engine-reference/verify-r5.md`, `verify-r6.md`)
// re-derived how Refractor itself does this from the Linux dedicated server's
// intact symbol table. This module is the viewer half: it turns one vehicle's
// assembled node tree into a table of seats (root plus every nested
// `PlayerControlObject`), classifies each seat the way the engine's own data
// shape does (SEAT-*/GUN-10), and drives a manned gun's aim and fire state
// from that table. `map.html` owns the glue -- the keyboard, the camera, the
// HUD variables -- everything here is pure data/state and takes no DOM, no
// `THREE.Scene` and no renderer, so `tests/test_seats_harness.mjs` can drive
// it with a handful of plain objects standing in for glTF nodes.
//
// What is NOT reproduced, and why, is called out at each site below rather
// than asserted as engine behaviour -- see especially `TurretAxis.step`.

import * as THREE from 'three';

// --- seat survey -------------------------------------------------------

const AXES = ['yaw', 'pitch', 'roll'];

/**
 * Every seat of one vehicle, keyed by the name of the `PlayerControlObject`
 * that owns it -- the root's own name for the root seat, a nested PCO's own
 * name for each of the others.
 *
 * The grouping key already exists in the data: `assemble.py` stamps every
 * non-PCO node's `extras.control` with the name of its nearest enclosing
 * `PlayerControlObject` (`control_scope`, `bf42/con.py`), and does the same
 * for `EntryPoint`/`SeatObject` under `extras.seat.control`. A single
 * `root.traverse()` bucketing every descendant by that tag therefore respects
 * PCO boundaries automatically -- a hull gunner's own RotationalBundle is
 * never attributed to the driver's seat, and vice versa -- without this
 * module re-deriving the tree structure `classifyVehicle`'s old stack-walk
 * used to.
 *
 * `order` lists seat ids in the order their PlayerControlObject node is first
 * seen (root always first). SEAT-22/23 (verify-r5.md) confirm the real engine
 * builds a `position id -> seat` map once per vehicle and switches seats with
 * `c_PIMenuSelect1..9` -> position 0..8, but the *position* integer itself is
 * assigned by client-side helpers this data does not expose. Declaration
 * order is the approximation: it reproduces the one pair the report checked
 * against real data exactly (Sherman: root/driver = position 0 = key 1,
 * `shermanBrowning_PCO1` = position 1 = key 2, SEAT-24), and generalises the
 * same way to M3A1 and the ship gun mounts. OPEN (SEAT-22): whether a vehicle
 * whose `.con` declares seats in a different order than the node tree walks
 * them would disagree with the real position map.
 */
export function surveyVehicle(root) {
  const rootId = root.userData?.control || root.name || 'vehicle';
  const seats = new Map();
  const order = [];
  function seatFor(id, node) {
    let seat = seats.get(id);
    if (!seat) {
      seat = {
        id, node: node || null, entryPoints: [], seatObjects: [],
        camera: null, axes: {}, fireArms: [], engineType: null, hud: null,
      };
      seats.set(id, seat);
      order.push(id);
    } else if (node && !seat.node) {
      seat.node = node;
    }
    return seat;
  }
  seatFor(rootId, root);
  root.traverse(obj => {
    const data = obj.userData;
    if (!data) return;
    const kind = data.templateKind;
    if (kind === 'PlayerControlObject') {
      // Bucket by `data.control`, not `obj.name`: a nested PCO's *node* name
      // gets a scene-wide disambiguating suffix whenever more than one
      // instance of its vehicle is placed on the level (Wake's own two
      // Shermans -- confirmed against the live scene, headless, this round:
      // `shermanBrowning_PCO1`'s own node is named `shermanBrowning_PCO1_1`
      // on the first Sherman), but its `control` tag -- the same string
      // every one of ITS OWN descendants report as their `owner` two lines
      // below -- is not. Keying this bucket by the node name instead split
      // one seat into two: an empty one under the suffixed name (this PCO's
      // `.node`, no entryPoints/axes/fireArms/camera -- none of its children
      // ever resolve `owner` to that string) and a fully-populated one under
      // the bare name (every child, but `.node` never set) -- shifting the
      // Sherman's own gunner from seat position 1 to 2 and leaving position 1
      // an unfireable dead seat, breaking exactly the `switchSeat` path
      // SEAT-23/24 describes. `data.control` is what a PCO's own descendants
      // already use to name it, so using it here too is the one dependable
      // key, not an approximation.
      const id = data.control || obj.name;
      if (obj !== root) seatFor(id, obj);
      if (data.hud) seatFor(obj === root ? rootId : id, obj).hud = data.hud;
      return;
    }
    const owner = data.control || rootId;
    if (kind === 'EntryPoint') {
      seatFor(owner).entryPoints.push(obj);
    } else if (kind === 'SeatObject') {
      seatFor(owner).seatObjects.push(obj);
    } else if (kind === 'Camera') {
      const seat = seatFor(owner);
      if (!seat.camera) seat.camera = obj;   // first one wins, same rule Vehicle.collect() uses
    } else if (kind === 'RotationalBundle' && data.rig?.axes) {
      const seat = seatFor(owner);
      for (const axis of AXES) {
        if (data.rig.axes[axis] && !seat.axes[axis]) {
          seat.axes[axis] = { node: obj, spec: data.rig.axes[axis] };
        }
      }
    } else if (kind === 'FireArms' && data.fireArms) {
      seatFor(owner).fireArms.push(obj);
    } else if (kind === 'Engine' && data.physics?.engineType) {
      seatFor(owner).engineType = data.physics.engineType;
    }
  });
  return { rootId, order, seats };
}

/**
 * GUN-10 (verify-r6.md)'s own definition, applied per seat: an Engine wins at
 * the root (a drivable body); short of that, a RotationalBundle with real
 * motion (`maxSpeed>0` on at least one axis -- excludes a zeroed gunner
 * Camera, which is never this `templateKind` anyway, and a purely cosmetic
 * hinge) *and* a FireArms is a manned gun; anything else that reaches an
 * `EntryPoint` is a bare seat -- a passenger position, or a helm this round
 * has no drive model for (a ship hull's own root: "c_ETShip" is not one of
 * the three engine types below, so it falls through to 'seat' exactly like a
 * true passenger, which is the honest answer for "no propulsion model" rather
 * than a special case).
 */
export function classifySeat(seat, isRoot) {
  if (isRoot) {
    if (seat.engineType === 'c_ETPlane') return 'air';
    if (seat.engineType === 'c_ETCar') return 'ground';
    if (seat.engineType === 'c_ETTank') return 'tank';
  }
  const hasMotion = AXES.some(axis => seat.axes[axis] && seat.axes[axis].spec.maxSpeed > 0);
  if (hasMotion && seat.fireArms.length) return 'gun';
  return 'seat';
}

/** `classifyVehicle`'s old contract (a root node in, one of five kinds out). */
export function classifyRoot(root) {
  if (!root) return null;
  const { rootId, seats } = surveyVehicle(root);
  return classifySeat(seats.get(rootId), true);
}

/**
 * Every `PlayerControlObject` root in the scene, spawner-placed or not.
 *
 * `flight.js`'s `findVehicles` only returns spawner children -- by design,
 * for the "planes and cars a free camera can auto-possess" use it serves --
 * which is exactly why the Defgun, the AA guns and the Brownings have never
 * shown up as enterable: they are static level furniture, not spawner
 * output, but they carry the identical `templateKind`/`control` shape. A
 * root here is any PCO with no ancestor PCO before `root` -- the same
 * boundary `surveyVehicle` already respects.
 */
export function findAllVehicleRoots(root) {
  const found = [];
  root.traverse(obj => {
    if (obj.userData?.templateKind !== 'PlayerControlObject') return;
    for (let p = obj.parent; p && p !== root; p = p.parent) {
      if (p.userData?.templateKind === 'PlayerControlObject') return;
    }
    found.push(obj);
  });
  return found;
}

/** Every `EntryPoint` of one vehicle, tagged with which seat it opens into. */
export function listEntryPoints(root, fallbackRadius) {
  const { seats } = surveyVehicle(root);
  const list = [];
  for (const seat of seats.values()) {
    for (const entry of seat.entryPoints) {
      list.push({
        node: entry, seatId: seat.id,
        radius: entry.userData?.seat?.entryRadius || fallbackRadius,
      });
    }
  }
  return list;
}

/**
 * Round 3's second disclosed gap: a shared physical door can carry more than
 * one `EntryPoint` — the Sherman declares one for the driver's seat and a
 * second, separately-scoped one for the hull gunner's, at each of its two
 * doors, and Wake's M3A1 goes one further with four passenger `EntryPoint`s
 * stacked on its one side door. All of a set's candidates share the exact
 * same authored local offset relative to their own seat, and their different
 * parent chains (the root vs. each nested seat's own PCO) still compose to
 * the *identical* world position — confirmed against the live Wake scene
 * this round: the Sherman's two door-pairs differ by ~1.1e-13 m (`getWorld
 * Position`'s own double-precision floor), and M3A1's four-way tie composes
 * to a bit-exact match, zero difference. A plain `distance < best` compare
 * lets whichever candidate's matrix chain happens to round a hair smaller
 * win — floating-point noise the level's own data never expressed an opinion
 * on, not a real "closer door."
 *
 * The fix: a candidate only unseats the incumbent by beating it by more than
 * `TIE_EPSILON` — several orders of magnitude above the measured noise floor
 * and several more below the smallest gap between two genuinely different
 * doors — so within that band the FIRST candidate `distanceOf` reaches keeps
 * it. That first-found rule is what makes the tie-break deterministic:
 * `entries`/`candidates` here is always built by one fixed traversal
 * (`surveyVehicle`'s own `order`, root seat first — SEAT-22's declaration-
 * order convention, the same one `VehicleOccupancy.seatIdAt` rests its own
 * key-1..9 mapping on), so "first found" means "declared first" every time,
 * not "whichever the caller happened to iterate this run." For the Sherman
 * that seats the driver's own door ahead of the gunner's at the same spot;
 * for M3A1 it seats the lowest-numbered passenger PCO. Either way it is the
 * same answer on every call, not a coin flip decided by rounding.
 *
 * Generic on purpose — a plain array plus a distance function, no EntryPoint
 * of its own — so it is usable (and unit-testable, see `test_seats.py`)
 * anywhere else this viewer needs "closest of several, ties settled by who
 * was offered first" rather than only for doors.
 */
export const TIE_EPSILON = 1e-6;   // metres; ~1e7x the measured noise, ~1e5x below any real gap

export function pickNearest(candidates, distanceOf) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = distanceOf(candidate);
    if (distance < bestDistance - TIE_EPSILON) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

// --- one vehicle's occupancy, across seat switches ----------------------

/**
 * Ties one vehicle's seat table to whichever drivetrain class its root
 * classifies to, and tracks which seat is currently manned. `map.html`
 * constructs one on entry and keeps it for as long as any seat is occupied;
 * switching seats (number keys) only changes `activeSeatId` and rebuilds the
 * turret, it never tears the vehicle down.
 *
 * `classes` is dependency-injected (`{Aircraft, GroundVehicle,
 * TrackedVehicle}`) rather than imported here, so this module never needs
 * `flight.js`/`ground.js`'s heavier THREE dependencies just to survey a seat
 * table, and so `TrackedVehicle`'s absence (P4's track, a parallel worktree)
 * is a plain "falls back to GroundVehicle" rather than an import error --
 * `map.html` resolves that fallback once, this class only ever sees a class
 * reference or `null`.
 */
export class VehicleOccupancy {
  constructor(root, classes = {}) {
    this.root = root;
    this.classes = classes;
    const survey = surveyVehicle(root);
    this.survey = survey;
    this.rootId = survey.rootId;
    this.order = survey.order;
    this.rootKind = classifySeat(survey.seats.get(this.rootId), true);
    this.drive = null;          // Aircraft | GroundVehicle | TrackedVehicle, once built
    this.activeSeatId = null;
    this.turret = null;         // TurretRig, only while the active seat is a 'gun'
  }

  seatInfo(id) { return this.survey.seats.get(id); }
  seatKind(id) { return classifySeat(this.seatInfo(id), id === this.rootId); }
  isActiveRoot() { return this.activeSeatId === this.rootId; }

  /** The root's own drivetrain object, building it on first use. */
  ensureDrive(parent, options) {
    if (this.drive || !['air', 'ground', 'tank'].includes(this.rootKind)) return this.drive;
    const { Aircraft, GroundVehicle, TrackedVehicle } = this.classes;
    if (this.rootKind === 'air') this.drive = new Aircraft(this.root, parent, options);
    else if (this.rootKind === 'ground') this.drive = new GroundVehicle(this.root, parent, options);
    else this.drive = new (TrackedVehicle || GroundVehicle)(this.root, parent, options);
    return this.drive;
  }

  /** Seat, root or nested, currently manned -- switches build/drop the aim rig. */
  setActiveSeat(id) {
    this.activeSeatId = id;
    const seat = this.seatInfo(id);
    this.turret = seat && this.seatKind(id) === 'gun' ? new TurretRig(seat) : null;
    return this.turret;
  }

  /** 1-based position -> seat id, root first (see `surveyVehicle`'s note on `order`). */
  seatIdAt(position) { return this.order[position]; }

  cameraNode() {
    const seat = this.seatInfo(this.activeSeatId);
    return seat?.camera || seat?.node || this.root;
  }

  /** The FireArms nodes `collectGuns()` should scope firing to. */
  activeFireArmsNodes() {
    return this.seatInfo(this.activeSeatId)?.fireArms || [];
  }

  /** `Vehicle/*` HUD block for the currently manned seat, falling back to the
   *  vehicle's own (a nested seat rarely repeats `setVehicleIcon`). */
  activeHud() {
    return this.seatInfo(this.activeSeatId)?.hud || this.seatInfo(this.rootId)?.hud || null;
  }

  /** The node whose `physics.soldierExitLocation` (if any) should place the
   *  soldier stepping out of the currently manned seat. */
  exitLocationNode() {
    const seat = this.seatInfo(this.activeSeatId);
    return seat?.node?.userData?.physics?.soldierExitLocation ? seat.node : this.root;
  }
}

// --- manned-gun aiming (GUN-2/GUN-3, verify-r6.md's corrected report) ---
//
// GUN-2 (verified): `RotationalBundle::handlePlayerInput` never reads its own
// `dt` -- it just samples the bound `PlayerInput` channel each tick, x0.2 on
// the mouse-look channels every real manned gun binds.
//
// GUN-3 (verified in shape, OPEN in closed form): the angle is NOT the raw
// sample mapped straight to a pose the way this viewer's own `flight.js`
// poses an aircraft control surface (`RiggedPart`/`axisAngle`, position-law,
// correct for a surface, never verified against a gun). The real mechanism
// is two per-axis accumulators -- an input register clamped to a hardcoded
// +-40 and deadzoned against +-1.0, and a `|acceleration|*dt` register --
// whose PRODUCT drives the angle, with an `automaticReset`-dependent step
// selecting between `maxRotation` and `maxSpeed` that the verifier read
// several instructions deeper than the first pass and explicitly could not
// close out ("I did not close out where that product lands" / "the exact
// per-tick algebra ... is still not nailed down").
//
// Two gaps, both named where they bite in `TurretAxis.step`:
//   1. `bf42/con.py`'s `rig()` (owned by another session this round; off
//      limits) exports each axis's acceleration only as a SIGN
//      (`direction`), never its degrees/second^2 MAGNITUDE, so the real
//      per-axis ramp rate GUN-3's own accumulator would need is not present
//      in this viewer's extracted data at all, independent of the algebra
//      question below.
//   2. Even given that magnitude, GUN-3's own closed form is unsettled.
//
// The corrected report's own Viewer Recipe names the way through both: "a
// tunable ease ... at a per-vehicle-tunable rate derived from
// acceleration/maxSpeed ... rather than the specific accel.dt/clamp-to-
// maxSpeed formula" -- ship the confirmed parts (the +-180 wrap when
// unlimited, the min/max clamp otherwise, degrees straight off the `.con`,
// no spring-to-centre) and approximate the ramp, not the wrap or the clamp.

const RIG_AXIS = { yaw: 'y', pitch: 'x', roll: 'z' };   // flight.js's own convention, mirrored
const RIG_SIGN = { yaw: -1, pitch: -1, roll: 1 };       // (unexported there; kept identical here)

// Seconds from rest to the axis's own declared `maxSpeed` -- GUN-8's
// illustrative Defgun numbers (1.8s yaw / 0.67s pitch, from real
// `acceleration`/`maxSpeed` values this viewer's data does not carry) sit on
// either side of this, so it is the right order of magnitude without
// claiming to reproduce either gun's real figure. Tunable; not measured.
export const TURRET_RAMP_TIME = 1.0;
// Mouse pixels (this viewer's own unit) per tick -> the input register's
// units. The real register's units are a raw Windows mouse delta at whatever
// pointer-speed setting the client read; the ratio between that and a
// pointer-locked `movementX` in a browser is not recoverable from any of the
// data this round has, so this is tuned to feel right against the +-40
// clamp and +-1.0 deadzone GUN-3 pins exactly, not derived from them.
export const TURRET_SENSITIVITY = 0.05;

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

/** One RotationalBundle node, integrated per GUN-3's confirmed shape. */
export class TurretAxis {
  constructor(axisName, node, spec) {
    this.axisName = axisName;
    this.node = node;
    this.spec = spec;
    this.base = node.quaternion.clone();
    this.angle = 0;      // degrees, relative to the authored rest pose
    this.velocity = 0;   // degrees/second, current
    this.sample = 0;     // pending raw input this tick, drained by `step`
  }

  /** Mouse motion arrives here, possibly several times before the next `step`. */
  feed(delta) { this.sample += delta; }

  step(dt) {
    // The input register: GUN-3's own hardcoded +-40 clamp and +-1.0
    // deadzone, confirmed exactly (verify-r6.md, `.rodata` 0x86c866c/70 and
    // 0x86b05ec). The asymmetric "<-1.0 gets +1.0" branch the verifier flagged
    // as unexplained is not reproduced -- a plain zero in the deadzone is used
    // for both signs, which only differs from the real engine in that one
    // corner the verifier itself could not account for.
    const reg = Math.max(-40, Math.min(40, this.sample * TURRET_SENSITIVITY));
    this.sample = 0;
    const driven = Math.abs(reg) > 1 ? reg : 0;
    // OPEN (GUN-3): the confirmed mechanism from here is `angle +=
    // velocityRegister*inputRegister`, where `velocityRegister` accumulates
    // `|acceleration|*dt`; this viewer has no per-axis acceleration magnitude
    // to accumulate (see the module comment above) and the verifier could not
    // close out the automaticReset-dependent step regardless. Approximated as
    // a rate-limited ease: velocity chases an input-scaled target at a fixed
    // fraction of the axis's own real `maxSpeed` per second.
    const maxSpeed = this.spec.maxSpeed || 0;
    const target = (driven / 40) * maxSpeed * this.spec.direction;
    const rampPerSecond = maxSpeed / Math.max(TURRET_RAMP_TIME, 1e-3);
    const maxStep = rampPerSecond * dt;
    const delta = target - this.velocity;
    this.velocity += Math.max(-maxStep, Math.min(maxStep, delta));
    this.angle += this.velocity * dt;
    if (this.spec.free) {
      // Confirmed as-is (GUN-3): an unlimited axis (min==max, or neither
      // declared) wraps through +-180 instead of clamping.
      if (this.angle > 180) this.angle -= 360;
      else if (this.angle < -180) this.angle += 360;
    } else {
      const lo = Math.min(this.spec.min, this.spec.max);
      const hi = Math.max(this.spec.min, this.spec.max);
      if (this.angle > hi) { this.angle = hi; this.velocity = 0; }
      else if (this.angle < lo) { this.angle = lo; this.velocity = 0; }
    }
    this._apply();
  }

  _apply() {
    _euler.set(0, 0, 0);
    _euler[RIG_AXIS[this.axisName]] = THREE.MathUtils.degToRad(this.angle * RIG_SIGN[this.axisName]);
    _quat.setFromEuler(_euler);
    this.node.quaternion.copy(this.base).multiply(_quat);
  }
}

/**
 * One seat's whole aim rig -- usually a yaw parent plus a pitch child
 * (GUN-6/GUN-21), occasionally a single axis (a hand-cranked AA mount) or a
 * yaw+roll pair where roll is doing elevation (Yamato, GUN-22).
 *
 * Routed by each axis's own bound input rather than by its yaw/pitch/roll
 * label: GUN-2 confirms every real manned gun binds `c_PIMouseLookX/Y`, and
 * `con.py`'s `rig()` already resolves a raw-int binding (`AA_Allies_
 * RotatingCrank`'s bare `4`) to the same symbolic name, so checking
 * `spec.input` handles Yamato's roll-as-elevation and the raw-int mounts
 * alike without a special case. An axis bound to anything else (a hand-turned
 * `c_PIYaw`/`c_PIPitch` crank, or `c_PIFire`'s recoil-animation axes, GUN-23)
 * is not driven by the mouse this round -- open, not approximated.
 */
export class TurretRig {
  constructor(seat) {
    this.axes = AXES
      .filter(name => seat.axes[name])
      .map(name => new TurretAxis(name, seat.axes[name].node, seat.axes[name].spec));
  }

  aim(dx, dy) {
    for (const axis of this.axes) {
      if (axis.spec.input === 'c_PIMouseLookX') axis.feed(dx);
      else if (axis.spec.input === 'c_PIMouseLookY') axis.feed(dy);
    }
  }

  step(dt) {
    for (const axis of this.axes) axis.step(dt);
  }
}

// --- firing: magazine, reload, auto-reload, heat (verify-r6.md GUN-12) --
//
// `gunfire.js`'s own `advance()` already paces shots at `stats.roundOfFire`
// once `group.firing` is true -- that IS the rate-of-fire gate GUN-12 places
// ahead of the ammo check, enforced downstream of everything below rather
// than duplicated here. This class only decides whether the trigger is even
// allowed to engage: reload and overheat block it outright (GUN-12's
// verified order), and `getHasHeat()`'s real test -- `template+0x300 >
// template+0x304`, corrected from an earlier equality reading, fields still
// unidentified -- has no equivalent in this viewer's extracted data, so
// "has heat" here is the practical proxy the extraction actually gives:
// the `.con` declared `heatAddWhenFire` at all. GUN-12's two unidentified
// instance flags and its `timeToEjectClipFinished` (distinct from the reload
// timer, per the verifier) have no data of their own here either; ejecting is
// folded into the one `reloadTime` window rather than invented a second one.
export class FireState {
  constructor(stats) {
    this.stats = stats;
    this.unlimited = stats.magSize == null || stats.magSize < 0;
    this.ammo = this.unlimited ? Infinity : stats.magSize;
    this.magsLeft = stats.numOfMag == null || stats.numOfMag < 0 ? Infinity : stats.numOfMag;
    this.hasHeat = stats.heatAddWhenFire != null;
    this.heat = 0;
    this.reloadRemaining = 0;
    this.overheatRemaining = 0;
  }

  get canFire() {
    if (this.reloadRemaining > 0) return false;
    if (this.overheatRemaining > 0) return false;
    // NOT the same comparison GUN-12 corrected to strict-greater-than: that
    // fix was to `getHasHeat()`, a template-level "does this weapon have a
    // heat mechanic at all" predicate on two still-unidentified fields,
    // distinct from `isReadyToUseFire`'s own overheat gate (a countdown
    // timer, `timeToOverHeatFinished()>0`) and from what actually starts
    // that timer, which the report never pins down. `heat>=1` here is this
    // viewer's own approximation of the trigger, following the corrected
    // report's Viewer Recipe ("clamp [0,1] ... block fire ... on reaching
    // 1.0") rather than a confirmed engine comparison — `>` would never fire
    // on this clamped scale, since `heat` never exceeds 1.
    if (this.hasHeat && this.heat >= 1) return false;
    if (!this.unlimited && this.ammo <= 0) return false;
    return true;
  }

  step(dt) {
    if (this.reloadRemaining > 0) {
      this.reloadRemaining = Math.max(0, this.reloadRemaining - dt);
      if (this.reloadRemaining === 0 && !this.unlimited) {
        this.ammo = this.stats.magSize;
        if (this.magsLeft !== Infinity) this.magsLeft = Math.max(0, this.magsLeft - 1);
      }
    }
    if (this.overheatRemaining > 0) this.overheatRemaining = Math.max(0, this.overheatRemaining - dt);
    if (this.hasHeat && this.heat > 0) {
      this.heat = Math.max(0, this.heat - (this.stats.coolDownPerSec || 0) * dt);
    }
  }

  /** Called once per round actually fired (chain onto `guns.onShot`). */
  registerShot() {
    if (this.hasHeat) {
      this.heat = Math.min(1, this.heat + this.stats.heatAddWhenFire);
      if (this.heat >= 1) this.overheatRemaining = this.stats.timeDelayOnOverheat || 0;
    }
    if (!this.unlimited) {
      this.ammo = Math.max(0, this.ammo - 1);
      if (this.ammo === 0 && this.magsLeft > 0) {
        this.reloadRemaining = this.stats.reloadTime || 0;
      }
    }
  }
}

/**
 * Splice one more handler onto a `GunFire` instance's single `onShot` slot,
 * without disturbing whatever is already wired there (map.html's own hand
 * weapon fire sound/ammo, which already no-ops for any group that is not the
 * hand weapon's own -- see its comment "onShot fires for vehicle guns too, so
 * the group is checked first"). Idempotent per instance: calling it twice
 * would chain the same extra handler twice, so callers guard it with their
 * own once-per-`GunFire` flag.
 */
export function chainOnShot(gunsInstance, extra) {
  const previous = gunsInstance.onShot;
  gunsInstance.onShot = group => {
    previous?.(group);
    extra(group);
  };
}

// --- world-space camera read ---------------------------------------------

/** Copy `node`'s current world pose into pre-allocated outputs -- no per-frame
 *  allocation, matching every other per-frame path on this page. */
export function readWorldPose(node, outPosition, outQuaternion) {
  node.updateWorldMatrix(true, false);
  node.getWorldPosition(outPosition);
  node.getWorldQuaternion(outQuaternion);
}
