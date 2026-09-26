// The human: his seat of a hull's instance (enter, exit, the seat switch,
// the doors he walks up to), his view of it (the seat's `VehicleCamera`, the
// chase law, the cockpit swap, the pilot, driver, gunner and passenger
// cameras), his soldier on foot (the mode switch, his Armor, his death),
// his look (the mouse pumped once a frame into the world's per-tick input)
// and the render interpolation between world ticks his camera is drawn at.
// `localPlayer.occupancy` / `aircraft` / `car` look his seat up in the
// vehicle registry on every read (features/vehicle-instance-refactor).
// Lifted out of map.html (Part 2).

import * as THREE from 'three';
import { FOV_DEG as FOOT_FOV } from './soldier.js';
import { hitFromDirAlpha, hitFromDirOctant } from './hud.js';
import { Armor } from './armor.js';
import { deathFamily } from './soldier-death.js';
import { PARA_FALLING } from './parachute.js';
import { routeFlightInput } from './mouse-look-key.js';
import { mayEnterHull } from './vehicle-instance.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `applyLook`, `buildSeatView`, `buildSpawnFlags`, `camera`, `captured`,
 * `clampMobileInput`, `clearVehicleHud`, `axis`, `deployActive`,
 * `deployTeamId`,
 * `disposeHandWeapon`, `disposeSeatPose`, `EMPTY_KEYS`,
 * `feedMobileTurretAim`, `feedVehicleHud`, `flyFreeCamera`, `followSeat`,
 * `footLookPair`, `forgetSeatViews`, `handleParachuteEvent`, `handleSoldierFootstep`,
 * `hudBridge`, `kbLockLeave`, `keys`, `killOccupantInSeat`, `loadSeatPose`, `LOCAL_PLAYER`,
 * `lookKeyHeld`, `lookNeedsKey`,
 * `mobileJumpHeld`, `mobilePadAxis`, `mobilePadHeld`,
 * `mobilePadVector`, `mouseInput`, `netSeatRow`, `netSendAction`,
 * `netVehicleIdFor`, `noteOccupiedVehicle`, `onFootCamera`, `optOnFoot`,
 * `optPilot`, `pickVehicle`, `playSoldierDeathSound`, `playSoldierHurtSound`, `pumpLook`,
 * `rebuildVehicleInterp`, `remoteCrewTeam`, `roomJoined`, `seatAltFire`,
 * `seatedCamera`, `seatFire`, `showFlagPicker`, `spawnAtFlag`,
 * `stepSeatIk`, `stopFallSound`, `syncFootBody`, `toggleFullMap`, `touchFlying`,
 * `triggerHitIndicator`, `updateMobileControls`, `vehicles`, `view`,
 * `viewFor`, `warmSubtree`, `world`.
 */
