# Mobile four-finger controls

Status: built and playtested on a phone (eighth pass, the finger split and the
tap bug below). This doc maps how
modern mobile FPS games use four fingers, compares that with what
`tools/bf1942-models/viewer/map.html` does today on touch, records what each
finger controls, and lists what was built.

## Why four fingers

Two-thumb play has a structural conflict: the right thumb must both drag the
camera and press FIRE, so you cannot aim and shoot at the same time. COD Mobile
and PUBG Mobile players solve this by curling the index fingers over the top
edge of the phone ("claw" grip), which gives two more independent inputs.
Sources: Activision's control guide
(blog.activision.com, "Getting a Grip on the Call of Duty: Mobile Controls"),
mein-mmo.de's 4/6-finger claw breakdown, and ReviByte's PUBG Mobile 4-finger
HUD guide.

The canonical four-finger assignment across both games:

- Left thumb: movement joystick, bottom left. Sprint by holding forward
  (COD Mobile's "Joystick Sprint" setting).
- Right thumb: camera look / drag aim, right side of the screen.
- Left index finger: a second FIRE button, upper left, in the index finger's
  reach zone. This is the whole point: fire without committing the thumbs.
- Right index finger: ADS / scope, upper right, plus secondary actions
  (jump, crouch, peek, reload) placed in the same zone.

Placement rules the guides agree on: fixed buttons, not floating, so muscle
memory works; fire buttons in opposite corners (roughly two-thirds up each
side); buttons slightly larger than default while learning. COD Mobile's
"Advanced mode" is what unlocks this: it moves firing off the stick and onto
dedicated buttons and lets you drag the whole HUD. "Simple mode" is the
two-thumb layout our viewer currently mirrors.

The screenshot the owner shared (`cod-gameplay.jpg`, `mobile-cod.webp`) shows
COD Mobile's default: stick bottom left, FIRE top right for the index finger,
crouch/prone cluster right of center, jump lower right, plus context buttons
(grenade, reload, loadout) that appear near the right thumb.

## What the viewer does today

All touch code lives in `tools/bf1942-models/viewer/touch-controls.js` and the
touch branches of `tools/bf1942-models/viewer/page-input.js`. The DOM is the
`#mobile-controls` block in `map.html` around line 62.

Current inventory:

- One virtual pad, bottom left. Its label and meaning change with mode:
  MOVE on foot, DRIVE in a car, AIM in a turret, STICK in an aircraft
  (`updateMobileControls`, touch-controls.js line 114). In a turret the same
  pad feeds camera aim (`feedMobileTurretAim`, line 62), so on-foot move and
  turret aim share one thumb.
- FIRE button, right side, thumb reach. Holds the soldier trigger or the seat
  triggers (`setMobileFire`, line 166).
- JUMP button, on foot only.
- ENTER / EXIT button, context-labeled from `page.nearEntry`.
- VIEW button, cycles camera when seated or on foot in third person.
- A throttle slider for aircraft, which replaces a stick axis with a slider.
- On-foot look: any touch on the renderer canvas that is not on the controls
  drags the camera (page-input.js pointerdown branch, line 672). Two touches
  pan and pinch.

So the viewer is a two-thumb layout. The conflicts that four-finger players
escape are all present: fire and look share the right thumb; move and turret
aim share the left thumb; there is no crouch, prone, sprint, reload, or ADS
control at all on touch; aircraft throttle is a slider rather than a second
axis.

## What four fingers would control in the viewer

Grip: thumbs move and look, index fingers land on the upper corners. Mapping,
left to right:

1. Left thumb: MOVE stick. Unchanged.
2. Right thumb: LOOK. Drag anywhere on the canvas that is not a control,
   already implemented.
3. Left index: FIRE, upper left. Same `setTouchTriggers` path as the existing
   FIRE button. For the soldier and for every seat that carries a gun.
4. Right index: ADS (the game's `c_PIAltFire`, right mouse button on desktop),
   upper right, with JUMP / crouch and reload in the same zone.

Missing pieces this implies, in build order:

- ADS as a held or toggled input. The desktop path already binds
  `c_PIAltFire` (page-input.js line 616, right mouse button releases it); the
  touch path never sets it.
- Crouch / prone. The keyboard has crouch (Ctrl, with the documented Chrome
  Ctrl+W caveat at page-input.js line 483) but touch has nothing. COD Mobile
  stacks crouch over prone with a long press.
- Kit weapon swap. Confirmed supported: digits 1-9 are `c_PIMenuSelect1-9`
  and route to `page.selectKitWeapon(slot)` (page-input.js line 251), and the
  mouse wheel (`c_PINextItem` / `c_PIPrevItem`) cycles kit weapons on foot
  (page-input.js line 163). Touch has no way to raise a slot.
- Reload and pickup kit. Confirmed supported: `c_PIReload` (R, Shift swaps
  back to the slung rifle, reloadKey at page-input.js line 252) and
  `c_PIDrop` / `page.pickupKit` (G, page-input.js line 214).
- Crouch and prone. Confirmed supported: `c_PICrouch` (Ctrl, held) and
  `c_PILie` (Z, edge), in `controls-defaults.js`. COD Mobile stacks crouch
  over prone with a long press, which matches hold versus edge exactly.
- Sprint. Confirmed supported: `c_PIWalk` (Shift, push and hold). COD Mobile's
  "Joystick Sprint" pattern (hold forward to sprint) needs no new button and
  fits the existing pad.
- A second touch aim source so FIRE and LOOK can be simultaneous. This already
  works structurally: the canvas pointer handlers track multiple pointers via
  `activeTouches`, and the buttons take pointer capture, so adding a left-side
  fire button is mostly DOM and layout work, not input plumbing.
- Turret aim on the left index fire plus right thumb look needs
  `feedMobileTurretAim` split from the pad, since today the pad is the only
  turret aim input.
- Aircraft: replace the throttle slider with a left-side vertical axis or a
  second stick when flying, since index fingers are busy firing.

## Proposed layout (first pass)

Bottom left: MOVE stick (unchanged). Right half of canvas: LOOK (unchanged).
Upper left: FIRE (index). Upper right: ADS (index); below it JUMP, then
CROUCH with long-press for prone, then RELOAD. Keep ENTER and VIEW near the
bottom right cluster but out of the index zone. A "two-thumb" fallback keeps
the current single FIRE button for players who do not adopt the grip.

## Built (second pass, 2026-10-01)

On top of the claw buttons above:

- Sprint: joystick-hold-forward. Full forward on the MOVE pad holds the
  game's own `c_PIWalk` trigger (`local-player.js` on-foot input), COD
  Mobile's "Joystick Sprint"; no new button and the thumb never leaves the
  stick.
- PICKUP: the G key's `c_PIDrop` as a button. It shows only when a kit is in
  reach, polled per frame through a new side-effect-free `kitDrops.offer()`
  in `kit-drops-page.js` (the same human gate and `findKitObject` reach the
  pickup itself uses). `map.html`'s `paintHud` refreshes the touch controls
  each frame so the offer appears without an event.
- SEATS: the digit row's seated job (`c_PIMenuSelectN` ->
  `switchSeat(position)`) as one button that walks the vehicle's
  spawn-declared seat order to the next free seat, skipping occupied ones
  and hidden when none are free (`touch-controls.js` `mobileNextFreeSeat`).
- MAP: the M key's `c_PIMap` body via `pageInput.padTriggerDown`, so it
  opens the deploy map on foot and toggles the full map otherwise, exactly
  as the keyboard does.

Verified with the stub-DOM smoke run extended over all of them (pickup
reach gating both ways, seat walk skipping an occupied seat and hiding when
full, map dispatch) plus the repo's page-wiring and kit-drop suites (270
tests, all green).

