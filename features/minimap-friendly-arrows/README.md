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

## The crewed-vehicle tint, and the hull that fell off the map (2026-09-23)

Bots now board, so the tint is reachable, and it exposed a bug: a teammate
who climbed into a vehicle vanished from both map surfaces. `drawVehicles`
walked `spawnersRoot.children`, and `Vehicle`'s constructor reparents a hull
onto the level root the moment anyone drives it. Nothing puts it back, so
the hull was gone from the map for good, parked or crewed, after its first
driver.

`indexScene` now keeps the level's vehicle list as it found it
(`mapVehicles`), and the map draws from that. Respawn reuses the same node,
so the list holds for the level's lifetime. The local player's own hull is
skipped, because the ring marks him. `friendlyVehicleNodes` maps a nested
seat (a carrier's AA battery) to the hull the map draws, and
`friendlyMarkerKey` carries each crewed hull's position and heading, so a
moving jeep repaints like an on-foot arrow.

Verified on Kasserine Pass (Axis): `__botMount('bot_1', 'Kubelwagen')`
draws the Kubelwagen in the Axis red; after `__botDismount` it stays on the
map as a white parked silhouette. Before the fix it disappeared on the mount
and never came back.

Remote humans are still not in `world.players` (see `netcode-render.js`), so
a room's other players get neither arrows nor tinted hulls.

## Which hulls are drawn: the client's rule (2026-09-24, ledger MMAP-3)

The map drew every spawner's hull, enemy-crewed ones included, and a wreck
kept its icon until its spawner put a fresh hull down. The vehicle pass of
the client's `BfMap::update` (BF1942.exe 0x0046a680) was read and is now
the rule (`viewer/map-vehicle-marks.js`, listed by `map-friendlies.js
mapVehicleMarks`):

- a hull is drawn only while its Armor has hit points (a wreck has no
  icon; neither does an object with no Armor);
- a hull any enemy sits in is not drawn (the last occupant walked decides);
- a hull a `teamOnVehicle` spawner holds for the other side is not drawn
  (the rule takes the held team; the viewer does not model the hold yet);
- a friendly-crewed hull is the side's colour, an empty one the client's
  grey, 0.574 (146/255), where the viewer used to draw the archive's white.

An earlier note here said retail's minimap shows no parked vehicles at all.
The client draws them, grey; the captures' lack of them is probably the one
clause not built: in `BfMenu+0x6DC` modes 0, 1, 3 and 4 the pass drops a
hull farther from the player than a float it reads off an object his player
holds at +0x94, and that object is not identified.

Verified on El Alamein (Allied, 8 bots, `__mapMarks().vehicles`): the two
bf109s and the Stuka the Axis bots flew were missing from the list while the
Allied Sherman and M10 were `friendly`; `__botDismount` on the Axis PanzerIV
brought it back as `empty`; a Sherman destroyed at 1616,-817 left the list
at once and came back `empty` at its spawner, 1721,-778, when the spawner
replaced it.
