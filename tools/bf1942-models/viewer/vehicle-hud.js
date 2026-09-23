/**
 * The in-game HUD's vehicle and gun side: the Vehicle/* variables, the seat
 * dots, the ammo and reload bars, and the crosshair. Split out of
 * `hud-feed.js`, which keeps the HUD itself and the sprite pack.
 *
 * Built once by the page. `page` hands in what it reads of the rest of the
 * page, as getters (a binding the page reassigns is read live):
 * `aircraft`, `bust`, `camera`, `car`, `crosshairEl`, `DEG_TO_RAD`,
 * `fireStateFor`, `forgetOccupiedVehicle`, `fullmapBox`, `gameHud`,
 * `handWeapon`, `hudPaths`, `isZoomed`, `itemsLocked`, `LOCAL_PLAYER`,
 * `mannedActive`, `mannedGuns`, `netOccupiedVehicleId`, `occupancy`,
 * `occupiedVehicleDamage`, `occupiedVehicleIdFor`, `optOnFoot`, `renderer`,
 * `roomClient`, `roomJoined`, `soldier`, `vehicleGuns`, `view`, `world`.
 */
export function createVehicleHud(page) {
  const vehicleHud = {};

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
    vehicleHud.seatDotsFor = null;
    vehicleHud.seatDotsSig = null;
    page.forgetOccupiedVehicle();
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
  vehicleHud.seatDotsFor = null;
  vehicleHud.seatDotsSig = null;

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
    if (page.occupiedVehicleIdFor(page.occupancy.root) == null) return [];
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
    if (vehicleHud.seatDotsFor === page.occupancy && sig === vehicleHud.seatDotsSig) return;
    vehicleHud.seatDotsFor = page.occupancy;
    vehicleHud.seatDotsSig = sig;
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
  vehicleHud.crosshairIcon = undefined;          // undefined until the layout has been looked at
  function crosshairIconLeaf() {
    if (vehicleHud.crosshairIcon !== undefined) return vehicleHud.crosshairIcon;
    const layout = page.gameHud.layout;
    if (!layout) return null;   // not loaded yet; ask again next frame
    const leaf = (layout.groups?.crosshair?.elements || []).find(
      el => el.kind === 'variable-picture' && el.var === 'CrossHair/CrossHairIcon');
    vehicleHud.crosshairIcon = leaf?.rect && leaf.texture
      ? { rect: leaf.rect, virtual: layout.virtual || [800, 600], texture: leaf.texture }
      : null;
    if (vehicleHud.crosshairIcon) {
      // One fetch, and the `ch-art` class only once the bytes are in: a pack
      // without `hk` keeps the centre dot instead of an empty box.
      const url = `${page.hudPaths.url(`${vehicleHud.crosshairIcon.texture}.png`)}${page.bust()}`;
      const img = new Image();
      img.onload = () => {
        page.crosshairEl.querySelector('.ch-pic').style.backgroundImage = `url("${url}")`;
        page.crosshairEl.classList.add('ch-art');
      };
      img.src = url;
    }
    return vehicleHud.crosshairIcon;
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

  Object.assign(vehicleHud, {
    ammoBarCode,
    clearVehicleHud,
    crosshairAim,
    crosshairIconLeaf,
    feedSeatDots,
    feedVehicleHud,
    fireGroupFor,
    hullSeatOccupants,
    insideView,
    readyFraction,
    remoteSeatOccupants,
    setCrosshairVar,
    setHudVar,
    turretDialAngle,
    updateCrosshair,
  });
  return vehicleHud;
}