## Built (third pass, 2026-10-01): the entry-state bugs

The first phone test found two real bugs, both reproduced headless on the
real page (aberdeen, phone-sized touch Chromium, the probe drives the real
ENTER and EXIT buttons):

- The touch EXIT press climbed back into the tank instead of leaving:
  `mobileSeatToggle` asked the on-foot branch first, and the tank's own
  door is in reach while seated, so the press re-entered. Fixed by asking
  the seat branch first, exactly as the keyboard's `useKey` does.
- JUMP and CROUCH showed in the tank: entering a vehicle unticks no box, so
  the HUD's on-foot check (`optOnFoot && soldier`) stayed true while
  seated. The HUD now derives both states from the seat itself:
  `onFoot` requires `!page.occupancy`, `seated` is `!!page.occupancy`,
  and the fire, aim, jump and prone gates refuse to write the foot inputs
  while a seat is held.

## Built (fourth pass, 2026-10-01): free-roam escape hatch, drag separation

The phone test's remaining complaints, all reproduced or confirmed headless:

- Closing the spawn screen without spawning strands the phone in the free
  camera: the page drops to free roam (the keyboard's Caps Lock / Enter
  brings the spawn screen back; a phone has neither) and the whole touch
  cluster hid with no soldier alive, so there was no way back at all. Fixed
  two ways: the cluster now stays up in free roam (MAP is its only button,
  everything else stays contextual), and the MAP button opens the spawn
  screen again — with a live soldier it dispatches `c_PIMap` (the M key's
  body), with nobody alive it dispatches `c_GIInGameMenu`, the game's own
  "bring the spawn interface back" trigger.
- "Move and look are connected in one pad": the real culprit was
  `touchFlying` — any canvas drag on foot walked the soldier forward while
  he looked, because the free camera's drag-to-fly flag was set on every
  first touch. `syncTouchFlying` now sets it only when there is no soldier
  and no seat, so the MOVE pad is the only walking input and a canvas drag
  is purely the look, on foot and in a seat alike. The free camera keeps
  its fly-forward drag. Verified headless: a canvas drag on foot reports
  `touchFlying false` and moves the soldier 0.
- The MAP button moved out of the thumb cluster to the top-left corner,
  across from the minimap, per the COD grab's controls-away-from-the-action
  layout.

## Built (eighth pass, 2026-10-01): split by finger, and the tap bug

The playtest reported two things. Every control was crammed into buttons on the
right side, which does not feel intuitive, and a player wants to be shooting and
jumping and going prone in the same moment. Separately, only JUMP and CROUCH
could be tapped while panning or moving; PREV and NEXT needed both hands free.

### The tap bug

JUMP and CROUCH ran their action on the `pointerdown` edge. Every other button
ran it on a `click`, which the browser synthesises after the tap. While a second
finger is already down, whether that finger is on the pan or on the move ring,
Chromium drops the synthesised click, so those buttons were dead exactly when a
player needs them. That is the whole of the reported symptom, and it is why the
two working buttons were the two that never used a `click`.

Every button now runs on its down edge through one `edgeButton` helper in
`touch-controls.js`, which also carries that button's own enabled and hidden
guard. No button in the module listens for a `click` any more, and the stub
smoke asserts exactly that.

### The layout

The HUD is split by FINGER rather than by screen half. A thumb has one job at a
time, and the previous split gave the right thumb four jobs at once.

| Zone | Controls |
| --- | --- |
| Left thumb | the MOVE ring at the bottom-left, JUMP above it, CROUCH above that, the MORE tab over those |
| Right thumb | FIRE at the bottom-right, AIM above it, the weapon pair above that |
| Right half, not on a button | the look drag |

JUMP and CROUCH moved to the left on purpose. They are the actions a player
needs while the other thumb is shooting, so putting them on the firing thumb is
what made "shoot and jump" impossible. The play screen now carries seven
controls where it carried twelve.

The look drag moved from the left half to the right half, where the right thumb
already is, and a drag off a held FIRE turns the camera as well. That is PUBG
Mobile's fire-and-aim, and it is what frees the right thumb to live on FIRE
rather than to alternate between the trigger and the camera. A 14 px dead circle
(`MOBILE_FIRE_LOOK_DEAD`) comes first, so a thumb simply resting on the button
does not walk the view, which is the complaint that put the fire side on its own
half in the sixth pass. The look zone steps aside in free roam, where the free
camera's own canvas drag is the look, and while the map-controls panel is open.

The remaining controls (RELOAD, PICKUP, SEATS, ENTER, VIEW, MAP, throttle) are
one MORE tap away in an action sheet that hangs from the top of the stage. It is
a drop-down rather than a bottom sheet because both bottom corners belong to a
thumb, and a bottom sheet would either cover the posture column or need an
offset tuned per screen height. Its scrim sits under the buttons and over the
look zone, so a tap anywhere else closes the sheet instead of turning the
camera.

`map.css` gained `.mobile-vert-stack` / `.mobile-posture-btn` /
`.mobile-more-btn` / `.mobile-thumb-stack` / `#mobile-more-sheet` and lost
`.mobile-action-cluster`. The map-controls FAB moved to the top-left corner on a
phone, where it no longer sits under FIRE.

One bug the stub smoke caught while this was being written: `updateMobileControls`
returns early on an unchanged visibility signature, and the sheet's open flag was
collapsed after that early return. A MORE press landing on a state with no HUD
(the deploy screen) therefore left the flag set and the sheet popped open by
itself later. The flag is now collapsed before the compare.

