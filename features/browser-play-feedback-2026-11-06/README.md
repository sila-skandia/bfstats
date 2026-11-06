# Browser play feedback, 2026-11-06

A player recorded a 17-minute walkthrough of play.bfstats.io (`bfstats.webm`
in the repo root, not committed: 1920x1080 AV1, 17:21) and wrote their
observations as white captions on the video. They were impressed overall:
flying "feels good and it's just like the original", tank steering and
shooting are good, and the controls preview soldier was called "a small
innovation". This page lists every caption that reports a defect or a gap, with
its timestamp, and what the investigation of each one found.

Their setup, from the video: Windows 11, Opera (German locale), the page in
browser fullscreen (F11).

## How the captions were read

One frame a second, OCR'd with macOS Vision over the full frame (the captions
move around the screen during gameplay), deduplicated, then the fragments
checked by eye against the frames. Re-run:

```bash
ffmpeg -i bfstats.webm -vf "fps=1,scale=1440:-1" -q:v 3 frames/c_%04d.jpg   # c_NNNN = second NNNN-1
```

## The reports

| # | Time | Caption (verbatim, typos kept) | Area |
|---|---|---|---|
| 1 | 5:26-6:06 | "In the Options section and common Menu, we can see our key bindings. Normally we can change these, but that doesn't seem to be possible yet or i do something wrong? It's more like a live overlay thats shows us, when we press the keys we've used, they then light up in green live" | OPTIONS > CONTROLS: no click-to-rebind |
| 2 | 8:44-9:08 | "In the graphics menu we see that we can't set the video resolution here. We can only relieve the graphics card a little by setting the video performance to lower or higher." | OPTIONS > VIDEO: no resolution |
| 3 | 1:21-1:36 | "In the singleplayer menu we can not play the campaign like in the original." | SINGLEPLAY: no campaign |
| 4 | 5:11-5:24 | "Unfortunately, online gaming is not yet possible via the browser." | MULTIPLAY: join not possible (known) |
| 5 | 10:59-11:24 | "In this mod (it is not an original BF1942 version), bots can sometimes not drive tanks" | Bots: Chi-ha tanks with bots aboard, not moving (US vs Japan level) |
| 6 | 11:25-11:32 | "sometimes you can't kill the machinegun guy on the tank" | Damage: a tank's exposed MG gunner |
| 7 | 11:44-11:57 | "DESTROYED TANKS, AIRCRAFT AND VEHICLES ARE NOT VISIBLE ON THE MAP AFTER A RESPAWN" | Vehicle respawn |
| 8 | 11:58-12:12 | "funny trembling soldiers..." (a prone medic shaking on the ground) | Prone soldier jitter |
| 9 | 12:13-12:20 | "Airplanes didn't start correctly if they be destroyed. they glitched in ground" | Aircraft respawn |
| 10 | 12:36-13:02 | "sometimes when you press the second mouse button the browser exits full screen mode" | Input: right mouse button |
| 11 | 15:42-16:42 | "Outposts that are now being captured have a new design. It is shown when an allieds player tries to capture an Axis position, then you see a circle that indicates how long it will take to capture it." | Capture ring (an observation, not a complaint; see capture-progress-rings) |

