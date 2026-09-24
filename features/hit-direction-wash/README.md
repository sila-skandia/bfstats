# Hit direction and the red wash

When the local player is hurt, BF1942 washes the whole screen red and, for seven
of the eight directions, draws a red arc on the side the damage came from. The
viewer drew only the arc, from a 1 s fade it made up, and put it on the wrong
side. It skipped the full-screen quad as an "artifact".

The engine's side is ledger HFD-1..HFD-9 and
[subsystems/ingame-hud.md](../bf1942-engine-reference/subsystems/ingame-hud.md)
§8. Every rule below points there.

## What the game does

- `BfMenu::setHitFromDir(dir, alpha)` (client `0x006acb60`) is the only writer
  of `HitFromDir/HitFromDir` and `HitFromDir/HitFromDirAlpha`, and it writes
  both at once. `_giveDamage` calls it for every damage the player takes: rounds,
  splash, falls, water, the combat area, drowning (HFD-1, HFD-4).
- The alpha is `damage / maxHitPoints`, held to 0..0.75 (HFD-2).
- The octant is the 3-D direction from the victim to the damage's own point:
  the muzzle a round left, a blast's centre, a landing's contact point, or
  the world origin. It is dotted with his forward and right at
  0.9238 / 0.3826 (HFD-3, HFD-4).
- `menu/InGame` draws a full-screen `(1, 0, 0, alpha)` quad and the arc for the
  direction. Its `TimeoutActionNode` sets the direction back to 0 after 0.2 of
  **menu** time. Nothing fades in between (HFD-5).
- Menu time steps 1/30 per painted frame, so the flash is **six painted
  frames** at any frame rate (HFD-6). The owner's recording agrees: constant
  alpha, 3-4 video frames at 60 fps, a second hit 0.13 s later as a separate
  flash (HFD-7).
- The wash tints everything `menu/InGame` drew before it (chain index 37) and
  nothing after (HFD-8).

## What the viewer does now

| File | Change |
|---|---|
| `viewer/hud.js` | `_drawFill` draws the 800x600 quad. Groups paint in the engine's chain order (`PAINT_ORDER`), so the wash covers the tickets, weapon bar and crosshair group. A layout without `colorVars` sets the alpha to the variable instead of halving it. `calculateHitOctant` treats `r = 0` as right. `hitFromDirOctant` and `hitFromDirAlpha` are new |
| `viewer/soldier-hud.js` | `triggerHitIndicator(dir, alpha)` is the engine's setter. `updateSoldierHud` runs the layout's timeout: a float32 1/30 step per call, six frames, not restarted by a second hit. The HP poll raises the engine's alpha at direction 1, and skips HP that `applyDamageToPlayer` already raised |
| `viewer/local-player.js` | The octant comes from the soldier's position toward the damage's point, in 3-D, with his real right `(-cos yaw, 0, sin yaw)`. A heal raises nothing |
| `viewer/map.html`, `viewer/vehicle-hits.js` | A bot's round reports its muzzle (`aimRay().origin`), not the bot's feet |
| `viewer/test-hooks-soldier.js` | `window.__damage(n, hit, from)` takes the damage's point |

## Deliberately not like the game

- **HP lost outside `applyDamageToPlayer`** (falls, drowning, the combat area,
  a room's snapshot) raises direction 1: the wash with no arc. The game points
  the arc at the contact point or the world origin. The poll cannot tell which
  one applies.
- **A vehicle round's point** is the firer's gun as it stands when the round
  lands. The round's own launch point is not in the hit record.
- **No wash in a seat.** The engine sends it to a hit hull's crew (HFD-9, the
  player set is unread).
- **The minimap and the DOM crosshair** are layers above the HUD canvas, so the
  wash does not tint them. The engine's does (chain 14 and 3 are under 37).
  Re-layering them is a separate change, because the supply icons and the map
  interleave in a way a z-index swap cannot reproduce.

## Verified

- `python3 -m unittest discover -s tools/bf1942-models/tests`: `test_hud.py`
  covers the octants, the alpha, the wash and arc painting, the paint order and
  the six-frame clock at 20, 60 and 144 fps. `test_hud_layout.py` pins the
  wash leaf, the zero fade times, the timeout and its viewer constant, and
  `PAINT_ORDER` against vanilla's `menu/InGame`. Each test fails on the code
  it replaced.
- Headless on El Alamein (Playwright, Vulkan, `__renderOnce` stepping, the HUD
  canvas read back against a pre-damage control):
  - a hit from 12 m to the soldier's screen-right lasts frames 1-6, gone on 7.
    The wash pixel is `(255, 0, 0, 102)` for 0.4 of 30 HP, the arc is on the
    right (45,315 new pixels, 0 on the left), and all 8,430 opaque HUD pixels
    under it are tinted;
  - from the left: the arc on the left (43,476 pixels, 0 on the right);
  - with no source: the wash alone;
  - at 144 fps: the same six frames;
  - the page camera's own right is the octant's right `(1, 0, 0)` at yaw π.
    The old vector pointed left.

## Open

HFD-9: the run-over collision's `Pos3`; where a soldier object's position
sits (taken as his feet); which players a hit hull washes.