Verified with the stub-DOM smoke (56 claims, including the tap bug reproduced as
a hold on the look zone plus a hold on the ring plus a tap on NEXT) and the live
phone probe on aberdeen (390x844 touch Chromium, real CDP multi-touch, 33
claims). On the live page: the look zone measures the right half (x 195, 195 px
wide), the ring sits at the bottom-left with JUMP, CROUCH and MORE stacked above
it clear of one another, FIRE is 112x84 at the bottom-right with AIM and the
weapon pair above it, a held ring and a held look drag both stay live while NEXT
raises the weapon (Bar1918 to GrenadeAllies at 6.00 speed), a held FIRE drops
rounds (20 to 17) while a JUMP tap lands, a 7 px wobble on FIRE moves the view
0.002 rad and a 54 px drag moves it 0.78 while the trigger stays down, and the
sheet clears the ring, the posture pair and FIRE.

Screenshots of the play screen and the open sheet are in this folder as
`hud-play.jpg` and `hud-sheet.jpg` (390x844 phone viewport, aberdeen). The whole
change is where the thumbs land, so these two are worth a look before the next
phone pass.

## Built (ninth pass, 2026-10-01): you could get down and not back up

The report was "if you crouch or prone you can't get back up", with the owner's
guess that it is a broken mechanic in our port and that retail lets you press
space to get up.

Measured on the live page first, driving the real keys with the real bindings
(`LeftCtrl` = `c_PICrouch`, `Z` = `c_PILie`, `Space` = `c_PIAction`, all three
from the shipped `Infantry.con` in `controls-defaults.js`). The keyboard path
was already correct and matches retail:

| Input | Stance after |
| --- | --- |
| LeftCtrl held | crouch |
| LeftCtrl released | stand |
| Z | prone |
| Z again | stand |
| LeftCtrl held from a crouch | crouch, rising to stand on release |
| Space while prone | prone, unchanged |

So the sim law is not the fault. Two things settled the last row and one open
question. The engine sets the jump bit only when neither the crouch nor the
prone flag is set (client `0x00500628`-`0x0050067a`, `symbols.json`
`BFSoldier_jumpFlagSet`), so a prone man's Space press does nothing at all and
is not a way out. BODY-1 gives the two chains that are: `Lb_LieToCrouch` when
the crouch channel is asserted while lying, and `Lb_LieToStand` when it lets
go.

The fault was touch-only, and it was one button doing two jobs. Prone was the
CROUCH button's 500 ms long press, which made an ordinary thumb-rest into a
permanent one-way trip: a hold and a toggle on one target cannot both work,
and nothing on the phone carried the toggle, so the only roads back were the
keyboard's Z and the keyboard's LeftCtrl.

The fix gives each posture button one retail binding and nothing else. CROUCH
is the `c_PICrouch` hold again and the long-press timer is gone, so resting on
it can no longer put the soldier down. PRONE is a new button in the same column
and is the literal `c_PILie` toggle: tap for prone, tap again for the
`Lb_LieToStand` rise. It lights in the warn colour when he is down, which is
also how a toggle reads differently from the two holds next to it, and the
visibility pass refreshes on the press rather than on the next frame. `prone`
joins the touchControls page bag and the visibility signature, so the keyboard's
Z lights the same button.

The column is four items now (MORE, PRONE, CROUCH, JUMP, 250 px tall above a
148 px ring), which fits a portrait phone with 374 px to spare. It does not fit
a landscape one, so a `max-height: 560px` rule lays the column down to the right
of the ring instead.

Verified with the stub-DOM smoke (67 claims) and the live phone probe (39
claims). On the live page: PRONE goes prone and stands him up again, a 900 ms
rest on CROUCH reads `crouch` and never `prone`, releasing it reads `stand`, and
the whole column measures clear of the ring and of the top of the stage.

One parity question left open, recorded so the next pass does not re-derive it.
Our law is `prone ? prone : (crouch ? crouch : stand)`, so while `c_PILie` is
asserted the crouch channel is ignored: holding Ctrl from prone does not bring
him to a crouch, and releasing Ctrl while prone leaves him prone. BODY-1's
`Lb_LieToCrouch` chain exists and has to be entered by something, and the
crouch channel is the only candidate. Nobody has read which channel picks which
chain out of `handlePlayerInput`. On a phone this is a mild annoyance (from
prone you must tap PRONE before CROUCH does anything) and on the keyboard it is
invisible, so it is filed rather than guessed at.

## Built (tenth pass, 2026-10-01): an open screen that steers

Three complaints, and the first one is the diagnosis for the other two: moving
the controls about left dead space between the thumbs to reach jump and crouch,
reloading is common and wants to be near firing, and aiming while firing is not
gelling ("I have to move the view then fire").

The cause of all three was the same. Splitting the screen into halves gave the
camera a PLACE, and a place you have to put your thumb is a place your thumb
cannot leave, so aiming and firing could not be the same moment. The owner's own
fix for it is the design: leave the open screen to panning and moving, and the
buttons then go wherever the fingers want them.

There is no pan half and no pan margin now. `#mobile-zone-look` is the whole
stage UNDER the buttons, so a touch that starts anywhere that is not a button is
the camera, and the margins, the top and the middle all steer equally. What pays
for it is the buttons being few, small and low.

The whole HUD is four things and nothing else, measured on a 390x844 phone
(`features/mobile-four-finger-controls/hud-play.jpg`):

| Where | What | Measured |
| --- | --- | --- |
| bottom-left corner | the MOVE ring | 112 px hit box, 64 px visible |
| left side, 572 px up | JUMP, CROUCH, PRONE | three 50 px targets, 6 px apart |
| right side, 572 px up | AIM, PREV, NEXT | three 50 px targets, 6 px apart |
| bottom-centre | the MORE tab | 56x36 at 28 px up |
| bottom-right corner | RELOAD against FIRE | 66x66 against 104x82 |

Two short rows of three, one per thumb, at the same height and hugging the
sides. A thumb never travels more than one button width, each control sits under
the thumb that presses it, and 38 px of centre corridor is left between the two
rows. RELOAD is the button next to FIRE because reloading is common, and MORE
sits in the bottom row between the ring and the corner.

What that leaves is the point of the whole exercise, so the probe asserts it
rather than the buttons:

