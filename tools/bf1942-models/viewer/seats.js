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
        // `automaticReset` is declared once per BUNDLE, not per axis (`con.py`
        // emits it beside `axes`), but it selects the whole control law a
        // `TurretAxis` runs under (GUN-2), so it is folded into the axis's own
        // spec here rather than making every consumer carry the rig object
        // alongside. A spec that already names it -- a hand-built test
        // fixture -- keeps its own value.
        seat.axes[axis] = {
          node: obj,
          spec: spec.automaticReset === undefined && data.rig.automaticReset
            ? { ...spec, automaticReset: true } : spec,
        };
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

  /**
   * VHUD-9's trigger for the HUD's turret dial:
   *
   *   ShowTurretIcon = (seatCamera.getViewMode() == 3)
   *                    && pcoTemplate.getHasTurretIcon()
   *
   * read at client `0x006ae597`–`0x006ae5d1`. Both halves matter, and the
   * viewer had neither: it showed the dial for any seat with a traverse, in
   * any view.
   *
   * The template queried is the **controlled** PCO's, not the vehicle root's
   * — `arg0`'s own `queryInterface(IID_IPlayerControlObjectTemplate)`. That
   * distinction is load-bearing: `setHasTurretIcon` is declared on vehicle
   * ROOTS only (7 vanilla templates, all turreted tanks; never a casemate
   * hull like the Wespe or StuG, which is why those must stop getting a
   * dial), so a Sherman's hull gunner — whose controlled PCO is
   * `shermanBrowning_PCO1` — gets none either. `activeHud()`'s root fallback
   * is therefore deliberately NOT used here.
   *
   * `viewMode == 3` is the inside view; the enum's own numbering was not
   * derived, only that 3 is the one that shows the dial and that chase views
   * do not (`ingame-hud.md`: "it needs the template's own `setHasTurretIcon`
   * and an inside view"). `map.html` passes its own first-person state.
   *
   * A scene baked before `con.py` learned the word carries no
   * `hasTurretIcon` at all and so shows no dial until it is re-extracted.
   * That is the correct failure: the alternative is keeping the wrong dial on
   * every casemate hull.
   */
  showsTurretIcon(insideView) {
    if (!insideView) return false;
    return this.seatInfo(this.activeSeatId)?.hud?.hasTurretIcon === true;
  }

  /**
   * The seat-occupancy dots, VHUD-11's data and VHUD-2's states, for the six
   * slots `hud-layout.json` draws.
   *
   * Each returned entry is `{ state, x, y }`. `x`/`y` come straight from the
   * seat's own PCO template (`setVehicleIconPos`, parsed by `con.py` since
   * this round) and are positions inside the 128x128 vehicle-icon texture —
   * the same space VHUD-7's `(192 + X, 452 + Y)` anchor works in, so the
   * Sherman's root `54/103` lands at (246, 555), inside the icon. A seat whose
   * extract has no position yields `null` for it and `hud.js` falls back to
   * the layout's own literal rect.
   *
   * `state` is `BfOccupiedVehicleData`'s five-entry icon table (VHUD-2,
   * vtable `0x0093f300` read as raw bytes): 0 draws nothing, 1
   * `vehicledot_local`, 2 `vehicledot_empty`, 3 `vehicledot_friend`, 4
   * `vehicledot_enemy`. **Which live state a given seat resolves to was NOT
   * read** — that half of VHUD-2 is still open — so this viewer answers the
   * only question it can: the seat you are sitting in is 1 and every other
   * declared seat is 2. There are no other occupants to be a 3 or a 4, and
   * inventing one would be a guess dressed as engine behaviour.
   *
   * Seats past the sixth get no dot: the layout has six `occupied-seat`
   * leaves and the engine has six `VehiclePosX1..6`/`Y1..6` pairs.
   *
   * A seat whose extract carries no `setVehicleIconPos` is state **0** — the
   * table's own "draws nothing" — and NOT a 1 or a 2 with a null position.
   * Every PlayerControlObject in the game declares the word (19,085 of
   * 19,089 declarations across 18 installs), so the only way to reach this is
   * a scene baked before `con.py` learned it, and for that scene there is no
   * place to put the dot: `hud-layout.json`'s own rects are the variables'
   * authored placeholders, a 5px diagonal staircase from (247,457), not six
   * seat positions. Measured on the page: with the pairs fed, that corner
   * holds 0 texels of dot; with them deleted, 66. Six dots in the wrong place
   * assert a seat layout the data does not have, so nothing is drawn until
   * the vehicle is re-extracted.
   */
  seatDots() {
    return this.order.slice(0, 6).map(id => {
      const seat = this.seatInfo(id);
      const pos = seat?.hud?.vehicleIconPos;
      const placed = Array.isArray(pos)
        && typeof pos[0] === 'number' && typeof pos[1] === 'number';
      return {
        state: !placed ? 0 : id === this.activeSeatId ? 1 : 2,
        x: placed ? pos[0] : null,
        y: placed ? pos[1] : null,
      };
    });
  }

  /** The node whose `physics.soldierExitLocation` (if any) should place the
   *  soldier stepping out of the currently manned seat. */
  exitLocationNode() {
    const seat = this.seatInfo(this.activeSeatId);
    return seat?.node?.userData?.physics?.soldierExitLocation ? seat.node : this.root;
  }
}

