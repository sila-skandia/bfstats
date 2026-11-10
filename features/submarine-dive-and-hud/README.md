# Submarine: the dive, the gauges, the periscope and the deep view

**Status:** built 2026-11-09 for vanilla (the Gato and the Sub7C), Road to Rome
and Secret Weapons, which use vanilla's HUD layout. The other mod trees' own
`hud-layout.json` files carry no submarine groups yet (see Open). Ledger rows
SUB-1..SUB-6.

## What retail does

The owner remembered it as "press the up arrow, she goes under, and the HUD
turns into a black screen with a radar". The data and the client say:

1. **The dive is on the arrow keys.** `c_PIPitch` turns each `GatoFloater`'s
   RotationalBundle: 0 to 50, 2 a second, accelerating at 1, and it holds
   where the key leaves it (no automatic reset). That angle is SHIP-7's depth
   setpoint: fully under, the floats settle `setpoint + 0.5` m down. The down
   arrow brings her back up (SUB-1).
2. **Gauges, always, while you drive her.** Water depth under the boat, the
   current depth and the wanted depth on two scrolling tapes (green above
   periscope depth, red near the crush depth) and the air (SUB-2, SUB-5).
3. **The periscope while she is shallow.** No deeper than `submarineData`'s
   5th float (19.5 m for the Gato, measured at her keel), the view is the
   periscope ring with its crosshair lines and a bearing scale under it whose
   marker follows the camera off the bow (SUB-3, SUB-4).
4. **The deep view.** Deeper than that, 0.3 s later the screen fades to black
   over 0.5 s, the fullscreen map opens and the boat's red-lit cockpit picture
   comes up behind it, and 1 s later the black fades away. That is the "black
   screen with a radar": the map, framed by the cockpit. Coming back up more
   than half a metre past where she went under closes the map and the
   periscope returns (SUB-3, SUB-4).
5. **Air and crush depth.** Deeper than the 5th float the air runs down at the
   1st float a second (111 s for the Gato) and the crew suffocate at the 3rd
   once it is gone; deeper than the 6th (40 m) the hull takes the 7th a
   second (PHY-3).

## What is built

| Piece | Where |
|---|---|
| The dive: each trimmed float's key axis, stepped once a server tick | `viewer/ship.js` `advanceTrim`, `diveSetpoint` |
| The readout, the periscope and deep switches, the fade | `viewer/submarine-hud.js` |
| The page's feed (depth off the body world, air off the hull's damage record, bearing off the camera) | `viewer/map.html` `createSubmarineHud`; called from `soldier-hud.js` |
| The three `menu/InGame` tops: `periscope` (periscope, bearing scale, cockpit picture), `depthFade`, `submarine` (gauges) | `extract_hud_layout.py` `SUBMARINE_TOPS` |
| Computed offsets (`TranslateNode`, a `BfTransformNode` whose X or Y is an expression) and the scrolling tape | `extract_hud_layout.py` `expr`, `add_shift`, `emit_scroll_picture`; `viewer/hud.js` `evalExpr`, `shiftOf`, `scrollPictureBand` |
| The sprites | `extract_hud_pack.py` (the `Submarine/` panels and tapes, `periscope`, `cockpit_512x512` and the artillery grid the bearing scale reuses). Published 2026-11-09 as the 14 pictures plus the live `hud.json` with their entries merged in, not a fresh pack: this PC's install carries the community map pack, whose levels re-source one vanilla level icon. Road to Rome's and Secret Weapons' own `hud.json` got the same 14 entries; their pictures resolve to vanilla's pack |
| Test hook | `window.__submarine()`: what the feed read, what it wrote, and the hull's body-world depth and air |

A fix rode along: a ship's body-world spec had no water part, so the damage
clock's depth (`world-damage.js` `submersionDepth`) read 0 m for every driven
ship. A driven Gato's crew could never run out of air and her hull was never
crushed. `hull-bodies.js` `seaHullSpec` gives a sea hull the same root part a
land hull's spec carries.

## How it was checked