| Claim | Measured |
| --- | --- |
| the top of the screen is completely clear of buttons | 572 px of 768, so 74% of the height |
| a centre corridor at button height | 38 px (x 176 to 214) |
| the left margin is clear from the top down to its row | x 0 to 14 clear at button height |
| the right margin likewise | x 376 to 390 |
| buttons as a share of the stage | 14% covered, 86% open |

The tenth pass put ONE row of six across the middle and called the result an
open screen. It was not: the row crossed the full width, so the left and right
margins were covered at that height and the centre of the screen had a bar
through it. Two rows of three that stop short of each other is the same set of
controls over half the width.

One consequence of making the zone the whole stage: a finger lying on open glass
would walk the view off its own micro drift. `MOBILE_LOOK_DEAD` (8 px) comes
first, the same reason the ring and the drag off FIRE have one.

Verified with the stub-DOM smoke (70 claims) and the live phone probe (54
claims). On the live page: the look zone measures the whole stage
(390x768 of 390x768), the six targets are 50 px each with 6 px between
neighbours and 8 px between the ring, MORE and RELOAD, a drag on the RIGHT
margin, on the LEFT margin, at the TOP of the screen and just above the rows all
steer by the same 0.54 rad for the same 40 px of finger, a finger resting on
open glass moves the view 0.0000 rad, and the stance loop still reads (PRONE
prone then stand, a 900 ms rest on CROUCH still a crouch). The viewer suite runs
4,554 with the same five pre-existing failures, and the nine suites that read
`map.html` through `page_source` pass 216.

One probe lesson from this pass, and it is a trap: a CDP touch point is a
circle of `radiusX: 8`, so a probe press 4 px from a button lands ON that
button. Three "the margin does not steer" failures were the probe pressing JUMP
and NEXT through the touch radius, while `document.elementFromPoint` on the same
coordinates said `#mobile-zone-look`. Keep probe press points clear of every
button by more than the touch radius, and do not trust a synthetic coordinate
that close to a target.

## Next steps

1. Playtest on a real phone, and judge the one judgement call in this pass: the
   drag off a held FIRE. `?touchlook=` still tunes the multiplier and
   `MOBILE_FIRE_LOOK_DEAD` is the slop in front of it.
2. Left to a later pass: a claw row along the top edge for players who adopt the
   four-finger grip (the look zone's left half is currently not a look at all,
   so a left index finger has nothing to do); the turret-aim split (the pad is
   still the only turret aim input); an aircraft stick pair replacing the
   throttle slider; radio calls.

## Built (first pass, 2026-10-01)

- `map.html`: the DOM. `#mobile-claw-left` holds FIRE (the left index
  button), `#mobile-claw-right` holds ADS, RLD and SWAP (the right index
  column), and CROUCH joins JUMP in the thumb cluster. The touchControls bag
  gains `keys`, `toggleProne`, `setTouchAltFire`, `cycleKitWeapon`,
  `handWeapon` and `startReload`.
- `map.css`: the `.mobile-claw-col` columns sit 34vh above the bottom strip,
  on the screen edges, sized larger than the thumb buttons.
- `page-input.js`: `setTouchAltFire(foot, seat)` writes `aimHeld` and
  `seatAltFire`, the touch twin of `setTouchTriggers`.
- `touch-controls.js`: FIRE2 shares the FIRE trigger path and its held state;
  ADS holds aim on foot and `c_PIAltFire` seated; CROUCH holds the same
  `e.code` the keyboard records (`ControlLeft`, `c_PICrouch`) so the engine's
  held read sees one key, and a 500 ms hold additionally toggles prone
  (`c_PILie`), COD Mobile's crouch-over-prone stack; RLD calls `startReload`
  behind the keyboard's has-a-magazine guard; SWAP calls `cycleKitWeapon(1)`,
  the wheel's own `c_PINextItem`. `resetMobileControls` clears aim, crouch
  and the prone timer.
- Verified with a stub-DOM smoke run (all seven paths: visibility, fire2,
  ads on foot and seated, crouch hold and release, reload, swap, reset) plus
  the repo's page-wiring test suites (mouse input, held input, page_source
  users: 263 tests, all green).

## Built (fifth pass, 2026-10-01): the playtest rework

The owner played the build on a phone and rejected three things. Each one and
what it became.

- Look was far too slow. Retail's on-foot law is 0.1215 degrees of yaw per
  pixel (`mouse-input.js`, GUN-2b), so a 180 took about 1,480 px of finger
  travel, several phone screens. Every touch look drag now runs at
  `TOUCH_LOOK_SCALE` (8) times the mouse's currency, both the top-left look
  zone and the canvas drag in `page-input.js`, which puts a 180 at about half
  a phone width. Measured on the live probe: 30 px of drag turns 0.508 rad,
  about 29 degrees. The multiplier lives in `touch-controls.js` and
  `page-input.js` imports it, and `?touchlook=<n>` overrides it on the
  device, the same idea as the `?turret=` knob on `countsPerPixel`.
- The floating move stick was tap-to-find-then-move, and the thumb had to
  hunt for it before every move. The ring is now FIXED at its home spot (the
  right edge, 172 px down in stage coordinates, below the minimap box) and is
  its own touch target, so the right index finger finds it by muscle memory
  and movement starts on the touch. It is 64 px across with a 28 px ball, and
  the ball's whole 18 px of travel is the input range: full deflection where
  the ball touches the ring, a 5 px dead circle at the centre so a resting
  finger stands still. The ball clamps inside the ring, the ring never moves,
  and a drag anywhere else on the stage is the look, so the ring is the only
  place movement lives.
- The SWAP menu is gone, replaced by a PREV / NEXT pair on the right thumb.
  One press steps the kit's weapon bar (`c_PINextItem` / `c_PIPrevItem`) and
  then COMMITS it through `weaponBarFire`, so the press raises the weapon
  instead of only moving the highlight the way the mouse wheel does. The
  owner wants to memorise the cycle over time. FIRE moved out of the cluster
  to the left thumb at the bottom-left, 96x68 px.

The ring doubles as the turret's aim stick in AIM mode, and its rate went
from 720 to 2200 px/s of equivalent hand travel, about 270 deg/s of turret
yaw at full deflection, because a held stick suffers the same "too slow"
complaint.

Four-finger assignment after this pass. The left index drags the top-left
look zone, the right index works the fixed ring, the left thumb fires, and
the right thumb works the bottom-right cluster (AIM, RELOAD, JUMP, CROUCH,
PREV, NEXT, MAP, ENTER/EXIT, VIEW, PICKUP, SEATS, THR).