export function createLocalPlayer(page) {
  const localPlayer = {
    get occupancy() { return page.vehicles.seatOf(page.LOCAL_PLAYER); },
    get aircraft() {
      const seat = page.vehicles.seatOf(page.LOCAL_PLAYER);
      const drive = seat?.instance.drive;
      return drive && (seat.rootKind === 'air' || seat.rootKind === 'ship') ? drive : null;
    },
    get car() {
      const seat = page.vehicles.seatOf(page.LOCAL_PLAYER);
      const drive = seat?.instance.drive;
      return drive && seat.rootKind !== 'air' && seat.rootKind !== 'ship' ? drive : null;
    },
    get vehicleGuns() { return page.vehicles.seatOf(page.LOCAL_PLAYER)?.groups.driven ?? []; },
    get mannedGuns() { return page.vehicles.seatOf(page.LOCAL_PLAYER)?.groups.manned ?? []; },
  };

  /**
   * Occupy `node` (any `PlayerControlObject` root — a flyable/drivable one,
   * a `c_ETTank`, a bare gun/seat furniture root) at `seatId`, or the root seat
   * when `seatId` is omitted. One `VehicleOccupancy` (`seats.js`) now backs
   * every kind: `air`/`ground`/`tank` additionally get a real drivetrain built
   * on it (unchanged interface, so `drive()`/`pilot()`/`view` need nothing new
   * to keep working when the *root* seat is the one active), and `gun`/`seat`
   * roots — and any nested seat of any of the above — run on `occupancy` alone,
   * stepped by `manned()` (`mannedActive()` decides which, in `frame()`'s
   * dispatch).
   */
  // The two mode boxes are the mode. This module runs the transitions
  // (`setPilot`, `setOnFoot`); others that need the flag alone mark it here.
  /** Out of the seat, if in it: the box and the transition together. */
  function leavePilot() {
    if (!page.optPilot.checked) return;
    page.optPilot.checked = false;
    setPilot(false);
  }
  /** The flags without their transitions: the deploy flow arms on-foot before
   *  the soldier exists, and a wreck has already emptied the seat. */
  localPlayer.markPilot = on => { page.optPilot.checked = !!on; };
  /** Off foot, if on it: the box and the transition together. */
  localPlayer.leaveOnFoot = () => {
    if (!page.optOnFoot.checked) return;
    page.optOnFoot.checked = false;
    setOnFoot(false);
  };
  localPlayer.markOnFoot = on => { page.optOnFoot.checked = !!on; };

  function setPilot(on, node = null, seatId = null) {
    if (on) {
      const current = localPlayer.occupancy;
      const target = node || current?.root || page.pickVehicle();
      if (!target) {
        page.optPilot.checked = false;
        return;
      }
      let seat;
      if (current && current.root === target) {
        // Re-entering the same vehicle at a specific door (its own EntryPoint
        // was in reach again) rather than wherever you last sat.
        seat = seatId ? page.vehicles.switchSeat(page.LOCAL_PLAYER, seatId) : current;
        if (seat && seatId) page.disposeSeatPose();
      } else {
        // A different vehicle than the one already held. Every exit path has
        // already given the old seat back; this is the defensive case.
        if (current) leaveSeat();
        // Root seat unless a specific `EntryPoint` said otherwise — walking
        // straight up to a Sherman's hull-gunner door seats you there directly,
        // never through the driver's seat first. The hull's instance builds the
        // drivetrain when its root seat is taken, adopts it into the body world,
        // thaws the node, collects this seat's guns, mounts the world's record
        // and claims the audio (`vehicle-instance.js`).
        seat = page.vehicles.enter(target, seatId, page.LOCAL_PLAYER);
      }
      // The seat is held by someone else: nothing happens, as a full seat in
      // the engine refuses the toggle. The caller reads `localPlayer.occupancy`.
      if (seat) mountLocalSeat(seat);
    } else if (localPlayer.occupancy) {
      // The seat's gone; tell the server so the others' replicas release it.
      const netSeat = page.netSeatRow('exit');
      leaveSeat({ reset: true });
      if (netSeat) page.netSendAction(netSeat);
    } else {
      page.world?.clearPlayerVehicle(page.LOCAL_PLAYER);
    }
    page.world?.resetStick(page.LOCAL_PLAYER);
    // Climbing in or out moves the drawn set and the camera both; re-collect
    // the nodes a tick poses and start a fresh pair (the render-interpolation
    // block, beside `footLookPending`).
    page.rebuildVehicleInterp();
    page.updateMobileControls();
  }

  /**
   * Whether the human may take a seat of the hull at `root`: the engine's
   * entry rule (`vehicle-instance.js mayEnterHull`) against the hull's crew
   * on this page -- bots, and himself when he is already aboard -- and, in a
   * room, against the room's players seated in it, who are replicas here and
   * never in the registry (`remoteCrewTeam`). The room refuses the same seat
   * (`server/room-control.mjs`), so a door the room would refuse is not
   * offered either.
   */
  localPlayer.mayEnterHull = root => {
    const vehicles = page.vehicles;
    if (vehicles.seatOf(page.LOCAL_PLAYER)?.root === root) return true;
    const team = vehicles.playerTeam(page.LOCAL_PLAYER);
    return mayEnterHull(vehicles.teamOf(root), team) && mayEnterHull(page.remoteCrewTeam?.(root) ?? 0, team);
  };

  function mountLocalSeat(seat) {
    // After the seats exist: this seat's own view rig, and its law -- which
    // asks whether the seat's Camera rides one of its own aim axes.
    page.buildSeatView();
    // The instance's `collect` has just cloned this seat's flash materials and
    // marked the additive ones fresh `Material` instances the renderer has
    // never linked a program for. The level's warm-up compiled the originals
    // they were cloned from, not these; skip this and the clone's first real
    // draw is the mid-burst link stall rule 6 exists to prevent.
    page.warmSubtree(seat.root);
    page.feedVehicleHud();
    // Render the seated soldier (passenger seats only — driver seats have no
    // poseAnimation and skip the load). Awaited here so the cockpit frame the
    // player sees is never the first external one with an empty seat.
    if (seat.instance.drivable || seat.rootKind === 'gun') page.loadSeatPose();
    // The room's control channel: the server mounts this player in its own
    // world the same way (netcode.js MSG_ACTION; the vehicle id is the room
    // table's, matched by template + pose like the renderer's). The seat-dot
    // feed keeps the same id for its every-frame occupant read.
    page.noteOccupiedVehicle(seat.root);
    const netSeat = page.netSeatRow('enter');
    if (netSeat) page.netSendAction(netSeat);
  }

  function syncLocalSeat() {
    const seat = localPlayer.occupancy;
    const was = page.viewFor;
    if (!seat) return;
    if (was && was.seat === seat && was.seatId === seat.seatId && was.drive === seat.drive) return;
    page.buildSeatView();
    page.rebuildVehicleInterp();
    page.feedVehicleHud();
    page.updateMobileControls();
  }

  function leaveSeat({ reset = false } = {}) {
    const seat = localPlayer.occupancy;
    if (!seat) return;
    const drive = seat.drive;
    // The seated occupant goes with the seat, or stepping out of a jeep leaves
    // a soldier sitting in mid-air where the driver's seat had been.
    page.disposeSeatPose();
    if (drive) {
      if (reset && seat.instance.seats.size === 1) drive.reset();
      // `reset()` only restores the exterior when it owns the swap, and it no
      // longer does. Vacating the seat has to put the fuselage back explicitly
      // or the parked plane sits on the strip as an open cockpit tub -- and a
      // hull someone else keeps driving is seen from outside.
      page.view?.setMode('cockpit');
      drive.setFirstPerson(false);
    }
    page.vehicles.leave(page.LOCAL_PLAYER);
    page.clearVehicleHud();
    // The seat's view rig goes with the seat: the next mount builds its own.
    page.forgetSeatViews();
    page.world?.resetStick(page.LOCAL_PLAYER);
    page.rebuildVehicleInterp();
  }


  /**
   * The number row: `c_PIMenuSelect1..9` in the game's own control maps
   * (SEAT-23/24, verify-r5.md) — digit N to the vehicle's Nth seat by spawn-
   * declaration order (`VehicleOccupancy.seatIdAt`; its own doc names the one
   * case this was checked against, and the one still open). A miss — an empty
   * position, or the seat already active — does nothing, same as the real
   * `map<int,PCO*>::find()` miss.
   */
  function switchSeat(position) {
    const seat = localPlayer.occupancy;
    if (!seat) return;
    const seatId = seat.seatIdAt(position);
    if (seatId === undefined || seatId === seat.activeSeatId) return;
    // Somebody sits there: the engine's own miss, nothing happens.
    if (seat.instance.holder(seatId) != null) return;
    // Discard the previous seat's soldier pose (if any) before loading the new
    // one — a driver→passenger switch on a Willy, or vice-versa.
    page.disposeSeatPose();
    // The hull does not move: the instance keeps its drive and body, and re-
    // scopes the seat's guns and the world's mount.
    page.vehicles.switchSeat(page.LOCAL_PLAYER, seatId);
    // This seat's own view rig: its Camera for the inside view, its `CVM*`
    // words for the cycle, the mode carried over where the seat reaches it.
    page.buildSeatView();
    // A different seat is a different camera, often in a different rig; snap
    // rather than sweep the view across the hull for a frame.
    page.rebuildVehicleInterp();
    page.warmSubtree(seat.root);
    page.feedVehicleHud();
    page.loadSeatPose();
    page.updateMobileControls();
    // The room's control channel: seat switches are rows, not input words.
    const netId = page.netVehicleIdFor(seat.root);
    if (page.roomJoined && netId != null) {
      page.netSendAction({ type: 'seat', vehicle: netId, seat: position, action: 'switch' });
    }
  }


  /** The sound and animation triggers `parachute.js` produced, newest last.
   *  Drained by `window.__parachute()`; capped so a long session cannot grow
   *  it without bound. Presentation only — the state machine keeps its own. */
  const parachuteLog = [];
  /** `window.__setDeploy(true)`: the ripcord, for a headless check that cannot
   *  hold a key down through Chromium's own focus rules. */
  localPlayer.debugDeployHeld = false;
  localPlayer.holdDeploy = on => (localPlayer.debugDeployHeld = !!on);

  // --- on foot ----------------------------------------------------------------
  //
  // All the arithmetic is in `soldier.js`, which imports nothing and is driven by
  // `tests/test_soldier.py` under node. This page only feeds it the keyboard and
  // takes the eye pose back, the same seam `flight.js` keeps between VehicleState
  // and the presentation layer.

  localPlayer.soldier = null;
  // The input object frame() built for this frame — onFootCamera's footFire
  // hands the deviation model the same c_PIThrottle/c_PIYaw values the world
  // consumed this tick (the engine's speed gates read the *input*, not the
  // achieved velocity).
  localPlayer.frameInputLast = null;
  localPlayer.prone = false;           // `c_PILie` is a toggle, not a hold
  const FLY_FOV = page.camera.fov;
  const FLY_NEAR = page.camera.near;
  // The near plane of a seat's own view. `Renderer_drawView` (0x004662c0) gives
  // the engine's render view a near plane of 0.1 m and nothing moves it
  // (`handweapon-view-and-deviation.md` section 3, quoted again at the near pass
  // in `frame()`); the free-fly camera's 0.5 is this page's own, chosen for a
  // camera that never sits inside anything.
  //
  // A vehicle's first-person interior is what needs it. `1P_Sherman_Gunner_M1`
  // — the box a tank commander looks out of — spans 0.089 m to 0.40 m ahead of
  // `ShermanCamera`, so at 0.5 every one of its 633 triangles fell inside the
  // near plane and the driver saw straight through his own tank: no frame, and
  // the gun barrel (0.57 m out, and so NOT clipped) smeared across the right of
  // the screen as a shapeless wedge. At 0.1 the frame draws and occludes the
  // barrel, which is what the wedge always was.
  const SEAT_NEAR = 0.1;
  // The soldier's near plane. Every on-foot entry has always set it with the
  // soldier FOV; named so the three lenses below read as the set they are.
  const FOOT_NEAR = 0.2;
  const LENS = {
    foot: [FOOT_FOV, FOOT_NEAR],
    seat: [FLY_FOV, SEAT_NEAR],
    fly: [FLY_FOV, FLY_NEAR],
  };
  /** The camera's lens for `kind`: 'foot', 'seat' or 'fly'. The one place
   *  outside the frame's own FOV easing that sets the projection. */
  localPlayer.useLens = kind => {
    const [fov, near] = LENS[kind];
    page.camera.fov = fov;
    page.camera.near = near;
    page.camera.updateProjectionMatrix();
  };
  /** A field of view alone, near plane kept (the weapon's zoom). */
  localPlayer.setFov = fov => {
    page.camera.fov = fov;
    page.camera.updateProjectionMatrix();
  };
  // GUN-6 (verify-r6.md): a manned gun's own Camera never sets its own FOV in
  // vanilla (`setVehicleFov` — no vanilla vehicle calls it) and the render
  // view's own default is 57.30 degrees vertical. `enterVehicle` sets
  // `camera.fov = FLY_FOV` (60) on the way in for every kind alike — fine for
  // an aircraft/car, whose `VehicleCamera` owns the view already, but a manned
  // gun never gets that camera at all, so nothing else was ever correcting it.
  const MANNED_GUN_FOV = 57.3;

  // --- the soldier's hit points, and the supply depots that refill them ------
  //
  // `verify-r4.md` (hit points, damage, healing) and `verify-r3.md` (supply
  // depots), both `## Corrected report`. `armor.js` and `supply.js` are
  // framework-free — see their own headers — so all the state tying them to
  // *this* soldier lives here, in the on-foot/spawn code this track owns.

  /** The on-foot soldier's own hit points, or null while none exists. Reset to
   *  full on every spawn/redeploy (`spawnAtFlag`, below — the one reset point,
   *  since `setOnFoot(true)` calls it too). */
  localPlayer.soldierArmor = null;

  /** `_shared/loadouts.json` ships `maxHitpoints: 30` for every vanilla-family
   *  kit (`verify-r4.md` R4-25's own cross-mod survey). Only the fallback for
   *  a maps tree extracted before that field existed — the same role
   *  `FALLBACK_PRIMARIES` plays for weapons below. */
  const SOLDIER_MAX_HP_FALLBACK = 30;


  /** Reused rather than reallocated every frame, the way `soldier.js`'s own
   *  `_tickInput` is: `onFoot` updates these fields in place and hands the
   *  same object to `supplyField.tick`/`canHeal`/`canRearm` every call.
   *  `refillAmmo` is wired once, beside `handWeapon`'s own declaration below —
   *  a closure over it, so it always acts on whatever is currently in hand. */
  const supplyTarget = { x: 0, y: 0, z: 0, team: 2, armor: null, refillAmmo: null };

  // Fall damage — the engine's own formula, in `fall-damage.js`.
  //
  // Ledger **HP-14**, `GameServer::handleCollisionLandOrWater` lnxded
  // `0x08154960`, delivered through the object-level `*0x15c` dispatch:
  // `BFSoldier::handleDamage` (0x08270980) -> `SimpleObject::handleDamage` ->
  // `Armor::damage`. HP-6's "the engine does not damage falling soldiers" was
  // refuted in 2026-09-18 and the hand-tuned R4-18 ramp it justified is long
  // gone; what this replaces is the *second* approximation, a single fitted
  // `FALL_KINETIC_HP = 10` calibrated against one measured Wake ledge fall.
  //
  // Three things the fitted version could not do, and the module now does:
  //
  //   - **The 8.0 m/s subtraction and its early return.** Nothing under
  //     8 m/s of arrival costs anything at all, and every term downstream uses
  //     the reduced speed. The fitted ramp had a 1.0 m tolerance instead, which
  //     is why it had to be eight times too gentle per metre to compensate.
  //   - **The two per-surface scalars are read, not fitted.** They are ordinary
  //     MaterialManager numbers and `_shared/damage.json` has carried them all
  //     along: `materialDamage = 30` and `damageMod(ground, 40) = 0.001` for
  //     every terrain material, so their product is 0.030. The old constant
  //     implied about 0.026, which is why it was close.
  //   - **Water, and the impact angle.** A fall into the sea is about 67x
  //     gentler and squares the cosine instead of cubing it.
  //
  // The height tracked is no longer the airborne peak. The engine's `F` is
  // `getLastCollisionHeight() - pos.y` — the height of the last *contact* — so a
  // jump straight up is billed 0 and a jump off a ledge is billed the ledge
  // rather than the apex above it. `SoldierBody` keeps that, and captures the
  // impact speed before `#settle` zeroes `velocity.y` to plant the feet;
  // `Soldier.step` latches the landing for the frame. All this page does is read
  // it and hand it to the formula.
  //
  // Measured on flat ground at g = -14.73, 30 HP, no kit damping: nothing below
  // 3.97 m, 1.2 HP at 4 m, 10.9 at 6 m, 21.7 at 7 m, lethal at 7.55 m.

  // The death cam: on the on-foot soldier's death (HP ≤ 0) the camera holds on
  // the corpse for a beat before the deploy screen opens (see
  // hitpoints-and-damage.md §7 'Client: local-player death' — `FUN_004933d0` →
  // `SpawnScreenStuff::setVisible(true)`; the beat is not a decoded client
  // animation). `soldierDead` latches until respawn so a follow-up `__damage`
  // on an already-dead body does not re-fire the flow.
  localPlayer.soldierDead = false;
  localPlayer.deathCamTimer = 0;    // seconds left on the corpse before openDeploy
  // Long enough to watch the body go down: the deaths run 0.7 .. 1.6 s, and a
  // man killed by a player should see that he was, and from where. The spawn
  // screen covers the whole stage once it opens (`spawn-layout.json`: the kit
  // column and the 512 px map pane), so this beat is the only look he gets.
  const DEATH_CAM_BEAT = 3.0;
  const deathCamPos = new THREE.Vector3();

  // How the death cam is framed, and for how long. Three settings, because the
  // deaths are showing different things: on foot the subject is the body that
  // just fell over, framed from behind and above on the far side from the man
  // who killed him (`soldier-view.js` `corpseCam`: `back` along the ground,
  // `lift` over the pelvis, the look on the pelvis); killed inside a
  // vehicle the subject is the **burning hull**, and retail's shot of it (owner's
  // capture, 2026-09-23: a plane crash, a tank kill) is a plain overhead — the
  // camera snaps to a point straight above the wreck and looks straight down,
  // pulled up far enough that the wreck and its smoke column sit small in the
  // middle of the frame, roughly the centre fifth. No pull-back along the
  // hull's facing, no low three-quarter angle. At the on-foot FOV the ground
  // spans ~1.1x the height, so 30 m puts a 7 m tank at about a fifth of the
  // frame. The pitch stops 2 deg short of the pole so the hull's own yaw still
  // decides which way is up on screen (`applyLook` is a `lookAt` with a world
  // up vector, degenerate at exactly -pi/2). The beats are not engine numbers
  // (the client's own death cam was never decoded past `FUN_004933d0` opening
  // the spawn screen); they are framing.   [HOUSE RULES]
  const DEATH_CAM = {
    // 4.6 m off the pelvis, 23 deg down: at the soldier's 57.3 deg the frame's
    // top edge sits 5.6 deg above the horizon, so the ground out to the man
    // who fired is in the picture behind the body.
    foot:    { lift: 1.8, back: 4.2, beat: DEATH_CAM_BEAT },
    vehicle: { lift: 30,  back: 0, pitch: -Math.PI / 2 + 0.035, beat: 3.0 },
    // Killed in a seat by a round: a short float behind and above the man
    // slumped in his seat, pitched straight onto him (atan(3 / 2.5) = 0.876):
    // the on-foot framing, with no `back`, looks past a point under the camera.
    seat:    { lift: 3, back: 2.5, pitch: -0.876, beat: DEATH_CAM_BEAT },
  };
  localPlayer.deathCamShot = DEATH_CAM.foot;
  /** What the death cam is framed on: `null` for the corpse itself — the
   *  on-foot death — or `{ x, y, z, yaw }`, the burning hull the player was in. */
  localPlayer.deathCamTarget = null;

  // The body's life and the death cam are written here and nowhere else;
  // the modules that see a death or a spawn say which one happened.

  /** Which death the body plays (`soldier-death.js`), chosen on the blow and
   *  kept: `null` while alive. */
  localPlayer.deathFamily = null;
  /** The body's heading at the blow. The corpse keeps it while the death cam's
   *  look turns freely. */
  localPlayer.deathYaw = 0;

  /** The body on foot has died: latch it, pick the death the engine would, and
   *  float the camera over it.
   *
   *  The trigger lets go here, once, for the same reason `holster` does it on
   *  the way into a seat: `onFootCamera` stops calling `footFire` the moment
   *  `soldierDead` latches (a dead body fires nothing), and the Fire Loop's
   *  `stop FinishSample` is an event on the *trigger's* release — so without
   *  this the loop voice started by the trigger he was holding when he died
   *  outlives both the trigger and the body, and rings until the weapon is
   *  torn down at respawn. */
  localPlayer.dieOnFoot = () => {
    page.releaseFireTrigger();
    const s = localPlayer.soldier;
    localPlayer.deathYaw = s?.yaw ?? 0;
    localPlayer.deathFamily = s ? deathFamily({
      parachuteOpen: !!s.chute?.open,
      swimming: !!s.swim?.swimming,
      freeFall: s.chute?.state === PARA_FALLING,
      stance: s.stance,
      hit: localPlayer.soldierArmor?.lastHit ?? null,
      yaw: s.yaw,
    }) : null;
    localPlayer.soldierDead = true;
    localPlayer.deathCamShot = DEATH_CAM.foot;
    localPlayer.deathCamTarget = null;
    localPlayer.deathCamTimer = localPlayer.deathCamShot.beat;
    // `c_SstKilled`, his last word -- which is all a free fall into the
    // ground without the cord pulled sounds like.
    page.playSoldierDeathSound();
  };
  /** Killed inside a hull: all of the body's HP goes (a body that climbed in
   *  at full health still has it, and the `soldierArmor.destroyed` latch must
   *  not fire the flow a second time), and the shot is of `target`, the
   *  wreck's `{ x, y, z, yaw }`. */
  localPlayer.dieInWreck = target => {
    if (!localPlayer.soldierArmor) localPlayer.soldierArmor = new Armor(SOLDIER_MAX_HP_FALLBACK);
    localPlayer.soldierArmor.applyDamage(localPlayer.soldierArmor.maxHitPoints);
    localPlayer.soldierDead = true;
    localPlayer.deathCamShot = DEATH_CAM.vehicle;
    localPlayer.deathCamTimer = localPlayer.deathCamShot.beat;
    localPlayer.deathCamTarget = target;
  };
  /** Killed in the seat by a round (the hull is fine): the corpse is the seat's
   *  own body, slumped over the gun (`seat-pose.js` `detachSeatCorpse`), and
   *  the shot is of `target`, its `{ x, y, z, yaw }`. The on-foot body plays
   *  nothing -- `dieInVehicle` is not one of its families -- so it stays out of
   *  the frame. */
  localPlayer.dieInSeat = target => {
    localPlayer.deathFamily = 'dieInVehicle';
    localPlayer.deathYaw = target?.yaw ?? 0;
    localPlayer.soldierDead = true;
    localPlayer.deathCamShot = DEATH_CAM.seat;
    localPlayer.deathCamTimer = localPlayer.deathCamShot.beat;
    localPlayer.deathCamTarget = target;
  };
  /** A fresh body on its feet with `armor`; the death cam lets go of it. */
  localPlayer.revive = armor => {
    localPlayer.prone = false;
    localPlayer.soldierArmor = armor;
    localPlayer.soldierDead = false;
    localPlayer.deathFamily = null;
    localPlayer.deathCamTimer = 0;
    localPlayer.deathCamShot = DEATH_CAM.foot;
    localPlayer.deathCamTarget = null;
  };
  /** The soldier is gone without a death (a team switch on the deploy screen). */
  localPlayer.discardSoldier = () => {
    localPlayer.soldier = null;
    localPlayer.soldierArmor = null;
    localPlayer.soldierDead = false;
    localPlayer.deathCamTimer = 0;
  };
  /** The level went, and the scene graph the soldier stood in with it. */
  localPlayer.forgetSoldier = () => { localPlayer.soldier = null; };
  /** Run the death cam's beat down; returns what is left. */
  localPlayer.runDeathCam = dt => (localPlayer.deathCamTimer -= dt);
  /** `c_PILie` is a toggle. */
  localPlayer.toggleProne = () => { localPlayer.prone = !localPlayer.prone; };
  localPlayer.standUp = () => { localPlayer.prone = false; };

  function setOnFoot(on) {
    if (on && page.optPilot.checked) {      // the two modes are exclusive
      page.optPilot.checked = false;
      setPilot(false);
    }
    // Either edge tears the old weapon down: entering rebuilds it against the
    // current level's gun index (a map switch has just cleared `guns.groups`),
    // leaving must not park a rifle on the free-fly camera.
    page.disposeHandWeapon();
    if (on) {
      // The soldier is the world's: `addPlayer` builds it the engine's way (a
      // fresh Soldier on the collider, spawned at the team's first flag) and
      // the page borrows the instance for the camera, exactly as the world's
      // records are the only ones the HUD reads.
      let player = page.world?.addPlayer(page.LOCAL_PLAYER, { team: page.deployTeamId });
      localPlayer.soldier = player?.soldier ?? null;
      if (!page.buildSpawnFlags() || !page.spawnAtFlag()) {
        // A level with no control point that owns a spawn group has nowhere to
        // put a soldier; say so rather than dropping him at the origin.
        page.world.removePlayer(page.LOCAL_PLAYER);
        localPlayer.soldier = null;
        page.optOnFoot.checked = false;
        page.showFlagPicker(false);
        return;
      }
      // The world's own FOV (`renderer.fieldOfView 1`, not `set1pFov` — the
      // arms rig's near pass picks its own, see frame()), and a near plane
      // that clears the capsule so a wall you are pressed against is drawn
      // rather than clipped through.
      localPlayer.useLens('foot');
      page.showFlagPicker(true);
    } else {
      // The deploy screen cannot outlive the mode it selects for: the pilot
      // checkbox's exclusivity and the on-foot box both land here with the
      // overlay possibly still up.
      if (page.deployActive()) page.toggleFullMap(false);
      // The soldier was the world's record; the world stops stepping it (a
      // ghost left in the players map would keep walking on its last input).
      page.world.removePlayer(page.LOCAL_PLAYER);
      localPlayer.soldier = null;
      // The soldier's own HP is meaningless off-foot; drop it and the icons
      // that read it rather than leave a stale number for the next spawn's
      // first frame to flash.
      localPlayer.soldierArmor = null;
      delete page.hudBridge.vars['Soldier/SoldierHitPoints'];
      delete page.hudBridge.vars['Soldier/SoldierMaxHitPoints'];
      delete page.hudBridge.vars['ShowHealIcon'];
      delete page.hudBridge.vars['ShowReloadIcon'];
      delete page.hudBridge.vars['ShowFlagIcon'];
      page.showFlagPicker(false);
      localPlayer.useLens('fly');
      // The fullscreen `?kblock` took for on-foot play goes with it.
      page.kbLockLeave();
    }
    page.updateMobileControls();
  }


  /** `hit` is the round's meeting with the body (`soldier-death.js`
   *  `roundHit`), when the damage was a round that met him. `attackerPos` is
   *  the damage's own point, which the arc points at: where the round left
   *  the muzzle, or a blast's centre (ledger HFD-4). */
  function applyDamageToPlayer(damage, attackerPos = null, attackerTeam = null, hit = null) {
    if (!localPlayer.soldierArmor || localPlayer.soldierDead) return;
    if (hit) localPlayer.soldierArmor.lastHit = hit;
    localPlayer.soldierArmor.applyDamage(damage);

    // If in a vehicle or piloting, vehicle damage handles it -- no on-foot grunts or hit arcs
    if (page.optPilot.checked || localPlayer.occupancy) return;
    // A heal (the test hook's negative damage) is no hit: the game heals
    // through `Armor::heal`, never `_giveDamage`.
    if (!(damage >= 0)) return;

    const isFriendlyFire = attackerTeam != null && attackerTeam === page.deployTeamId;
    // The killing blow is `dieOnFoot`'s last word, not a grunt as well.
    if (localPlayer.soldierArmor.hitPoints > 0) page.playSoldierHurtSound(isFriendlyFire);

    // `_giveDamage`'s wash and arc (HFD-2, HFD-3): the octant from the
    // soldier toward that point, in 3-D, the alpha this damage's share of
    // his max HP. A caller that names no point gets 1, whose arc the data
    // never draws (MEME-14): the wash alone.
    const soldier = localPlayer.soldier;
    const dir = attackerPos && soldier ? hitFromDirOctant(soldier, soldier.yaw, attackerPos) : 1;
    page.triggerHitIndicator(dir, hitFromDirAlpha(damage, localPlayer.soldierArmor.maxHitPoints));
  }

  // The stick spring itself lives in world.js next to the aircraft path that
  // spends it (STICK_RATE / STICK_RETURN, moved verbatim); the page's resets
  // below delegate to `world.resetStick`.



  /** This frame's input word and look pair for the local player: seated,
   *  on foot, or nothing (the free camera). The keyboard and the mouse never
   *  leave the page; this folds them into the engine's PlayerInput, named by
   *  action. */
  localPlayer.sampleInput = (seated, onFoot, lookTicks, dt) => {
    let input = null;
    let look = null;
    // The control map folds the devices into the engine's channels: the
    // keyboard's key pairs and the joystick's axes are bindings of the same
    // triggers (`c_PIThrottle`, `c_PIRoll`, ...), and `controls.axis` sums
    // them. The touch pad stays the page's own override, exactly as before.
    const axis = t => page.axis(t);
    const heldTrigger = t => page.held(t);
    if (seated) {
      // The pad's deflection must land in the device stage BEFORE the pump
      // turns the counts into an axis, or this frame's pad aim arrives a
      // frame late (the page's original feed-then-pump order).
      page.feedMobileTurretAim(dt);
      page.pumpLook(lookTicks);
      // The engine's PlayerInput, named by action. `forwardKeys` and
      // `rudder` are the aircraft's throttle latch and rudder spring — raw
      // key pairs on the keyboard, but the profile's joystick axes land on
      // the same channels, so the stick flies the plane through them. Ground
      // vehicles steer and throttle with the pad folded in
      // (`forward`/`strafe`), while the plane's roll and pitch arrive from
      // the stick axes separately.
      input = {
        forward: page.clampMobileInput(
          axis('c_PIThrottle') + page.mobilePadAxis('y')),
        forwardKeys: axis('c_PIThrottle'),
        strafe: page.clampMobileInput(
          axis('c_PIYaw') + page.mobilePadAxis('x')),
        rudder: axis('c_PIYaw'),
        fire: heldTrigger('c_PIFire') || page.seatFire,
        altFire: page.seatAltFire || heldTrigger('c_PIAltFire'),
        roll: page.mobilePadHeld ? page.mobilePadVector.x : axis('c_PIRoll'),
        pitch: page.mobilePadHeld ? page.mobilePadVector.y : axis('c_PIPitch'),
        pad: page.mobilePadHeld,
      };
      // A pilot holding the mouse-look key flies hands off: the engine's
      // router zeroes c_PIYaw, c_PIPitch and c_PIRoll for every tick the key
      // is down (`BFPlayer::handleInput`, `mouse-look-key.js`). The throttle
      // and the triggers still reach the aircraft.
      routeFlightInput(input, page.lookNeedsKey() && page.lookKeyHeld());
      look = { x: page.mouseInput.x, y: page.mouseInput.y };
    } else if (onFoot) {
      page.pumpLook(lookTicks);
      const held = page.captured ? page.keys : page.EMPTY_KEYS;
      // The touch drag forwards like a held W (`touchFlying`), but only into
      // neutral: a held S still brakes, and two held keys cancel as they
      // always did. `axis` carries the W-S pair; the touch term adds only
      // when the pair is not already speaking.
      const throttle = axis('c_PIThrottle');
      input = {
        forward: page.clampMobileInput(
          throttle + (page.touchFlying && throttle === 0 ? 1 : 0)
          + page.mobilePadAxis('y')),
        strafe: page.clampMobileInput(
          axis('c_PIYaw') + page.mobilePadAxis('x')),
        walk: heldTrigger('c_PIWalk'),
        crouch: heldTrigger('c_PICrouch'),
        prone: localPlayer.prone,
        jump: heldTrigger('c_PIAction') || page.mobileJumpHeld,
        // `c_PIMenuSelect9`, input bit 22 -> TemplateMessage 18 ->
        // `BFSoldier::setIsParachuting(true)`. It is the kit's ninth item slot
        // and the engine gives it a second job on a falling soldier; see
        // `parachute.js`. The numpad's 9 rides along because a bail-out is a
        // two-second window and the digit row may be far from WASD — the
        // viewer's own kindness, not a control-map binding. On a touch device
        // the JUMP button doubles as the ripcord while the state machine says
        // you are falling — a jump is worth nothing in mid-air, and a
        // bail-out is no time to hunt for a control that would otherwise
        // have to be added to the pad.
        deploy: heldTrigger('c_PIMenuSelect9') || held.has('Numpad9')
          || localPlayer.debugDeployHeld
          || (page.mobileJumpHeld && localPlayer.soldier?.parachuteState === 'falling'),
        dead: localPlayer.soldierDead,
      };
      // A dead body holds still: when `soldierDead` latches (death cam active)
      // zero the steering/jump input so the corpse does not keep walking.
      if (localPlayer.soldierDead) {
        input.forward = input.strafe = 0;
        input.jump = false;
        input.crouch = input.prone = false;
      }
      look = page.footLookPair();
    }
    return { input, look };
  };

  /** The soldier's own event queues, drained once a frame. */
  localPlayer.drainSoldierEvents = () => {
    // Bail-out triggers for the frame. `parachute.js` names each one by the
    // engine's own sound trigger (`c_SstFallingHigh`, `c_SstOpenParachute`,
    // `c_SstParachuteLand`) and animation state; `page-audio.js` plays them,
    // and the log keeps them where a check can read them.
    if (localPlayer.soldier?.parachuteEvents.length) {
      for (const event of localPlayer.soldier.drainParachuteEvents()) {
        localPlayer.parachuteLog.push(event);
        page.handleParachuteEvent(event);
      }
      if (localPlayer.parachuteLog.length > 64) localPlayer.parachuteLog.splice(0, localPlayer.parachuteLog.length - 64);
    }
    // The free fall can also end without a state event -- a respawn or a
    // climb into a seat resets the chute outright -- and its winds loop.
    if (localPlayer.soldier?.parachuteState !== PARA_FALLING) page.stopFallSound();
    if (localPlayer.soldier?.footstepEvents.length) {
      for (const step of localPlayer.soldier.drainFootstepEvents()) page.handleSoldierFootstep(step);
    }
  };


  // --- the frame's phases this module owns (map.html `frame()`) ---------------

  /** The frame's input phase: the human's seat and the word he feeds the
   *  world this frame. Returns the frame's mode (`seated`, `onFoot`, read once
   *  here and held for the rest of the frame) and the word and look pair the
   *  world was handed, which the room sends after the step. */
  localPlayer.frameInput = dt => {
    // The human's presentation follows the seat he holds, looked up every frame
    // (a bot taking the wheel of his hull gives it a drive under him).
    if (page.optPilot.checked) syncLocalSeat();
    page.updateMobileControls();
    // ---- the input stage (page) ----------------------------------------------
    // The keyboard and the mouse never leave this page. The look stage (the
    // mouse stage's per-frame pump, mouse-input.js) is pumped here once a frame
    // in exactly the two cases the old code pumped it — on foot
    // (`stepSoldierLook(pumpLook(ticks))`) and seated (`stepTurret`'s own pump) —
    // and never for the free camera. The world owns the tick from there: its
    // per-tick law consumes one buffered input per player per tick (world.js,
    // the tick law in its header), which is the engine's own
    // `InputManager::update` 0x0049cff7 boundary.
    const seated = page.optPilot.checked && localPlayer.occupancy;
    const onFoot = page.optOnFoot.checked && localPlayer.soldier;
    // The world's one clock answers this frame's tick count; the pump reads it
    // so the look stage and the sim can never drift apart (Fix 5). A frame
    // before any level has built the world owes no ticks.
    const lookTicks = page.world?.lookTicks(dt) ?? 0;
    const { input, look } = localPlayer.sampleInput(seated, onFoot, lookTicks, dt);
    page.world?.setInput(page.LOCAL_PLAYER, input, look);
    localPlayer.frameInputLast = input;
    return { seated, onFoot, input, look };
  };

  /** The frame's camera phase, after the world has stepped and the drawn
   *  instant is set (`localLook.present`): the camera of the mode the input
   *  phase read, then the human's own body placed where that camera draws it. */
  localPlayer.frameCameras = (dt, seated, onFoot) => {
    if (seated) {
      page.seatedCamera(dt);
    } else if (onFoot) {
      page.onFootCamera(dt);
    } else {
      page.flyFreeCamera(dt);
      page.applyLook();
    }
    // Unconditional: rounds already in the air have to finish their flight even
    // if the trigger, the pilot mode or the whole aircraft has gone away — the
    // world's tick runs `guns.advance` after the players and before the bodies,
    // exactly where frame() used to.
    page.followSeat(dt);
    // The player's own body. After `onFootCamera` (which is where `syncFootView`
    // settled whether the camera is inside the man this frame) and after the
    // world's tick has moved him, so the rig is placed at the position the frame
    // is actually drawn at rather than the previous one's.
    page.syncFootBody(dt);
    // After the mixer, which has just re-posed the arms from the sit clip, and
    // after the drivetrain's `applyRig`/`applyTurrets` above, which is where the
    // steering wheel got this frame's angle. Both orders matter: run it before
    // the mixer and the clip overwrites the hands, run it before the rig and the
    // hands chase last frame's wheel.
    if (page.optPilot.checked) page.stepSeatIk();
    // Killed in the seat by a round, with the hull whole: slump there.
    if (page.optPilot.checked) page.killOccupantInSeat();
  };

  Object.assign(localPlayer, {
    DEATH_CAM,
    FLY_FOV,
    MANNED_GUN_FOV,
    SOLDIER_MAX_HP_FALLBACK,
    applyDamageToPlayer,
    deathCamPos,
    leavePilot,
    leaveSeat,
    parachuteLog,
    setOnFoot,
    setPilot,
    supplyTarget,
    switchSeat,
    syncLocalSeat,
  });
  return localPlayer;
}
