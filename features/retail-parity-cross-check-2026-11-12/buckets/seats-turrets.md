# seats-turrets

## Summary

- CODE-WRONG: 3 (all low; latent or mod-only, no vanilla seat moves today)
- SETTLED: 1 (low)
- DELIBERATE: 3
- INCONCLUSIVE: 2
- MATCH: 19 groups (listed below)

Not reached, and why: the DEV-* deviation law in `seat-cone.js` (AI-145, DEV-9..14, the
bot-pilot "OPEN") is the deviation bucket's; I checked only that its addresses name the
right functions. `model-clips.js` / `model-crew.js` lean on TANK-12 / Engine rows (vehicle
bucket); I only checked the names. Camera mouse-look (MLK-*) neck limits in
`vehicle-camera.js` were not re-derived. `vehicle-players.js` client HUD addresses were
checked by name only, except the turret-icon gate (read).

## Findings (non-MATCH), most severe first

### F1 [CODE-WRONG] [low] Entry-point fallback radius is 4 m; the engine default is 3.0
- Code: `tools/bf1942-models/viewer/vehicle-entry.js:30` — `const ENTRY_RADIUS_FALLBACK = 4;`
  (comment line 28: "the only invention here is the 4 m fallback radius"); used through
  `entry-points.js:65` `radius: entry.userData?.seat?.entryRadius || fallbackRadius`.
