# Round replay: both sides on the minimap

Asked 2026-09-29: "With the round replayer, the mini map doesn't show anyone
on it - like it would when playing in-game. I think it makes sense to show
both teams on the map, is that data available"

It was. The recording has every replicated player's position, heading and
side at any clock time (`replay-battles.js` `whereIs`), and the M battle map
already drew everyone from it. The HUD minimap in the corner read the page's
own world (`map-friendlies.js`), which a replay never fills. So it marked
nobody, plus the level's parked vehicles at their pads, which the replay hides
in the 3D view.

## What it marks now

`replay-minimap.js` `minimapMarksAt` reads the recording at the clock.
`map-surfaces.js` paints those marks in place of the world's while a replay
is open (`page.replayMinimap`). The rules are the client's own
(`map-vehicle-marks.js`), with one change: in play the map shows only the
reader's side, and a replay shows both.

- **Men on foot** get the `minimap_icon_soldier_16x16` arrow, turned to their
  heading, in their side's colour. Axis is red (247, 52, 49) and Allies blue
  (75, 126, 252). These are the colours each side sees its own players in
  (`MINIMAP_TEAM_TINT`), so both sides look as they do in a real round.
- **A crewed hull** gets its template's icon in the crew's colour (the lowest
  seat decides). The men inside have no mark of their own.
- **An empty hull** is grey (`EMPTY_VEHICLE_TINT`), and only while the
  recording has it live. The candidates are the hulls the replay draws
  (`ReplayPlayer.hulls`), so kits and rounds never show up.
- **A wreck** is not marked, and neither is a hull whose recorded hit points
  are 0.
- **A last sighting** is drawn faded (alpha 0.45) under the live marks. This
  covers anyone beyond the recording's range, for `whereIs`'s 20 s.
- **The ring** is the followed player while the camera is his (orbit or
  first person, with no creator rig), and the map is centred on him. His own
  mark, and his hull's, is left out, just as the local player's is in play.
  In first person the ring turns with his view (the page camera's heading).
  In the orbit it turns with his body or hull. On the free camera, or while
  the followed player is out of range, the ring is the camera.

The full (M) map surface takes the same marks when it is open, though in a
replay M opens the battle map instead.

## Tests

`tools/bf1942-models/tests/test_replay_minimap.py` (node harness
`replay_minimap_harness.mjs`) covers a small recording at one moment with
each camera, plus the Bocage round when it is on disk. That round shows both
sides at 60, 120, 240 and 400 s. A call takes 0.4 ms at the median over 40
moments. The test bounds the median at one 60 fps frame, not the worst call:
an 8 ms bound on the worst call failed under load (load average 25). The
page caches the marks per clock, camera and built-hull count, so the map's
repaint key costs one call a frame.
