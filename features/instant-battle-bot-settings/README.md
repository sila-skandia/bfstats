# Instant Battle bot settings, rebuilt

The retail Instant Battle left column (CUSTOM/EASY/NORMAL/HARD, OVERALL
DIFFICULTY, AI SKILLS, PLAYER DEATH TICKET PENALTY, ENEMY VS. FRIENDLY UNITS
RATIO, and the PERFORMANCE block) was switched off years ago
(`menu-screen.js` `SHOW_BOT_SETTINGS = false`) because the viewer ran no bots.
The bots exist now, and the screen needed two controls that map onto what
`map.html` actually takes:

- **NUMBER OF BOTS** — the total across both sides. `skirmish.js` splits it
  between the teams, an odd count leaving the extra body on the player's side.
  Range 0..32, the same clamp `?botCount=` has. Click anywhere in the trough.
- **BOT INTELLIGENCE** — five stops: 0.10 / 0.25 / 0.50 / 0.75 / 1.00, passed
  as `?botSkill=`. `map.html` previously clamped the floor at 0.25; the floor
  is 0.10 now.

Until the strategist gets a control of its own the intelligence slider carries
the caption **BF1942 EQUIVALENT**. The strategist is a separate axis and
already exists: `doctrine.js`'s doctrine registry — `sai` (the engine's own
strategic AI), `garrison` (the invention: hold posts, else push), `squad` —
chosen per side with `?doctrine=` (default `garrison`). A future control here
would be a doctrine picker; tactics-flavoured doctrines (kamikaze flag rush,
spawn-camper, squad discipline) would slot into the same registry with
`registerDoctrine`.

## Implementation

`play/bot-settings.js` draws and hit-tests the two controls; it is
viewer-authored (the flattened `menu-layout.json` has no elements to reuse)
but uses the menu pack's own face and the retail sliders' grey-frame /
black-well / select-green look, in the old column's spot. `skirmish.js` paints
it after `paintMenu(..., false)` and tests it before the layout walk. The dead
retail-slider mapping (`applyBotSlider`, which clicked through layout `sets`
arrays that never repainted) is gone.

## The briefing owns the pane

`page-input.js`'s pointerdown (and the wheel dolly) now return while
`page.overlay.briefingCaptures()` — the same handshake the keydown router
already honoured. Before, the first click behind the briefing hit the canvas
through the overlay's `pointer-events: none`, called `capture()`, and the
pointer lock took the cursor away: READY could never be clicked and only
Escape worked, while drags flew the free camera behind the plate. The game's
own rule: the briefing is closed before the game takes any input at all.

## Verified

- `node --check` on every touched module; `tests.test_menu_screen`,
  `tests.test_mouse_input`, `tests.test_load_briefing_js`,
  `tests.test_controls_menu`, `tests.test_menu_screen.mjs` green.
- Live pass (local serve): the screen draws both controls in the pack's face;
  trough clicks set 27 bots / 0.10 intelligence and the launch URL carries
  `botCount=27&botSkill=0.1`; on `map.html` a synthetic pointerdown + drag
  behind the briefing captures nothing (`pointerLockElement` stays null) and
  the READY click settles the briefing.
