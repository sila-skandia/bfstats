# Crosshair hit marks

Asked 2026-09-24 from the owner's recording (`1790223308128.mp4`, Berlin, DP on
foot): four short diagonal lines flash at the corners of the crosshair when your
round hits a soldier, friend or foe, on foot, in a tank or in a plane.

The evidence is in `features/bf1942-engine-reference/ledger.md`, rows XHIT-1 to
XHIT-11, and `subsystems/ingame-hud.md` section 7. This note records what was
built on it.

## What the game does

- **It is data.** `menu/InGame`'s crosshair group has four 1×3 / 3×1 quads at
  the corners of the 20×20 crosshair box. They are turned 0.8 rad about their
  own centres, drawn in the crosshair colour, and their alpha is multiplied by
  `CrossHair/HitIndicationTime`. All 18 installs have the same four quads
  except bfheroes. The only gates are the group's own `ShowCrossHair` and
  not-periscope.
- **The timer.** The local player's own float. A hit sets it to 1.0 and it
  runs down `t = max(0, t − dt)`, so a single hit fades out over one second. An
  automatic weapon keeps resetting it, which holds the marks at full for the
  length of the burst.
- **What raises it.** `GameServer::giveDamage` raises it before it prices any
  damage, when:
  - the round is the local player's own;
  - the object it met has a PlayerControlObject root with a non-zero team: any
    soldier, or a hull while someone sits in it.

  There is no team comparison and no damage floor. Only direct projectile hits
  count: the engine's explosions never reach `giveDamage`. On by default
  (`game.serverHitIndication 1`).

## What the viewer does now

| Piece | Where |
|---|---|
| `rotation` on fills, `colorVars` (a VariableColorEffect's live channels) and `alphaVars` (BfMultiplyColorEffect2) in the layout | `extract_hud_layout.py`; republished `maps/_shared/hud/hud-layout.json` and EoD's (additive fields only) |
| Fills turn about their centres. Bound channels replace the static colour, and the multiply bindings scale alpha and must be fed | `viewer/hud.js` `liveColor`, `_drawFill`, `_drawPicture` |
| The timer, raised on a hit and decayed per rendered frame; the `CrossHair` group shown whenever the player is in the world, including the death cam | `viewer/soldier-hud.js` |
| The trigger: the human's direct hit on a soldier or a manned, unwrecked hull, read before the damage lands. The human's rounds now meet his teammates | `viewer/vehicle-hits.js` `marksTheCrosshair`, `roundBodyCast`; `viewer/hand-weapon.js` tags the hand weapon's gun group |
| One crosshair colour for the cross and the marks: the profile's `game.setCrossHairColor`, divided by 256 as the game does | `viewer/controls.js` (read from an imported profile's `GeneralOptions.con`), `viewer/vehicle-hud.js` `--ch-ink` |
| The cross itself in HUD units, stretched per axis: arms 10 units long and 1 thick, the gap in units, and the 1×1 centre point (`serverCrossHairCenterPoint 1`) | `viewer/vehicle-hud.js` `updateCrosshair`, `viewer/map.css` |

A `hud-layout.json` from before these fields still paints exactly as before. So
does a mod pack that has not been re-extracted: `soldier-hud.js` keeps the
group down in hip fire until the layout carries the marks' binding.

## Decisions to know about

- **The default colour is the shipped default profile's yellow (255 255 0).**
  This follows the rule the viewer's controls already use: the game's own
  shipped data, not a value this repo picks. Importing a profile folder in
  OPTIONS > CONTROLS brings its colour; the owner's is red (255 0 0). The
  cross used to be `rgb(176,32,16)`, which was a video-compressed measurement
  of that red.
- **Bots' rounds still pass through their own side.** Only the human's rounds
  meet teammates for now. Changing the bots touches bot combat and is a
  separate task.

## Verified

- `python3 -m unittest discover -s tools/bf1942-models/tests`:
  - `test_hud_layout.py`: the marks' geometry, bindings and gates;
  - `test_hud.py` with `hud_harness.mjs`: the painter's diagonals, pivot, sense
    and alpha;
  - `test_hit_indication.py`: what raises the mark and which soldiers a round
    meets;
  - `test_controls.py`: the colour.
- Headless El Alamein on the live page: one BAR round on a frozen teammate at
  10 m raised the timer in the frame of the hit, 0.983 after that frame's dt.
  It then ran down 1/60 a frame to 0 at exactly 1.0 s. The captures show the
  four diagonals at the corners, at half alpha at 0.5 s, and gone after.
- Seated in a Sherman: the group is up and the periscope gate reads false.
- Page loads on desktop and mobile emulation with no errors.

## Open

- **XHIT-9:** whether the HUD batch alpha-tests, which would cut the marks off
  before `t` reaches 0.
- **XHIT-11:** the crosshair gap law. `BfCrosshairNode`'s draw (`0x007db970`)
  loses its x87 stack in the decompiler, so the gap still uses the viewer's
  camera projection, now applied in HUD units.
- The full-screen red damage flash in the `hitIndicator` group is still skipped
  by `hud.js`. It is flagged as its own task.