- `tools/bf1942-models/tests/test_ship_dive.py`: a hull on eight Gato floaters
  through `ship.js`. The setpoint runs at 2 m a second, coasts 2 m on release
  and holds; she settles at 12.49 m for a 12 m setpoint (SHIP-7's 12.5) and
  floats at 2.49 m at setpoint 0 (the closed form, 2.489); the setpoint stops
  at 50; a sleeping root wakes on the key and dives, and stopped under water
  she stays awake and climbs on the other arrow (SUB-7, 2026-11-10: a float
  whose angle term is not 0 wakes the hull before its sleep test; the
  harness's 'a sleeping root does not dive' was the opposite).
- `tools/bf1942-models/tests/test_submarine_hud.py`: the readout, the
  periscope switch and the deep latch's half metre, the fade's timeline, the
  feed opening and closing the map, and the tape's band against hand
  arithmetic.
- In the page, Midway, the Gato: surfaced, the periscope ring, lines, bearing
  scale and the four gauges draw (keel depth 7.85 m, shown depth 1.95 m).
  Holding the dive key under way she went down at 2 m/s, the wanted-depth
  tape stopped at 15 (0.75 of the 20 m of water there), and past 19.5 m the
  fade ran and the map opened inside the cockpit picture. On the down arrow
  the deep view let go at 19.08 m, the map closed and the periscope came back.

## Divergences

- **The HUD's gate.** Retail asks the player's control object (read as
  `getSubPos`, which the exporter does not carry). The page takes a
  `VTSubmarine` with a crush depth: the two vanilla boats, and none of Desert
  Combat's land hulls that author `submarineData` (SUB-6).
- **The periscope in third person.** It rides in the crosshair group, whose
  third-person switch has no read caller (XHIT-10). The page shows it from the
  boat's own camera only.
- **Leaving the boat deep.** Retail's `Submarine::hide` leaves the map as it
  was; the page closes the map it opened.

## Open

- **The other mod trees.** FH, FHSW, FHSW Europe, EoD, Desert Combat, bf1918,
  GC, Interstate and Pirates ship their own `hud-layout.json`, decoded before
  the submarine groups existed. The dive works in all of them (it is the
  float's own rig), but their gauges, periscope and black fade do not draw
  until their layouts are re-decoded (`extract_hud_mods.py --mod <id>`), which
  waits for the owner to name the mod.
- **A room.** In a room the server runs the damage clocks and sends hit
  points, not the air, so the air gauge there reads the page's own record,
  which does not drain.
- **Check against retail.** Whether a parked Gato dives before she is under
  way (SUB-7 says she does: the float's own angle wakes her), whether the periscope shows in third
  person, and how the deep view looks on the owner's install.
- **The bearing marker's grey.** `menu/InGame` tints it 0.5 grey; `hud.js`
  applies a picture's alpha and not its colour, so it draws in its own
  yellow.

## 2026-11-10: BF1918's M1uboot

- **A stopped boat under water froze.** The page's floats ran only while the
  root was awake and nothing but the revs woke it, so a boat at rest at her
  setpoint slept after 100 ticks and the dive keys moved the setpoint and
  nothing else, while the air ran out. `PhysicsFloatingBundle::updatePhysics`
  wakes the hull first whenever the float's angle term is not 0 (SUB-7):
  `ship-law.js` and `body-float.js` now do. With the setpoint back at 0 the
  floats no longer wake her, and a hull climbing under 0.5 m/s can still sleep
  on the way up (TANK-21).
- **BF1918's layout.** Its `menu/InGame` keeps the cockpit picture in a top of
  its own and folds the capture flag into the deep fade's SplitNode;
  `extract_hud_layout.py` now gathers a group from every top carrying one of
  its pictures and repeats no leaf another group holds. Vanilla's layout is
  byte-identical. The bf1918 pack needs `extract_hud_mods.py --mod bf1918`.
- **A stale local cache.** `serve_viewer.py` keeps a remote file until the
  cache is removed, and `~/.cache/bfstats-mesh-remote/maps/_shared/hud/hud-layout.json`
  on this Mac is from 5 November, before the submarine groups: every local
  page, vanilla's Gato included, drew no submarine HUD from it.