// --- manned-gun aiming (GUN-2, closed form; GUN-2b, the one open number) ---
//
// `RotationalBundle::calculateAndClipAngle` (lnxded `0x081d7490`) was read
// end to end in the 2026-09-19 round -- all 361 instructions, re-traced
// independently -- so the shape below is a transcription, not an
// approximation. It is a **first-order velocity servo**, and the earlier
// reading here ("two accumulators whose PRODUCT drives the angle", a +-40
// input register, a +-1.0 deadzone, a `lo == hi` wrap) was wrong on every
// one of those four points:
//
//   speed  ->  sign(acceleration) * input * maxSpeed,  ramped at
//              |acceleration| deg/s^2
//   angle  +=  speed * dt  +  continousRotationSpeed * dt
//   then:  minRotation == 0 && maxRotation == 0  ->  a single +-360 wrap
//          otherwise  angle > max -> max,  else  angle < min -> min
//
// Degrees throughout. Three consequences the viewer never had:
//
//   * `continousRotationSpeed * dt` is added EVERY tick, whatever the input
//     is doing, in the non-`automaticReset` path.
//   * `automaticReset` is a different control law entirely -- see
//     `_stepAutomaticReset`. 221 vanilla templates declare it.
//   * The wrap test is on the two bounds being ZERO, not on their being
//     equal. `min == max == 45` pins the axis at 45; it does not spin.
//
// `direction = sign(acceleration)` (`con.py`) matches the engine's
// `fchs`-on-negative-acceleration exactly and is kept.
//
// What is NOT closed is GUN-2b: `maxSpeed` is a **gain, deg/s per unit of
// input**, and nobody has yet read what magnitude the client's mouse-look
// axis delivers as `PlayerInput[c_PIMouseLookX/Y]`. Everything between a
// pointer-lock pixel and that number is this file's own choice, and it is
// made in one place (`step`'s input normalisation plus
// `TURRET_SPEED_SCALE`), labelled as such.

const RIG_AXIS = { yaw: 'y', pitch: 'x', roll: 'z' };   // flight.js's own convention, mirrored
const RIG_SIGN = { yaw: -1, pitch: -1, roll: 1 };       // (unexported there; kept identical here)

// The ramp rate for an axis whose extract does not carry its own
// `setAcceleration`, deg/s^2. An axis that does carry it uses that number
// (`spec.acceleration`, emitted by `con.py` since 2026-09-17); this is the
// fallback for every glb baked before then.
//
// 90 deg/s^2 is the middle of the 30-150 band `setAcceleration` occupies
// across vanilla (flight-model.md §2a, confirmed). Still a fallback, not a
// measurement -- the fix is to re-extract, after which the gun's own number
// wins. A Sherman tower's real number is 1000, an MG42's 5000; at those
// rates the ramp is essentially instant and the cap is what the hand feels.
//
// CRITICAL: `step` multiplies this by `speedScale` alongside the cap, so the
// wind-up TIME stays `maxSpeed/acceleration` -- the game's own ratio --
// however far `TURRET_SPEED_SCALE` moves the cap. Scale one without the
// other and a Defgun takes four times as long to answer a flick.
export const TURRET_ACCELERATION = 90;
// Degrees of aim the mouse asks for, per pixel of pointer-locked
// `movementX/Y`. This is `map.html`'s own `LOOK_SENS` (0.0022 rad/px) in
// degrees, on purpose: a gunner's hand should ask a turret for the same
// travel it asks a soldier's head for, and the turret's own rate cap is then
// the only thing that makes aiming one heavier than the other.
export const TURRET_DEGREES_PER_PIXEL = 0.0022 * 180 / Math.PI;