- Ledger: SEAT-32 (reads the door's `setEntryRadius` at template `+0x138`) — no row states the default.
- Third-party: not needed; the ctor is two instructions.
- Our binary: `EntryPointTemplate::EntryPointTemplate()` lnxded `0x081ae0e0`:
  `movl $0x40400000, 0x138(%ebx)` = **3.0**. `BFfindEntryPoint` reads that same field
  (`flds 0x138(%eax)` at `0x0831d994`).
- Verdict reasoning: an `EntryPoint` whose `.con` omits `setEntryRadius` reaches 3.0 m in
  retail, not 4. Also `||` turns an explicit `setEntryRadius 0` (never reachable in retail)
  into 4. Census of every EntryPoint in `viewer/models/**` (12,479): every one carries an
  `entryRadius`, so nothing reaches the fallback today. It is a latent wrong default.
- Fix: `ENTRY_RADIUS_FALLBACK = 3` (cite `0x081ae0e0`), and in `entry-points.js:65` use
  `entry.userData?.seat?.entryRadius ?? fallbackRadius` so a declared 0 stays 0. Fix the
  comment at vehicle-entry.js:27-29.

### F2 [CODE-WRONG] [low] RotationalBundle omitted-word defaults: maxSpeed 0 and accel 90 where the engine has 1.0 and 0.1; and no skip of a maxSpeed-0 axis
- Code: `bf42/con.py:2001` `"maxSpeed": (self.max_speed or (0.0, 0.0, 0.0))[index]` and
  `:2013` (acceleration left out when absent or 0); `viewer/turret-rig.js:86`
  `TURRET_ACCELERATION = 90`, `:242` `Math.abs(this.spec.acceleration || TURRET_ACCELERATION)`,
  `:234` `this.spec.maxSpeed || 0`. `TurretAxis.step` always runs `_advance` and `_clip`.
- Ledger: GUN-2 (law), GUN-20 ("skipping a slot whose `maxSpeed` component is exactly 0").
  con.py's own docstring at `:2036` already cites the ctor defaults (maxSpeed 1.0, accel 0.1)
  for the landing-gear path, but the aim-axis emission at `:2001` does not use them.
- Third-party: not needed (ctor and branch read directly).
- Our binary: `RotationalBundleTemplate::RotationalBundleTemplate()` lnxded `0x081d922b`
  `movl $0x3f800000` into `+0x174/+0x178/+0x17c` (maxSpeed **1.0** each),
  `0x081d923c` `movl $0x3dcccccd` into `+0x180..` (acceleration **0.1** each); min/max/cont 0;
  input ids `0x37` (none). `RotationalBundle::handleUpdate` `0x081d79b0..0x081d79ec`:
  `flds 0x174(%esi); fucomp; cmpb $0x40,%ah; jne` per slot, so `calculateAndClipAngle` is
  not called for a slot whose maxSpeed == 0. No servo, no continuous term, no
  automaticReset ramp and no clip run for it.
- Verdict reasoning: (a) an omitted `setMaxSpeed` turns at 1 deg/s per input unit in retail,
  but the viewer freezes it. (b) An omitted `setAcceleration` ramps at 0.1 deg/s^2 in retail
  (effectively frozen), but the viewer gives it 90. (c) A declared-0 maxSpeed axis is
  skipped outright in retail; the viewer still clips it and still runs automaticReset and
  the continuous term. Census of `viewer/models/**` rig axes: of 8,288 mouse-look
  RotationalBundle axes, 10 have maxSpeed 0 and 8 lack an acceleration. All of them are mods:
  bf1918 Stationary_Browning, Daimler_Truck_AA PomPomYawer and autocarmg TopMGYawer(1);
  DC Stationary_Browning; EoD M35Quad50 and Mk19. The 211 maxSpeed-0 rig axes are all either
  those free mouse axes or free `c_PIFire` automaticReset axes, which the rig does not drive.
  So nothing that moves today diverges. Whether those 10 guns are "omitted" (retail turns
  them) or "declared 0" (retail freezes them) cannot be told from the glb. Reading their
  `.con` settles it.
- Fix: in `con.py` aim-axis emission, emit the engine default for an omitted word:
  `maxSpeed` from `self.max_speed or (1.0, 1.0, 1.0)` and `acceleration` from
  `self.acceleration or (0.1, 0.1, 0.1)`. Always emit `acceleration`, even when it is 0.
  In `turret-rig.js`, change `TURRET_ACCELERATION` to `0.1`, or better, drop the fallback
  once every tree is re-baked. Add `if (!this.spec.maxSpeed) return;` at the top of
  `step`, and the same guard in `preview` / `stepFrom` (return the unchanged state): that
  is GUN-20's skip. Re-bake the affected mod trees per the exporter rules.

### F3 [CODE-WRONG] [low] Exit with no `setSoldierExitLocation` puts the soldier 2 m left; the engine default is the PCO origin
- Code: `viewer/vehicle-entry.js:294` and `:426`
  `: new THREE.Vector3(-2, 0.5, 0);` (comment: "else two metres to the vehicle's left").
- Ledger: SEAT-35 (exit = template `+0x158` position × PCO absolute matrix). No row gives the default.
- Third-party: n/a.
- Our binary: `PlayerControlObjectTemplate::PlayerControlObjectTemplate()` lnxded
  `0x08319725` `movl $0x0,%esi` then `0x0831973a/0x08319771/0x08319774`
  `movl %esi, 0x158/0x15c/0x160(%ebx)` (exit position **0,0,0**), and the same for `+0x164`
  (exit rotation 0).
- Verdict reasoning: retail drops an occupant whose seat declares no exit location at the
  seat PCO's own origin. The viewer invents (-2, 0.5, 0). Nothing documents it as
  deliberate. Census: every vanilla PCO in `viewer/models` carries `soldierExitLocation`.
  203 mod PCOs do not (FHSW 128, mostly attitude indicators; DC 50 bunker PCOs; bf1918 17;
  EoD 5; GCMOD 3). Most of these are not seats.
- Fix: either `new THREE.Vector3(0, 0, 0)` (retail), or keep (-2, 0.5, 0) and label it a
  viewer choice in the comment (it stops a man being placed inside the hull's collision).
  Owner's call. Today it only touches mod non-seats and DC bunkers.

### F4 [SETTLED] [low] seat-survey "OPEN (SEAT-22)": seat position numbers are answered by SEAT-34
- Code: `viewer/seat-survey.js:128-137`: "the *position* integer itself is assigned by
  client-side helpers this data does not expose. Declaration order is the approximation …
  OPEN (SEAT-22)".
- Ledger: SEAT-34 (confirmed 2026-10-25): each PCO's `setPcoId`, else the lowest free number
  in a breadth-first walk. The depth-first order the viewer uses gives the same numbers on all
  126 multi-seat vanilla/XPack1/XPack2 roots.
- Third-party: not needed.
- Our binary: `postInitPcoId` lnxded `0x0831c7c0`. It walks a `std::list` queue
  (`list::resize` / `_M_create_node` at `0x0831c7f7`/`0x0831c821`), takes children through
  vt+0x7c (`0x0831c8e2`) and the sibling link `+0x54` (`0x0831c98b`), and files ids with
  `_Rb_tree::insert_unique` (`0x0831ca15`). It then assigns the unnumbered PCOs with
  `_Rb_tree::find` for the lowest free id (`0x0831cac0`). This is breadth-first with pcoId
  first, as SEAT-34 says.
- Verdict reasoning: the open question is closed. The code still ignores `setPcoId` (the
  extractor does not emit it) and walks depth-first. That is exact for the three vanilla packs.
  It is unchecked for mods, where a `setPcoId` or a deep tree could reorder keys 1..9.
- Fix: update the comment to cite SEAT-34. Optionally have `con.py`/`assemble.py` emit
  `setPcoId` and sort `order` by (pcoId, BFS index), which makes it exact everywhere.

### F5 [DELIBERATE] [-] Viewer choices that are documented, keep them
- `vehicle-camera.js:83-120` CHASE/FRONT/flyby framing: the labelled `legacy` framing. The
  retail law (CVM-2/5/6) is in `chase-camera.js`. The header lines 16-31 ("a hardcoded
  constant we cannot read") are stale next to the "SINCE READ" paragraph at 55-59, so that
  part is comment-only.
- `vehicle-entry.js` `BAIL_OUT_HEIGHT = 9.5`, `BAIL_OUT_HULL_GRACE = 1.5`: the comment says
  the engine has no such number.
- `vehicle-entry.js:31` `ENTRY_SCAN_PERIOD = 0.25` s: how often the HUD prompt is checked, a
  browser choice. The press itself runs the full finder.
- `entry-points.js` `pickNearest` `TIE_EPSILON` first-wins: see F6.

### F6 [INCONCLUSIVE] [low] Equal-distance door tie-break
- Code: `spawn-seat.js:37-39` (documented: "the engine breaks that tie on the incumbent's
  template flag bit 0 … which is not read"), `entry-points.js:109` first-declared wins.
- Our binary: `BFfindEntryPoint` `0x0831d9ce..0x0831d9e0`. After `fucompp` on
  (best, d): `andb $0x45; xorb $0x40; jne take` and, on equality, `cmpb $0,-0x45(%ebp); jne reject`.
  `-0x45` is `vt+0x20(template) & 1` of the incumbent (`0x0831da99..0x0831daa5`). So on a tie
  the LATER candidate in grid order replaces the incumbent unless the incumbent's flag bit 0
  is set. The viewer keeps the earlier one. Because distances are cut to whole centimetres,
  ties are common at shared doors (Sherman, M3A1). Grid order is the culler's and differs
  from declaration order anyway.
- To settle: name template vt+0x20 (IPlayerControlObjectTemplate slot) and read the
  BinTree/QuadTree culler's insertion order for one hull's doors. The lab's M3A1 door press
  would show which passenger seat retail picks.

### F7 [INCONCLUSIVE] [low] Track texture scroll "at the engine's 60 Hz assumption"
- Code: `viewer/model-rig.js:83-85` `TICKS_PER_SECOND = 60`.
- Our binary: the server's `AnimatedBundle::handleVisualUpdate` `0x08265730` never touches
  the texture speed (template `+0x1bc` on Mac, `AnimatedBundleTemplate::setAnimatedTextureSpeed`
  Mac `0x00822c54`). The consumer is client renderer code, which I did not find in the Mac
  dump (only setter/makeScript reference it). The simulation runs at 30 Hz (MENU_STEP,
  HFD-6), so "60 Hz engine" is at least unsupported.
- To settle: find the client reader of AnimatedBundleTemplate+0x1bc (the winpc offset may
  differ) and see whether it scales by frame dt, tick count or wall time.

## MATCH list

- SEAT-32 / `BFfindEntryPoint` 0x0831d770 -> spawn-seat.js `findEntryPoint`. Distance cut
  `trunc(d*100)/100` (constant 0x86b01ac = 100.0, truncating control word 0x0831d94e). Reach is
  `useTemplateRadius ? +0x138 : radius`, strict `<` (0x0831d976..0x0831d9a1). `d <= r^2` (0x0831d9a7..b8).
  Initial best 100000.0 (0x86c089c). Team 0-or-mine on the root (0x0831da58..71). Occupied
  seat skipped (vt+0x14). Wreck via `queryComponent(0xc4a4)` vt+0xc8.
- SEAT-31 grid candidates -> `hullFrom` / `getObjectsFromGrid(pos, radius)` takes the
  query radius (0x0831d7fe call with `0xc(%ebp)`).
- SEAT-26 / SEAT-28 -> vehicle-entry.js `open` (mayEnterHull, isWreck).
- SPAWN reach constants: getActive human 5.0 (`0x08163fd6` `0x40a00000`), bot 15.0
  (`0x08163f9d`), toggleEntryPoint bot 15.0 (`0x0814f22e`), human 3.0 + useEntryRadius
  (`0x0814f25c` push 1, `0x0814f262` `0x40400000`), getPreferredPco at vt+0x48 (`0x0814f293`).
- SEAT-30 `getPreferredPco` 0x083193c0 -> `preferredSeat`: types `<=1`, 0x11, 0x12; root
  free (vt+0x14). Ctor default vehicleType 0x14 (`0x083198b2`).
- GUN-2 `calculateAndClipAngle` 0x081d7490 -> turret-rig.js `TurretAxis`. Early-out on
  accel==0 && cont==0. rememberExcess off: backlog zeroed and input used raw. Target
  `sign(accel)*input*maxSpeed` (fchs, `fmuls 0x174`). Ramp `|accel|*dt` with overshoot
  clamp to target. `angle += speed*dt + cont*dt`. Wrap only when min==max==0: >180 → -360,
  then <-180 → +360 (0x86c031c 180, 0x86c0320 360, 0x86c0324 -180). Else `>max → max`,
  else `<min → min`. Speed never zeroed. Backlog clamps ±40 / -1.0 only in the
  rememberExcess branch (0x86c866c, 0x86c8670, 0x86b05ec).
- GUN-2 automaticReset law -> `_stepAutomaticReset`: target `sign(accel)*input*maxRotation`,
  angle ramps at `|accel|` deg/s with overshoot clamp, then the same clip.
- HP-15 0.2 input scale -> turret-rig.js `step(inputScale)`: `RotationalBundle::handlePlayerInput`
  `0x081d834f` (`+0xee`), `fldl 0x86c8678` = 0.2 applied to all three axes.
- GUN-20 compose order / MLK-17 (yaw, pitch, roll) -> `poseNode` (names only; handleUpdate's
  skip is F2).
- CVM-2/5/6 constants 1.2 / 0.3 / 0.6 / -2.0, both binaries (lnxded 0x86c4f64/0x86c030c/
  0x86c4f68/0x86c4f6c, client 0x8fb7d0/0x8d6434/0x8eb33c/0x8ea538) -> chase-camera.js via
  seat-camera.js.
- CVM-1 CameraTemplate ctor 0x081accc0: four mode bytes 1 and three 0 -> seat-view.js cycle
  (byte-to-mode mapping taken from CVM-1).
- VIEW-16 / seat-view.js `vehicleFov`: PCO template ctor `+0x248` = 0 (`0x08319973`, esi=0).
- VHUD-9 turret icon -> vehicle-occupancy.js `showsTurretIconAt`: client `0x006ae5ac`
  `cmpl $0x3` (view mode) && template vt+0x60, stored to `[0xa5f1a8]+0xc +0xac`.
- SEAT-37 -> seat-body.js: `PlayerControlObject::enter` `0x08317372` `call *0x2c` with
  (1, 0) = updateFlags; `SeatObject::enter` 0x083208d0 named.
- SEAT-8 / SEAT-9 seat flags and setUseSeat -> seat-ik.js / seat-pose.js (names: operator<<
  0x083207f0, setUseSeat 0x08271950, setAnimationState 0x0826cee0).
- IK chain names -> seat-ik.js: updateIk 0x08265880, applyIk 0x08342610, transform
  0x083420f0, applyIK2BoneSolver 0x083418f0 / maya 0x08332e10, setRotation 0x08060d30,
  yaw/pitch/roll 0x08061db0/dd0/df0, rotateZDeg 0x080625f0.
- PHY-10 origin 1 m over the feet -> vehicle-entry.js `nearestEntry` origin (`toggleEntryPoint`
  measures from the control object's `getAbsolutePosition`, vt+0x3c → vt+0x38).
- seat-survey.js engine-type / physics names (operator<<(EngineType) 0x0823ef60, PCO
  handlePlayerInput 0x08318900, Camera::setViewMode 0x081ac7c0, setVehicleFOV 0x081aadd0)
  name-checked.
- `entry-points.js` `boundingRadius` -> `BCompositeObject::getBoundingRadius` 0x08165630 (name only).

## Fix-phase findings (2026-11-12)

### F2, settled against the `.con` sources
I read the 10 affected axes in the installed archives (`~/.wine/.../Mods` and
`~/.cache/vimpact-game/Mods`) with `bf42.rfa.RfaArchive`:
- **Eight are authored 0.** Each is a two-slot bundle whose triple carries the other
  slot's speed: `Stationary_Browning` Point `setMaxSpeed 90/0/0` and Rotation `0/90/0`
  (bf1918, and DC's glb is identical); EoD `M35Quad_MGBase 90/0/0` and `MGRotation 0/90/0`;
  EoD `Mk19Point 90/0/0`; bf1918 `Daimler_Truck_PomPomYawer 10/0/0` with its pitch bound.
  Retail skips those slots (GUN-20), so they hold still. The viewer already held them,
  and now does so by the gate.
- **Two are a con.py parse failure, not an omission.** bf1918 `autocarmg_TopMGYawer`
  and `autocarmg_TopMGYawer1` say `setMaxSpeed 40/0`. `con.py`'s strict `vec3` threw on
  the two-component token, so the word was dropped and the glb carries maxSpeed 0. The
  console reads a Vec3 per CON-16 (`operator>>(istream&, Vec3&)` 0x080b7130): the last
  component read repeats, so this is 40/0/0. Retail traverses these guns at 40 deg/s per
  input unit, while today's glb holds them still. **The glb cannot say 40, so no viewer
  fallback can recover it; this needs a re-extract.**
- **Survey of every bound template, all 12 mods, both installs**
  (scratchpad `scripts/omitted.py`, `scripts/shortvec.py`).
  - The only kinds built on `RotationalBundleTemplate`'s ctor are `Camera`, `Engine`,
    `FloatingBundle`, `LandingGear` and `Wing`: they are the only callers of
    `RotationalBundleTemplate::RotationalBundleTemplate()` in lnxded, and none stores
    over `+0x174..+0x188`.
  - Bound templates that omit `setMaxSpeed`:
    - The SBD pilot hatch (`sbdcockpitpilothatch` and `sbd-tcockpitpilothatch`), bound to
      `c_PIMenuSelect3`, in vanilla, FH, FHSW and FHSWEurope.
    - bf1918 `horse_spearcamera` (Camera).
    - FHSW and FHSWEurope tank Engines `jagdtiger_gt102engine`, `pantherf_88_gt102_engine`,
      `pantherf_gt102_engine` and `pantherg_gt101_engine` (bound to `c_PIYaw`/`c_PIThrottle`).
      Their `extras.physics.maxSpeed` already reads null, which `ground-engine.js` treats as
      1.0. Only their rig axes carried a wrong 0.
  - Non-triple rotation words:
    - bf1918 `autocarmg_TopMGYawer` and `TopMGYawer1`: `setMaxSpeed 40/0`.
    - FH `pzl11ElevatorLeft` (Wing): `setMaxSpeed 0/110`.
    - DC and DC_Final `F14AFrontHatch_R` and `F14BFrontHatch_R` (LandingGear): `setMaxSpeed -3/-90`.
  - No input-bound `RotationalBundle` omits `setMaxSpeed` apart from the SBD hatch. So on
    today's trees a rig maxSpeed of 0 on a mouse, stick or steering bundle is authored,
    and the GUN-20 gate freezes nothing that turns in retail. The one current case is
    bf1918 `bicycle_albelt_Complex`: `setMaxSpeed 0/100/0` with yaw bound to `c_PIYaw`,
    31 placements in the local bf1918 level bakes. Retail holds that bundle still, and
    the viewer steered it at `spec.maxSteer` until now.

### F6, narrowed
- The tie flag is `ObjectTemplate::getFlags()` (`0x0816af70`, `movl 0x14(%eax),%eax`), read on
  the incumbent seat's PlayerControlObjectTemplate. PCO template vtable `0x0873eba0` has
  +8+0x20 = `0x0816af70`; `updateFlags` sits in the next slot (`0x081d4c90`).
- `ObjectTemplate` ctor `0x081d46bd`: `movl $0x0, 0x14(%ebx)`.
- No `or $0x1` on `+0x14` and no immediate-1 `updateFlags` call exists anywhere in lnxded.
  The direct calls set 0x40, 0x20 and 0x2; no virtual `vt+0x24` call is preceded by
  `push $0x1`.
- So bit 0 is never set as far as a static read shows, and **on equal cut distances the
  LATER candidate in the grid's walk wins**. Which candidate is later depends on the order
  `ObjectManager::addChildObjects` appends a hull's doors (the `getChild` / sibling-link
  order against `.con` `addTemplate` order), which I did not read.
- I did not implement this: flipping `pickNearest` to "last wins" over declaration order
  could be wrong either way until that walk order is read. Still INCONCLUSIVE, with half
  of it settled.

## Fixes applied

- **F1**: entry-point fallback radius is now the engine default.
  - `viewer/vehicle-entry.js:27-32`: `ENTRY_RADIUS_FALLBACK = 3.0`, citing the
    `EntryPointTemplate` ctor `0x081ae0e0` and SEAT-32.
  - `viewer/entry-points.js:65`: `entryRadius ?? fallbackRadius`, so a declared 0 stays 0.
  - Tests: `test_vehicle_entry_reach` 8 OK, `test_vehicle_entry_wreck` 4 OK, `test_seats` OK.
- **F2**: con.py reads and defaults the servo words as the engine does; TurretAxis gains the
  GUN-20 skip; the steering bundles get the same gate.
  - `bf42/con.py` (setMinRotation/setMaxRotation/setMaxSpeed/setAcceleration parse): reads
    through `stream_vec3` (CON-16) in place of strict `vec3`.
  - `bf42/con.py` (new `SERVO_TEMPLATE_KINDS`, `rig()`): for RotationalBundle, Camera,
    Engine, Wing, LandingGear and FloatingBundle, an omitted `setMaxSpeed` emits 1.0 and an
    omitted `setAcceleration` emits 0.1. The acceleration is always emitted, an authored 0
    included. `_landing_gear_axes` emits the defaulted speed it already gated on, not 0.
    The `physics()` block is unchanged and still reports null for an omitted word.
  - `viewer/turret-rig.js`:
    - `TURRET_ACCELERATION = 0.1` (was 90) and new `TURRET_MAX_SPEED = 1.0`, both with ctor
      citations.
    - `??` in place of `||` throughout.
    - `_still()` makes `step`, `preview` and `stepFrom` skip an axis whose maxSpeed is 0
      (GUN-20, `0x081d79b0..ec`). `hold()` and `swingToward()` are unchanged.
  - `viewer/tracked-vehicle.js:536-604, 885`: a steering bundle whose yaw maxSpeed is 0
    holds its rest angle (`wheel.steerHeld`). This replaces the "waits on con.py" note.
  - `viewer/ground-engine.js`: re-read and left as it is. Its Engine axes take maxSpeed and
    acceleration from `extras.physics`, which already reports null for an omitted word, and
    the ground verifier's `axisRate` already applies GUN-20 there. It reads no steering
    bundle.
  - Tests:
    - `tests/test_seats_harness.mjs`: 18 hand-built aim specs that relied on the 90 fallback
      now carry `acceleration: 90`, so their behaviour is unchanged. `fallbackAccelAtTenth`
      and `fallbackAccelAtHalf` are rounded to 4 places. Two new probes:
      `zeroSpeedContinuousAngle` and `zeroSpeedClipAngle`.
    - `tests/test_seats.py`: `test_an_axis_without_one_falls_back_and_is_slower` became
      `..._takes_the_engine_default`. It encoded the wrong 90; it now expects 0.1, 0.01 and
      0.05. New `test_a_zero_max_speed_axis_is_not_stepped`.
    - `tests/test_con.py`: new `test_a_short_rotation_vector_reads_as_the_console_reads_it`
      and `test_an_omitted_servo_word_is_the_template_default`.
  - Results, all OK: test_con 135, test_assemble 157, test_seats 89, test_held_axis,
    test_patch_held_axes, test_mouse_input 40, test_gun_recoil, test_ground 135,
    test_physics, test_flight, test_ship, test_spin, test_seat_aim_state, test_bot_ai 76,
    test_loaded_rounds, test_world, test_idle_vehicle, test_bomb_release, test_rocket_flight,
    test_body_ground, test_contact_response, test_world_ship_pitch, test_ship_law,
    test_ship_dive, test_patch_engine_limits, test_dc_engine_reads, test_extract_vehicle_ai,
    test_vehicle_part_sounds.
  - Failing for reasons outside these files:
    - `test_dogfight_school`: 4 failures. Its gunner modules call only `TurretRig` /
      `hold()` / `swingToward()`, which this change does not touch. These are probably other
      sessions' flight work; not proven.
    - `test_body_float`: 2 failures. `viewer/body-float.js` and `tests/test_body_float.py`
      carry another session's uncommitted edits.
    - `test_mouse_look_key`: setUpClass errors because its harness does not copy
      `engine-spin.js`. That harness problem is independent of this change.
- **F3**: the no-exit-location default is now the PCO origin.
  - `git log -S` traces the (-2, 0.5, 0) offset to ef53c2252 (2026-09-15, "press E, and
    the war has a driver's seat"). It was a first-cut placeholder, not a defect fix.
  - `viewer/vehicle-entry.js` `exitPose` doc and both sites now use `(0, 0, 0)`, the
    template default (PCO template ctor `0x0831973a..0x08319789`, SEAT-35).
  - **Not changed, outside my files:** `server/level-instance.mjs:285` holds the same
    `new THREE.Vector3(-2, 0.5, 0)` for the room's exit, and `tests/test_room.py:285` says
    "The default exit point is 2 m to the vehicle's left" (that suite is skipped here).
    The coordinator should hand those to the server bucket.
- **F4**: `viewer/seat-survey.js` `surveyVehicle` doc. The "OPEN (SEAT-22)" paragraph now
  cites SEAT-34 (`postInitPcoId` 0x0831c7c0: `setPcoId`, else lowest free in a
  breadth-first walk) and records that the extractor does not read `setPcoId`. No ordering
  code changed, because the data does not carry the word.
- **F5**: `viewer/vehicle-camera.js` header. "a hardcoded constant we cannot read" now says
  the law is read (CVM-2/5/6, `chase-camera.js`) and that this section is the labelled
  `legacy` framing.
- **F6**: not implemented (see "F6, narrowed" above).

### Re-extracts needed (mod re-extraction out of scope; for the coordinator)
- **bf1918:** `autocarmg` (models tree and every bf1918 level bake that places it). This
  restores the top MGs' traverse (`setMaxSpeed 40/0`, retail 40), and is the one visible
  case. Also `horse_spearcamera`'s Camera look rig.
- **FHSW and FHSWEurope:** `jagdtiger_gt102engine`, `pantherf_88_gt102_engine`,
  `pantherf_gt102_engine` and `pantherg_gt101_engine` rig axes (maxSpeed 0 -> 1.0), plus
  the SBD hatch.
- **FH:** `pzl11ElevatorLeft` (Wing `0/110` -> 0/110/110) and the SBD hatch.
- **DC and DC_Final:** `F14AFrontHatch_R` / `F14BFrontHatch_R` (LandingGear `-3/-90` ->
  -3/-90/-90).
- **Vanilla:** the SBD hatch only (bound to `c_PIMenuSelect3`; nothing in the viewer
  drives it).
- **Every tree, no behaviour change:** rig axes of the six servo kinds now carry an
  explicit `acceleration` (0 where authored 0) where the key was absent before. Every
  viewer consumer reads an absent key as 0, so this changes no behaviour. It needs no
  rebake on its own.

## Ledger edits

- **GUN-20**, append to the row's claim: "The skip is per slot: a slot whose `maxSpeed` is
  exactly 0 runs no servo, no continuous term, no automaticReset ramp and no clip. An
  OMITTED `setMaxSpeed` is not 0: every kind built on `RotationalBundleTemplate`'s ctor
  (RotationalBundle, Camera, Engine, Wing, LandingGear, FloatingBundle; the only callers of
  `0x081d91c0`/`0x081d90c0` in lnxded, none storing over `+0x174..+0x188`) starts at
  maxSpeed 1.0 and acceleration 0.1 per component (`0x081d922b`, `0x081d923c`). Viewer:
  `turret-rig.js` `TurretAxis._still`, `tracked-vehicle.js` `steerHeld` (2026-11-12)."
- **New row SEAT-38** (or append to SEAT-32): "**An EntryPoint that declares no
  `setEntryRadius` reaches 3.0 m.** `EntryPointTemplate::EntryPointTemplate()` stores
  `0x40400000` to `+0x138` (lnxded `0x081ae0e0`), the field `BFfindEntryPoint` compares the
  cut distance with (`flds 0x138(%eax)` `0x0831d994`) | **confirmed** (2026-11-12) | ctor
  read. Viewer `vehicle-entry.js` `ENTRY_RADIUS_FALLBACK`."
- **SEAT-35**, append: "A template that never says `setSoldierExitLocation` exits at the
  seat PCO's own origin with no rotation: the PCO template ctor zeroes `+0x158..+0x160` and
  `+0x164..+0x16c` (`0x0831973a`..`0x08319789`). Viewer `vehicle-entry.js` `exitPose`
  (2026-11-12); `server/level-instance.mjs` still uses (-2, 0.5, 0)."
- **SEAT-32**, append on ties: "On equal cut distances the newcomer replaces the incumbent
  unless the incumbent seat's template `ObjectTemplate::getFlags()` (`0x0816af70`,
  `+0x14`) has bit 0. The ctor zeroes it (`0x081d46bd`), and no writer of bit 0 was found
  in lnxded, so in practice the later candidate in `getObjectsFromGrid`'s walk wins. That
  walk's order among one hull's doors is unread."
- **CON-16**, append: "`con.py` reads `setMin/MaxRotation`, `setMaxSpeed` and
  `setAcceleration` this way since 2026-11-12. Before that a two-component token
  (bf1918 `autocarmg_TopMGYawer` `setMaxSpeed 40/0`, FH `pzl11ElevatorLeft`, DC
  `F14*FrontHatch_R`) dropped the word."
