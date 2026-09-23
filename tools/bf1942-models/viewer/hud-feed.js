// What the HUD reads each frame: the engine's own MemeFile variables
// (`Vehicle/*`, `Ammo/*`, `Overheat/*`, the seat dots, the soldier's health,
// stance, ammo and weapon bar, the crosshair, the view blurb), written into
// `gameHud.vars` from the local player's seat and soldier, plus the HUD
// painter itself and its sprite pack. `hud.js` stays the renderer. Lifted
// out of map.html (features/vehicle-instance-refactor Part 2).

import { Hud, AMMO_TYPE_CODES, AMMO_TYPES_WITH_ROUNDS } from './hud.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `aircraft`, `bust`, `camera`, `car`, `combatArea`, `combatFrame`,
 * `crosshairEl`, `currentDir`, `DEG_TO_RAD`, `deployActive`, `deployKit`,
 * `deployTeamId`, `drawFullMap`, `feedFlagIconVars`, `feedTicketVars`,
 * `fireStateFor`, `fullmapBox`, `handSlot`, `handWeapon`, `hitIndicatorDir`,
 * `hitIndicatorTimer`, `hud`, `hudPaths`, `isZoomed`, `itemsLocked`,
 * `kitLoadout`, `kitWeaponSlots`, `lastSoldierHp`, `loadouts`,
 * `LOCAL_PLAYER`, `mannedActive`, `mannedGuns`, `netOccupiedVehicleId`,
 * `netVehicleIdFor`, `occupancy`, `occupiedVehicleDamage`, `optOnFoot`,
 * `optPilot`, `paintDeploySoon`, `playSoldierHurtSound`, `renderer`,
 * `roomClient`, `roomJoined`, `soldier`, `soldierArmor`, `soldierDead`,
 * `teamNation`, `triggerHitIndicator`, `updateHud`,
 * `updateSeatPoseVisibility`, `vehicleGuns`, `view`, `WEAPON_ICON_VARS`,
 * `weaponBarUntil`, `world`.
 */
