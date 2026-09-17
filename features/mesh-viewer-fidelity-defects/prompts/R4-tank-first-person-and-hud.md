# R4 — The tank driver's view, and how the HUD reaches the screen

You are a research agent on the map-viewer fidelity round. Read
`features/mesh-viewer-fidelity-defects/BRIEFING.md` first if you have not.
You read the engine and the shipped data; you do not change the viewer.

## The defect

Retail's tank driver sees the world through a slot in a riveted metal interior
that fills the rest of the frame, with the gun barrel crossing the slot from
the right, and a complete HUD strip along the bottom: soldier health bar and
stance figure at the far left, vehicle health bar and vehicle icon, seat dots,
a centred comms icon, then two ammo panels reading `30` (shells) and `400` (MG).

The viewer, from the same seat: no interior at all — the world fills the frame
— a large black wedge where geometry is being drawn wrong, and a HUD strip that
is shifted, part-scaled, clipped at the bottom, **missing the soldier group
entirely**, and showing both ammo icons with **no counts**.

Compare `game-tank-1p.png` with `mesh-tank-1p.png`, and their strips.

## Evidence and the measurements already taken

`_hud-scale-compare.png` is an identical 1:1 crop of both captures'
bottom-left corner (x 0–760, y 1140–1440) with a 100 px grid. Both captures are
~2545x1440. From it, stated as **observations to confirm or refute, not as
findings**:

- Retail appears to stretch the 800x600 virtual HUD space onto the whole
  screen with **independent x and y scale**. The vehicle health bar's rect is
  `(174, 525)`, 32x64 (VHUD-7): `174 x 2542/800 = 553` and
  `525 x 1440/600 = 1260` land on the measured left edge (~545) and top
  (~1260). A uniform fit with pillarboxing predicts x ≈ 729, which the capture
  does not show.
- The viewer's vehicle group sits ~30 px lower than retail's, runs off the
  bottom of the screen, and its sprites read ~1.3x retail's.
- Retail draws the soldier health bar and stance figure **while the player is
  inside the tank**. The viewer draws neither.

## What is already settled — do not re-derive it

- **HUD-1…10** and **VHUD-1…8**, with `subsystems/ingame-hud.md` as the
  narrative. In particular: every number is bound through one generic
  named-variable registry populated once per **rendered frame** (HUD-3);
  `TransformNode::draw` (`0x007e92b0`) is the whole coordinate law — a child
  accumulates `parent.xy + local.xy` plus its own `w`/`h` (HUD-8); three
  fill-node classes share one `draw()` and one fill formula
  (HUD-5…7); `visibleFraction = (Size / textureNativeDimension) x (Variable / Maximum)`,
  and a missing `Maximum` collapses it to 0, not full.
- **VHUD-7** gives the absolute 800x600 rects, independently re-walked and
  reproduced to the pixel: vehicle icon 128x128 at (200,462); health bar 32x64
  at (174,525); six 8x8 seat dots at `(192 + VehiclePosX[i+1], 452 + VehiclePosY[i+1])`;
  turret dial back-plate 64x64 at (400,540), pipe 16x32 at (418,540), body
  32x32 at (410,550); vehicle-players popup 220x85 at (201,502); ammo panel
  two-icon primary/secondary at (600,514)/(720,514), one-icon fallback at
  (710,514); soldier-skin panel background at (589,525).
- **VHUD-8.** Hit points are set exactly once, on a vehicle's **root**
  PlayerControlObject — switching seats never changes displayed HP — while
  icon and ammo-bar words are per seat.
- **VHUD-9 is open**: what sets `Vehicle/ShowTurretIcon`, and what
  `Vehicle/IconLookRotation` measures (unit, sign, pivot). The viewer feeds
  neither, so the dial never draws.
- **VHUD-10 is open**, and it is exactly the missing `30` / `400`: whether a
  **driver's own** weapons feed `Ammo/PrimaryAmmoText`, `Overheat/OverHeat` and
  `Ammo/ReloadTime` the way a manned gun's do, and which weapon fills primary
  versus secondary when the root declares `NumberOfWeaponIcons 2`. The static
  half is confirmed — a Sherman's root feeds cannon + `ABAmmoBarReloadBar` and
  coax + `ABAmmoBarHeatBar` correctly.
- `hud.js` culls any leaf whose required variables are not all present in
  `vars` rather than inventing a value, which is why absent variables show up
  as missing art rather than empty bars.
- `features/bf1942-3d-models/in-game-hud.md` closes with two things you should
  read: that closing VHUD-10 means changing how `drive()` fires (a gated
  `FireState` per `vehicleGuns` entry rather than the unconditional
  `setFiring` it uses today), and a previous **stage-size** bug in the same
  family as the misplacement above — the HUD painted against a stale
  `stageWidth`/`stageHeight` that `resize()` stamped once at load, 76 px
  shorter than the 3D frame it was merged with.
