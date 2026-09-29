# Round replay: riding out what it is handed

Reported 2026-09-29: "My game play recorder is crashing quite frequently, it
just freezes and I can't quit it ... if I'm zooking around the map and choose
to go FPOV on a particular player it often hangs there." Asked for: a round of
error handling so that errors and unexpected data are ridden out, not crashed
on.

## What freezes the page and keeps it frozen

Not reproduced from the recordings on this PC. A sweep of all seven in
headless Chromium (every player followed in first person at 4x playback, the
page's own frame stepped and each frame timed, a stuck page paused through the
DevTools protocol for its stack) ran about 28,000 first-person frames with no
throw, no hang and no frame over 140 ms. Two live sessions (the page's own
loop, audio running, real clicks on name tags and board rows, key presses,
drags) found nothing either.

What was reproduced is the mechanism that fits the report. One camera pose
that is not all numbers:

- froze the picture: the page's audio throws on a non-finite value
  (`AudioParam.setTargetAtTime`, from `engine-audio.js` handed a listener at
  no position), before the render, every frame, until the loop's "Render loop
  error" card came up;
- could not be left: leaving first person read the orbit's heading off that
  pose (`setMode`), and the free camera took its place from it, so the orbit's
  eased yaw and the free camera's position stayed at no position for good,
  through every change of mode and of player. Only a reload got out.

`~/.cache/replay-resilience/nan-probe.cjs` shows it: one NaN quaternion, then
orbit, free, another player, first person, all frozen behind the card before
this change, all drawing after it.

A second, plainer "hang": first person on a player out of the recording's
range holds his last known pose while the round plays on, and the bar and card
(the only place that says "out of range") slid away after 2.8 s.

## What changed

- **The camera** (`replay-camera.js`) never draws or keeps a pose that is not
  all numbers. Each frame starts by putting any such state back (the orbit's
  angles and zoom, the free camera's place and look, the look-around, the
  glide). First person that throws or comes out as no position hands that
  frame to the orbit, with no HUD and no hidden body, and comes back when his
  eyes do. Any mode that still comes out as no position holds the last good
  pose. A drag or wheel of no number moves nothing.
- **The replay's frame** (`replay.js`, `replay-guard.js`) runs each stage
  through a guard: a throw is a console warning (once per message) and the
  stage's stand-in, and every later stage still runs. The clock always moves
  on (a stage that threw used to leave it behind). A hull that throws, or is
  placed at no position, is hidden with its sound let go; after three frames
  in a row it is left out until the next seek. Soldiers are placed one by one
  (`replay-bodies.js`), so one bad record no longer stops everyone after him.
  The controller's entry points the page calls cannot throw into the page.
  Loading builds each hull, fallback soldier and dropped kit on its own, so
  one model that cannot be built is a warning and one thing left out, not a
  replay stuck half loaded.
- **The recording** (`replay-recording.js`): a record that is not what its
  kind says is left out, not the whole file with it; a time outside 0 to 12
  hours is left out (one garbled time would stretch the round, and the ticket
  estimate walks the round in 0.1 s steps); samples, parts, spawn points,
  hit points, engines, aims, round directions and clocks that are not numbers
  are left out; out-of-order lists are sorted before anything searches them.
  The count is `rec.skipped`, and the status line says "N damaged records
  left out". Every recording on this PC parses with 0 skipped.
- **The page** (`map.html` `frame`): the world, the replay, the render, the
  HUD and the shell each run whatever the one before threw, so a throw in the
  world's presentation no longer leaves the last picture up with no Escape
  menu. The first throw is still the loop's to report.
- **Audio**: `engine-audio.js` writes no value that is not a number, and a
  voice at no position keeps its last distance; `page-audio.js` plays no
  one-shot at no position.
- **Input** (`replay-ui.js`): every button, menu item, board row, name tag,
  log line and pointer handler runs quietly; a lift that throws still ends
  the drag. A key whose action throws is still the replay's, and Escape then
  goes on to the page's own menu. The bar's parts update independently.
- **Out of range in first person**: the card stays up while the followed
  player's first person is out of range, as it does for a respawn countdown.

## Reading a fault next time

`replay.guard.report()` in the console lists every stage that has thrown, how
often, and its messages. The camera's own faults are console warnings
starting `replay camera:`. Both warn once per message.

## Tests

`tests/test_replay_resilience.py` (through `replay_resilience_harness.mjs`):
damaged lines, NaN poses through every camera mode, the frame's stages, a
hull that keeps throwing, a NaN step, clock and seek, an engine voice at no
position (which throws on the old `engine-audio.js`), Escape with the
replay's keys throwing, and `map.html`'s `frame` read out of the page and run
with each phase throwing in turn.

The stress tools are in `~/.cache/replay-resilience/`: `fpov-sweep.cjs`
(`--mode seek|play`, checks every frame for a non-finite camera),
`live-session.cjs` (real input), `nan-probe.cjs`.