7 and 9 are one subsystem (a destroyed vehicle's respawn) and are
investigated together.

## Status

All fixed on `fix/browser-play-feedback` (each built on its own branch and
merged), 2026-11-06. None of it has been seen in a real browser on a real
level yet; every fix is covered by node/Python tests that run the real
modules and fail on the old code.

| # | Status | What changed | Tests | Left open |
|---|---|---|---|---|
| 1 | fixed | DEFINE KEY on OPTIONS > CONTROLS to retail parity: click a box, press a key / button / wheel / axis; Escape unbinds; Grave refused; per-map conflict scan; SAVE refuses on conflict, writes the four `.con` files byte-identical to a retail save; DEFAULT confirms. `controls-edit.js` (new), `controls.js` (engine key table, slot flag, mixed axis verbs), `play/controls-screen.js`, `page-input.js` (screen gets Escape first). Ledger CTL-1..CTL-8; viewer-profile-controls section 8 | `test_controls_rebind` (45) | FIRE / ALT FIRE swapped between mouse buttons has no effect in game yet (the page's mouse path predates the control map); Grave in game still opens the console; browser-reserved keys can't be bound |
| 2 | fixed | Retail's DISPLAY MODE plate and list (`WxHx32`, heights that fit the screen) replaces RENDER SCALE; the chosen height sets the pixel ratio in `resize()`; a stored percentage migrates. Ledger VID-11; video-options README | `test_display_mode`, `test_video_settings` (now runs on macOS), `test_controls_menu` | No entries above native (no supersampling); `screen.*` under Windows zoom unchecked |
| 3 | built | SINGLEPLAY > CAMPAIGN | INSTANT BATTLE; the campaign screen; 16 missions in retail's order with per-side tickets; retail's score rule, floors/caps, final grade; single-player results screen with DONE / REPLAY / CONTINUE; saved per side in localStorage. Long LEVELS titles cut before NO BOTS. Ledger CAMP-1..CAMP-6; [single-player-campaign](../single-player-campaign/README.md) | `test_campaign` (.py 14, .mjs 28) | **Needs its data published** (`menu/campaign.json`, the three menu pages, debriefing layout and 14 textures under `maps/_shared/hud/`) before the CAMPAIGN button appears live; until then the menu shows Instant Battle alone. Campaign briefing plate not drawn |
| 4 | not done | Online play from the browser is a known roadmap item | | |
| 5 | fixed | A bot hull wedged on a prop plants an obstacle at the contact, fails the route at 401 ticks as retail, starts the replan from a free point and backs out. Wake, 16 seeds x 900 s: stuck-hull windows 6 (714 s) -> 2 (138 s). Soldiers on foot byte-identical. Ledger AI-163 | `test_bot_hull_wedge` | Turn-in-box dither; a Sherman high-centred on terrain; beached Daihatsus; an idle Sherman at its order point |
| 6 | fixed | Half-body (hatch) seats are hittable as retail; hidden drivers still are not; hidden leg capsules dropped so nothing pokes through the roof; a stand-in sphere while the seat model loads; bots can hit a player in a hatch. Ledger SEAT-37 | `test_hatch_gunner` (12) | Pilots are half-body seats, so they are hittable now too (retail's rule); bot rounds still see through hulls (older issue) |
| 7, 9 | fixed | A respawn re-parks the hull on its pad visible and frozen, resets every rigged part to rest (gear down), and `aircraftSpec` measures at rest (1.80 m, not 0.46 m). Pads keep SPAWN-14's 2 m clearance from the player. Rooms fixed too | `test_vehicle_respawn` (5) | The netcode server's own pads have no SPAWN-14 check |
| 8 | fixed | `soldierFrame`'s right row no longer flips past 90 degrees of pitch. Longest flip run 1004 -> 3 ticks. Ledger AI-108 / VIEW-14 dated notes | `test_bot_aim_frame` | Bots drawn at view yaw, not body yaw + 3x twist (parity, not shaking) |
| 10 | mitigated | Opera detected: a one-time card on first capture says how to turn off mouse and rocker gestures (German names too), shown again if the page was hidden with the right button held; defaults cancelled on every mouse button and the context menu while captured; the leave-page guard covers seated play | `test_opera_gestures` (11) | Whether Opera's gestures fire under pointer lock needs a real Opera on Windows |

## Findings

Each investigation's result, as it landed, before the fixes.

### #10 Right mouse button "exits fullscreen": Opera's mouse gesture

Not our page. At 12:35.5 the player holds right mouse (binocular zoom) while
moving the mouse; at ~12:36.1 the game cuts in one frame to a freshly loading
Opera Speed Dial tab, with Opera's "hold Esc to exit fullscreen" hint still up,
so the window was still fullscreen and a new tab came to the front. At 12:42
the tab strip shows the game tab (still playing audio) plus three Speed Dial
tabs: it happened more than once. Hold-right-and-move-down is Opera's
documented "new tab" gesture, on by default on Windows
([Opera help](https://help.opera.com/latest/shortcuts/),
[forum diagnosis of the same report](https://forums.opera.com/post/114858)).
Retail binds alt-fire/zoom (`c_PIAltFire`) to the right button, so players
hold it while aiming: exactly the gesture's trigger.

Ours: `page-input.js:869-919` acts on buttons 0 and 2 only; no
`preventDefault` on `pointerdown`/`pointerup` (932-1033); no `mousedown`,
`mouseup` or `auxclick` listeners anywhere; `contextmenu` is prevented on the
canvas only (1052-1054); the `beforeunload` guard (424-428) covers on-foot
play only, not seated.

A page probably cannot cancel Opera's gestures (a developer reports
`preventDefault` on mouse down/up does not, [forum](https://forums.opera.com/post/304335)).
Plan: (1) detect Opera (`userAgentData.brands` / `OPR/`) and show a one-time
hint on first capture to turn off mouse gestures and rocker gestures in
Settings > Shortcuts; (2) if the page goes hidden mid-round with the right
button held, show the hint on return; (3) cheap defensive `preventDefault` on
pointer/mouse down/up and `auxclick` while captured, `contextmenu` on the
document (may stop side-button Back/Forward); (4) extend the `beforeunload`
guard to seated play. Unverified: whether gestures fire under pointer lock;
needs a real Opera on Windows.

### #2 No video resolution: we have one, labelled as a percentage

Mostly a discoverability gap. OPTIONS > VIDEO already has RENDER SCALE
(50-150 % of the device pixel ratio, `video-settings.js:52,87-88`,
`video-apply.js:27-32,55-61`, applied live); the player never touched it
(frames c_0525-c_0549 show "100 %"). Its box shows a bare percentage
(`play/controls-screen.js:455-462`), and retail's DISPLAY MODE plate is
deliberately not drawn (`video-options.js:22-24`). At 1080p in F11 the player
already renders native 1920x1080 (`map.html:590-593,1013-1023`).

Retail (BF1942.exe, read in Ghidra): the DISPLAY MODE list is built at
`0x006b0520` from the renderer's enumerated D3D modes above 640x480, labelled
`"%dx%dx%d"` (or `"... @ %d"` with `renderer.allowAllRefreshRates`), current
mode selected; 16/24/32 bpp map to R5G6B5/R8G8B8/X8R8G8B8 at `0x0063dcb0`.
SAVE (`0x006b11a0`) parses the selected entry, writes `game.setGameDisplayMode`
to `Video.con` and calls `__changeResolution` (`0x006b0db0`), which resizes
the window, switches the mode and rescales the menu fonts (FONT-3). The stock
presets carry 800x600x16/32, but SAVE takes the mode from the list, so picking
a preset does not change resolution (inferred, not traced). Layout:
`menu_videodispl_256x256` at (65,230), listbox `Options/Video/DisplayModeList`
at (69,242,177,200), 14-unit rows. Needs a ledger row (VID-11).

Plan: draw the DISPLAY MODE plate (reuse `menu-screen.js:309`'s listbox in
`paintVideo`, `controls-screen.js:483-497`) with entries built from the
display's physical size at retail-style heights (480 ... 2160) at the
screen's aspect, labelled `WxHx32`; store the chosen height, apply pixel ratio
= chosenH / screen.height in `resize()`; fold RENDER SCALE into it (or keep it
as a fine adjustment that shows pixels, not percent); presets leave it alone.
Quick win (~2 h): show `1920x1080` in the RENDER SCALE box. Full plate ~1-2
days. Open: whether `screen.*` follows browser zoom and monitor changes on
Windows; whether to allow supersampled entries above native.

### #7 and #9 Respawned vehicles: invisible, and planes in the ground

One gap: a respawn reuses the old vehicle's scene node and never resets it.
Both reproduced in scratch scripts against the real modules.

**#7, invisible but enterable.** Frames c_0709-c_0714: the player faces an
empty garage arch, presses E and is in a Panzer IV, which then shows. Our
minimap still marks it (`map-friendlies.js:188` checks the pad, not the draw).
The chain: entering builds a drive and `Vehicle`'s constructor moves the node
out of the `spawners` group (`vehicle-base.js:797`) for good (the comment at
`level-statics.js:1176` saying exit puts it back is wrong); the wreck clears
after its 10 s life (`vehicle-wrecks.js:789,799`), the pad drops it
(`level-statics.js:1082`), and `syncVehicleSpawnOwnership` hides it
(`hull-bodies.js:1444`, from commit `9835a6f0`); `respawnVehicle`
(`vehicle-wrecks.js:1027` via `stepVehiclePads`, `level-statics.js:1111`)
restores children, hit points and pose (`hull-bodies.js:1906`) but not
`node.visible`, and the sync's active branch (`hull-bodies.js:1434`) never
shows it. Only nodes still in `spawners` are re-shown per frame
(`level-statics.js:1433`). It hits whenever the wreck clears before the pad
delay ends, the usual case (10 s wreck, 30-60 s delay).

**#9, a respawned plane sits gear-up in the ground.** Frames c_0735-c_0746
(P-51): enterable while unseen, flat with no gear in third person, then gear
down once the player gets out. `respawnVehicle` leaves gear, wheels and
control surfaces as the last life left them; a plane destroyed in flight is
never parked (`vehicle-instance.js:357`; only `#park` at :408 resets). On
entry `aircraftSpec` measures the wheels off the current pose
(`aircraft.js:973`, survey ~869-949) before the constructor lowers the gear
(:1087), so retracted wheels become the undercarriage: ground clearance 1.80 m
gear down vs 0.46 m gear up in the scratch test.

Retail (ledger, no new Ghidra needed): a fresh object at the spawner plus
`spawnOffset`, lifted out of the ground on the next collision tick (SPAWN-28);
delay drawn after each spawn, starting at destruction for one slot (SPAWN-10,
SPAWN-11); wreck lives `timeToLiveAfterDeath`, 10 s default (HP-19); a fresh
plane has its gear down (PHY-25); no land vehicle spawns with a soldier within
2 m (SPAWN-14); the minimap draws any hull with hit points (MMAP-3).

Plan: (1) on respawn, re-parent the node into `spawnersRoot` keeping its world
pose, set `visible = true`, refreeze; belt-and-braces show it in the sync's
active branch; a `tests/vehicle_pads_harness.mjs` case for drive, destroy,
wreck clear, respawn. (2) reset every rigged part to its rest pose on respawn
(`rest-pose.js` `restQuaternion`, wheels to base) beside the gun reset, and
have `aircraftSpec` measure wheels at rest; test that clearance matches load.
Side findings: vehicle pads skip SPAWN-14's 2 m check (`stepVehiclePads`);
rooms share the sync (`net-room.js:1212`), so multiplayer likely has #7 too
(unchecked). Not checked end to end on a real level (no level files on this
Mac).

### #6 Can't kill a tank's MG gunner: every hatch gunner is unhittable

Frames c_0686-c_0692: the player empties a magazine from a doorway into a
Sherman's Browning gunner, crosshair on his head and torso; he is never hurt.
"Sometimes" because gunners on standing or full-body seats (Hanomag, Ho-Ha,
M3A1 MG, jeeps, AA guns) can be killed, and every tank-hatch gunner cannot.

Ours: a round reaches soldiers through `projectile-flight.js:319` ->
`vehicle-hits.js:584` `roundBodyCast` -> `page.bodyAt` (:594) ->
`bot-referee.js:645-654` -> `env.seatedBodyAt` (`map.html:1884`) ->
`bot-visuals.js:715-719`, which returns no body for any half-body seat
(`if (!vis.seat || vis.seat.halfBody) return null;`). `capsulesOf`
(`bot-visuals.js:708`) and the local player's `seatPose.seatedBody`
(`seat-pose.js:264-271`) carry the same rule, so bots can't shoot a player in
a hatch either. It came in with `6a624300`, whose comment has it backwards: a
half-body seat hides the legs and leaves the torso out (`seat-ik.js:199`,
`hideBelowPelvis`). The round then hits the hull and does rifle damage to the
tank.

Retail (lnxded, Ghidra): `SeatObject::enter` (`0x083208d0`) parents the soldier
to the seat and calls `setUseSeat`, but never sets object flag bit 0, the only
thing that keeps a soldier out of the round contact test (FF-1, COL-24,
`checkObjectVsObjects` `0x0825d820`). A seat with no SeatObject is different:
`PlayerControlObject::enter` (`0x08316f00`) calls `updateFlags(1, 0)` at
`0x08317372` (BFSoldier vtable +0x2c = `BCompositeObject::updateFlags`
`0x08164570`), so hidden drivers can't be shot. `c_SeatShowHalfBodySoldier`
only makes `setUseSeat` (`0x08271950`) `disableBoneTree("Bip01 Pelvis")`; the
capsule test `SkeletonCollisionMesh::getDistanceToGeometry` (`0x083aeb10`)
never checks disabled bones. Damage goes to the soldier (FF-3); DIE-1 and
DIE-11 agree gunners die in their seats. Vanilla seats with the flag:
`Chi-ha_BrowningSeat`, `ShermanBrowningSeat`, `PanzerIVBrowningSeat`,
`T34-85MG42Seat`, `SturmGeschutzMG42Seat`, `T95_BrowningSeat`,
`FlakPanzerFlakSeat`, `M3A1Seat`. Needs a SEAT ledger row.

Reproduced (scratch `repro.mjs`, real `createBotReferee` and `seatBody`):
Chi-ha, Sherman, Panzer IV gunners: no hit; Hanomag MG42 and Willys: hit for 40.

Plan: drop the `halfBody` exclusion in `seatedBodyAt`, `capsulesOf` and
`seatedBody`; keep no body for seats without a SeatObject. Capsules can stay:
the legs fold into the pelvis and `roundBodyCast` only counts a body nearer
than the hull face, so the hull still stops low shots. Optionally answer with
the seat anchor while the seat model loads (`!vis.seat`). Add a half-body case
to `tests/friendly_fire_harness.mjs`. Open: remote players in the netcode
render path not checked; the `c_SeatHalfBodySoldier` typo in the Elco/Type38
side-gunner seats matches no flag.

### #8 Trembling soldiers: a bot's aim frame flips past 90 degrees of pitch

Not a prone, slope or animation bug. Tracking the medic over 11:58.3-11:59.1
(helmet, fist and boot, camera motion removed) shows a whole-body yaw wobble
pivoting near the hips, flipping between two headings every 1-4 video frames:
a per-tick (30 Hz) flip. Stationary on flat sand.

Root cause: `bot-aim.js:354-359` `soldierFrame` builds the right vector as
`cross(f, [0,1,0])`, which reverses sign once view pitch passes 90 degrees, so
`lookAtCounts` inverts both yaw and pitch counts. Pitch can pass 90 since
6d54bdf0 (2026-10-17, VIEW-14) raised `PITCH_LIMIT_DEG` in `soldier.js:145`
from 38 to 95; turning toward something behind it, the count law drives any
pitch toward +/-95. The bot settles into a two-tick cycle (pitch 85/95, yaw
+/-12 degrees), `steerOnFoot` (`bot-route.js:777`) never gets the heading
inside its cone so it doesn't move, and the body follows that yaw
(`bot-visuals.js:1212-1216`). Standing bots shake too; prone makes it visible.

Reproduced in `sim/run.mjs` (El Alamein, 6 a side, seed 3) with a probe on
`_aimLook`: bot_8 prone, yaw alternating -99.3/-87.3, 295 of 299 prone ticks
reversing, stuck 1004 ticks. Retail: the bot's camera is the soldier's own
(AI-123, VIEW-14), pitch about X never changes the right row; at rest and on a
slope the up row eases to the terrain normal (PHY-38), no tremble. Our sense
camera `cameraBasis` (`bot-aim.js:259-260`) already uses a fixed right row.

Fix: in `soldierFrame`, `r = [-cos(yaw), 0, sin(yaw)]`, `u = cross(r, f)`
(identical below 90 degrees). With a patched copy, 240 s runs: longest flip
run 1004/354/354 ticks -> 3/3/3 (seeds 3/1/5), prone reversals 295/301 -> 0.
Add a `tests/bot_ai_harness.mjs` case (pitch 85, goal behind: no yaw flip,
turns and levels). Note the regression against AI-108 / VIEW-14 in the ledger.
Side notes: bots are drawn at view yaw, not body yaw + 3x twist (0-60 degrees
off); the medic's prone pose (head and legs lifted) was not looked at.

### #1 Controls can't be rebound: retail's DEFINE KEY flow, recovered

Ours only displays and lights bindings: `play/controls-screen.js` hit-tests
tabs, pager, DEFAULT, profile and preview only (`:638-689`), its key, mouse
and wheel input only lights boxes (`:707-745`, `:859-870`), SAVE has no action
(`:697`); `controls.js` has nothing that changes a binding (the
viewer-profile-controls README lists DEFINE KEY as open).

Retail, from the menu data and BF1942.exe (Mac decompile names confirmed at
the Windows addresses):
- **Click.** A box sets `WaitForKey`, `Alternate` (right column) and
  `ActiveKey`; `menu/ControlsMenu` draws a 120x15 plate at the pointer reading
  "DEFINE KEY" / "DEFINE ALTERNATE KEY" (colour 0.508, 0.523, 0.430). Our
  extractor drops these plates as off-screen
  (`extract_controls_menu_layout.py:168-172`). A tab click clears the wait.
- **Capture** (`handleControlsInput` 0x006c67d0, polled while `Controls+0x18`;
  gate 0x00446de3): any scancode; Grave (0x29) refused with "THIS KEY IS NOT
  MAPPABLE!" (0x006c7678); **Escape unbinds the box** (`setKey("")`,
  0x006c6816-0x006c683f), it does not cancel; mouse buttons 1-5 (left via
  `PrimaryMouseButton` 0x006c63c0), wheel -> `MWheelUp/Down`, mouse moved past
  +/-0.2 -> `Mouse_IDAxis_0/1` (0x008eaf50, 0x009226c0); joystick buttons 0-31
  and axes 0-3 past 0.2 from a rest snapshot, an axis filling both halves of
  its pair (`getNextAxisIndex` pairs 6/7 ... 49/50), push direction = invert.
  Labels follow the keyboard layout (`scan2ascii` 0x0066f7f0).
- **Write** (`setKey` 0x006c6040): an axis in the primary clears the partner
  row's primary; an alternate equal to the new primary is cleared; an
  alternate set while the primary is empty fills the primary.
- **Conflicts** (`checkKeyCollision` 0x006c1520): allowed while editing, marked
  per box, checked per map (Common+Infantry, Common+Land/Sea, Common+Air);
  INFANTRY vs AIR is fine. Hover shows a red "CONFLICT DETECTED" bar.
- **SAVE** (`SaveAllControls` 0x006c6410) refuses with "FAILED TO SAVE
  CONTROLS! THERE IS A CONFLICT!" if any box is marked, else rewrites all four
  files (0x006ed4a0, 0x006ebcc0, 0x006eb1c0, 0x006ec890) with the formats at
  0x009222b0-0x009224c8 (alternate column's trailing ` 1`, the three mixed axis
  verbs) and shows "KEY ASSIGNMENT HAS BEEN SAVED". **DEFAULT** confirms, then
  `DefaultAllControls` (0x006c6520).

Gaps in our parser (`controls.js:102` `parseCon`): drops
`addButtonsToAxisMapping`, `addButtonAndKeyToAxisMapping`,
`addKeyAndButtonToAxisMapping` (a retail-saved profile loses those axes
today), ignores the trigger slot flag, and `keyIdToCode` lacks `IntlBackslash`
<-> `IDKey_OEM_102` (the German `<>` key). Boxes show the first two bindings in
file order (`:263`, `controls.js:588`), not by slot. `page-input.js:67` takes
Escape before the screen sees it.

Plan (~3-4 days): `controls.js` gets a code -> `IDKey_*` table (from the
engine's table at 0x0061e850), the missing verbs and slots, a row x slot draft
and `serializeCon(context)` that keeps unowned lines and writes the common
block into every context file; `controls-screen.js` gets capture (keys, mouse
buttons with `contextmenu`/button 3-4 prevented, wheel, polled pad buttons and
axes), Escape-unbinds, the not-mappable message, the conflict scan, the plate
and red bar, and SAVE's three messages; the open screen claims Escape first;
store `event.code`, label with `navigator.keyboard.getLayoutMap()` where
available, delay `ControlLeft` one tick (Windows AltGr). Tests: capture ->
`.con` -> parse round trip in `tests/controls_harness.mjs`, plus e2e. Risks:
browser-reserved keys (Ctrl+W/T/N, F11, Escape in fullscreen) never arrive.
Open: apply on SAVE (retail) or immediately; limit mouse-axis capture to axis
rows; DEFAULT writes to disk or only refills (unchecked).

### #3 No campaign: retail's campaign, recovered

Retail's SINGLEPLAY row has CAMPAIGN and INSTANT BATTLE (the other two buttons
in `menu/SingleplayerNavigation` are demo-build placeholders; 1.61 has no
training). Ours draws only Instant Battle (frames c_0084, c_0094). A full
retail install is in the CrossOver bottle at `~/Library/Application
Support/CrossOver/Bottles/BF1942/drive_c/EA Games/Battlefield 1942`.

Retail:
- **Order.** `Game.rfa` `Bf1942/Game/CampaignMapList.con`, 16 `Game.addLevel`
  lines, read at `FUN_006da1d0` (string `0x009242e8`), each `GPM_CQ bf1942`:
  BattleAxe, Gazala, Wake, Kursk, Tobruk, Midway, Stalingrad, El_Alamein,
  Guadalcanal, Kharkov, Omaha_Beach, Bocage, Market_Garden,
  Battle_of_the_Bulge, Berlin, Iwo_jima. One list; side is the TEAM pick. All
  16 are live on mesh.bfstats.io.
- **Menu** (`menu/CampaignMenu`): NEW CAMPAIGN ("YOUR ONGOING CAMPAIGN WILL BE
  OVERWRITTEN"), CONTINUE CAMPAIGN, TEAM, LEVELS, STATISTICS, OVERALL
  DIFFICULTY (EASY/NORMAL/HARD set AiSkill, NrOfLives, BotRatio to 1/2/3;
  IMPOSSIBLE probably 4; CUSTOM exposes sliders). Campaign AI skill does take
  effect (AI-21, `0x006bd370`).
- **Per level.** Root script `SinglePlayerAllied.con` / `SinglePlayerAxis.con`
  with its own tickets (Wake 140 vs 120); briefing and four debriefing lines
  per side in `Menu/init.con` (`setAlliedCampaign`, `setAlliedObjectives`,
  `setAlliedHints`); art `sp_briefing_512x512`, `sp_debriefing_512x512`,
  `statusbar(_full)`, `allied/axis_win/lose_camp`.
- **Score** (client `FUN_004b1160` ~`0x004b24bb`, matching lnxded
  `gameStatusPlaying` `0x0815190d`): a win adds its victory type (minor 1,
  major 2, total 3; same 0.4/0.8 margins as `round-state.js` `victoryTypeOf`),
  a loss subtracts twice it. Floors `0x008db9c0` (-2 x4, -3 x4, -4 x8), caps
  `0x008dba00` (5, 7, 9, 11, 13, 15, 17, 17, 17, 19, 20, 21, 22, 23, 24, 25).
  Below the floor = TOTAL DEFEAT; otherwise CONTINUE advances **won or lost**.
  Bar = (score - floor) / (cap - floor). Final grade after mission 16 (from
  the Mac decompile's `DebriefingMenu::debriefing`, not checked in our binary):
  < -3 total defeat, < 4 major, < 10 minor defeat, < 19 minor, < 24 major
  victory, else total victory.
- **Save.** `save/<profile>/<campaignId>/campaign.con` (`0x008dbda0`;
  `FUN_006d9bf0`, `FUN_006da3b0`): `game.setCurrentLevel`,
  `setCampaignScores`, difficulty, `setMissionNr`, `playerStats.setTot*`; the
  game restarts with `+continueCampaign 1 +campaignProfile %s +campaignId %d
  +newCampaign 0|1` (`0x00924308`, `FUN_006da9c0`).

Reusable: nav sub-row pattern (`play/front-end.js:29-52`), menu page
extraction (`extract_main_menu_layout.py:72-82`), launch URL
(`play/skirmish.js:302`), sides per level (`skirmish.js:246`,
`extract_menu_layout.py:1007-1014`), URL bot settings (`map.html:1754-1756`),
victory type (`round-state.js:132-175`), debriefing (`round-end.js:60`),
restart hook (`round-end.js:685-688`, `map.html:2189`), briefing
(`briefing-screen.js`; `bf42/level.py:2520` `parse_briefing` skips the
campaign verbs on purpose), profile storage (`profile-sync.js:44`).

Plan. Minimum (~2-3 days): add the order to `menu-levels.json` and the
campaign briefing keys to `scene.json` (game layer, `patch_scene.py`, no
rebake); SINGLEPLAY sub-row; campaign screen (NEW/CONTINUE, TEAM, difficulty,
level list); state `{team, difficulty, missionNr, score}` in localStorage,
launch with `&campaign=1`; campaign round end with the score rule, CONTINUE,
status bar, final result. Full parity (+2-3 days): SP briefing plate with
hints, debriefing art and lose music, STATISTICS, per-side tickets from
`SinglePlayer{Side}.con` (check `load_tickets`), account save, real presets
(AI-20 table, BotRatio, NrOfLives).

Owner decisions: bot count (retail fills `maxNrofPlayers`, 18 on Wake; we
default to 4); progress in localStorage only or the account too; vanilla only
or mods with their own `CampaignMapList.con`; offer REPLAY; copy retail
exactly (a lost level still advances) or mark a departure.

Side defect: in the LEVELS list "INVASION OF THE PHILIPPINES" runs over its
"NO BOTS" tag.

### #5 Bots not driving tanks: a wedged hull never frees itself

What ran: vanilla **Wake Island** (EoD was only highlighted in CUSTOM GAME),
team AXIS (frames 10:57-10:58). Two Chi-has by the supply depot shed near the
Airfield (~1350-1362 x, 732-743 z), ~30 m west of the Airfield heavy-tank pad.
The soldiers on screen are the exposed MG42 gunners; a driver is never drawn.

Reproduced headless (Wake bake fetched from mesh.bfstats.io, `garrison`
doctrine, 4 a side, seed 1): at 753 s a bot-driven Chi-ha wedged its
front-left corner on a steel barrel (`stebarrel1_m1`) at that depot with a
second bot on its MG, and stayed there 146 s at full throttle, distance to
goal fixed at 218.52 m, gunner firing. The obstruction handling is
soldier-sized:
1. The touched-object rule (`predictObstacles` / `trackContact`) is on foot
   only (`bot-route.js:854`); the hull's own contacts are never an obstacle.
2. `onObstructed` (`bot-route.js:628-633`) plants a 1.5 m circle 1 m ahead of
   the hull centre: inside a 3 m tank, so the replan is the same corridor.
3. Each obstruction replan resets `_stalledTicks` (`bot-route.js:456`), so the
   counter cycles 0->150 forever and the 401-tick path failure never fires.
4. With the steering point ahead, turn-in-place (`bot-vehicle.js:420`) always
   drives forward; the back-out the comment at `bot-route.js:861` promises
   never runs.
The route threads a ~4-cell gap between the depot and an abandoned Sherman;
the tank cut the corner onto blocked cells.

Retail, from the lab's five Wake co-op recordings (~2.5 h, 30 bots): every MG
gunner boarded under a driver (37 driver vs 31 MG stints); a lone gunner
moved to the driver seat in 2-30 s (M3A1); of 17 windows where a bot-driven
tank stood still 60 s+, every one was the driver fighting
(`BBFireInfantery`), never trying to move. In lnxded,
`ObstructionDetection::update` (0x08532b00) only flags "obstructed" past 150
ticks and `getNewIntermediatePathPos` (0x0852ab60) fails the path at 401,
without resetting the counter there. Retail avoids `R_bot + R_object` circles
(AI-32, AI-119).

Plan: a hull touch rule fed by `drive.hullContacts` (circle at the contact,
hull radius + margin, fail the route; our own invention, like the soldier
rule); `onObstructed` for hulls sized `bot._radius() + OBSTACLE_RADIUS` past
the front; keep the engine's two counters (flag 150, fail 401) so the replan
can't reset the failure; on a wedged hull start the route from `_validPos` so
the first point is behind and it reverses (unverified why it starts ahead
today); regression run `--map wake --seed 1 --doctrine garrison`, Chi-ha
leaves (1364, -739) within ~15 s. Confidence medium: retail drivers also stop
to fire, so the video's 25 s could be fighting; the player's own round would
settle it. Side findings: an Allied Sherman parked at its order point
(895, -880) for 1047 s in seed 2 (separate idle issue); Allied bots drove the
empty Chi-ha (allowed by retail's entry rule, unchecked against lab data).
