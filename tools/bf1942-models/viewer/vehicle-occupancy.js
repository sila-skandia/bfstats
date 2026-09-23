// One vehicle's occupancy: its seat table tied to the drivetrain its root
// classifies to, one aim rig per seat, and the per-seat reads (eye, guns,
// HUD block, seat dots, exit point). Split out of `seats.js`, which
// re-exports it.

import { resolveSeatDots, SEAT_DOT_SLOTS } from './seat-dots.js';
import { byWeaponSlot } from './bomb-release.js';
import { DRIVE_KINDS, classifySeat, hasAimAxes, surveyVehicle } from './seat-survey.js';
import { TurretRig } from './turret-rig.js';

/**
 * Ties one vehicle's seat table to whichever drivetrain class its root
 * classifies to, and keeps one aim rig per seat. `vehicle-instance.js` builds
 * exactly one per hull and keeps it for as long as any seat is occupied; each
 * occupant's seat is its own `SeatHandle`, which asks the per-seat forms
 * (`rigFor`, `cameraNodeOf`, `fireArmsNodesOf`, ...). `activeSeatId` and the
 * methods named after it remain for a single-occupant caller.
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
    if (this.drive || !DRIVE_KINDS.includes(this.rootKind)) return this.drive;
    const { Aircraft, GroundVehicle, TrackedVehicle, Ship } = this.classes;
    if (this.rootKind === 'air') this.drive = new Aircraft(this.root, parent, options);
    else if (this.rootKind === 'ground') this.drive = new GroundVehicle(this.root, parent, options);
    // A helm with no `Ship` class injected stays a bare seat rather than
    // becoming a Corsair: `Aircraft`'s own spec table falls back to the
    // CORSAIR numbers, which on a 2,500-tonne hull is not a degraded ship, it
    // is a different vehicle. Same rule `TrackedVehicle` gets, opposite answer,
    // because `GroundVehicle` on a tank hull IS a degraded tank.
    else if (this.rootKind === 'ship') this.drive = Ship ? new Ship(this.root, parent, options) : null;
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
    this.turret = this.rigFor(id);
    return this.turret;
  }

  /** The aim rig of seat `id`, built the first time that seat is manned and
   *  kept for as long as this occupancy lives; null for a seat with no aim
   *  axes. Every occupant of a hull reads its own seat's rig through this
   *  (`vehicle-instance.js`), so a gunner and a driver aim two rigs of one
   *  seat model. */
  rigFor(id) {
    const seat = this.seatInfo(id);
    if (!seat || !hasAimAxes(seat)) return null;
    let rig = this.turrets.get(id);
    if (!rig) {
      rig = new TurretRig(seat);
      this.turrets.set(id, rig);
    }
    // The nodes have been sitting wherever `applyRig` left them while this
    // seat was empty; put the rig's own angles back on before anything reads
    // a world pose off them this frame.
    rig.apply();
    return rig;
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

  cameraNode() { return this.cameraNodeOf(this.activeSeatId); }

  /** Seat `id`'s eye: its Camera node, else the seat node, else the root. */
  cameraNodeOf(id) {
    const seat = this.seatInfo(id);
    return seat?.camera || seat?.node || this.root;
  }

  /**
   * The FireArms nodes `collectGuns()` should scope firing to, primary first.
   *
   * `map.html`'s ammo panel reads `nodes[0]` as the primary weapon-icon slot
   * and `nodes[1]` as the secondary, and that used to be declaration order.
   * `byWeaponSlot` sorts on the declared trigger instead -- `c_PIFire` before
   * `c_PIAltFire`, stably -- which is what puts the B17's bombs in the PRIMARY
   * slot, where `setNumberOfWeaponIcons 1` and `setPrimaryAmmoIcon
   * "Ammo/Icon_bomb.tga"` say they belong (ledger BOMB-7: its pilot carries a
   * rack and no gun). A Sherman's cannon and coax are both `c_PIFire` and keep
   * the order they were declared in. It is a design choice and not a derived
   * fact -- VHUD-10 is still open -- and `byWeaponSlot` carries why.
   *
   * Firing does not depend on the order (world.js keys each node on its own
   * `input`), so this is the HUD's rule and nothing else changes behind it.
   */
  activeFireArmsNodes() { return this.fireArmsNodesOf(this.activeSeatId); }

  /** Seat `id`'s FireArms nodes, primary first (see `activeFireArmsNodes`). */
  fireArmsNodesOf(id) {
    return byWeaponSlot(this.seatInfo(id)?.fireArms || []);
  }

  /** `Vehicle/*` HUD block for the currently manned seat, falling back to the
   *  vehicle's own (a nested seat rarely repeats `setVehicleIcon`). */
  activeHud() { return this.hudOf(this.activeSeatId); }

  /** Seat `id`'s `Vehicle/*` HUD block, else the root's. */
  hudOf(id) {
    return this.seatInfo(id)?.hud || this.seatInfo(this.rootId)?.hud || null;
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
  showsTurretIcon(insideView) { return this.showsTurretIconAt(this.activeSeatId, insideView); }

  /** `showsTurretIcon` for seat `id`. */
  showsTurretIconAt(id, insideView) {
    if (!insideView) return false;
    return this.seatInfo(id)?.hud?.hasTurretIcon === true;
  }

  /**
   * The seat-occupancy dots, VHUD-11's data and VHUD-2's states, for the six
   * slots `hud-layout.json` draws.
   *
   * Each returned entry is `{ state, x, y }`. `x`/`y` come straight from the
   * seat's own PCO template (`setVehicleIconPos`, parsed by `con.py` since
   * wave 2) and are positions inside the 128x128 vehicle-icon texture —
   * the same space VHUD-7's `(192 + X, 452 + Y)` anchor works in, so the
   * Sherman's root `54/103` lands at (246, 555), inside the icon. A seat whose
   * extract has no position yields `null` for it and `hud.js` falls back to
   * the layout's own literal rect.
   *
   * `state` is `BfOccupiedVehicleData`'s five-entry icon table (VHUD-2,
   * vtable `0x0093f300` read as raw bytes): 0 draws nothing, 1
   * `vehicledot_local`, 2 `vehicledot_empty`, 3 `vehicledot_friend`, 4
   * `vehicledot_enemy`. The states are resolved in `seat-dots.js` from the
   * live occupancy: the seat this occupancy is sitting in is 1, a seat an
   * `occupants` row names is 3 or 4 by that player's team against
   * `localTeam`, and everything else is 2. `occupants` is the page's job to
   * gather — it is the room's other players seated in THIS vehicle, as
   * `{ seat, team }` rows in this survey's own position numbering — because
   * this class only ever knows the local player's seat.
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
  seatDots(occupants = [], localTeam = 0) {
    return this.seatDotsAt(this.activeSeatId, occupants, localTeam);
  }

  /** `seatDots` with the local player sitting in seat `id` (null: none). */
  seatDotsAt(id, occupants = [], localTeam = 0) {
    const iconPos = this.order.slice(0, SEAT_DOT_SLOTS).map(id => {
      const pos = this.seatInfo(id)?.hud?.vehicleIconPos;
      return Array.isArray(pos)
        && typeof pos[0] === 'number' && typeof pos[1] === 'number'
        ? pos : null;
    });
    const localSeat = id == null ? null : this.order.indexOf(id);
    return resolveSeatDots({
      iconPos,
      localSeat: localSeat >= 0 ? localSeat : null,
      occupants,
      localTeam,
    });
  }

  /** The node whose `physics.soldierExitLocation` (if any) should place the
   *  soldier stepping out of the currently manned seat. */
  exitLocationNode() { return this.exitLocationNodeOf(this.activeSeatId); }

  /** `exitLocationNode` for seat `id`. */
  exitLocationNodeOf(id) {
    const seat = this.seatInfo(id);
    return seat?.node?.userData?.physics?.soldierExitLocation ? seat.node : this.root;
  }
}
