# Round replay: manual checks

The game folder now has the v4 recorder: `dsound.dll` is bf42plus `4fc0352`
(pushed to `sila-skandia/bf42plus` master). The build it replaced is
`dsound_old.dll` in the same folder. To go back to it:

```bash
cp ~/.wine/drive_c/EA\ Games/Battlefield\ 1942/dsound_old.dll ~/.wine/drive_c/EA\ Games/Battlefield\ 1942/dsound.dll
```

Hard-refresh the viewer (Ctrl+Shift+R) before each check: the browser keeps
the old modules otherwise.

## 1. The round you recorded (v3, no game needed)

<http://localhost:5273/map.html?replay=replays/20260927-000617-wake-coop/replay_20260927-001120.ndjson&serverlog=replays/20260927-000617-wake-coop/ev_14568-20260927_0006.xml&mode=CoOp>

| check | expected |
|---|---|
| you, from the start | Marine uniform and the BAR, not a bazooka |
| the bots | each in his own kit: AT with a bazooka, scouts with a scoped rifle, and so on |
| the Aichi Val in flight (1:42) | propeller disc turning, gear up, its engine note while the camera is near |
| landing craft | a crewed Daihatsu sounds its engine wherever it is, not only by the destroyer. Five hulls sound at once at most, the same limit as in play |
| Shermans and M3A1 half-tracks | wheels and tracks turn while they move |
| your shots | flash and tracer from the weapon you held; the Defgun's rounds leave its barrel |
| damage | smoke and fire on a damaged hull, the explosion and the wreck when one dies |
| a death | the body falls and stays; the kit lies where he died |
| seeking | drag the bar back and forth: all of the above comes back |

A v3 file cannot show the rest, so these are not bugs here: other players'
shots (v3 has only yours), turrets turning (they sit at rest), crouch, prone
and weapon switches. A plane's control surfaces and every engine's throttle
are estimated from how the hull moves.

## 2. A round with the v4 recorder

1. Record a lab round as usual (the bf1942-server-lab skill), joining in the
   90 s pregame.
2. Do each of these once, and note the round clock:
   - fire your rifle, switch to the pistol and fire it, throw a grenade;
   - crouch, then go prone;
   - man a tank or an AA gun, turn it and fire;
   - fly a plane: take off, turn, land if you can;
   - ride a landing craft.
3. `python3 lab/lab.py stop`, and open the URL it prints.

The file should say so itself:

```bash
f=$(ls -t ~/.wine/drive_c/EA\ Games/Battlefield\ 1942/replays/replay_*.ndjson | head -1); head -c 100 "$f"; echo; grep -o '"k":"[a-z]*"' "$f" | sort | uniq -c
```

The header reads `"v":4,"plus":"99.0.0-0-g4fc0352"`, and the counts include
`f` (every round fired: thousands, with 30 bots), `jn` and `j` (turrets), `g`
(engines), `st` and `anim` (soldiers). If `f`, `j`, `g` or `st` is missing,
the recorder turned that part off on purpose: `logs/bf42plus_debug.log` in
the game folder says why, on a line starting `replay:`.

In the viewer:

| check | expected |
|---|---|
| bots shooting | flashes and tracers from bots' weapons, each shot's sound at the shooter |
| the event feed | "fired the ..." rows from every player, not only you |
| your pistol, your grenade | the pistol in your hand while you held it; the grenade in flight, then its explosion |
| crouch, prone | your body in that stance |
| the turret | turns as you turned it; the rounds leave along the barrel |
| the plane | the engine note follows the throttle you used |

## 3. If the new DLL misbehaves

- The game crashes on joining or at the first shot: put `dsound_old.dll`
  back (above), and keep `logs/bf42plus_debug.log` and anything in
  `logs/crash/` from the game folder.
- Stutter while recording: the v4 sampler reads every hull and soldier ten
  times a second. Note when it happens.

For anything wrong in a replay, the useful report is the replay clock, the
label of what is wrong, and what you expected instead.