// What multiplies an axis's declared `setMaxSpeed` to get the rate it will
// actually turn at.
//
// GUN-2b is the reason it exists, and the reason it stays. `maxSpeed` is a
// **gain** -- deg/s per unit of input -- so "a Sherman's `setMaxSpeed 35` is
// 35 deg/s on screen" is only true if the mouse delivers an input of exactly
// 1, and nothing establishes that it does:
//
//   * The +-1 clamp on the input lives inside the `rememberExcessInput`
//     branch, and across 18 installs NOT ONE turret, manned gun, tank or
//     `Objects.con` rotational bundle declares that flag (vanilla's 32 uses
//     are all aircraft rudder and tail-flap `Wing` bundles). For every gun
//     the input is raw and unclamped.
//   * The wire format reserves headroom to **+-16**: `PlayerAction::set`
//     packs every `PlayerInput` float with `floatToFixed(v, 12, 16.0f)` and
//     `get` decodes `((n/4095)*2 - 1)*16.0`. An input normalised to +-1
//     would leave fifteen sixteenths of the encoding dead.
//   * The "a soldier's head turns nine times faster for the same hand
//     movement" observation, which is what originally produced this number,
//     compares two different control laws: `SoldierCamera` declares
//     `setMaxSpeed 0/0/0` and so never enters `calculateAndClipAngle` at all.
//
// So the OPEN question this constant stands in for is narrow and stated:
// **what magnitude the client's mouse-look axis delivers as
// `PlayerInput[c_PIMouseLookX/Y]`.** The trail runs as far as the client's
// `ControlMap.addAxisToAxisMapping` registrars (`FUN_006bba90` /
// `FUN_006bbd90`) without reaching the multiply. Until someone reads it,
// this is the viewer's stand-in for that gain and must be left alone --
// removing it or "correcting it to 1" was checked against the binary and
// refuted (ledger GUN-2b).
//
// Tunable live with `?turret=<scale>` so a number can be settled by playing
// rather than by another guess.
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

/**
 * One RotationalBundle axis, run as the engine's own first-order velocity
 * servo (GUN-2, lnxded `0x081d7490`).
 *
 * Two registers, both on the instance and both persisting between ticks:
 * `angle` (engine `+0x104`, degrees from the authored rest pose) and `speed`
 * (engine `+0x110`, deg/s). Each tick the servo ramps `speed` toward
 * `sign(acceleration) * input * maxSpeed` at `|acceleration|` deg/s^2 and
 * integrates it, plus the continuous term, into `angle`.
 *
 * This replaced a bank-and-spend model in which `feed` accumulated DEGREES
 * OF AIM into a `pending` register clamped to +-40 and `step` paid them out.
 * Every part of that had a citation that turned out to be a misreading of the
 * same function: the engine's `+0x128` register is an **input backlog in
 * input units**, its +-40 clamp and its `-1.0` companion both live inside the
 * `rememberExcessInput` branch, and **no** turret, manned gun or tank in any
 * of 18 installs declares that flag -- so for every gun in this viewer that
 * register does not exist at all. There is no deadzone, no idle decay and no
 * "never turn further than was asked": those were feel patches compensating
 * for a bank the engine never had.
 *
 * The one thing kept from the old model is that `feed` may be called several
 * times before a `step` (pointer lock can deliver more than one `mousemove`
 * per frame). The pixels accumulate and are converted to an input ONCE, in
 * `step`, against that tick's own `dt`.
 */
