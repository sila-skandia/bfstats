# Friendly units on the map: arrows, not dots

The map surfaces marked a teammate with `icon_vehicledot_friend` — an 8x8
blue disc that says where he is and nothing else. Retail marks him with
`minimap_icon_soldier_16x16`, an arrowhead that says which way he is facing,
and paints it in the side's own colour. This is that, on both surfaces (the
HUD widget and the spawn/full map, which share `paintMap`).

## The colour is the local side's, not friend-or-foe

The unit icons ship white on a black outline and the engine modulates them.
Which colour was the one thing that could not be settled from an Allied
capture, because both candidate rules — "friendlies are blue" and
"friendlies are the local team's colour" — paint an Allied player's
teammates blue. `icon_vehicledot_friend.dds` being blue and
`icon_vehicledot_enemy.dds` red is real evidence for the first rule, so this
needed an Axis capture to settle.

`Screenshot From 2026-09-13 20-53-36` is one: a desert map, Axis side, and
every teammate arrow and vehicle icon on the minimap is **red**. So it is
the local team's colour.

The two tints, measured as the purest texel inside each capture's minimap
box (bilinear filtering only ever pulls a texel toward the background, never
past the source, so the extreme is the modulate colour):

| capture | side | tint |
|---|---|---|
| 2026-09-22 21-01-16 (Bocage, HUD widget) | Allied | (75, 126, 252) |
| 2026-09-23 10-11-40 (Bocage, spawn map) | Allied | (75, 126, 252) |
| 2026-09-13 20-53-36 (desert, HUD widget) | Axis | (247, 52, 49) |

Two different maps and two different surfaces agree on the blue **to the
texel**, which is what says these are the colours themselves. They are near
(0.3, 0.5, 1.0) and (0.97, 0.2, 0.19); the measured values ship, because
they are what was seen.

`MINIMAP_TEAM_TINT` in `map.html` holds both.

## How it is drawn

`tintedSprite(name, rgb)` is `out = src * tint` per channel with alpha
untouched — the engine's modulate. White becomes the tint outright, the
black outline stays black, the grey antialiasing lands in between. Memoised
per (sprite, colour): two colours and a handful of icons, so a dozen 16x16
canvases built once. Tinting per marker per frame would put a
`getImageData` on the frame path, which is the one thing the map surfaces
are careful not to do (features/mesh-viewer-performance, rule 7).

**Size.** Every minimap icon draws at one sprite pixel per virtual unit:
`setMinimapIconSize` defaults to 16 and the 16x16 sprites declare nothing
else. Checked against the Axis capture — the 32x32 player ring measures 30.6
virtual units across and the soldier arrow's 8-wide ink measures 6.3 — and
the viewer's existing `MARKER_SCALE` already lands within 4% of that, so the
arrow draws at the plain `sc` the vehicles use, not the `sc * 0.5` the dot
it replaces used.

**Heading.** `soldier.yaw` turns a forward of `(sin yaw, 0, cos yaw)`
(`soldier.js` `lookVector`); the surface's screen angle is the same
`atan2(x, -z)` the camera and the vehicle silhouettes already go through, so
the three agree by construction. Proved in the page rather than argued: for
the local player on foot, `atan2(sin(soldier.yaw), -cos(soldier.yaw))` and
the `cameraHeading()` that `drawPlayer` uses differ by 4e-14 rad.

**A crewed hull is the mark.** A teammate riding a vehicle gets no arrow of
his own — `friendlyMapUnits` skips him — and `drawVehicles` paints the hull
he is in with the team tint instead. That is what the retail captures show:
one mark per man, and the vehicle is it.

## Verified

- Bocage, 10 bots, Allied: 10 arrows on the HUD widget and the spawn map,
  each turned its own way. 64 canvas pixels of exactly `rgb(75,126,252)` and
  33 of `rgb(50,84,168)` — which is the sprite's own grey (170) modulated by
  that same tint, so the multiply is exact and not merely close.
- `python3 -m unittest` over `tools/bf1942-models/tests` — 2706 tests, OK.

## Not reachable yet: the crewed-vehicle tint

The rule is implemented and correct, but nothing in the viewer can currently
put a teammate in a vehicle, so it never fires:

- **Bots do not board.** `bot.js` has no vehicle behaviour at all.
- **Remote humans are not in `world.players`.** A room's other players are
  replicas owned by `netcode-render.js` (its own `soldiers` / `vehicles`
  maps); `world.players` holds the local player and the bots only. So the
  map's friendly marks — the arrows included — have always been bots-only,
  and `player.occupancy.root` is never set for anyone but the local player.

Either of those two would light it up unchanged. Until then the tint is
reached only by the local player's own hull, which is reparented out of
`spawnersRoot` while he drives it and is marked by the ring instead — the
way retail marks it.

## An unrelated difference, noted not changed

Retail's minimap does **not** show parked vehicles: in both reference
captures the only marks are control points, the local ring, and the local
side's living units. This viewer draws every spawner as a white silhouette.
That is a deliberate sandbox affordance (it is how you find a plane), not a
bug, and it is left alone — but it is why our map still reads busier than
the captures even with the arrows in.