Keep together when tuning. `MOBILE_PAD_TRAVEL` and `MOBILE_PAD_DEAD` in
`touch-controls.js` describe the ring's input geometry, and the ring (64 px)
and ball (28 px) sizes in `map.css` are the same geometry in pixels.

Verified with the stub-DOM smoke (28 claims) and the live phone probe on
aberdeen (390x844 touch Chromium, 18 claims). The ball clamps at 18 px, a
13 px deflection reads `forward 0.615` in the input word and a release reads
0, the ring does not move under the finger, NEXT raises the next weapon and
PREV walks back (Sg44 -> GrenadeAxis -> Sg44), and a FIRE press drops six
rounds. The full viewer suite runs 4,554 tests with five failures that
reproduce with these files reverted (the vehicle-sound published tables, the
bocage baked nav routes, the scene-layer mode merge), so they predate this
work. The API tier passes 714 tests.

## Built (sixth pass, 2026-10-01): navigation left, actions right

The follow-up playtest had one layout complaint and one that passed. Moving
and firing at the same time was hard with the ring at the top-right and FIRE
at the bottom-left, and the pan sensitivity of the fifth pass passed testing
unchanged (the 8x multiplier stands, `?touchlook=` still tunes it).

The screen is now split by job. The LEFT half carries both movement
controls: dragging it pans the camera (the left index finger, or the left
thumb when it is off the ring) and the fixed ring sits at its bottom-left
under the left thumb. The RIGHT half is actions only: FIRE at the
bottom-right (96x68 px) and the button cluster above it (AIM, RELOAD, JUMP,
CROUCH, PREV, NEXT, MAP, ENTER/EXIT, VIEW, PICKUP, SEATS, THR). Moving and
firing is now one thumb each, held at the same time.

A drag on the action side no longer pans. In play only the left half feeds
the look (`page-input.js` gates the canvas drag on `touchFlying`, which is
free roam only), so a firing thumb slipping off the button cannot jerk the
camera. Free roam keeps its drag-to-fly look, since that gesture is the free
camera's only movement.

The look zone is the full left half now and steps aside while the
map-controls panel is expanded: the panel sits under it in z order
(`#side` is z 3, the zone z 9), so without the gate the panel's left half is
untappable. `updateMobileControls` hides the zone while the panel is open
(`sideOpen` joined the visibility signature).

Verified with the stub-DOM smoke (28 claims) and the live phone probe on
aberdeen (21 claims). The ring measures at the bottom-left (16 px from the
left edge, 24 px up), FIRE at the bottom-right (14 px from the right edge),
the two do not overlap, a held ring deflection and a held FIRE run together
(`forward 0.615`, six rounds fired while moving), and a canvas drag on the
action side turns the camera 0.0000 rad while the same drag on the left half
turns it 0.508 rad. The viewer suite runs the same 4,554 tests with the same
five pre-existing failures as the fifth pass.

## Built (seventh pass, 2026-10-01): two-finger input made robust

The playtest report read "it only supports one touch at a time": go forward
then pan and the movement sticks, pan first then move and the view snaps
around. Real multi-touch input (CDP touch events, one event per touch-point
change) reproduced both halves.

The snap is the thumb missing the ring. Its hit area was exactly the 64 px
ring, so a thumb press 2 px outside it fell through to the pan zone and
became the pan, where the thumb's settling jitter turned the camera (0.135
rad from an 11 px jitter, measured). The stick is the same class of fault. A
held input whose pointer ends without reaching its own element (a finger
sliding off a 64 px target, or a browser cancelling one pointer when a second
finger starts a gesture) left the input frozen at its last value, and the
surface then refused new presses behind a stale pointer.

Three fixes, aimed at the class rather than the symptom.

- The ring keeps its 64 px visual and gains a 112 px round HIT AREA
  (`#mobile-pad` over the inner `#mobile-pad-ring` in map.css). A thumb
  aiming for the ring and landing up to 56 px off it drives the ring, never
  the pan.
- Every held input (ring, pan, FIRE, AIM, JUMP, CROUCH) tracks the pointer
  that drives it and dies with that pointer wherever it ends: its own
  element, any other element, or a `pointercancel` /
  `lostpointercapture`. `touch-controls.js` keeps the map (`trackPointer` /
  `endPointer`, listeners on the window) and a missed release can no longer
  leave an input stuck on.
- Last press wins on the ring and the pan zone: a press while a stale
  pointer is still tracked re-arms the surface instead of dead-ending behind
  it. A surface that hides also stops driving input immediately, since the
  vector would otherwise freeze at its last value.

Verified with the multi-touch probe (aberdeen, real CDP touch input, 17
claims). Move-then-pan holds both inputs live (the ring keeps steering
during the pan, `strafe -0.615`), lifting the ring finger stops movement
while the pan finger keeps panning, pan-then-move shows a 0.000 rad snap on
the ring press, and a press just off the ring drives the ring
(`strafe 0.98`) with no view movement. The single-touch probe (21 claims)
and the stub-DOM smoke (28 claims) stay green, and the viewer suite runs the
same 4,554 tests with the same five pre-existing failures.

One probe lesson worth keeping (references/mobile-touch-probe.md): headless
Chromium grants the pointer lock at the deploy close, and under the lock
pointer events carry `clientX = 0` with only `movementX/Y` live, which
poisons every coordinate-based touch claim. Drop the lock and re-take the
page capture with a canvas press before driving real touch input.

## The eleventh pass: panning is smooth again

The owner reported that the touch HUD felt good but panning had become jumpy,
and that it had been smoother before. The buttons and the layout were fine. The
camera stepped.

The cause, measured. The look stage converts accumulated pointer pixels into a
per-frame axis (`mouse-input.js` `pump`: `counts / elapsedSeconds`), and the
old touch path called `lookDelta(dx * TOUCH_LOOK_SCALE)` once per
`pointermove`, forwarding each event's raw travel. Touch does not arrive one
event per frame: the digitiser samples on its own clock, so one frame gets
several moves and the next gets none. A burst's whole rotation therefore landed
on the frames that received events, and the frames in between rotated by
exactly nothing. Probed on the real page (aberdeen, phone viewport, a steady
drag): 32 of 120 frames rotated by exactly 0 degrees, each bracketed by a
full-rotation frame, with single-frame steps up to 19 degrees. That is what
"jumpy panning" looks like when the total rotation is correct and its
distribution is not.