export class TurretAxis {
  constructor(axisName, node, spec) {
    this.axisName = axisName;
    this.node = node;
    this.spec = spec;
    this.base = node.quaternion.clone();
    this.angle = 0;      // degrees from the authored rest pose (engine +0x104)
    this.speed = 0;      // deg/s, the servo's velocity register (engine +0x110)
    this._pixels = 0;    // this tick's un-consumed pointer motion
  }

  /** Pointer motion for the coming tick, in the browser's own screen sense.
   *  Accumulates; `step` consumes and zeroes it. */
  feed(delta) {
    this._pixels += delta;
  }

  /**
   * One tick.
   *
   * `inputScale` multiplies the sampled input before the servo sees it, which
   * is exactly where the engine applies HP-15's damage penalty:
   * `RotationalBundle::handlePlayerInput` (`0x081d834f`) scales all three
   * axes by the double at `ds:0x86c8678` = **0.2** when `SimpleObject+0xee`
   * is set, i.e. while the vehicle is critically damaged. `map.html` passes
   * that 0.2 in; everything else passes nothing and gets 1.
   */
  step(dt, inputScale = 1) {
    if (!(dt > 0)) return;
    const pixels = this._pixels;
    this._pixels = 0;

    // GUN-2b, and the only invented quantity in this function. The engine's
    // `input` is `PlayerInput[c_PIMouseLookX/Y]`, whose magnitude nobody has
    // read; `maxSpeed` is the deg/s it buys per unit of it. This viewer's
    // choice is that a hand asking for more travel per second than the axis's
    // own scaled ceiling delivers input 1 -- so `maxSpeed * TURRET_SPEED_SCALE`
    // is the viewer's traverse ceiling, which is the behaviour this file has
    // shipped all along and the part players have already judged. Stated as a
    // choice, not transcribed as a fact.
    const cap = Math.abs(this.spec.maxSpeed || 0) * speedScale;
    const asked = pixels * TURRET_DEGREES_PER_PIXEL / dt;   // deg/s the hand wants
    const unit = cap > 0 ? Math.max(-1, Math.min(1, asked / cap)) : 0;
    // `direction` is `sign(acceleration)`, the engine's own
    // `fchs`-on-negative-acceleration; `inputScale` is HP-15's 0.2.
    const input = unit * (this.spec.direction || 1) * inputScale;

    // `|acceleration|`. Scaled with the cap so the wind-up TIME is the game's
    // ratio whatever `TURRET_SPEED_SCALE` is -- see `TURRET_ACCELERATION`.
    // NOTE: `con.py` omits a zero `setAcceleration` rather than emitting 0, so
    // the engine's own early-out (`acceleration == 0 && continousRotationSpeed
    // == 0` returns without touching either register) cannot be told apart
    // from "this glb predates the field". The fallback is applied in both
    // cases, which is the pre-existing behaviour and the safe one.
    const accel = Math.abs(this.spec.acceleration || TURRET_ACCELERATION);

    if (this.spec.automaticReset) {
      this._stepAutomaticReset(dt, input, accel);
    } else {
      // The servo proper. `speed` chases the commanded rate; `angle`
      // integrates it AND the continuous term, which is added every tick
      // whatever the input is doing -- that unconditional `+=` is the whole
      // of `setContinousRotationSpeed`'s effect here.
      const target = input * cap;
      const maxStep = accel * speedScale * dt;
      const change = target - this.speed;
      this.speed += Math.max(-maxStep, Math.min(maxStep, change));
      this.angle += this.speed * dt + (this.spec.continuousRotation || 0) * dt;
    }
    this._clip();
    this._apply();
  }

  /**
   * `automaticReset`'s law, which shares nothing with the servo but the
   * clip: the angle ramps STRAIGHT toward `input * maxRotation` at
   * `|acceleration|` **deg/s** -- a rate, not an acceleration -- with no
   * velocity register and no continuous-rotation term. Release the input and
   * the target is 0, so the part returns to rest at the same rate: that is
   * what makes a steering wheel self-centre and why 221 vanilla templates
   * (steering wheels and Engines) declare it.
   *
   * `maxRotation` is the per-axis `setMaxRotation` component, which `con.py`
   * drops when the axis is free -- and free means both bounds are zero, so
   * an absent `max` here really is the engine's 0 and the part ramps home.
   *
   * `speedScale` is deliberately NOT applied: it is a stand-in for the
   * unknown input magnitude against `maxSpeed`'s gain (GUN-2b), and this law
   * never reads `maxSpeed`.
   */
  _stepAutomaticReset(dt, input, accel) {
    const target = input * (this.spec.max || 0);
    const limit = accel * dt;
    const delta = target - this.angle;
    this.angle += Math.max(-limit, Math.min(limit, delta));
    this.speed = 0;
  }