- `flight.js` already does the cockpit-interior graft for aircraft:
  `<Control>.cockpit.glb` built by `extract_models.py --cockpit`, selected by
  `reaches_first_person(library, name)`, swapped by `CockpitSwap` — in the
  shipped data cockpits are strikingly uniform (`DistCompareSelector`,
  exterior first, interior second, `addLodComparison 0.5`).

## Questions, in priority order

1. **What is the black frame in retail's tank view?** Settle whether it is
   (a) an interior mesh selected the way an aircraft cockpit is, (b) a
   full-screen HUD picture in `menu/InGame`, or (c) the hull's own geometry
   seen from a camera inside it. Name the file and the mechanism. Then say
   whether the Sherman's template tree satisfies `reaches_first_person`, i.e.
   whether `extract_models.py --cockpit` would already produce the asset the
   viewer is missing.
2. **Where is the driver's eye, and what FOV?** The camera position for the
   driver's seat relative to the hull, the FOV it uses (GUN-6: no vanilla
   vehicle sets `vehicleFov`, `zoomFov` or `useScope` — so what does a tank
   driver get, and from where), what geometry is hidden while first-person, and
   what the engine does on the `C` view toggle the retail capture's help line
   mentions.
3. **The screen mapping — the most valuable answer in this track.** How does
   the engine map an 800x600 HUD rect to a screen of arbitrary size? Read it,
   do not fit it: find where the HUD's projection or viewport is set up
   (`TransformNode::draw` consumes rects; something upstream turns them into
   device coordinates) and state the rule, including what happens at 4:3 versus
   16:9 and whether any element is exempt. Check the rule against the retail
   capture at 2542x1440 and against a second resolution if you can produce one.
   The viewer's misplaced, mis-scaled strip is almost certainly this rule being
   wrong.
4. **Which groups are live for a driver, and who writes them.** Confirm from
   the client that the soldier group (health bar, stance figure) really is fed
   while the player occupies a vehicle — HUD-3 says the soldier group calls
   `setPoseAndIcon` when the current control object's template class id is
   `CID_BFSoldierTemplate` and `SoldierHud::reset` otherwise, which on its face
   predicts a *reset* inside a tank; the capture shows a healthy-looking bar
   and figure. Resolve that apparent contradiction; it decides whether the
   viewer should feed the soldier group from the player's body while driving.
5. **Close VHUD-10 if you can.** Which weapon feeds the primary panel and which
   the secondary for a Sherman driver, what writes `Ammo/PrimaryAmmoText`,
   `Overheat/OverHeat` and `Ammo/ReloadTime` for a drivetrain root, and what
   `FireArmsBundle::getAmmo` (lnxded `0x08290cd0`) reports for a root holding
   two FireArms. The retail capture gives you ground truth to check against:
   `30` shells and `400` MG rounds, the MG falling to 195 and the cannon to 29.
6. **Close VHUD-9 if you can.** What sets `ShowTurretIcon` and what
   `IconLookRotation` measures. Leads already in the corpus: whatever per-frame
   code writes `ShowVehicleIcon` almost certainly writes `ShowTurretIcon`
   beside it, and the `+0x320` member's owner gives the angle's producer. Say
   whether retail draws the dial for a Sherman driver at all — the capture is
   evidence.
7. **The crosshair in the slot.** The retail capture shows a small red cross in
   the view slot. Which `CrossHair/CrossHairType` a tank driver gets, what
   colours it (`CrossHair/CrossHairRed/Green/Blue` divided by 256 per the
   layout note), whether it deviates, and how it relates to the gun's actual
   aim point. Coordinate with R5, which owns the scope overlay in the same
   region — you own the vehicle side.
8. **Seat dots and the players popup** for a tank: which of the five
   `Occupied/OccupiedData` states a driver's own seat resolves to (VHUD-2
   settles the table but calls the live selector open), and whether the popup
   appears unprompted.

## Deliverable

The report shape in the briefing, plus:

- The screen-mapping rule, written as a formula from virtual (x, y, w, h) to
  device pixels, with the evidence for it.
- A table of every HUD variable a tank driver's frame needs, who writes it in
  retail, and whether the viewer currently has a source for it.
- A clear verdict on the interior: asset path, extraction command, and whether
  anything in `extract_models.py` needs to change to produce it.

## What would make this report wrong

- Fitting the screen mapping to one screenshot instead of reading it. One
  capture cannot distinguish several plausible rules; the code can.
- Assuming the interior is a HUD image because it looks 2D, or assuming it is
  geometry because aircraft use geometry. Establish which.
- Answering VHUD-10 with "the viewer should just feed the numbers it has". The
  question is what retail feeds, including which weapon lands in which panel.
