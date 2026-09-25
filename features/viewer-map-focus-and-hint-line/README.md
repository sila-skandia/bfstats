# The map overlay's capture, and the bottom line's retirement

Two viewer changes, reported together.

## 1. Closing the map left the player's inputs dead

Symptom: `M` opened the full-screen map, and closing it left the keyboard and
the mouse dead until the stage was clicked again. Flying and on foot both, which
is what said it was not a seat's problem.

The cause: opening the map released the pointer, and every channel the world
reads is gated on the capture (`controls.js` `axis`/`held` reads `page.captured
? page.keys : null`). Nothing on any close path took it back. The release itself
is wanted and stays, because a held key must not fly the plane under the
overlay. What was missing was the other half of the loan.

Two open paths, so two fixes.

- The plain map, which is a seat's map key and the free camera's
  (`page-input.js` `mapKey` falls through to `toggleFullMap`). `map-surfaces.js`
  now records whether the open took the capture (`mapTookCapture`) and hands it
  back on close. Only what the open took is returned, so a map opened from the
  flythrough, with nothing captured, still closes to a free cursor.
- On foot the map key opens the deploy screen (`page-input.js` `mapKey` calls
  `openDeploy()`), which is the same overlay wearing its spawn chrome. Its way
  out with a living soldier is `spawning.js` `cancelDeploy`'s rejoin branch, and
  that branch resumed the life and returned with nothing captured. It now takes
  the capture, the same currency the spawn and the free-roam leave already pay
  with. `deploySpawn` and `enterFreeCam` were never the bug.

Verification runs through two hooks added to `?shots`: `__captured()` reads the
flag itself, and `__frameInput()` reads the word the page handed the world this
frame, which a wall or a bot cannot fake the way a walk distance can. The tab
used for it was hidden, so the frame loop was stepped by hand with
`__renderOnce`. Timers there are throttled to a second, so the steps are
synchronous.

On foot, after a spawn from the flag screen:

| | captured | input word | gait | moved |
|---|---|---|---|---|
| before the map | true | `forward: 1` | run | 3.39 m |
| map open | false | | | |
| map closed | true | | | |
| after the map | true | `forward: 1` | run | 7.41 m |

No click, and no error on the page. The free camera's own round trip measures
the same way: 94.4 m before, 96.7 m after.

## 2. The bottom line is gone

The `#hud` line across the bottom of the stage carried two things. It carried
the key list for the current mode, and it carried every transient message the
page had to say. Both were left over from the first build. "Press E to enter the
Kubelwagen" is not something a player reads twice, and the control profiles are
their own reference now: Esc then Controls names the keys per profile, and those
tests still pass.

Removed with it:

- the per-mode key templates (`HUD_FLY`, `HUD_FOOT`, `HUD_PILOT`, `HUD_DRIVE`,
  `HUD_MANNED`, `HUD_TOUCH`, `getTouchHudText`), the templates' `hintText`
  substitution into the line, and the writers `updateHud`, `showHint`,
  `flashHud`, `showView`;
- the messages: the view blurb, `CAPTURING`/`CONTESTED`/`NEUTRALISING`, the
  spawn announcement, `killed in action`, and the `E - enter the ...` prompt;
- the capture banner's state machine, whose only reader was the line:
  `updateCaptureHud`, `captureStateFor`, `captureHudText`, `roomCapture*`,
  `localCapture`, `resetCaptureUi`, `otherSideInside`, and net-room's
  `roomCapture*` calls on the capture rows (their comms line and their console
  log stay);
- the `#hud` CSS, and the `hud` bag member each module read it through.

What did not go:

- `#hud-canvas` and `hudFeed.gameHud` (`hud.js`), which draw the engine's own
  panels from the game's `hud-layout.json`, not from any hint text;
- `controls.hintText`, which the profile tests read a profile's key for a
  trigger through (`tests/controls_menu_harness.mjs`,
  `tests/mouse_look_key_harness.mjs`);
- the touch control pad's own labels (`.action-hint`, `.speed-hint`), which are
  the mobile UI's buttons naming themselves.

The flag-status disc beneath the minimap is unaffected. `ticket-feed.js`
`feedFlagIconVars` answers its one question, whether the player stands in a
neutral point's radius, from `nearestEnemyFlag` over the same `flags` the
capture law reads.

## Files

- `viewer/map-surfaces.js`: `mapTookCapture`, and the borrow-and-return
  `toggleFullMap`.
- `viewer/spawning.js`: `cancelDeploy`'s rejoin branch captures.
- `viewer/page-input.js`: `HUD_FOOT` gone, the kblock fullscreen label gone.
- `viewer/capture.js`: the banner state machine gone.
- `viewer/hud-feed.js`, `local-player.js`, `vehicle-entry.js`, `vehicle-wrecks.js`,
  `seat-camera.js`, `page-console.js`, `net-room.js`, `soldier-hud.js`,
  `ticket-feed.js`, `free-camera.js`, `test-hooks*.js`: the line's writers and
  readers.
- `viewer/map.css`: the `#hud` rules.
- `viewer/map.html`: the element, its bindings, and the bag members.
- `viewer/test-hooks.js`: `__captured()` and `__frameInput()`.
- `tests/control_point_harness.mjs`, `tests/test_control_point_law.py`: the
  `captureStateFor` cases went with the function, and the control point law's
  own cases are untouched.