  /**
   * The engine's own tail, in its own order (`0x081d7645` onward).
   *
   * The wrap gate is `minRotation == 0 && maxRotation == 0` -- the template
   * default -- and NOT a zero-width range: `min == max == 45` clamps to 45.
   * `con.py`'s `free` carries that test. When it fires it is a single +-360
   * correction, not a modulo, which is why a tick big enough to travel more
   * than a full turn is not normalised (the engine does not normalise it
   * either).
   *
   * The clamp tests `> max` FIRST and `< min` second, on the authored
   * components in the order the `.con` gave them -- it does not sort them.
   * Nothing zeroes the velocity register at a bound, so an axis held against
   * its stop keeps its speed and answers a reversed input by ramping through
   * zero, exactly as it would in mid-travel.
   */
  _clip() {
    if (this.spec.free) {
      if (this.angle > 180) this.angle -= 360;
      else if (this.angle < -180) this.angle += 360;
    } else {
      const hi = this.spec.max ?? 0;
      const lo = this.spec.min ?? 0;
      if (this.angle > hi) this.angle = hi;
      else if (this.angle < lo) this.angle = lo;
    }
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
    for (const axis of this.axes) {
      if (axis.spec.input === 'c_PIMouseLookX') axis.feed(dx);
      else if (axis.spec.input === 'c_PIMouseLookY') axis.feed(dy);
    }
  }

  /**
   * One tick for every axis this rig drives.
   *
   * `inputScale` is passed straight through to each `TurretAxis.step` and is
   * HP-15's damage penalty: **0.2** while the vehicle is critically damaged,
   * 1 otherwise. `map.html` owns deciding which, since it is the only thing
   * that knows the hull's live Armor.
   */
  step(dt, inputScale = 1) {
    for (const axis of this.axes) axis.step(dt, inputScale);
  }

  /** The traverse this rig currently sits at, in radians, in the same sense
   *  the node itself is rotated about its own up axis — i.e. already through
   *  `RIG_SIGN`, so a caller does not have to know this file's convention.
   *  Zero when the seat has no yaw axis to traverse (a fixed mount that only
   *  elevates).
   *
   *  NOT what the HUD's turret dial wants: see `turretYawRadians`. */
  headingRadians() {
    for (const axis of this.axes) {
      if (axis.axisName === 'yaw') {
        return THREE.MathUtils.degToRad(axis.angle * RIG_SIGN.yaw);
      }
    }
    return 0;
  }

  /**
   * The same traverse, in the ENGINE's sign rather than three.js's — positive
   * to the controlled PCO's right, which is what VHUD-9's
   * `IconLookRotation = atan2(dot(pcoRight, camForward), dot(pcoForward,
   * camForward))` measures for a tank driver whose camera rides the turret.
   *
   * It exists because `headingRadians()` has `RIG_SIGN.yaw = -1` baked in, and
   * the HUD dial used to be fed from it. That was two errors cancelling: the
   * engine's `RotateEffect` (`0x007edbf0`: `x' = x·c + y·s`, `y' = -x·s + y·c`)
   * is **counter-clockwise** on a y-down HUD frame while canvas `rotate(+θ)`
   * is clockwise, and the extra `-1` hid it. `hud.js` now rotates by `-angle`,
   * so the value it is given has to be the un-negated engine one — the two
   * halves only look right together. `undefined`, not 0, when the seat has no
   * traverse, so `map.html` can tell "no dial" from "dial at twelve o'clock".
   */
  turretYawRadians() {
    for (const axis of this.axes) {
      if (axis.axisName === 'yaw') return THREE.MathUtils.degToRad(axis.angle);
    }
    return undefined;
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
