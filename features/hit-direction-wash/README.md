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

### In a vehicle (HFD-10..HFD-13)

- `_giveDamage` washes every player in the `getPcos()` map of the first
  PlayerControlObject at or above the damaged object. Only a root PCO fills
  that map, with itself and every seat under it. A child seat's map stays
  empty, and a soldier's map is himself (HFD-10).
- In vanilla, XPack1 and XPack2 a hull's damaged object is always its root:
  every `hasArmor 1` sits on the root PCO, and every path hands `_giveDamage`
  the Armor's owner, the root, or a root from the splash query (HFD-11). So
  everyone seated anywhere in a hit vehicle is washed. The octant comes from
  the hull's origin against the hull's own forward and right, whatever seat
  he is in and wherever he looks. The alpha is the damage over the hull's
  max HP, which is 100 for a Sherman.
- The hull's `Pos3`: where a round was fired from, a blast's centre, a
  landing's contact point, and the world origin for water, a crash into
  another object and `Armor::update`'s once-a-second ticks (burn, water,
  upside-down; HFD-4, HFD-13).
- A splash also hits each exposed occupant as a soldier, and that washes him
  from his own frame (HFD-12).

## What the viewer does now

| File | Change |
|---|---|
| `viewer/hud.js` | `_drawFill` draws the 800x600 quad. Groups paint in the engine's chain order (`PAINT_ORDER`), so the wash covers the tickets, weapon bar and crosshair group. A layout without `colorVars` sets the alpha to the variable instead of halving it. `calculateHitOctant` treats `r = 0` as right. `hitFromDirOctant` and `hitFromDirAlpha` are new |
| `viewer/soldier-hud.js` | `triggerHitIndicator(dir, alpha)` is the engine's setter. `updateSoldierHud` runs the layout's timeout: a float32 1/30 step per call, six frames, not restarted by a second hit. The HP poll raises the engine's alpha at direction 1, and skips HP that `applyDamageToPlayer` already raised |
| `viewer/local-player.js` | The octant comes from the soldier's position toward the damage's point, in 3-D, with his real right `(-cos yaw, 0, sin yaw)`. A heal raises nothing |
| `viewer/map.html`, `viewer/vehicle-hits.js` | A bot's round reports its muzzle (`aimRay().origin`), not the bot's feet |
| `viewer/test-hooks-soldier.js` | `window.__damage(n, hit, from)` takes the damage's point |
| `viewer/round-launch.js`, `projectile-flight.js`, `round-impact.js` | Every round keeps where it left the barrel, and its hit record carries it as `origin`: the engine's `Projectile+0x134`. A round that hits the player on foot now points his arc there too, not at the firer's gun as it stands when the round lands |
| `viewer/vehicle-hits.js` | `washSeatedCrew` raises the wash when the hull the local player sits in takes damage, with the octant from the hull root's world position and axes (`hitFromDirOctantAxes`) and the alpha as damage over the hull's max HP. It is fed by a round (toward `origin`), a blast (its centre), a crash (object or water: the origin; ground: the contact point; the kill material: no arc) and the Armor's timed ticks (the origin) |
| `viewer/vehicle-damage.js` | `applyHit` and `applySplash` return the priced `amount` beside the HP `lost`: a killing hit washes at its damage's share, not the HP that was left. `update` returns the HP its last timed tick took, and `VehicleDamageSet.update` lists the ticks in `ticks` |
| `viewer/world.js`, `world-damage.js`, `crash-damage.js` | The step report's `timedDamage` carries those ticks, and a crash record says whether the terrain was water and what the hull lost |
| `viewer/hud.js` | `hitFromDirOctantAxes(victim, forward, right, source)` is the octant for a victim framed by its own axes. `hitFromDirOctant` is it with a soldier's heading |

## Deliberately not like the game

- **HP lost outside `applyDamageToPlayer`** (falls, drowning, the combat area,
  a room's snapshot) raises direction 1: the wash with no arc. The game points
  the arc at the contact point or the world origin. The poll cannot tell which
  one applies.
- ~~**A vehicle round's point** is the firer's gun as it stands when the round
  lands. The round's own launch point is not in the hit record.~~ The record
  carries it now (`origin`). The gun remains only the fallback for a record
  without one.
- ~~**No wash in a seat.**~~ A hit hull washes the local player in any seat
  of it (HFD-10, HFD-11). What is still missing in a seat:
  - **The combat area** burns the hull a seated player is in and washes
    nobody here. The engine hands `giveDamage` the player's own seat PCO, so
    only a root seat's crew would see it, at about 0.002 a tick against a
    100 HP hull: nothing visible.
  - **His own damage.** A round that meets his exposed body, or HFD-12's
    second splash on an exposed occupant, washes nothing here, because
    `applyDamageToPlayer` still returns before the wash in a seat. The engine
    washes him from his own frame, which is his `SeatObject`'s, and the viewer
    has not read it.
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
- The seated wash: `test_hull_wash.py` covers a round, a blast, a crash
  (object, ground, water, kill material) and a burn tick on the hull he
  sits in; the hull's own frame, turned and pitched; a wreck and another
  hull washing nothing; the killing hit's alpha; and the on-foot arc taking
  the record's launch point. `test_hud.py` pins `hitFromDirOctantAxes`, and
  that it agrees with the yaw form on 2,000 random cases.
  `test_vehicle_damage.py` pins the ticks and the priced amounts, and
  `test_bomb_release.py` pins that the record's `origin` is the rack's barrel.
  Under node, every new behavioural test fails on the code it replaced.
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
- In a seat (2026-09-24), headless on El Alamein in a Sherman. The bots were
  frozen and the rAF loop stopped. `__roundHit` sends a round through the
  page's own `applyVehicleHit` and `__blast` a splash, and `__hull().axes`
  gives the root's frame, from which each expected octant was computed:
  - driver seat, a 30-point round from 40 m off the hull's right: octant 3,
    alpha 0.3. The HUD canvas reads `(255, 0, 0, 77)` over all 915,054
    pixels clear in the pre-hit frame, and the arc adds 50,345 pixels on the
    right and 0 on the left, for frames 1-6. Both are gone on 7;
  - the hull MG seat (`shermanBrowning_PCO1`, a child PCO), a 20-point round
    from the same world point: octant 3 again, the hull's right, at 0.2
    (alpha 51), with the arc 50,345 right and 0 left;
  - a blast 4 m astern: octant 5, alpha 0.0387, which is the 3.87 HP it cost
    over 100;
  - critical at 11 HP: the first burn tick one world second later raises
    octant 4, toward the world origin, at 0.015, for six frames;
  - the control, two quiet frames: 0 washed pixels and 0 arc pixels. The 801
    pixels that do change between them are other HUD elements animating, not
    the wash.
  `tests/hull_wash_harness.mjs` covers the same paths under node, plus the
  crashes and the killing hit's alpha.

## Open

HFD-9: where a soldier object's position sits. `local-player.js` looks from
his feet, while `soldier-pose.js` puts his origin 1 m above them
(`setCharacterHeight -1.00`, strong inference). The run-over `Pos3` (the world
origin, HFD-13) and which players a hit hull washes (HFD-10, HFD-11) were
closed 2026-09-24.