export function createHudFeed(page) {
  const hudFeed = {};

  // --- feeding the vehicle/gun HUD variables (BRIEFING2.md's contract) -------
  //
  // P1's painter (`viewer/hud.js`, a parallel track not yet merged into this
  // worktree) reads `window.__hud.vars`, keyed by the engine's own MemeFile
  // names exactly as `hud-layout.json` binds them. This track never paints —
  // every write below is a plain assignment behind an optional-chained lookup,
  // a documented no-op until that painter exists, and every value this seat
  // does not currently have is cleared (`delete`d, not set false/0) so the
  // painter's own culling rule ("unknown stays absent, cull the group") sees an
  // honest table rather than an invented zero.
  const HUD_VEHICLE_VARS = [
    'Vehicle/ShowVehicleIcon', 'Vehicle/VehicleIcon',
    'Vehicle/ShowTurretIcon', 'IconLookRotation',
    'Vehicle/VehicleHitPoints', 'Vehicle/VehicleMaxHitPoints',
    'Ammo/NumberOfWeaponIcons',
    'Ammo/PrimaryAmmoIcon', 'Ammo/PrimaryAmmoBar',
    'Ammo/PrimaryAmmo', 'Ammo/PrimaryAmmoText', 'Ammo/MaxPrimaryAmmo', 'Ammo/PrimaryMag',
    'Ammo/SecondaryAmmoIcon', 'Ammo/SecondaryAmmoBar',
    'Ammo/SecondaryAmmo', 'Ammo/SecondaryAmmoText', 'Ammo/MaxSecondaryAmmo',
    'Ammo/ReloadTime', 'Ammo/ReloadTimeSecondary', 'Overheat/OverHeat',
    // VHUD-11/VHUD-2: the seat-occupancy dots. One shared `Occupied/OccupiedData`
    // backs all six leaves (an array here, indexed by the leaf's own
    // `position`), and each dot's place inside the 128x128 vehicle icon is a
    // `Vehicle/VehiclePos/VehiclePosX<n>`/`Y<n>` pair — the layout's own
    // spelling, which nests the group (`test_hud_layout.py` has it verbatim).
    'Occupied/OccupiedData',
    ...Array.from({ length: 6 }, (_, i) => [
      `Vehicle/VehiclePos/VehiclePosX${i + 1}`,
      `Vehicle/VehiclePos/VehiclePosY${i + 1}`,
    ]).flat(),
  ];

  function setHudVar(name, value) {
    const table = window.__hud?.vars;
    if (!table) return;
    if (value === null || value === undefined) delete table[name];
    else table[name] = value;
  }

  function clearVehicleHud() {
    for (const name of HUD_VEHICLE_VARS) setHudVar(name, null);
    // The dot feed's memo goes with them, or re-entering the same vehicle at
    // the same seat would leave all thirteen variables deleted and never
    // rewritten. The cached room id is the same kind of stale-on-exit state:
    // every exit path (setPilot off, exitVehicle, exitManned) funnels here
    // through `leaveSeat`.
    hudFeed.seatDotsFor = null;
    hudFeed.seatDotsSig = null;
    page.netOccupiedVehicleId = null;
  }

  // R2-8 (verify-r2.md's corrected report): the client's own case-sensitive
  // decode of `setPrimaryAmmoBar`/`setSecondaryAmmoBar`. A name it does not
  // recognise — a mod's typo, or the ambiguous bare `ABAmmoBar` vanilla itself
  // never disambiguates — silently becomes 7, the client's own default, not an
  // extraction bug.
  const AMMO_BAR_CODES = {
    ABNone: 0, ABAmmoBarOnly: 1, ABAmmoBarHeatBar: 2, ABAmmoBarReloadBar: 3,
    ABHeatBarOnly: 4, ABReloadBarOnly: 5, ABIconOnly: 6,
  };
  function ammoBarCode(name) {
    return name == null ? null : (AMMO_BAR_CODES[name] ?? 7);
  }

  /**
   * `IconLookRotation` for the seat currently manned, in radians, or
   * `undefined` when this seat has no dial to draw.
   *
   * Un-negated on purpose: this is the engine's own value, positive to the
   * controlled PCO's right, and `hud.js` owns the canvas-versus-`RotateEffect`
   * sign flip. See `feedVehicleHud`.
   */
  function turretDialAngle() {
    if (!page.occupancy?.showsTurretIcon(insideView())) return undefined;
    return page.occupancy.turret?.turretYawRadians();
  }

  // The seat-dot feed's memo: the vehicle it was last written for and the
  // state signature it wrote. The positions are template data and never move,
  // and the states only move when the local player switches seats or a room
  // player enters, leaves or switches seats in this vehicle — so the table is
  // rewritten on a change, not on every frame, and `frame()` can afford to ask
  // every frame whether anything changed.
  hudFeed.seatDotsFor = null;
  hudFeed.seatDotsSig = null;

  /** The room's other players seated in THIS vehicle, as the `{ seat, team }`
   *  rows `seatDots()` takes: `seat` in the occupancy's own position numbering
   *  (the snapshot's `seatIndex` is that index — `netcode-render.js` seats its
   *  replicas by the same law), `team` the server's team id. Empty when not in
   *  a room or when this vehicle has no room table id: single-player has no
   *  other occupants, and a vehicle the room does not track cannot be matched.
   *
   *  The table id is computed lazily rather than only on entry, because entry
   *  can happen before the first snapshot lands — `netVehicleIdFor` needs a
   *  pose to match against, and a null computed too early would otherwise stay
   *  null for the whole ride. */
  function remoteSeatOccupants() {
    if (!page.roomJoined || !page.roomClient || !page.occupancy) return [];
    if (page.netOccupiedVehicleId == null) page.netOccupiedVehicleId = page.netVehicleIdFor(page.occupancy.root);
    if (page.netOccupiedVehicleId == null) return [];
    const out = [];
    for (const slot of page.roomClient.remoteSlots()) {
      const p = page.roomClient.remotePlayer(slot);
      if (p && p.seated && p.inVehicle && p.vehicleId === page.netOccupiedVehicleId
          && Number.isInteger(p.seatIndex)) {
        out.push({ seat: p.seatIndex, team: page.roomClient.teamOf(slot) });
      }
    }
    return out;
  }

  /** The other occupants of the hull the human sits in -- bots, on this page --
   *  as the same `{ seat, team }` rows, from the hull's own seat map. */
  function hullSeatOccupants() {
    const seat = page.occupancy;
    if (!seat) return [];
    const out = [];
    for (const [seatId, playerId] of seat.instance.seats) {
      if (playerId === page.LOCAL_PLAYER) continue;
      out.push({ seat: seat.order.indexOf(seatId), team: page.world?.player(playerId)?.team ?? 0 });
    }
    return out;
  }

  function feedSeatDots() {
    if (!page.occupancy) return;
    const dots = page.occupancy.seatDots([...remoteSeatOccupants(), ...hullSeatOccupants()],
      page.roomClient?.hello?.team ?? page.world?.player(page.LOCAL_PLAYER)?.team ?? 0);
    const sig = dots.map(d => d.state).join(',');
    if (hudFeed.seatDotsFor === page.occupancy && sig === hudFeed.seatDotsSig) return;
    hudFeed.seatDotsFor = page.occupancy;
    hudFeed.seatDotsSig = sig;
    setHudVar('Occupied/OccupiedData', dots.map(d => d.state));
    for (let i = 0; i < 6; i++) {
      const dot = dots[i];
      setHudVar(`Vehicle/VehiclePos/VehiclePosX${i + 1}`, dot?.x ?? null);
      setHudVar(`Vehicle/VehiclePos/VehiclePosY${i + 1}`, dot?.y ?? null);
    }
  }

  /**
   * Is the camera in the engine's view mode 3 — the inside view?
   *
   * Every seat has a `VehicleCamera` now and two of its modes are mode 3: the
   * cockpit and the nose cam, which is the same Camera with its eye displaced.
   * A seat with no rig yet (the frame between a mount and `buildSeatView`) is
   * inside, which is where every seat opens.
   */
  function insideView() {
    return page.view ? page.view.inside : !!page.occupancy;
  }

  /**
   * Push this vehicle's `Vehicle/*`/`Ammo/*` HUD block into `hud.vars`. Called
   * once on entry and every seat switch (icon/bar/hitpoints are effectively
   * static between those), and every tick from `manned()` so a manned gun's
   * live ammo/heat actually moves.
   */
  function feedVehicleHud() {
    if (!page.occupancy) return;
    const rootHud = page.occupancy.seatInfo(page.occupancy.rootId)?.hud;
    const seatHud = page.occupancy.activeHud();
    setHudVar('Vehicle/ShowVehicleIcon', true);
    setHudVar('Vehicle/VehicleIcon', seatHud?.vehicleIcon ?? null);
    // The turret dial (`vehicleIcon`'s other three sprites, VHUD-7's rects): a
    // fixed back plate and barrel with the hull's own icon rotating underneath,
    // which is how a tank commander reads where the hull is pointing relative
    // to where he is looking.
    //
    // The angle is the engine's own `IconLookRotation` (VHUD-9, client
    // `0x006ae5d9`–`0x006ae616`):
    //
    //   IconLookRotation = atan2(dot(pcoRight, camForward),
    //                            dot(pcoForward, camForward))     // radians
    //
    // positive to the PCO's right, about the CONTROLLED PCO's own axes — the
    // hull, for a tank driver. For a seat whose camera rides the turret that is
    // the turret's own traverse, which is what `turretYawRadians()` returns.
    //
    // It replaced `headingRadians()`, and the swap is one half of a PAIR: that
    // accessor carries `seats.js`'s `RIG_SIGN.yaw = -1`, and `hud.js` used to
    // rotate the sprite clockwise (canvas `rotate(+θ)`) where the engine's
    // `RotateEffect` is counter-clockwise. Two errors cancelling, which is why
    // the dial looked right. `hud.js` now rotates by `-angle`; feed it the
    // negated value again and every dial mirrors.
    //
    // Gated, for now, on there being a traverse to show at all. VHUD-9's real
    // trigger is `(seatCamera.viewMode == 3) && pcoTemplate.hasTurretIcon`, and
    // `setHasTurretIcon` only reached the extract in this round's `con.py`
    // change, so a scene baked before it has no field to read. Handled where
    // the gate is, not here.
    const heading = turretDialAngle();
    setHudVar('Vehicle/ShowTurretIcon', heading === undefined ? null : true);
    setHudVar('IconLookRotation', heading === undefined ? null : heading);
    // The seat-occupancy dots (VHUD-11). `in-game-hud.md` used to record their
    // positions as "live-bound per vehicle", i.e. carried by nothing the
    // extractor could reach; they are `setVehicleIconPos` on each seat's own
    // PlayerControlObject, and `con.py` simply had no hit for the word. Fed as
    // one shared state array (`Occupied/OccupiedData`, which is what the layout
    // binds — one `BfOccupiedVehicleData` object backs all six leaves) plus a
    // position pair per dot. A seat whose extract predates the word feeds no
    // pair and `hud.js` keeps the layout's own literal rect.
    //
    // Called here for the entry frame and on every seat switch; `frame()` also
    // calls it every frame, because a room player can change this vehicle's
    // occupancy at any moment. The feed's signature memo makes both cheap.
    feedSeatDots();
    // R2-31 (corrected, verify-r2.md): hitpoints/armor live on the root PCO
    // only, one Armor shared by every seat — never a nested seat's own value.
    //
    // Live when this vehicle is one the damage set knows about, and the template's
    // static number otherwise. Before the Armor existed this could only ever print
    // the authored maximum, so the bar never moved no matter what hit you.
    const live = page.occupiedVehicleDamage();
    setHudVar('Vehicle/VehicleHitPoints',
              live ? live.hitPoints : (rootHud?.hitpoints ?? null));
    setHudVar('Vehicle/VehicleMaxHitPoints',
              live ? live.maxHitPoints : (rootHud?.maxHitpoints ?? null));
    // Which copy of the ammo panel `menu/InGame` paints: the layout gates every
    // primary leaf on `NumberOfWeaponIcons == 1` and every secondary one on
    // `== 2` (VHUD, verify-r2.md R2-13), so a seat that never feeds it shows no
    // ammo at all. `setNumberOfWeaponIcons` is the seat's own word; the fallback
    // covers scenes extracted before it was carried — a declared secondary
    // means two panels, anything else one.
    setHudVar('Ammo/NumberOfWeaponIcons', seatHud?.numberOfWeaponIcons
      ?? (seatHud?.secondaryAmmoIcon || seatHud?.secondaryAmmoBar ? 2 : 1));
    setHudVar('Ammo/PrimaryAmmoIcon', seatHud?.primaryAmmoIcon ?? null);
    setHudVar('Ammo/PrimaryAmmoBar', ammoBarCode(seatHud?.primaryAmmoBar));
    setHudVar('Ammo/SecondaryAmmoIcon', seatHud?.secondaryAmmoIcon ?? null);
    setHudVar('Ammo/SecondaryAmmoBar', ammoBarCode(seatHud?.secondaryAmmoBar));
    // Live ammo/heat: manned seats via `manned()`; drivetrain roots via
    // `drive()`/`pilot()` (T4a) — both step FireState and gate `canFire`, so
    // `chainOnShot` is not orphaning counters on the Sherman cannon/coax.
    //
    // A seat's `fireArms` array can hold two nodes (R2-30: the Sherman's root
    // declares `NumberOfWeaponIcons 2`, cannon then coax) — `nodes[0]`/`[1]` is
    // this viewer's stand-in for "primary"/"secondary" weapon-icon slot, the
    // same declaration-order assumption SEAT-22's own seat-position map already
    // rests on; the extracted data has no independent primary/secondary tag to
    // cross-check it against.
    let nodes = [];
    if (page.mannedActive()) {
      nodes = page.occupancy.activeFireArmsNodes();
    } else if (page.occupancy.isActiveRoot() && (page.aircraft || page.car)) {
      nodes = page.occupancy.seatInfo(page.occupancy.rootId)?.fireArms || [];
    }
    const primary = nodes[0] ? page.fireStateFor(nodes[0]) : null;
    const secondary = nodes[1] ? page.fireStateFor(nodes[1]) : null;
    // `hud-layout.json`'s vehicle-skin ammo panel prints `Ammo/{Primary,Secondary}
    // AmmoText` (registered by a DIFFERENT client function, R2-12, than the
    // `PrimaryAmmo`/`MaxPrimaryAmmo`/`PrimaryMag` trio) -- the soldier-skin
    // panel's own text binds `Ammo/PrimaryAmmo` directly instead (R1-20), so this
    // second name is unique to the vehicle layout and was missing entirely: a
    // seated ammo panel (Defgun, Sherman) drew its icon and bar but never its
    // number. Neither verify-r2.md nor hud-layout.json's own notes say whether
    // the real engine ever lets `*AmmoText` diverge from the live count; mirrored
    // here rather than left unfed, since an unfed one is a confirmed-wrong "no
    // number ever" and a mirrored one is at worst a guess about a case nothing
    // surveyed exercises.
    setHudVar('Ammo/PrimaryAmmo', primary && !primary.unlimited ? primary.ammo : null);
    setHudVar('Ammo/PrimaryAmmoText', primary && !primary.unlimited ? primary.ammo : null);
    setHudVar('Ammo/MaxPrimaryAmmo', primary ? primary.stats.magSize : null);
    setHudVar('Ammo/PrimaryMag',
      primary ? (primary.magsLeft === Infinity ? -1 : primary.magsLeft) : null);
    setHudVar('Ammo/SecondaryAmmo', secondary && !secondary.unlimited ? secondary.ammo : null);
    setHudVar('Ammo/SecondaryAmmoText', secondary && !secondary.unlimited ? secondary.ammo : null);
    setHudVar('Ammo/MaxSecondaryAmmo', secondary ? secondary.stats.magSize : null);
    // `hud-layout.json` binds exactly one `Overheat/OverHeat` (no "...Secondary"
    // variant) shared by both panels' heat-bar copy — R2-30's own Sherman is the
    // real case this matters for, since its heat weapon is the coax (secondary),
    // not the cannon (primary): reading only `nodes[0]` would silently show no
    // heat at all while the coax cooked. No array/closure here — this runs every
    // tick `manned()` steps (rule 5, features/mesh-viewer-performance/README.md).
    const heated = primary?.hasHeat ? primary : secondary?.hasHeat ? secondary : null;
    setHudVar('Overheat/OverHeat', heated ? heated.heat : null);
    // Both reload-bar copies are a fraction of `reloadTime` remaining, scaled to
    // the `max: 1.0` the layout declares — direction (counts down to empty vs.
    // fills up as reload completes) is not settled by anything in
    // verify-r2.md/verify-r6.md or `hud-layout.json`'s own metadata, so this is
    // an approximation: counts down from full (just started) to empty (ready).
    // `reloadFraction` is a module-level function, not a closure allocated here,
    // for the same per-tick reason as `heated` above.
    setHudVar('Ammo/ReloadTime', readyFraction(primary, nodes[0]));
    setHudVar('Ammo/ReloadTimeSecondary', readyFraction(secondary, nodes[1]));
  }

  /** The `GunFire` group that actually fires this FireArms node — `mannedGuns`
   *  for a seat someone is sitting in, `vehicleGuns` for the drivetrain root's
   *  own.
   *
   *  Which list is asked first matters, and is not a detail: a drivetrain
   *  root's own FireArms end up in BOTH, because `collectMannedGuns()` collects
   *  whatever `occupancy.activeFireArmsNodes()` names and for the root seat
   *  that is the same pair of nodes `collectGuns()` already put in
   *  `vehicleGuns`. Only one of the two copies is ever fired — `manned()` and
   *  `drive()` each own their own list — so reading the idle copy's `cooldown`
   *  is reading a clock nothing winds, which is exactly how the reload bar came
   *  back "ready" a frame after the shell left. `mannedActive()` is the same
   *  test `frame()` uses to pick which of the two runs.
   *
   *  Plain loops rather than `find`, because this runs from `feedVehicleHud` on
   *  every tick and an arrow predicate would allocate a closure a frame
   *  (features/mesh-viewer-performance, rule 5). */
  function fireGroupFor(node) {
    if (!node) return null;
    const live = page.mannedActive() ? page.mannedGuns : page.vehicleGuns;
    for (const group of live) if (group.node === node) return group;
    const other = live === page.mannedGuns ? page.vehicleGuns : page.mannedGuns;
    for (const group of other) if (group.node === node) return group;
    return null;
  }

  /** How ready this weapon is to fire again, `0` (just fired) to `1` (ready),
   *  or `null` when there is no weapon in that slot at all.
   *
   *  This used to read `state.reloadRemaining / reloadTime` alone, and on a
   *  tank cannon that is a bar which never moves: a Sherman's `reloadTime` is
   *  0.35 s and only runs once its whole 30-round magazine is out. What the
   *  player actually waits through between shells is the `roundOfFire`
   *  cooldown — 1/0.35 s = 2.86 s — which lives on the `GunFire` group, not on
   *  `FireState`. GUN-5 has the engine's own `isReadyToUseFire` gating on the
   *  eject-clip timer, the reload timer, the overheat timer AND the fire-rate
   *  timer together, so the bar takes whichever of them is still running: it
   *  is a readiness bar, and readiness is the last gate to clear.
   *
   *  Direction: fills as the weapon becomes ready, empty right after the shot.
   *  Neither verify-r2.md nor `hud-layout.json` settles which way this bar
   *  runs (VHUD-10 is still open on the whole live-value question for a
   *  driver's own weapons), so this is a choice, not a reproduction — made
   *  this way round because the alternative draws a FULL bar at the exact
   *  moment the gun cannot fire, which reads as "loaded" to anyone glancing at
   *  it, and because every other gauge in this layout is full when the thing
   *  it measures is in good shape. Module scope, not a closure inside
   *  `feedVehicleHud`, for that function's own stated per-tick reason. */
  function readyFraction(state, node) {
    if (!state) return null;
    const reloadWindow = state.stats.reloadTime > 0 ? state.stats.reloadTime : 0;
    let remaining = reloadWindow > 0 ? state.reloadRemaining / reloadWindow : 0;
    const group = fireGroupFor(node);
    const rate = group?.stats.roundOfFire;
    if (group && rate > 0) {
      remaining = Math.max(remaining, group.cooldown * rate);
    }
    if (state.hasHeat && state.overheatRemaining > 0 && state.stats.timeDelayOnOverheat > 0) {
      remaining = Math.max(remaining, state.overheatRemaining / state.stats.timeDelayOnOverheat);
    }
    return 1 - Math.max(0, Math.min(1, remaining));
  }

  /**
   * The crosshair's gap, in CSS pixels: the deviation ABOVE the stationary
   * floor, projected through the camera — `0.5 x height x tan(dev - floor) /
   * tan(vfov / 2)`.
   *
   * Subtracting the floor is measured, not derived: in retail footage a still
   * Thompson (minDev 0.4 deg, never zero) draws its arms MEETING at centre,
   * and they part when the shooter moves, turns or fires. So the gap tracks
   * the acquired spread, not the whole cone. OPEN: whether the engine's own
   * mapping is this projection or a linear scale — a corpus question
   * (crosshair draw path, client side); the footage pins only the endpoints.
   */
  /**
   * What is under the trigger this frame, as the crosshair needs to know it:
   * the `setCrossHairType` word of the weapon in hand, or of the seat.
   *
   * The word is declared per HandFireArms AND per PlayerControlObject, and it
   * is the whole of the decision. Vanilla splits 37 templates across
   * `CHTCrossHair` (the four bars: every rifle and SMG, and the Sherman,
   * PanzerIV, Tiger, T34, Chi-ha and every hull/stationary MG), 49 across
   * `CHTIcon` (one texture, `hk.tga` — no vanilla template overrides
   * `CrossHair/CrossHairIcon`, so the bazooka, the K98, the Defgun, the
   * Priest, the Sexton and every aircraft draw the same picture) and 64 across
   * `CHTNone` (passengers, ships, the Willy).
   *
   * The page used to ask only the hand weapon, and only on foot, so a
   * CHTCrossHair tank drew nothing and a CHTIcon launcher drew a bare dot.
   * `deviation` is the hand weapon's acquired spread; a vehicle gun has no
   * deviation model here, and the bars meet at centre the way a tank's do.
   */
  function crosshairAim() {
    // The seat he holds, not the hull's drive: a drive outlives his seat (a bot
    // may still be driving it), and a soldier who had just stepped out of a
    // Sherman used to be asked what the Sherman draws.
    if (page.occupancy) {
      // The CONTROLLED PCO's own `hud` block, which is where `setCrossHairType`
      // is declared — a Sherman's driver and its hull gunner are two PCOs and
      // answer separately. A scene extracted before the word was carried has
      // none, and an absent word draws nothing rather than a guess.
      return { style: page.occupancy?.activeHud?.()?.crossHairType ?? null,
               deviation: 0, scoped: false };
    }
    const hw = page.handWeapon;
    // No active item, no `setCrossHairType` to read: the item gate takes the
    // reticle with the weapon.
    if (!page.optOnFoot.checked || !page.soldier || !hw || page.itemsLocked()) {
      return { style: null, deviation: 0, scoped: false };
    }
    const floor = (hw.model.floor?.() ?? 0) * page.DEG_TO_RAD;
    return {
      style: hw.data?.crossHair ?? null,
      deviation: Math.max(0, hw.model.current() * page.DEG_TO_RAD - floor),
      scoped: !!hw.data?.zoom?.scope && page.isZoomed(),
    };
  }

  /** The `CrossHair/CrossHairIcon` leaf of the layout's own crosshair group:
   *  the rect a CHTIcon crosshair occupies in the 800x600 virtual screen, and
   *  the sprite it defaults to. Read from `hud-layout.json` rather than written
   *  here, so a mod that moves or replaces it is followed. */
  hudFeed.crosshairIcon = undefined;          // undefined until the layout has been looked at
  function crosshairIconLeaf() {
    if (hudFeed.crosshairIcon !== undefined) return hudFeed.crosshairIcon;
    const layout = gameHud.layout;
    if (!layout) return null;   // not loaded yet; ask again next frame
    const leaf = (layout.groups?.crosshair?.elements || []).find(
      el => el.kind === 'variable-picture' && el.var === 'CrossHair/CrossHairIcon');
    hudFeed.crosshairIcon = leaf?.rect && leaf.texture
      ? { rect: leaf.rect, virtual: layout.virtual || [800, 600], texture: leaf.texture }
      : null;
    if (hudFeed.crosshairIcon) {
      // One fetch, and the `ch-art` class only once the bytes are in: a pack
      // without `hk` keeps the centre dot instead of an empty box.
      const url = `${page.hudPaths.url(`${hudFeed.crosshairIcon.texture}.png`)}${page.bust()}`;
      const img = new Image();
      img.onload = () => {
        page.crosshairEl.querySelector('.ch-pic').style.backgroundImage = `url("${url}")`;
        page.crosshairEl.classList.add('ch-art');
      };
      img.src = url;
    }
    return hudFeed.crosshairIcon;
  }

  function updateCrosshair() {
    const { style, deviation, scoped } = crosshairAim();
    // `!fullmapBox.hidden` covers both overlays this can now collide with: the
    // deploy screen and the full map. They did not need saying while this ran
    // only from `footFire`, which the overlay suppresses; it runs every frame
    // now, so a soldier waiting to spawn would otherwise aim at his own map.
    const show = (style === 'CHTCrossHair' || style === 'CHTIcon')
      && !scoped && page.fullmapBox.hidden;
    // Written only on change, and read back from the element rather than a
    // cache because enterVehicle and disposeHandWeapon hide it behind this
    // function's back: every DOM write here invalidates style, and a frame
    // with nothing new to say must cost the page nothing (rule 3).
    if (page.crosshairEl.hidden !== !show) page.crosshairEl.hidden = !show;
    if (!show) return;
    const icon = style === 'CHTIcon';
    if (page.crosshairEl.classList.contains('ch-icon') !== icon) {
      page.crosshairEl.classList.toggle('ch-icon', icon);
    }
    // The renderer's own backing store, not `stageHeight`: a headless capture
    // resizes the renderer through `__renderOnce` and never touches the page,
    // so the cached page height is stale there and the crosshair gap came out
    // scaled for a window nobody is looking at. Same reasoning, and the same
    // source, as the HUD canvas's own size in `frame()`.
    const ratio = page.renderer.getPixelRatio();
    const height = page.renderer.domElement.height / ratio || 800;
    if (icon) {
      const leaf = crosshairIconLeaf();
      if (!leaf) return;
      // The HUD stretches its virtual screen independently on each axis
      // (hud.js `_scaleFor`), so the icon does too.
      const width = page.renderer.domElement.width / ratio || 1280;
      setCrosshairVar('--ch-icon-w', leaf.rect[2] * width / leaf.virtual[0]);
      setCrosshairVar('--ch-icon-h', leaf.rect[3] * height / leaf.virtual[1]);
      return;
    }
    const px = 0.5 * height * Math.tan(deviation) / Math.tan(page.camera.fov * page.DEG_TO_RAD / 2);
    setCrosshairVar('--ch-gap', px);
  }

  function setCrosshairVar(name, px) {
    const value = `${px.toFixed(1)}px`;
    if (page.crosshairEl.style.getPropertyValue(name) !== value) {
      page.crosshairEl.style.setProperty(name, value);
    }
  }

  // --- the in-game HUD: soldier-side variables --------------------------------
  //
  // hud.js owns the one painter for every group hud-layout.json declares; this
  // page's job is only to keep `gameHud.vars` current with the engine's own
  // named variables (features/bf1942-3d-models/in-game-hud.md). This section
  // feeds the SOLDIER side — health bar, stance figure, hand-weapon ammo panel —
  // plus the one shared boolean (`Vehicle/ShowVehicleIcon`) that switches the
  // ammo panel between its soldier and vehicle skins; a future seats.js owns
  // the vehicle-side groups themselves (vehicleIcon/vehicleHealth/vehicleSeats/
  // primaryAmmo/secondaryAmmo) and, once it lands, the finer-grained seated
  // state that boolean really needs — see the note on `inVehicle` below.

  // c_BfSoldierStanding/Crouching/Lying, the engine's own pose vocabulary
  // (CommonSoldierData.inc), against the sprite pack's own suffix — a direct
  // rename, not an inference.
  const STANCE_TEXTURE = { stand: 'standing', crouch: 'crouching', prone: 'lying' };

  // OPEN [R1-12]: the nation key BFSoldierHud's stance icon actually reads was
  // never traced (verify-r1.md leaves it open). Approximated with the same
  // per-side nation the deploy screen's own kit art already resolves
  // (`teamNation`), translated only where the icon set's own filenames spell a
  // nation differently from the flag-mesh table (`jap`, where `hud.json`'s
  // `flagMeshNation` says `jp`) — an asset-naming difference this file already
  // has to bridge elsewhere, not a new engine fact.
  const STANCE_NATION = { us: 'us', ger: 'ger', brit: 'brit', rus: 'rus', jp: 'jap' };

  // The kit's own health-bar art, memoised: `kitLoadout` allocates a small
  // object per call, so this only re-resolves it when the level/team/kit
  // actually changed instead of on every rendered frame
  // (features/mesh-viewer-performance, rule 5). Compared field by field, not
  // via a joined-string key: a template literal built fresh every call to
  // throw away immediately is itself the per-frame allocation rule 5 rules out.
  hudFeed.kitArtDir = null;
  hudFeed.kitArtTeam = null;
  hudFeed.kitArtKitName = null;
  hudFeed.kitArtCache = null;
  function kitHealthArt(team, kitName) {
    if (team !== hudFeed.kitArtTeam || kitName !== hudFeed.kitArtKitName || page.currentDir !== hudFeed.kitArtDir) {
      hudFeed.kitArtDir = page.currentDir;
      hudFeed.kitArtTeam = team;
      hudFeed.kitArtKitName = kitName;
      const resolved = page.kitLoadout(team, kitName).kit;
      hudFeed.kitArtCache = (resolved && page.loadouts?.kits?.[resolved]) || null;
    }
    return hudFeed.kitArtCache;
  }

  // The stance icon's own nation, memoised the same way and for a bigger
  // reason: `teamNation` allocates a `Map` and walks every control point on
  // the level (found while reviewing this track — it was being called
  // unmemoised, once per rendered frame, the exact per-frame-allocation-plus-
  // O(n)-scan shape rule 5 exists to catch). The team's nation cannot change
  // without a fresh spawn, so this only re-runs it when the team or level did.
  hudFeed.nationArtDir = null;
  hudFeed.nationArtTeam = null;
  hudFeed.nationArtCache = null;
  function stanceNation(team) {
    if (team !== hudFeed.nationArtTeam || page.currentDir !== hudFeed.nationArtDir) {
      hudFeed.nationArtDir = page.currentDir;
      hudFeed.nationArtTeam = team;
      hudFeed.nationArtCache = STANCE_NATION[page.teamNation(team)] || (team === 1 ? 'ger' : 'us');
    }
    return hudFeed.nationArtCache;
  }

  /**
   * Keep `gameHud.vars` current with the soldier's own state, once per
   * rendered frame (HUD-3: the engine itself recomputes this HUD once per
   * `Renderer_drawFrame`, not the 30Hz tick) — called from `frame()`, right
   * before `gameHud.paint()`. Writes plain fields on an existing object only;
   * the nation and kit-art lookups are memoised above (rule 5), so the only
   * per-call allocation left is the display-string template literal itself.
   */
  // The "nothing to warn about" frame: what `CombatArea.step` returns inside
  // the area, hoisted so `updateSoldierHud` allocates nothing per frame.
  const IN_COMBAT_AREA = { countdown: 0 };

  // `setHudAmmoType` -> `Ammo/AmmoType`, and which of those print a round
  // count: both live in `hud.js` beside the rest of the layout's own
  // vocabulary, so `tests/hud_harness.mjs` can drive them under node. HUD-10.
  //
  // Every `soldierAmmo` variable this file writes, so a weapon swap starts from
  // nothing. The `Ammo/Primary*` names are shared with the vehicle panel, which
  // is fine: the two groups are mutually exclusive in the layout
  // (`Vehicle/ShowVehicleIcon` gates one and `NotData` of it the other), and
  // only one of them is fed at a time.
  const SOLDIER_AMMO_VARS = [
    'Ammo/AmmoType', 'Ammo/PrimaryAmmo', 'Ammo/MaxPrimaryAmmo', 'Ammo/PrimaryMag',
    'Ammo/SoldierAmmo/SoldierAmmoHasMag', 'Ammo/SoldierAmmo/SoldierAmmoIcon',
    'Ammo/SoldierAmmo/SoldierAmmoBar', 'Ammo/SoldierAmmo/SoldierAmmoBarFill',
    'Ammo/SoldierAmmo/SoldierAmmoBarSize',
  ];

  function updateSoldierHud(dt = 0.016) {
    const vars = gameHud.vars;
    const inVehicle = page.optPilot.checked && !!page.occupancy;

    if (page.hitIndicatorTimer > 0) {
      page.hitIndicatorTimer = Math.max(0, page.hitIndicatorTimer - dt);
      if (page.hitIndicatorTimer <= 0) {
        vars['HitFromDir/HitFromDir'] = 0;
        vars['HitFromDir/HitFromDirAlpha'] = 0;
      } else {
        vars['HitFromDir/HitFromDir'] = page.hitIndicatorDir;
        vars['HitFromDir/HitFromDirAlpha'] = page.hitIndicatorTimer;
      }
    }

    if (page.soldierArmor && !page.soldierDead && !inVehicle) {
      if (page.lastSoldierHp !== null && page.soldierArmor.hitPoints < page.lastSoldierHp - 0.01) {
        const drop = page.lastSoldierHp - page.soldierArmor.hitPoints;
        page.playSoldierHurtSound(false);
        if (page.hitIndicatorTimer <= 0) {
          page.triggerHitIndicator(1, drop / (page.soldierArmor.maxHitPoints || 100));
        }
      }
      page.lastSoldierHp = page.soldierArmor.hitPoints;
    } else {
      page.lastSoldierHp = page.soldierArmor?.hitPoints ?? null;
    }
    // Any seat at all, which `seats.js` answers for: `occupancy` is non-null
    // from the moment `setPilot` seats someone until `leaveVehicle` /
    // `exitManned` clears it, whatever the seat is — a cockpit, a driver's
    // bench, or a Defgun that has no drivetrain to be an `aircraft`/`car` at
    // all. This runs after `frame()`'s dispatch has already called
    // `feedVehicleHud`, so testing `aircraft || car` here would blank the
    // vehicle groups that a manned gun had just filled in.
    // A seated soldier's optOnFoot box is still ticked — he is only suspended,
    // per disposeHandWeapon's own comment on the old #ammo element — so the
    // vehicle check has to be explicit here too.
    // A dead body is in the world (his corpse and the ticket counter stay) but
    // his HUD is not: retail drops the stance/health, weapon and ammo groups
    // the instant the local player dies -- the death cam shows only the
    // minimap, the tickets and the spawn chrome -- so everything below the
    // ticket feed gates on `onFootActive`, which a death clears.
    const inWorld = page.optOnFoot.checked && !!page.soldier && !inVehicle;
    const onFootActive = inWorld && !page.soldierDead;
    // The ticket counter is not the soldier's, and its own `when` is only
    // `ShowTicket`, so it would otherwise ride over a free-fly camera — where
    // this viewer deliberately shows no HUD chrome at all and the game would
    // not be in a round. Gate it on the player being in the world (on foot or
    // in any seat), which is the same condition that raises the rest of the
    // HUD. Fed before every early return below, because a soldier who has just
    // died leaves `soldier` null while the counter is still up in the game.
    page.feedTicketVars(vars);
    if (!inWorld && !inVehicle) vars['ShowTicket'] = false;
    // The soldier ammo panel is gated on `Ammo/AmmoType` alone (plus not being
    // in a vehicle), and the live branches below only ever write it, so a
    // death would leave the last magazine readout painted over the death cam.
    // In a seat the shared `Ammo/Primary*` names carry the vehicle's own feed,
    // hence dead-only here.
    if (page.soldierDead) for (const name of SOLDIER_AMMO_VARS) delete vars[name];
    // The flag-status disc beneath the minimap: the layout's own `ShowFlagIcon`
    // leaf at (720,230) 64x64 (the neutral white flag while the local player
    // stands inside a neutral control point's radius; the screenshot's little
    // white flag). Fed from the same capture state `updateCaptureHud` reads, so
    // the disc and the CAPTURING line can never disagree. `AxisFlagIcon` /
    // `AlliedFlagIcon` stay unfed — CTF-only leaves with no conquest meaning.
    page.feedFlagIconVars(vars);
    // The combat-area warning, drawn by the layout's own `outside` group.
    // `stepCombatArea` leaves `combatFrame` null whenever nothing the engine
    // would call a player is in the world, and its countdown is 0 while that
    // player is inside — either way the group culls, the engine's own gate
    // being `0 < Outside/OutsideTime`. Not gated on `onFootActive`: the warning
    // is exactly as much the pilot's as the rifleman's.
    page.combatArea.feed(vars, page.combatFrame || IN_COMBAT_AREA);
    // T4a / V-R4: retail keeps the soldier stance icon inside vehicles.
    vars['Soldier/ShowSoldierIcon'] = !!page.soldier && (onFootActive || inVehicle);
    vars['Vehicle/ShowVehicleIcon'] = inVehicle;
    vars['Weapon/ShowWeaponIcon'] = onFootActive && !!page.handWeapon;
    // The weapon bar (the kit's inventory row the game paints while a weapon
    // is being selected — layout group `weaponBar`, gated on this one var, so
    // a stale true could draw it over a cockpit): up for a beat after the last
    // selection input, on foot only. Written before every early return below.
    const weaponBarUp = onFootActive && performance.now() < page.weaponBarUntil;
    vars['Weapon/SelectingWeapon'] = weaponBarUp;
    if (!weaponBarUp) {
      // Only cleared here — the icon/slot values themselves may stay stale
      // while the bar is down, because every weaponBar leaf is gated on
      // SelectingWeapon and culls whole.
      for (const key of page.WEAPON_ICON_VARS) vars[key] = null;
      vars['Weapon/WeaponSelect'] = null;
    }

    if (!page.soldier) {
      vars['CrossHair/ShowCrossHair'] = false;
      vars['CrossHair/ScopeIndex'] = 0;
      return;
    }

    const iconNation = stanceNation(page.deployTeamId);
    const stanceWord = STANCE_TEXTURE[page.soldier.stance] || 'standing';
    vars['Soldier/SoldierIcon'] = `Soldier/Icon_${iconNation}_soldier_${stanceWord}.tga`;

    // The kit glyph is baked into these two textures already (opened
    // healthbar_full_scout_64x64.png directly: the scout scope icon sits in the
    // art itself), not a separate layout element — feeding these two is the
    // whole of "the health bar and its kit art".
    const art = kitHealthArt(page.deployTeamId, page.deployKit);
    vars['Soldier/SoldierHealthBarIcon'] = art?.healthBarIcon;
    vars['Soldier/SoldierHealthBarFullIcon'] = art?.healthBarFullIcon;

    // TEMPORARY seed, not a feed: `Soldier/SoldierHitPoints` and
    // `SoldierMaxHitPoints` are supply-and-health's (BRIEFING2), and nothing in
    // this worktree tracks damage yet. Vanilla's own constant
    // (CommonSoldierData.inc: HitPoints 30, MaxHitPoints 30) seeds the bar so
    // its fill layer has something to paint before that track lands; the `??=`
    // means a real tracked value, once written, is never stomped back to this.
    vars['Soldier/SoldierMaxHitPoints'] ??= 30;
    vars['Soldier/SoldierHitPoints'] ??= 30;

    // SCOPE-1 / V-R5: CrossHair/* is owned here (T5). Off-foot, drop the overlay
    // so ScopeIndex cannot stick into a seat; Submarine/ShowPeriscope stays
    // untouched for whatever later feeds a real periscope. Soldier art above
    // already ran for the seated case (T4a).
    if (!onFootActive) {
      vars['CrossHair/ShowCrossHair'] = false;
      vars['CrossHair/ScopeIndex'] = 0;
      return;
    }
    vars['Submarine/ShowPeriscope'] = false;

    // The weapon bar's own contents while it is up: the spawned kit's
    // inventory — one icon per `addWeaponIcon` entry (slot order, loadouts'
    // `weapons` list), painted at the slot's own numbered rect the way the
    // engine raises it (a mod kit with no slot-2 weapon leaves that rect's
    // variable unfed, so the layout's literal picture shows — HUD-1), and the
    // highlighted fill on the slot in hand. The variable names come from the
    // prebuilt WEAPON_ICON_VARS so nothing allocates per frame.
    if (weaponBarUp && page.kitWeaponSlots) {
      for (let slot = 1; slot <= page.WEAPON_ICON_VARS.length; slot++) {
        const entry = page.kitWeaponSlots.find(w => w.slot === slot);
        vars[page.WEAPON_ICON_VARS[slot - 1]] = entry ? (entry.icon || null) : null;
      }
      vars['Weapon/WeaponSelect'] = page.handSlot;
    }

    const hw = page.handWeapon;
    if (!hw) {
      vars['CrossHair/ShowCrossHair'] = false;
      vars['CrossHair/ScopeIndex'] = 0;
      return;
    }
    // SCOPE-1 / V-R5: FireArms::setZoom writes ScopeIndex 0/1 when useScope;
    // weapon sync copies ScopeIcon / SniperSight / SightIcon. spriteKeyFromRef
    // in hud.js turns `sniper.tga` into atlas key `sniper`.
    // Hip fire keeps ShowCrossHair false so layout leaves 10–13 (four fill
    // ticks gated only on ShowCrossHair) do not draw a black box over the DOM
    // `#crosshair`; the scope overlay is the only layout CrossHair consumer.
    const zoom = hw.data?.zoom;
    const scoped = !!(zoom?.scope && page.isZoomed());
    if (scoped) {
      vars['CrossHair/ShowCrossHair'] = true;
      vars['CrossHair/ScopeIndex'] = 1;
      vars['CrossHair/SniperSight'] = !!zoom.sniperSight;
      vars['CrossHair/ScopeIcon'] = zoom.icon || 'sniper.tga';
      if (!zoom.sniperSight) {
        // Binoculars branch (SCOPE-3): ring via SightIcon. sightIcon is not yet
        // extracted on weaponStats — fall back to the layout's authored default.
        vars['CrossHair/SightIcon'] = zoom.sightIcon || 'scout_ring_128x128.tga';
      }
    } else {
      vars['CrossHair/ShowCrossHair'] = false;
      vars['CrossHair/ScopeIndex'] = 0;
    }
    const magazine = hw.data?.magazine;
    const hudAmmo = (hw.data?.hudAmmo || '').toLowerCase();
    const ammoHud = hw.data?.hud;
    const ammoType = AMMO_TYPE_CODES[hudAmmo];
    // Every branch below only ever WRITES, so without this a weapon swap left
    // the previous weapon's leaves behind: switch off a bazooka and its rocket
    // icon stayed in `SoldierAmmoIcon`, switch to a knife (`ATNone`, which no
    // branch feeds) and the rifle's `AmmoType 1` kept the whole magazine panel
    // on screen. Harmless while only two branches existed and only one of them
    // fed an icon; not once every type in HUD-10's enum is reachable. Cleared
    // to undefined rather than to a zero, which is the painter's own rule.
    for (const name of SOLDIER_AMMO_VARS) delete vars[name];
    if (hudAmmo === 'atammobar' && magazine) {
      // R1-19/HUD-9, the magazine-bar branch. PrimaryAmmo is the loaded round
      // count (top-right, "14" in the retail shot); PrimaryMag is a SEPARATE
      // int, the spare-magazine count (bottom-right small box, "5") — the two
      // numbers verify-r1.md's report was asked to settle, and they are not
      // the same count.
      vars['Ammo/AmmoType'] = 1;
      vars['Ammo/PrimaryAmmo'] = hw.rounds;
      vars['Ammo/MaxPrimaryAmmo'] = magazine.size;
      vars['Ammo/PrimaryMag'] = hw.mags;
      // OPEN: no `.con` word or client write-site for SoldierAmmoHasMag turned
      // up in R1's survey; fed true unconditionally so the spare-count readout
      // shows at all for a magazine weapon — an assumption this file is making,
      // not a confirmed engine default.
      vars['Ammo/SoldierAmmo/SoldierAmmoHasMag'] = true;
      // The weapon's own bar art/size (weaponStats.hud), tolerant per HUD-1:
      // absent leaves hud-layout.json's own literal (vanilla's rifle-style bar).
      if (ammoHud?.ammoBar) vars['Ammo/SoldierAmmo/SoldierAmmoBar'] = ammoHud.ammoBar;
      if (ammoHud?.ammoBarFill) vars['Ammo/SoldierAmmo/SoldierAmmoBarFill'] = ammoHud.ammoBarFill;
      if (ammoHud?.ammoBarSize) vars['Ammo/SoldierAmmo/SoldierAmmoBarSize'] = ammoHud.ammoBarSize;
    } else if (ammoType >= 2) {
      // Every icon-style type. HUD-10 closed the enum: the `.meme` value and
      // the `.con` value are THE SAME enumeration, so the weapon's own
      // `setHudAmmoType` goes straight through with no converter to write.
      //
      // The one real change is `ATIcon`, which this fed as **6** on the
      // reasoning that 6 and 7 painted identically and the choice was
      // arbitrary. It is 2, and it is not arbitrary: the layout's `{2,3,4,5}`
      // group draws the rounds text (gated `ne 4 && ne 5 && ne 6`) where the
      // `{6,7}` group does not, so a Bazooka, Panzerschreck, ExpPack,
      // Detonator or Landmine was showing an icon with no rocket count beside
      // it. 6 is `ATIconAndHeatBar`, which in vanilla is the MedPack alone.
      //
      // `Ammo/PrimaryAmmo` is fed for every type whose layout branch prints it,
      // and left alone for the two that do not (4 `ATIconAndReloadBar`, the
      // RepairPack; 5 `ATIconNoText`).
      vars['Ammo/AmmoType'] = ammoType;
      // `magSize -1` is the engine's unlimited ammo (`hw.rounds` = Infinity),
      // and the detonator is the one weapon in vanilla that declares it AND an
      // icon type that prints a count — left alone it painted the word
      // "Infinity" beside the demokit icon. An unlimited weapon has no count to
      // print, so it gets none.
      if (AMMO_TYPES_WITH_ROUNDS.has(ammoType) && Number.isFinite(hw.rounds)) {
        vars['Ammo/PrimaryAmmo'] = hw.rounds;
      }
      if (ammoHud?.icon) vars['Ammo/SoldierAmmo/SoldierAmmoIcon'] = ammoHud.icon;
    }
    // `ATNone` (0, the two knives) and anything unrecognised leave
    // `Ammo/AmmoType` unset: every soldierAmmo leaf requires it, so the whole
    // panel culls rather than guessing a shape for a weapon this file cannot
    // classify. For a knife that is also what the engine does -- 0 is tested by
    // no layout branch at all.
  }

  /** Announce the view C just selected, then fall back to the control list. */
  const VIEW_BLURB = {
    cockpit: 'cockpit · first person, from the seat\'s own eye point',
    nose: 'nose cam · past the propeller, no cockpit, reticle over open air',
    chase: 'chase · behind and above, horizon held level',
    front: 'front · ahead of the nose, looking back',
    flyby: 'fly-by · planted in the world, re-plants as you pull away',
    // The soldier's own names (`soldier-camera.js`).
    inside: 'first person · through the soldier\'s own eyes',
  };
  hudFeed.hudViewTimer = 0;
  function showView(mode) {
    page.hud.textContent = `view: ${VIEW_BLURB[mode]}`;
    clearTimeout(hudFeed.hudViewTimer);
    hudFeed.hudViewTimer = setTimeout(page.updateHud, 2200);
    // Seat poses only draw in external views — hide in the cockpit (CVMInside),
    // since the player is looking out from the pilot's eyes, not at the seat.
    page.updateSeatPoseVisibility();
  }

  // --- the sprite pack --------------------------------------------------------
  //
  // Every marker on every map surface is the game's own sprite out of
  // `menu.rfa`: `extract_hud_pack.py` decodes them into `maps/_shared/hud/`
  // for vanilla and into `maps/mods/<mod>/_shared/hud/` for whatever a mod
  // repaints, and `hudPaths` above picks between the two per file. So an Eve
  // of Destruction level flies the NVA and Viet Cong flags its own archives
  // hold, over the vanilla bezel and rings it never touched. `hud.json` names
  // the sprites and carries the flag-mesh-to-nation table (EoD's own, which
  // is why `flagso_m1` resolves differently there); `minimap-icons.json` is
  // `ObjectTemplate.setMinimapIcon` per vehicle template, read from the mod's
  // own `Objects.rfa` chain. They are point art and are drawn unsmoothed at
  // whole multiples where the surface allows.
  const hudPack = { sprites: new Map(), icons: {}, nations: {} };

  /** The player marker ships as a black cut-out — a solid arrowhead inside a
   *  translucent disc, colour left to the engine. Painted once the way the HUD
   *  shows it, grey disc and green arrow, and kept as a canvas. */
  function tintPlayerRing(img) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (!a) continue;
      if (a >= 200) {
        px[i] = 118; px[i + 1] = 214; px[i + 2] = 92;
      } else {
        px[i] = 214; px[i + 1] = 214; px[i + 2] = 208;
        px[i + 3] = Math.min(215, Math.round(a * 1.45));
      }
    }
    ctx.putImageData(data, 0, 0);
    return c;
  }

  async function loadHudPack() {
    let manifest, icons;
    try {
      [manifest, icons] = await Promise.all([
        fetch(`${page.hudPaths.url('hud.json')}${page.bust()}`).then(r => r.json()),
        fetch(`${page.hudPaths.url('minimap-icons.json')}${page.bust()}`).then(r => r.json()),
      ]);
    } catch (error) {
      // The surfaces still draw — fallback dots, no chrome — so this is a
      // warning, not a failure.
      console.warn('hud sprite pack unavailable', error);
      return;
    }
    hudPack.nations = manifest.flagMeshNation || {};
    hudPack.icons = icons || {};
    for (const [name, entry] of Object.entries(manifest.sprites || {})) {
      const img = new Image();
      img.onload = () => {
        hudPack.sprites.set(name, name === 'minimap_icon_ring_32x32'
          ? tintPlayerRing(img) : img);
        if (page.deployActive()) {
          page.paintDeploySoon();
          // The spawn rings draw with these sprites (with a stroked-circle
          // fallback); once the real ring lands, put it on the map at once.
          page.drawFullMap(true);
        }
      };
      img.onerror = () => {};
      img.src = `${page.hudPaths.url(entry.file)}${page.bust()}`;
    }
  }
  loadHudPack();

  const sprite = name => hudPack.sprites.get(name) || null;

  // The in-game HUD painter (hud.js), sharing this same sprite pack rather than
  // fetching its own copy. `gameHud`, not `hud`: that name is already the
  // `#hud` hint-line DOM element throughout this file. Published unconditionally
  // on `window.__hud` — not only under `?shots` — because that is the whole of
  // the round-2 contract other tracks (seats.js, supply.js, armor.js) write
  // their own variables through: `window.__hud.vars['Vehicle/VehicleIcon'] =
  // ...`, once those tracks land.
  const hudCanvas = document.getElementById('hud-canvas');
  const gameHud = new Hud({ canvas: hudCanvas, sprite,
                            base: rel => page.hudPaths.url(rel), bust: page.bust });
  gameHud.load();
  window.__hud = gameHud;

  Object.assign(hudFeed, {
    clearVehicleHud,
    crosshairAim,
    feedSeatDots,
    feedVehicleHud,
    gameHud,
    hudPack,
    showView,
    sprite,
    updateCrosshair,
    updateSoldierHud,
  });
  return hudFeed;
}