The fix. Both look drags, the open-screen zone and the drag off a held FIRE,
now measure the finger into a smoothed velocity and are fed once a frame as
`speed x dt` (`feedMobileLook`, beside `feedMobileTurretAim` in
`local-player.js`), the same units the move ring already used. The smoothing is
a time constant (`MOBILE_LOOK_TAU`, 60 ms, about four frames) rather than a
per-sample fraction, so the window is the same however the OS spaced its
samples. A frame that received no event now turns by the steady rate, and a
frame that received five turns by the same rate. `TOUCH_LOOK_SCALE` keeps its
meaning as the same multiple on the same pixel count, and the sensitivity
profiles, the plus-or-minus 16 saturation and `countsPerPixel` reach the rate
unchanged.

The fix needed two details, both caught by the stub smoke. A finger that comes
to rest stops sending samples, and nothing would ever return the stored speed
to zero, so a held-still drag would turn the view forever. `feedLookVelocity`
eases the aim to a halt over the same time constant once the samples go stale,
measured from `vel.at`, which only a real pointermove stamps, so the staleness
test stays inside one clock. The decay cannot be measured against a per-feed
clock, because consecutive fed frames each see only one frame's gap and that
gate would never trip. The release paths zero the speed, so a released drag
cannot coast.

Verified. Re-probed on the live page: the staircase is gone (1 zero-gap frame,
was 32, with the 26 former gaps covered by the steady rate) and the per-frame
rotation is a tight continuous band (tail p05 1.05 degrees, p95 3.00 degrees,
max 3.84 degrees, no dead frames). A 220 px drag still pans 106.8 degrees, a
5 px sub-dead-circle wobble still turns 0.0 degrees, and FIRE still acts on its
down edge (live pass, all claims green). A throwaway stub-DOM smoke
(scratchpad/touchpan/, gitignored, since the module has no committed Node
harness) asserts the burst-feeds-once, rested-decay, and released-is-a-no-op
contracts. `./scripts/verify.sh --skip-e2e` runs the same 4,554 tests with the
same five pre-existing failures (extractor tables, baked-nav route, scene-layer
mode layer), none of which this touches.

## The twelfth pass: two sticks, an entry pill and the weapon chip

The owner reported three things at once. Entering a vehicle cost two taps down
into the MORE sheet. Seated, the controls were almost unusable -- one ring was
asked to be throttle, steering, aim and camera at once, and the right half of
the screen was a free zone where a thumb that did not land right dragged the
camera instead of steering. And cycling weapons said nothing about which one
the tap raised.

The entry pill. ENTER moved out of the sheet onto its own button, above the
MORE tab and out of both thumbs' corners, shown the moment the entry scan
offers a door on foot and all the while a seat is held (as EXIT). Out of reach
it hides rather than greys -- an always-there dead pill is one more thing the
eye reads past. The sheet's own ENTER cell is gone; the sheet keeps pickup,
seats, view, map and throttle. On the page the entry scan already ran every
quarter second on foot (`vehicle-entry.js`), so the pill costs no new scan,
only a read of the offer it already makes.

Two sticks, one per thumb. The single move ring's seated job split in two.
The LEFT ring keeps only the throttle's vertical axis -- a seat has no strafe,
so its horizontal axis is dead seated -- and hides on a gun, where no throttle
reaches the seat. The RIGHT ring is its twin on the right edge, shown seated
only: STEER in a car (its yaw axis), STICK in a plane (roll and pitch), AIM on
a gun (the turret, through the same deflection the mouse feeds). On foot the
right ring hides and the left ring is MOVE as before; the look zone still owns
the whole open screen. Seated, FIRE and AIM lift above the right ring by the
`data-mode` word the pass writes on `#mobile-controls` (DRIVE, STICK, AIM), so
the corners no longer collide. `local-player.js`'s seated branch reads the two
rings by thumb: throttle from the left ring's y, steering/roll/pitch from the
right ring's x and y, and the flight stick's `pad` marker (which preserves
roll and pitch when the mouse-look key is up) now follows the right ring.

The weapon chip. One flash per PREV/NEXT press, above the weapon pair: the
raised weapon's kit icon (`kitWeaponSlots` entry's `icon`, resolved to the
sprite the HUD already packed through `kit-icon.js`'s candidate chain) and the
weapon's own name, 1.4 seconds, then gone. When the icon is not yet packed
the chip still names the weapon, so the tap always says something. The chip is
a readout: `pointer-events: none`, so a thumb that reaches for it pans instead.

The code. `touch-controls.js` grew the second ring's geometry (`padDeflection`
serves either ring from the same dead circle and travel), the pill, the chip
and a `mobileRightPadAxis` on the exported interface; `local-player.js` reads
it seated; `map.html` gained the ring, the pill and the chip and hands the
touch bag `kitWeaponSlots`, `handSlot` and `hudPack`; `map.css` mirrors the
ring styles to the right edge and lifts FIRE/AIM for the three seated modes.
The chat input harness copies `touch-controls.js`, which now imports
`kit-icon.js`, so its module list gained that sibling (the established
ERR_MODULE_NOT_FOUND trap).

Verified. `node --check` on both touched modules, the page-wiring suites
(`page_source`, `chat_input`, `weapon_bar`, `world`) at 52 green, and the
seated + replay harnesses (`test_seated_level_switch`, `test_replay_models`)
at 126 green. A phone playtest of the three seated modes and the pill is the
remaining check -- the touch HUD has no committed headless driver.

## The thirteenth pass: the drive returns to the left thumb, ALT beside FIRE, game chrome on the pill

The playtest's report, and where each landed: the left ring accelerated a tank
but never a plane; steering belonged in the left thumb with the right thumb
purely aiming; a two-weapon seat (left and right mouse on the desktop) showed
its second weapon in the HUD but offered no way to fire it; EXIT floated in
the middle of the screen; FIRE was huge; and the pill wore no game art.

