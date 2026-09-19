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

/** The two inputs a player's mouse actually reaches an aim axis through
 *  (GUN-2). Everything else a `RotationalBundle` can bind — a steered front
 *  wheel's `c_PIYaw`, a minigun barrel's `c_PIFire` spin — is somebody else's
 *  to pose, and `TurretRig`/`hasAimAxes` both key off exactly this pair. */
export const AIM_INPUTS = ['c_PIMouseLookX', 'c_PIMouseLookY'];
const isAimAxis = spec => AIM_INPUTS.includes(spec?.input);

/** Does this seat give the player something to aim with the mouse? True for
 *  every manned gun, and also for a tank's own driving seat — a Sherman's
 *  driver traverses `ShermanTower` (`c_PIMouseLookX`, free, 35 deg/s) and
 *  elevates `ShermanGunBase` (`c_PIMouseLookY`, -20..+5 at 20 deg/s) off the
 *  same mouse, which is why this asks what the seat is WIRED to rather than
 *  what `classifySeat` calls it. */
export function hasAimAxes(seat) {
  return !!seat && AXES.some(name => isAimAxis(seat.axes?.[name]?.spec));
}

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
        poseAnimation: null, cameraViewModes: null,
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
      const seat = seatFor(owner);
      seat.seatObjects.push(obj);
      // SEAT-9: the passenger seat's own pose animation strings, if declared.
      // `extras.seat.poseAnimation` comes straight off `seatAnimationUpperBody/`
      // `seatAnimationLowerBody` in the `.con` — the same names
      // `BFSoldier::setUseSeat` resolves (engine reference SEAT-9). Empty on a
      // driver seat or a manned gun: those fall back to the soldier's own
      // template, and `poseAnimation` staying null is the "no override" signal.
      if (data.seat?.poseAnimation && !seat.poseAnimation) {
        seat.poseAnimation = data.seat.poseAnimation;
      }
    } else if (kind === 'Camera') {
      const seat = seatFor(owner);
      if (!seat.camera) seat.camera = obj;   // first one wins, same rule Vehicle.collect() uses
      // camera-modes.md §3: CVM* booleans say which views the seat offers.
      // Omitted flags default on; only the ones actually declared land here.
      if (data.cameraView?.cvm) seat.cameraViewModes = data.cameraView.cvm;
    } else if (kind === 'RotationalBundle' && data.rig?.axes) {
      const seat = seatFor(owner);
      for (const axis of AXES) {
        const spec = data.rig.axes[axis];
        if (!spec) continue;
        // First bundle per axis name wins, EXCEPT:
        // 1. An axis the mouse actually reaches beats one it does not (V-100:
        //    turret vs steered front wheel under the same control).
        // 2. A movable aim axis (`maxSpeed > 0`) beats a zero-speed dummy on
        //    the same input (Stationary Browning: Point declares pitch at
        //    maxSpeed 0; Rotation owns the real elevation). First-wins alone
        //    bound pitch to Point and left elevation dead.
        // Losing the `seat.axes` slot costs the other bundle nothing:
        // `Vehicle.collect`/`applyRig` pose every declared bundle on their own.
        const held = seat.axes[axis];
        if (held) {
          const aimUpgrade = isAimAxis(spec) && !isAimAxis(held.spec);
          const speedUpgrade = isAimAxis(spec) && isAimAxis(held.spec)
            && Math.abs(held.spec.maxSpeed || 0) === 0
            && Math.abs(spec.maxSpeed || 0) > 0;
          if (!aimUpgrade && !speedUpgrade) continue;
        }
        seat.axes[axis] = { node: obj, spec };
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
    this.turret = null;         // TurretRig, whenever the active seat has one
    /** One rig per seat, kept for as long as this occupancy lives. Rebuilding
     *  it on every seat change would lose the angle the player left the turret
     *  at — climb from a Sherman's driver's seat to its hull gun and back and
     *  the tower snapped to hull-forward — and would also re-capture the
     *  node's rest pose from a node that may not be at rest yet. */
    this.turrets = new Map();
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

  /** Seat, root or nested, currently manned -- switches select the aim rig.
   *
   * Keyed on what the seat is WIRED to, not on what `classifySeat` calls it.
   * This used to ask for `'gun'`, which is the classification an Engine at the
   * root takes away: a Sherman's driving seat declares `ShermanTower`'s free
   * `c_PIMouseLookX` traverse at 35 deg/s and `ShermanGunBase`'s
   * `c_PIMouseLookY` elevation over -20..+5 — the real game's tank aiming,
   * sitting in our own extracted data — and classified as `'tank'`, so nothing
   * ever drove them and `applyRig` re-posed both to hull-forward every frame.
   * `hasAimAxes` asks the question the rig itself answers. */
  setActiveSeat(id) {
    this.activeSeatId = id;
    const seat = this.seatInfo(id);
    if (!seat || !hasAimAxes(seat)) {
      this.turret = null;
      return null;
    }
    let rig = this.turrets.get(id);
    if (!rig) {
      rig = new TurretRig(seat);
      this.turrets.set(id, rig);
    }
    // The nodes have been sitting wherever `applyRig` left them while this
    // seat was empty; put the rig's own angles back on before anything reads
    // a world pose off them this frame.
    rig.apply();
    this.turret = rig;
    return this.turret;
  }

  /** Re-assert every seat's aim rig on the scene graph.
   *
   * Called once a frame, right after the drivetrain's own `integrate` — which
   * ends in `applyRig`, and `applyRig` re-poses every declared
   * `RotationalBundle` from a surface table that never carries
   * `c_PIMouseLookX/Y`, i.e. back to hull-forward. Stepping only the ACTIVE
   * rig after that leaves every other seat's gun snapping to rest for as long
   * as nobody is sitting in it: climb out of a Sherman's driving seat with the
   * tower traversed 90 degrees and the tower whipped round to face front,
   * then back again when you returned. A turret stays where it was left. */
  applyTurrets() {
    for (const rig of this.turrets.values()) rig.apply();
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

// How fast an axis's velocity register winds up toward its commanded rate,
// deg/s^2 -- GUN-3's own `|acceleration|*dt` accumulation, which is
// `setAcceleration`'s magnitude and nothing else. An axis whose extract
// carries that number uses it (`spec.acceleration`, emitted by `con.py` from
// 2026-09-17); this is only the fallback for one that does not, which is
// every glb baked before then.
//
// Replaces a shared `TURRET_RAMP_TIME = 1.0` s, i.e. "every gun in the game
// takes one second to reach its own top rate". That is roughly right for the
// heavy mounts GUN-8 illustrates (a Defgun's real figures work out at 1.8 s
// yaw / 0.67 s pitch) and badly wrong for a tank turret, which is the
// complaint that produced this: a Sherman's 35 deg/s traverse spent the whole
// of a short flick still winding up, so the turret crawled where the game
// swings it. 90 deg/s^2 is the middle of the 30-150 band `setAcceleration`
// actually occupies across vanilla (flight-model.md §2a, confirmed), and at
// the Sherman's own 35 deg/s that is 0.39 s to the cap. Still a fallback, not
// a measurement -- the fix is to re-extract, after which the gun's own number
// wins.
//
// CRITICAL: `step` multiplies this by `speedScale` before applying it, so the
// wind-up time is maxSpeed/acceleration (the game's own ratio) regardless of
// how much the cap has been scaled up. Without the scale, a Defgun with
// speedScale=4 reaches 360 deg/s in 360/90 = 4 s instead of 360/360 = 1 s —
// the "moves very slowly, then builds up momentum" complaint, root-caused.
export const TURRET_ACCELERATION = 90;
// Degrees of aim the mouse asks for, per pixel of pointer-locked
// `movementX/Y`. This is `map.html`'s own `LOOK_SENS` (0.0022 rad/px) in
// degrees, on purpose: a gunner's hand should ask a turret for the same
// travel it asks a soldier's head for, and the turret's own rate cap is then
// the only thing that makes aiming one heavier than the other.
export const TURRET_DEGREES_PER_PIXEL = 0.0022 * 180 / Math.PI;

// How much aim can be BANKED, in degrees, waiting for the axis to deliver it.
// GUN-3's input register is hard-clamped to +-40 and this is that clamp, in
// this file's own units. Its job is to bound a flick, not to stop one: a
// player who throws the mouse across the pad asks for more travel than any
// turret can produce in one frame, and everything past this is dropped.
//
// Reduced from 90 — the old value banked nearly half a degree-second at the
// Defgun's cap (360 deg/s), so a fast flick left ~90 deg of aim still wound up
// in the register, the turret kept swinging at full rate for a quarter second
// after the hand stopped, and every short aim overshot its mark. 40 matches
// GUN-3's own clamp (manned-guns.md §3) and keeps the coast to a snap.
export const TURRET_PENDING_CLAMP = 40;

// The deadzone, GUN-3's own +-1.0 on the register: below this much banked
// aim, nothing moves.
export const TURRET_DEADZONE = 0.05;

// --- idle decay for the pending bank -----------------------------------------

// Frames of no mouse input before the pending bank starts draining. At 60 Hz
// this is ~50 ms — too short for the eye to notice on active aiming (pointer-
// lock delivers movement every frame), long enough that a single missed
// `movementX/Y` event on a fast swipe does not zero the bank.
export const TURRET_IDLE_DECAY_FRAMES = 3;

// Exponential decay rate (1/s) applied to the pending bank once the idle
// threshold is crossed. With the clamp at 40 deg and the Defgun's cap at 360
// deg/s, this drains a post-flick bank in ~0.15 s — the turret settles to a
// stop instead of coasting the rest of a quarter-second. [free]
export const TURRET_IDLE_DECAY = 12;

// What multiplies an axis's declared `setMaxSpeed` to get the rate it will
// actually turn at.
//
// It exists because `maxSpeed` as a literal deg/s ceiling does not survive
// contact with the game. `manned-guns.md` §3 is explicit that the +-40 input
// clamp is "not the template's `maxSpeed`", that `automaticReset` branches
// on whether `|acceleration|` multiplies `maxRotation` or `maxSpeed` and that
// "this downstream use was not closed out", and that the closed form of
// `angle += reg[0x110] * reg[0x128]` is open. So nothing confirms that a
// Sherman's `setMaxSpeed 35` is 35 degrees of traverse per second on screen,
// and taken literally it is roughly nine times slower than the same hand
// movement turns a soldier's head — reported twice from play as the turret
// being far slower than the game's.
//
// Tunable live with `?turret=<scale>` so a number can be settled by playing
// rather than by another guess. [free]
export const TURRET_SPEED_SCALE = 4;

let speedScale = TURRET_SPEED_SCALE;

/** Override the traverse-rate scale (`?turret=`). Returns what took effect. */
export function setTurretSpeedScale(value) {
  const scale = Number(value);
  if (Number.isFinite(scale) && scale > 0) speedScale = scale;
  return speedScale;
}

export function turretSpeedScale() { return speedScale; }

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

/** One RotationalBundle node, integrated per GUN-3's confirmed shape.
 *
 * The mouse asks for an ANGLE, not a rate. That is the correction this class
 * needed, and `manned-guns.md` §3 states the part of it that is confirmed
 * outright: the input register at `+0x128` *accumulates* raw input. This
 * class used to drain its sample to zero on every `step`, which threw away
 * two things at once — everything a fast frame asked for above the clamp, and
 * the whole of a flick the instant the hand stopped moving. A turret that can
 * only ever turn at "how fast is the mouse moving right now" cannot feel
 * connected to a hand, however the constants are tuned, and two rounds of
 * tuning it said so.
 *
 * So `feed` banks degrees and `step` spends them, as fast as the axis's own
 * rate allows, and what it spends it takes off the bank. Ordinary aiming
 * lands 1:1 with the pointer because the bank clears inside a frame or two;
 * a flick keeps the turret swinging after the hand has stopped, which is what
 * the accumulating register buys. The ramp between rates is still GUN-3's
 * `|acceleration|` accumulation, and the +-180 wrap and the min/max clamp are
 * still the confirmed ones.
 *
 * Open, and unchanged: the closed form of `angle += reg[0x110] * reg[0x128]`,
 * and therefore what the two registers' units really are. This is the
 * "tunable eased approach toward an input-scaled target" §3 asks for, not a
 * transcription.
 */
export class TurretAxis {
  constructor(axisName, node, spec) {
    this.axisName = axisName;
    this.node = node;
    this.spec = spec;
    this.base = node.quaternion.clone();
    this.angle = 0;      // degrees, relative to the authored rest pose
    this.velocity = 0;   // degrees/second, current
    this.pending = 0;    // degrees of aim asked for and not yet delivered
    // Frames since the mouse last fed this axis. When it grows past the idle
    // threshold (`TURRET_IDLE_DECAY_FRAMES`), the pending bank decays — see
    // `step` for why.
    this._idleFrames = 0;
  }

  /** Mouse motion arrives here, possibly several times before the next
   *  `step`, and is banked rather than replacing what was already asked for.
   *  `direction` is folded in here so everything downstream is in the node's
   *  own sense. Resets the idle counter so the bank is not decayed while the
   *  hand is moving.
   */
  feed(delta) {
    const asked = delta * TURRET_DEGREES_PER_PIXEL * (this.spec.direction || 1);
    this.pending = Math.max(-TURRET_PENDING_CLAMP,
      Math.min(TURRET_PENDING_CLAMP, this.pending + asked));
    this._idleFrames = 0;
  }

  step(dt) {
    if (!(dt > 0)) return;
    this._idleFrames += 1;
    // When the mouse has been idle for a few frames, let the banked aim decay
    // — GUN-3's input register (+0x128) carries the accumulated sample, and
    // without a drain a flick leaves it sitting there, the turret swinging
    // through the full pending clamp at full rate after the hand has stopped.
    // Reported from play as "overshoot": the axis keeps coasting long after
    // the pointer did. During active aiming `feed` resets `_idleFrames` to 0
    // every frame, so the decay never fights a living hand — it only fires in
    // the gap between the last `movementX/Y` and the next, which is the same
    // silence the game's own `automaticReset` branch answers.
    if (this._idleFrames > TURRET_IDLE_DECAY_FRAMES) {
      this.pending *= Math.exp(-dt * TURRET_IDLE_DECAY);
    }
    const pending = Math.abs(this.pending) > TURRET_DEADZONE ? this.pending : 0;
    // The rate the bank is asking for, held to what this axis can do.
    const cap = Math.abs(this.spec.maxSpeed || 0) * speedScale;
    const want = Math.max(-cap, Math.min(cap, pending / dt));
    // GUN-3's velocity register: it winds up at the axis's OWN
    // `setAcceleration` when the extract carries it, and at the fallback
    // otherwise -- see `TURRET_ACCELERATION`.
    //
    // The acceleration is scaled by `speedScale` just like the cap — without it
    // the ramp is 4× too slow (speedScale=4 means 360 deg/s cap but 90 deg/s²
    // ramp, so a Defgun takes a full 4 s to answer a flick instead of the
    // game's ~0.6–1.0 s). Scaling both keeps the wind-up time at
    // maxSpeed/acceleration, the game's own ratio.
    const maxStep = (this.spec.acceleration || TURRET_ACCELERATION) * speedScale * dt;
    const change = want - this.velocity;
    this.velocity += Math.max(-maxStep, Math.min(maxStep, change));
    let step = this.velocity * dt;
    // Never turn further than was asked for: overshooting the bank would
    // make the axis drift on after the hand stopped instead of settling.
    if (Math.abs(step) > Math.abs(this.pending)) {
      step = this.pending;
      this.velocity = step / dt;
    }
    this.angle += step;
    this.pending -= step;
    if (this.spec.free) {
      // Confirmed as-is (GUN-3): an unlimited axis (min==max, or neither
      // declared) wraps through +-180 instead of clamping.
      if (this.angle > 180) this.angle -= 360;
      else if (this.angle < -180) this.angle += 360;
    } else {
      const lo = Math.min(this.spec.min, this.spec.max);
      const hi = Math.max(this.spec.min, this.spec.max);
      // Pending is cleared at a stop too: aim banked against a wall would
      // otherwise sit there and snap the axis the moment it turned back.
      if (this.angle > hi) { this.angle = hi; this.velocity = 0; this.pending = 0; }
      else if (this.angle < lo) { this.angle = lo; this.velocity = 0; this.pending = 0; }
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
    // Only the axes this rig actually drives. It used to take every axis the
    // seat had and then feed none but the mouse-look pair, which pinned the
    // rest to their rest pose every frame instead of leaving them to
    // `applyRig`. Harmless while this was built for manned guns only — the
    // six vanilla/mod seats that mix inputs all pair mouse-look with a
    // `c_PIFire` barrel-spin axis nothing feeds either way — but not once a
    // drivetrain root can have one: the V-100's driving seat carries a turret
    // pitch beside `V-100FrontWheelR`'s own `c_PIYaw`, and claiming that
    // second axis would weld its front wheels straight.
    this.axes = AXES
      .filter(name => isAimAxis(seat.axes[name]?.spec))
      .map(name => new TurretAxis(name, seat.axes[name].node, seat.axes[name].spec));
    /**
     * A single multiplier on everything the player asks this rig for, set from
     * outside — **HP-15**, and the one hook the vehicle's damage state needs
     * in this file.
     *
     * `RotationalBundle::handlePlayerInput` (lnxded 0x081d834f) picks between
     * two near-identical duplicated blocks; the one it takes when the object's
     * `+0xee` byte is set multiplies each of the three input axes by the
     * double at `ds:0x86c8678` = **0.2** (0x081d83af / 0x081d83b7). So a
     * critically damaged vehicle still traverses, at a fifth of the rate. A
     * destroyed one is a separate, harder gate one level up —
     * `PlayerControlObject::handlePlayerInput` (0x08318920) returns before
     * forwarding input to any child at all — and reaches here as **0**.
     *
     * It is deliberately a scale on the **input**, applied here rather than
     * inside `TurretAxis`: the engine scales `PlayerInput` on its way into the
     * bundle, not the servo's own maxSpeed or acceleration, so a critical
     * turret's wind-up profile is unchanged and only the amount asked for
     * shrinks. It also keeps the whole of HP-15 out of `TurretAxis`, whose
     * servo is being replaced under GUN-2.
     *
     * `map.html` owns the value; `vehicle-damage.js`'s `inputGate` is the
     * rule that produces it.
     */
    this.inputScale = 1;
  }

  /**
   * Feed one frame's mouse motion in, in the browser's own screen sense:
   * `dx` positive rightwards, `dy` positive downwards, exactly as
   * `movementX`/`movementY` report them.
   *
   * NOT negated by the caller. It used to be — `lookDelta` passed
   * `(-dx, -dy)`, borrowed from the soldier's own `look()`, whose yaw counts
   * the other way — and the negation landed on top of `RIG_SIGN`'s own flip
   * inside `_apply`, so the sum of the two inverted both axes: the mouse
   * pushed right swung a gun left, and pushed down raised it. Measured on the
   * Sherman's hull Browning as well as its main gun, so this was wrong for
   * every manned gun in the viewer, not just the tank that exposed it.
   */
  aim(dx, dy) {
    // HP-15's single multiplier (see `inputScale`). 0 for a wreck, which takes
    // no player input at all, so the rig is left exactly where its last
    // occupant abandoned it rather than drifting or snapping home.
    const scale = this.inputScale;
    if (!(scale > 0)) return;
    for (const axis of this.axes) {
      if (axis.spec.input === 'c_PIMouseLookX') axis.feed(dx * scale);
      else if (axis.spec.input === 'c_PIMouseLookY') axis.feed(dy * scale);
    }
  }

  step(dt) {
    for (const axis of this.axes) axis.step(dt);
  }

  /** The traverse this rig currently sits at, in radians, in the same sense
   *  the node itself is rotated about its own up axis — i.e. already through
   *  `RIG_SIGN`, so a caller does not have to know this file's convention.
   *  Zero when the seat has no yaw axis to traverse (a fixed mount that only
   *  elevates). Read by `map.html` to drive the HUD's turret dial. */
  headingRadians() {
    for (const axis of this.axes) {
      if (axis.axisName === 'yaw') {
        return THREE.MathUtils.degToRad(axis.angle * RIG_SIGN.yaw);
      }
    }
    return 0;
  }

  /** Re-assert every axis's current angle on its node without advancing time.
   *  `applyRig` overwrites these nodes from the vehicle's own surface table
   *  every frame, so a rig that is not being stepped this frame — one whose
   *  seat has just become active again — needs this before anything reads a
   *  world pose off it. */
  apply() {
    for (const axis of this.axes) axis._apply();
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
    // `numOfMag` counts the loaded magazine, not the spares beside it — the
    // same reading `map.html`'s hand weapon already ships ("`magazines 5` is
    // read as the loaded magazine plus the spares", `hw.mags = magazines -
    // 1`, which is what puts a Thompson's confirmed 30/4 on the HUD instead
    // of 30/5). Counted as the spares here too, so `Ammo/PrimaryMag` means
    // the same thing in a seat as it does on foot and a Sherman carries the
    // 30 shells its `.con` declares rather than 30 plus a free reload.
    this.magsLeft = stats.numOfMag == null || stats.numOfMag < 0
      ? Infinity : Math.max(0, stats.numOfMag - 1);
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
