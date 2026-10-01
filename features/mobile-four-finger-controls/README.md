# Mobile four-finger controls

Status: built (first pass). No playtest on a real phone yet. This doc maps how
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

## Next steps

1. Playtest on a real phone with the grip, and tune button sizes and the
   34vh index-finger row against the placement rules above.
2. Left to a later pass: kit selection beyond pickups happens on the deploy
   screen already (its own UI), so the remaining gaps are the turret-aim
   split (the pad is still the only turret aim input), an aircraft stick
   pair replacing the throttle slider, radio calls, and a two-thumb fallback
   that hides the claw buttons for players who do not adopt the grip.

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