Throttle climbs the plane. The reason a pushed ring did nothing in the air:
the aircraft's throttle is a RATE channel (`forwardKeys`, `throttle +=
power * dt` at `world-vehicle-tick.js`; there is no latch in the game) and the
ring's y only ever reached `forward`, which the ground branch consumes and
the air branch ignores. The left ring's y now feeds both. Push forward and the
throttlings climb the way W climbs them, hold level and they stay, pull back
and they fall to reverse thrust's floor; a helicopter takes the same axis as
its keyed collective, straight position on `c_PIThrottle`. The ring on a tank
is unchanged: `forward` carries its deflection.

The drive re-homes to the left thumb. A tank steers on the left ring's
horizontal axis again (`strafe`, the ring's own on-foot geometry) while the
right ring aims: the deflection stage now feeds EVERY seat -- the turret gate
is gone -- so the same deflection the mouse drives aims the turret, pans a
hull camera, and the ring's label reads AIM everywhere but in the air.
Aircraft keep the right ring as a stick (roll and pitch straight off the
vector; feeding the stage would drive the same surfaces twice) and gain the
rudder on the left ring's x (`rudder: clamp(key axis + pad x)`). Labels: MOVE
on foot, DRIVE or THR on the left ring, AIM or STICK on the right.

ALT beside FIRE. The second trigger existed whole since the claw pass -- AIM
held `c_PIAltFire` -- and the AIM label hid it. Seated, the button moves out
of its row into the fire cluster beside FIRE, reads ALT, and wears the seat's
declared secondary ammo icon (`occupancy.activeHud().secondaryAmmoIcon`
through `kit-icon.js`'s candidate chain); on foot it returns to its row as
the zoom's AIM. FIRE slims to 76x62 and RELOAD to 56, so the pivot between
the aim ring and the trigger is a 12 px rock, and the cluster plus the ring
no longer reach the centre.

EXIT out of mid-screen. The pill drops to 64x40 stacked above the MORE tab at
left 132 -- clear of both corners and of the fire cluster's band in both
states, no longer floating at centre when it turns to EXIT. Its insides are
two vector glyphs (the viewer's own strokes: the archives carry no enter
icon, a keyboard game never needed one, and the per-mod icons of bf1918/FHSW
do not cross trees) and the word the pass swaps. The plate behind them is the
game's own art: the menu's beveled button, `knappext_n`/`_mo`, packed from
menu.rfa, hydrated off the sprite pack through custom properties, the
mouse-over plate on the lit state.

Verified: `node --check` on both modules; `page_source`, `chat_input` and
`world` at 42 green. The phone playtest is the handback: a push on the left
ring climbs a plane's throttles, a tank drives on the left and aims on the
right, ALT fires the coax, and EXIT sits above MORE.

## The fourteenth pass: the claw pair, FIRE inboard, the minimap as a disk

The playtest's report on foot: the trigger and the pan live under the same
thumb, so "how do I pan and fire at once -- a finger and a thumb, is that how
other games do it?". And the minimap: too big for a phone and pixelated.

Yes, a finger and a thumb is how the games do it (the first section of this
doc), and the layout finally gives the finger something to press. Three
grips, in order of how many hands adopt them:

- **Two thumbs** (the default): the right thumb puts itself on FIRE and
  drags from there; the trigger stays down and the drag turns the view
  (PUBG Mobile's fire-and-aim, built in the fifth pass). The flaw was the
  corner. From the bottom-right corner a drag has the whole screen up and
  left and about 50 px right or down before the thumb leaves the glass --
  about 50 degrees of turn at `TOUCH_LOOK_SCALE` 8 -- and right-and-down is
  where a recoil pull and a target crossing right both go. FIRE now sits
  INBOARD: a 64 px round trigger whose contact point lands near right 136 /
  bottom 136 (`#mobile-controls[data-mode="MOVE"] .mobile-fire-cluster`),
  inside the arc a right thumb rests in on a phone held in landscape, with
  more than 130 px of glass in every direction. RELOAD rides toward the edge
  beside it, centred on the trigger and a rock of the thumb away. The weapon
  pair, which is taps and nothing else, takes the corner the trigger left
  (`.mobile-weapon-pair`, right 16 / bottom 20, 44 px targets), and the
  weapon chip flashes beside it. AIM alone stays in the right row, above
  RELOAD at the edge (bottom 172 on foot).
