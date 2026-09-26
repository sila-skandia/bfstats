# No third person on foot

2026-09-26. F11 and C were changing the owner's view while he walked. F11 is
`c_PICameraMode3` (CHASE FRONT) and C is `c_PIToggleCameraMode`; both are bound
in every shipped control map, Infantry's included, so an accidental press took
him out of first person mid-stride. He asked for the soldier's external views
to go, keeping three cases: a vehicle seat, a mounted weapon, and an open
canopy.

## What was there

`features/vehicle-camera-toggle-sweep/README.md` (2026-09-23) added
`soldierExternalViews`, a page switch of its own, and `FOOT_VIEW_CYCLE` in
`soldier-camera.js`. With the switch on, which was its default, C on foot ran
inside, chase, front-chase the way it does from a seat. That file called it a
deliberate departure from CAM-1 rather than an engine reading, and it was:
`Objects/Soldiers/Common/Objects.con` writes `CVMChase 0`, `CVMFrontChase 0`
and `CVMFlyBy 0` on `SoldierCamera`, and `Camera::setViewMode` refuses a mode
whose `CVM*` byte is zero, so retail gives a standing soldier one view.

## What changed

On foot the cycle is `SOLDIER_VIEW_CYCLE`, which is `inside` alone, and it
widens only while a chute is open. `syncFootView()` is the whole of the rule.

| file | change |
|---|---|
| `viewer/soldier-camera.js` | `FOOT_VIEW_CYCLE` deleted; the header keeps the CAM-1 reading and records the withdrawal |
| `viewer/soldier-view.js` | `soldier3pOnFoot()` deleted, so `syncFootView()` sets `PARACHUTE_VIEW_CYCLE` or nothing |
| `viewer/server-settings.js` | `soldierExternalViews` and its `?foot3p=` spellings deleted; the two words from `ServerSettings.con` stay |
| `viewer/seat-camera.js` | the side panel no longer wires `#srv-soldier-views`, and a settings change no longer re-gates the foot view |
| `viewer/map.html` | the `server: soldier views` checkbox is gone, and `soldier3pOnFoot` and `serverSettings` leave their bags |
| `viewer/test-hooks-soldier.js` | `__footView().cycleOnFoot` is gone |
| `tests/soldier_camera_harness.mjs`, `tests/seat_view_harness.mjs` | the flag's fixtures go; both report the module's export list instead |

Deleting the key is what makes it stick. `readServerSettings` copies every
boolean it finds under `SERVER_SETTINGS_DEFAULTS`, and `ServerSettings.set`
writes all three keys whenever one of them changes, so a browser that had ever
touched the side panel holds `"soldierExternalViews": true` under
`bf42-server-settings`. A flipped default would have loaded the departure back
on over that entry. A key that is no longer read cannot.

## What is untouched

- A seat's cycle, from a vehicle and from a mounted weapon with no drivetrain.
  `seatViewModes` reads the seat Camera's own `CVM*` words and the server's
  `externalViews` and `allowNoseCam`.
- `PARACHUTE_VIEW_CYCLE`, the canopy's three views, which is the exception the
  owner named.
- `?no-soldier3p=1`, which puts the canopy's external views back behind a flag.

## Verified

Unit rung, from `tools/bf1942-models`:

- `python3 -m unittest tests.test_soldier_camera tests.test_seat_view` ran 30
  tests, OK. Both suites were rewritten around the removal: the module's export
  list is asserted to carry no `FOOT_VIEW_CYCLE`, and the three reads that used
  to answer `soldierExternalViews` (the defaults, `?foot3p=1`, and a stored
  `"soldierExternalViews": true`) now come back with the two shipped words.
- The full suite (`python3 -m unittest discover -s tests`) and
  `./scripts/verify.sh --skip-e2e` were run after the change.

Live rung, `map.html?shots=1&map=wake&dev=1`, served from
`tools/bf1942-models/viewer`, one page load:

- the page boots to a 557 px stage with `window.__errs` empty.
- `#srv-soldier-views` is absent; `#srv-external-views` and `#srv-nose-cam` are
  present and checked.
- on foot at `Landing_Beach`, F9, F10, F11, F12 and C each leave
  `__footView()` at `inside` with `modes: ["inside"]`, pressed twice over.
- the dispatch reaches the router on the same page: Tab opens and closes the
  score board, and under an open canopy F11 gives `front`, F10 gives `chase`,
  and C walks inside, chase, front.
- `AA_Allies` (`rootKind: "gun"`, no drivetrain) reaches cockpit, chase, front
  and fly-by.
- `Corsair` reaches cockpit, nose, chase, front and fly-by.

One error was on the page and is not this change's: opening the score board
raises `TypeError: Cannot read properties of undefined (reading 'get')` in
`bitmap-text.js:14` `tintedAtlas`, from `scoreboard-screen.js:138` `drawText`.
`font.tinted` is undefined for the face the board draws. Both files are
unmodified in the tree, and it reproduces with none of this change's keys
touched.

## Open

- The `tintedAtlas` TypeError above, on the score board's own paint path.
- A seat's cycle was read on the live page for one gun and one aircraft. The
  passenger and hull-gunner seats share `seatViewModes`, so those two are the
  same code as the four and five modes above.
