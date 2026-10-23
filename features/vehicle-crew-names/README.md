# Vehicle crew names

Status: built 2026-10-23. Local play, the sidecar page and replays feed the
HUD's crew list. Checked headless on El Alamein with a bot. Not yet seen in a
live sidecar round.

## What retail does

In a vehicle with other players, the HUD lists everyone aboard over the
vehicle icon, bottom left. The ledger has the evidence: VHUD-16 covers the
text, VHUD-17 the triggers, VHUD-18 the timeout and VHUD-19 the seat dots.

- **Text.** One row per seat, `(n) name`. `n` is the seat's place in the hull's
  seat map, which is the same number as its seat key. An empty seat leaves its
  row blank, and your own seat is listed too. The rows are drawn in
  `standard6` in `InGameVehiclePlayerStyle`, colour (0.84, 0.87, 0.78). They
  start at (201,502) on the 800x600 screen, 15 px apart, over
  `vehicle_position_256x128` at (196,496). The engine has seven rows and the
  layout draws six.
- **When it shows.** The list is rebuilt when you take a seat, when anyone
  else gets into or out of your hull, and when you press 1 to 6 while seated,
  whether that seat is free or taken. It comes up only when more than one
  seat is held, so it never shows when you are alone. Keys 7 to 9 do not
  raise it.
- **How long.** The list stays up 3.0 on the menu clock, which advances 1/30
  per painted frame (HFD-6). That makes 91 painted frames in float32: about
  1.5 s at 60 fps, 0.8 s at 110. There is no fade. A second trigger while it
  is up does not extend it, and getting out hides it at once.

## What the viewer does

- `tools/bf1942-models/viewer/vehicle-players.js` holds the engine's flag,
  the seven rows and the layout's timeout counter (`VehiclePlayersList`), plus
  a copy of the UI's `decodePlayerName`. A decoded name is drawn only when the
  `standard6` face has every glyph for it. The face is Latin only, as
  retail's is, so a Cyrillic name keeps its raw form, which is what retail
  shows.
- `vehicle-hud.js` `crewBySeat` reads who sits where once a frame: the local
  player, room and sidecar players (`remotePlayer(slot).seatIndex`, named by
  `nameOf(slot)`, so real players and server bots alike), and this page's own
  bots. A new hull or a new crew rebuilds the list, as the engine's enter and
  exit handlers do. `feedVehiclePlayers` runs from `paintHud`, once per
  painted frame.
- `local-player.js` `switchSeat` calls `vehiclePlayersKey` before the seat
  switch, including the sidecar path, where the switch itself is the
  server's.
- `replay-hud.js` feeds the same list for the followed player's seat from
  `crewOf` and `nameAt`. The recording has no key presses, so in a replay the
  list comes up on boarding and on crew changes only.

## How it was checked

- `tests/test_vehicle_players.py` runs the module under node through
  `vehicle_players_harness.mjs`. It checks the rows, the blank seats, the
  trigger rules, the 91-frame timeout, that a second trigger does not extend
  it, the leave-and-return counter, and the name decode. It also reads
  vanilla `menu/InGame`, where installed, for the culls, the 3.0 timeout and
  its two writes, and the six rows. Where the client binary is present, it
  checks the `"(%d) %s"` format string.
- Headless, on El Alamein with two bots and the page's own animation loop
  stopped:
  - In a Sherman alone, the rows read `(1) Player` and the list stays down.
  - When a bot takes the hull MG, the list shows `(1) Player`,
    `(2) <bot name>` for 91 stepped frames, then hides.
  - Key 2 brings it back, and getting out clears it.
  - The capture shows the rows over the vehicle icon.

## Open

- Not yet seen against the lab server in a shared vehicle. The sidecar path
  reads the same `seatIndex` and `vehicleId` the seat dots already use, plus
  `nameOf`.
- `0x006d7a00` refreshes only when the controlled object is not
  `player+0x98`. That field is read as the player's own soldier and has not
  been traced.