- **Three-finger claw** (the competitive standard, the owner's pick): left
  thumb on the move ring, right thumb panning the open screen, left index
  curled over the top edge on a second FIRE. `#mobile-claw-fire-btn` is that
  button: a 76x52 pill at top 22 / left 14.
- **Four fingers**: the right index on the trigger the right thumb's row
  holds, AIM on foot and ALT (the seat's second trigger) seated.
  `#mobile-claw-alt-btn`, top 22 / right 124 -- left of the minimap's disk,
  below the ticket bar. Seated this is the vehicle layout every console
  Battlefield ships: thumbs on the two sticks, index fingers on the
  triggers.

The claw buttons are MIRRORS, not new bindings. A trigger with two buttons
is down while either is held and lifts only when the last finger leaves:
`touch-controls.js` keeps a holder set per trigger (`holdFire`/`dropFire`,
`holdAim`/`dropAim`), the thumb FIRE's drag-off look rides its own pointer
as before, and the pills have no drag look at all -- with a claw grip the
right thumb is already panning, and an index finger drifting on its pill
must not steer a second time. Both pills step aside while the MORE sheet is
down, which drops from the same edge. The trigger itself was restyled to
read as one: round, the warn colour, a reticle glyph over a small word, and
a held state that glows a ring wider than the button, because the thumb
covers the button and the state has to show around it.

The minimap on a phone is a 96 px disk (`#minimap.is-disk`): below 720 px of
stage `syncMinimapToTickets` squares the box and caps it at 96 instead of
the old 118-wide rectangle, the retail bezel, flag strip and grid readout
stay off it (square furniture a circle cuts to chords, unreadable at this
size), and a CSS ring is its chrome. The pixelation had a cause, not a
taste: the canvas drew at a backing ratio capped at 2 and was shown through
`image-rendering: pixelated` on a 3x screen, every other row doubled.
`map-canvas-fit.js` `backingRatio` lets the small widget draw at 3 (a 288 px
backing, still smaller than the desktop widget's) and the disk drops
`pixelated`. The disk also opens one zoom level in (0.287 of the map across
its 96 px rather than the closed level's 0.659), once, because at a quarter
of the retail widget's width the closed level is a cluster of flags round an
arrow and the phone has no N.

One repair on the way through: the "Joystick Sprint" term on `walk` in
`local-player.js` read `mobilePadAxis('y') < -0.9`, which with the pad's
up-positive y is full BACK, and it held `c_PIWalk` -- the game's SLOW gait, a
third of the run (`soldier.js`); BF1942 has no sprint. A phone player
backing away at full stick crawled at a third of what S gives. The term is
gone; full forward was already the run.

Unchanged this pass, named so the next one knows: the plane. The right ring's
13 px of travel to full stick and the rudder leaking off the throttle ring's
x axis are the instability the playtest felt, and the fix is a latching
throttle slider on the left edge, rudder as two step buttons, a bigger right
stick with a response curve and an axial snap, and tilt steering as an
option -- the next pass, on the owner's word.

## The fifteenth pass: one stance button, SIGHTS that work, JUMP under the right index

The owner's report after the claw pass ("much better"): JUMP, CROUCH and
PRONE are three buttons taking space, and the AIM button does not do what the
right mouse does in the game, which is show the sights (a bazooka's, a
rifle's scope).

The AIM button really did nothing on foot. Every vanilla hand weapon sets
`altFireOnce`, which makes the zoom a press LATCH (`hand-fire.js`: the toggle
weapons read `hw.zoomed`, only a weapon without the latch reads the held
`aimHeld`), and the touch button only ever set the held flag. The right
mouse's press edge (demolitions swap, a knife's stab, the latch flip, else
the hold) is now one function, `page-input.js` `footAltPress`, that the mouse
and the touch button both call; `footAltRelease` ends a hold. The button
reads SIGHTS and lights while the zoom is latched, from the visibility
signature, so the sniper's un-zoom between rounds and a weapon change unlight
it without a touch.

One STANCE button replaces CROUCH and PRONE, COD Mobile's own control: a tap
toggles the crouch (prone, a tap stands up), a 350 ms hold toggles prone.
Both are toggles on a phone -- the crouch key stays latched in `page.keys`
until the next tap -- and the press edge does nothing, the tap resolving on
the release and the hold on its timer, which is what lets a hold and a toggle
share one target (the ninth pass's objection was a crouch that engaged on the
press). The word is the stance: CROUCH lit while crouched, PRONE lit in the
warn colour while prone, an unlit CROUCH standing. The left row is STANCE and
SIGHTS, both taps the left thumb makes between moves (a zoom needs no thumb
afterwards; aiming is the right thumb's). JUMP moves to the right row above
RELOAD, so a jump costs the running thumb nothing, and the top-right claw pill
is JUMP on foot (the right index's job in the four-finger grips) and ALT
seated, with a holder set like FIRE's.

## The sixteenth pass: two-finger pan, seats on the pair, the kit bar, the pilot's slider

The owner's report after the stance pass ("pretty great now"): panning is
jumpy while the other thumb holds a control and smooth once it lets go; a
quick seat switch is wanted, like the weapon pair; the kit could use a more
intuitive selector; and in a plane the controls are better but Desert
Combat's airframes run away in pitch and yaw, so could the throttle be a
slider and one control fly the plane, freeing a finger to fire.

**Two-finger pan.** Not a gesture problem (every surface is
`touch-action: none`). Phone digitisers sample slower and burst more with two
contacts, and the one-finger smoothing window (60 ms) let those bursts
through as jumps. `lookTau()` doubles the window to 120 ms while two or more
pointers are down, at the cost of about 60 ms more lag at the start and end
of a two-finger pan. `?touchstats` paints the pan finger's sample rate and
the contact count at the top of the stage so the next tuning is done against
the phone's own numbers.

**Seats on the pair.** Seated in a hull with more than one seat, the corner
pair reads SEAT - / SEAT + and steps to the next free seat in the vehicle's
spawn-declared order, wrapping (`mobileCycleSeat`); the chip says which seat
the press asked for. The sheet's SEATS button stays for the next-free jump.

**The kit bar.** On foot the kit's slots are a row of icon buttons at the
bottom centre (`#mobile-kit-bar`), the raised one lit, each tap the slot's
own select (`selectKitWeapon`, the digit key's body); PREV/NEXT stay. The
bar rebuilds only when the kit, the raised slot or the sprite pack changed.

**The pilot's left hand.** In the air the left ring is gone. A latching
throttle track stands in its place (`#mobile-thr-wrap`): a finger sets the
throttle where it lands and leaves it there, the value shared with the
sheet's slider, and the hull takes it straight on `c_PIThrottle` as the
sheet's slider always did. The rudder is two step buttons under the track,
the keyboard's A and D (`mobileRudderAxis` into the input word's `rudder`),
so a throttle push can no longer leak yaw. The right ring grows into a stick
(`is-stick`: 104 px ring, 36 px of travel against the move ring's 18, so
full stick is about 9 mm of thumb rather than 3) with a response curve that
blends the deflection toward its cube (`MOBILE_STICK_EXPO` 0.7): the centre
is soft, a tremor is trim, full stick is still full stick. FIRE and ALT are
the index fingers' on the top pills, so in level flight no thumb has to
touch anything.

## The seventeenth pass: the nose cam by default, a camera pill, one rudder

The owner's report after the slider pass ("much better"): the throttle track
is too tall and meets the FIRE pill; a kill is incredibly hard to line up
through the cockpit, so the second cockpit view (the first toggle) should be
the default; the camera needs a quick toggle to chase, front and back; and
the rudder would be better as one control than two buttons.

- **Nose cam by default.** On a touch screen an aircraft opens in its nose
  cam, the second first-person view and the one C's first press gives from
  the cockpit: the reticle over open air (`seat-camera.js` `buildSeatView`,
  a fresh hull entry only, where the seat has one). A seat switch or a view
  the player has chosen carries over as before.
- **VIEW on the top edge.** A camera pill beside the claw FIRE, seated only,
  one tap round the C cycle as the seat and the server allow it: nose, chase,
  front, fly-by, cockpit. The sheet's VIEW stays.
- **One rudder.** A rocker under the throttle: the ball follows the finger's
  offset from centre, the yaw is proportional to it (`MOBILE_RUD_TRAVEL` 36
  px, a 5 px dead band), and a lift springs it back, as a pedal does. Half
  rudder is now a thing; the two step buttons were two targets to find.
- **A shorter throttle.** The track is 90 px, not 150: on a short stage the
  taller one met the claw FIRE pill's foot, and a thumb's useful throttle
  travel is about this long.

## The eighteenth pass: the disk in landscape, and EXIT off the HUD

The owner's report: the round minimap showed on the way into the spawn
screen and nowhere else, the game itself still drawing the square; and the
ENTER/EXIT button is ugly and takes HUD space, EXIT above all.

The disk's test was the stage's WIDTH under 720 px, which a phone held in
landscape (800-900 px wide) sails past, so in play the desktop widget drew,
196 px and square, under the claw pill at right 124; the disk only ever
showed in portrait. "Small" is now a phone: a touch stage under 560 px tall
as well as any stage under 720 wide (`syncMinimapToTickets`), and `is-disk`
pins the corner itself (top 30, right 10) since the landscape stylesheet
never did.

The pill loses the menu plate, which read as a stray piece of menu, and
wears the same dark pill as every other control. Seated it is EXIT as a
glyph alone on the top edge beside VIEW (`is-exit`, 44 px wide): a door you
are already through needs no word in the middle of the HUD. On foot ENTER
keeps its spot above MORE, shown only with a door in reach.
