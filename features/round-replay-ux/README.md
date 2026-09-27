# Round replay: the viewing experience

A replay (`map.html?replay=...`, features/round-replay-capture and
features/round-replay-fidelity) plays a recorded BF1942 round back through the
map's own vehicles, soldiers, sounds and effects. The playback was right; the
way you watch it was not. The report, after watching one:

- the follow camera is rigid: no zooming out, no roaming around the player;
- the raw replay log is useful for seeing what the recorder captures, but the
  kills should read the way the game's own kill and chat log does;
- the slider needs Esc before the mouse reaches it (the view held the pointer
  lock), and the timeline has nothing on it: no chapters, no thumbnails.

This is the redesign: the patterns it takes from modern games' replay and
demo viewers, the controls, the layout, and what it leaves out.

## Status

Built (2026-09-27). The design below is what was built; "What was built" at
the end has the files, the decisions made on the way and what is still open.

## Patterns adopted

| Pattern | Taken from | Here |
|---|---|---|
| Orbit camera locked on a player, drag to orbit, wheel to zoom | Fortnite replay's third-person and drone-follow cameras, Rocket League's player camera, Overwatch's third-person spectating | The default camera. Always centred on the followed player, or on the hull he rides, or on his body after he dies (`focusLife`, kept). W/S zoom, A/D orbit, Q/E tilt, so the keyboard alone can roam around him. |
| Camera modes on number keys and one cycle key | CS2 spectating (jump cycles first person, third person, free roam), Fortnite's camera picker | 1 orbit, 2 first person, 3 free. C cycles: the game's own camera key. |
| First person through the player's eyes | CS2 / Valorant POV spectating | On foot: his recorded eye height by stance, heading and aim pitch (`st`). In a seat: the seat's own Camera node, the same eye the page's cockpit view uses. His own body is hidden so the camera is not inside his head. |
| Free camera, mouse look only while the right button is held | Unreal-style fly cameras, Fortnite's drone-free, Rocket League's fly cam | WASD, Q/E down/up, Shift fast. The pointer is locked only while the right button is down. |
| Timeline with event markers | Rocket League goal markers, Valorant and CS2 demo timelines (kills per round), YouTube chapters | Kills and deaths (the followed player's stand out), vehicles destroyed, flag captures, round start and end. Hover for a tooltip, click to jump just before the event. |
| Hover thumbnails | YouTube / Twitch storyboard previews | A small frame is grabbed from the 3D canvas as playback passes each chapter and every 5 s of recording time, never by re-rendering; hovering shows the frame nearest the time. The first pass through a stretch has none yet. |
| Transport keys | YouTube and every video player | Space, arrows for 5 s steps, `,` `.` for the previous/next marker (video editors' marker keys), `-` `=` for speed. |
| Player list is the scoreboard | BF1942's own Tab scoreboard (Axis left, Allied right), clickable like Overwatch and Valorant replay portraits | Tab opens it; click a name to follow. ↑ ↓ step through players without it. A player card over the timeline says whom you follow and what he is doing. |
| Kill feed and chat as the game draws them | The play page's own message log | `comms.js` / `chat-log.js`, the log the play page draws: `killer [weapon] victim` under the killer's flag, `[point] Axis captured the control point`, chat, the centre kill message when the followed player dies, and, in first person on the recording player, the game's red hit-direction wash. The raw replay log stays as a debug panel (L). |
| Name tags you can click | Spectator name tags (CS2, Fortnite) | Players near the camera carry their name (within 35 m, fading out by 60; since features/round-replay-highlights); clicking one follows him. |
| Chrome that gets out of the way | Netflix / YouTube idle fade; Overwatch, Fortnite and Rocket League hide-HUD keys | While playing, the bar fades after a few idle seconds (a thin progress line stays); H hides every panel for clean shots. |
| Shortcuts overlay | YouTube and GitHub's `?` | `?` lists every key. |

## Controls

Everything works with the mouse directly: no Esc, no pointer lock for the
timeline or any button.

| Action | Mouse | Keys |
|---|---|---|
| Play / pause | play button | Space |
| Back / forward 5 s | step buttons | ← / → (Shift: 15 s) |
| Previous / next event | marker buttons, click a marker | `,` / `.` (Shift: the followed player's only) |
| Seek | click or drag the timeline | Home / End |
| Speed (0.25x to 8x) | speed button | `-` / `=` |
| Orbit around the player | drag with either button | A / D, Q / E tilt |
| Zoom in / out | wheel | W / S |
| Reset the orbit | | R |
| Camera: orbit, first person, free | mode buttons | 1, 2, 3; C cycles |
| First person: look around, back to the orbit | drag (springs back), wheel out | 1 |
| Free camera: look | hold the right button (pointer locked while held), or drag | |
| Free camera: move | wheel moves along the view | W A S D, Q / E down / up, Shift fast |
| Follow previous / next player | arrows on the player card, click a name tag | ↑ / ↓ |
| Players (scoreboard) | Players button | Tab |
| Name tags (the players near the camera) | | N |
| Battle map, Auto camera, battle markers (features/round-replay-highlights) | Map, Auto buttons | M, 4, B |
| Replay log (debug) | Log button | L |
| Hide the interface | | H |
| Fullscreen | button | F |
| Shortcuts | ? button | ? |
| Close a panel | click outside | Esc; with nothing open, Esc is the game's menu as before |

The play page's own keys do nothing in a replay unless they are listed
above: WASD never reaches the soldier or the free-fly camera, Caps Lock and
Enter never open the spawn screen, M no map, F1..F8 no radio. The console
(`~`) still opens, and the Escape menu still comes up when no replay panel is
open, because that is how the game is left.

## Layout

```
+----------------------------------------------------------------+
| game message log (kills,               game minimap + tickets  |
|  flags, chat) - the page's own                                  |
|                                         [replay log, L: debug  |
|                                          panel under the map]  |
|                                                                 |
|                      (the action)                               |
|                                                                 |
|               [ < flag  Name   Sherman - driver  hp  > ]        |
| ==x=====|===x=====*==========|========x===================     |
| > << >> |< >|  2:33 / 4:39  round 2:28    [orbit|1P|free] 1x  Players Log ? [] |
+----------------------------------------------------------------+
```

- Top left and top right stay the game's: the message log where the game
  puts it, the minimap and ticket plate where the game puts them.
- Bottom: the replay bar, the timeline across its full width and one row of
  controls under it. It fades while playing and idle.
- Bottom centre, just above the bar: the player card.
- On demand: the scoreboard (Tab) and the shortcuts (?) as centred overlays,
  the replay log (L) docked on the right under the minimap.
- The site's nav bar goes, as it does in a match: the replay owns the screen.

The chrome takes its look from the game's own screens (the spawn screen and
the scoreboard): translucent dark plates, khaki heading strips, olive-edged
buttons with upper-case labels, and the message log's team colours (Axis
red, Allies blue).

## Left out, and why

- **An auto-director or kill cam** (the camera cutting to the action on its
  own): it needs a model of what is interesting; the chapters and the
  scoreboard get you there by hand. (Since built: the Auto camera,
  features/round-replay-highlights.)
- **A heading-locked chase camera for vehicles**: the orbit stays level and
  world-aligned so it never swings on its own; first person is the view
  locked to the vehicle.
- **The level's flags following the recording**: the page's own flags and
  minimap bar still show the round's opening ownership; the captures are in
  the message log and on the timeline. Driving the page's capture machinery
  from a recording is its own piece of work.
- **Scores**: the scoreboard shows kills and deaths, which the recording has;
  a score needs the game's score rules.
- **The game's own canvas scoreboard reused for Tab**: its rows are painted,
  not clickable. The DOM scoreboard copies its layout and colours instead.
- **Thumbnails for stretches not yet played**: that would take a re-render
  per thumbnail.
- **Reverse playback**: seeking is cheap; stepping back with ← does the job.

## What was built

### Files

| File | What it is |
|---|---|
| `viewer/replay-camera.js` | `ReplayCamera`: the orbit, first person and free camera, and `focusLife` (kept, with a `preferBody` flag the orbit's death cam uses). |
| `viewer/replay-chapters.js` | Pure: the chapters, the kill lines (a v3 file's missing weapons filled from the server log), each player's state and tally at a time, the roster, the message-log events, next and previous chapter. |
| `viewer/replay-feed.js` | `ReplayFeed`: writes the recording into the page's message log as playback crosses it, rebuilds it after a seek, and raises the hit wash. |
| `viewer/replay-timeline.js` | `ReplayTimeline`: the scrubber, the marks, the tooltip, the grabbed frames. |
| `viewer/replay-ui.js` | `ReplayUi`: the bar, the player card, the scoreboard, the name tags, the replay log, the shortcuts, the input layer and the key map. |
| `viewer/replay.js` | Wires them: `follow`, `feedRate`, `afterRender`, `tagTargets`, the first-person body hiding; the controller's `afterRender`, `feedRate`, `active`. |
| `viewer/replay-recording.js` | Additive: `rec.kills`, `rec.captures`, `rec.controlPoints`, `rec.roundStarted`, `player.leftT`; the flag rows now fire on a capture. |
| `viewer/replay-server-log.js` | Additive: each server row carries `pid`, `victim`, `weapon`, `vehicle`, `scoreType`, `winner`. |
| `viewer/comms.js` | Additive: `setRadioShown`, `chatLine`, `lexicon`, and `onCapture`'s optional list of points. |
| `viewer/map.html` | The replay's context (the message log, the flag sprites, the hit wash, the keyboard owners, the pointer release), the post-render hook, the message log's clock, the gamepad gate, the nav bar hidden for `?replay=`. |

### Decisions made on the way

- **The in-game feed is `comms.js`.** `hud-feed.js` is the HUD painter and
  its sprite pack; the kill, flag and chat log a player sees is `comms.js`
  over `chat-log.js`. The replay writes into that one (`onKill`,
  `onCapture`, `chatLine`), so the lines are the game's own: the lexicon's
  weapon names (`[Bar 1918]`, `[Panzerschreck]`), the flags, the team
  colours, the five-second expiry per section, the centre message when the
  followed player dies. The flag sprites for the card and the scoreboard come
  from `hud-feed.js`'s pack.
- **The log runs on the recording's clock.** The page ticks it at
  `dt x feedRate()`: the replay's speed while it plays, nothing while it is
  paused or dragged, 1 with no replay open. A seek clears it and replays the
  last minute's lines with the timers stepped between them, so the log shows
  what it showed at that instant.
- **Captures were missed.** A point is taken through neutral (2, then 0 as
  the flag comes down, then 1), and the parser only noticed a direct 2-to-1
  change, which neither test recording has. Their captures now show: Landing
  Beach and South Base to Axis at 195.5 s and 236.5 s in
  `replay_20260927-075756`, Landing Beach to the Allies at 43.5 s in
  `replay_20260927-001120`.
- **The hit wash.** `rec.hitsTaken` (HitFromPosEvent 0x3C) exists only for
  the recording player. In his own first person each hit raises the HUD's own
  `HitFromDir` wash and arc (`soldier-hud.js` `triggerHitIndicator`), octant
  = sector + 1, alpha = strength / 255 held at 0.75. Which side sectors 1-3
  are is not confirmed: they are drawn clockwise from ahead (1 front-right, 2
  right), the HUD's own order. If the recorder's sectors turn out to count
  the other way, it is `(8 - sector) % 8 + 1` in `replay-feed.js`.
- **First person in a seat** is the seat's Camera node, the cockpit view's
  eye. For the root seat of a hull with a drive, the vehicle's own
  `<Template>.cockpit.glb` is grafted through its drive (`loadCockpit`, the
  flown vehicle's path) the first time anyone looks out of it, so a pilot's
  view is the SBD's own cockpit. Gunners look out of their seat on the
  outside model; their guns turn only in a v5 recording (v4's parts are not
  usable).
- **Name tags in first person** are his own side only, as the game's friend
  tags are; the orbit and the free camera tag everyone near.
- **The server log's rings on the level** are drawn only while the replay log
  is open: they are debug overlay, and the default view stays clean.
- **The page's input.** The replay's input layer sits over the 3D canvas, so
  the page's click-to-fly never sees a click; a click made while the level
  was still loading has its pointer lock released when the replay opens. The
  replay's keys are read on the window's capture phase and never reach the
  page's own handler. The gamepad is not polled during a replay (its buttons
  would open the spawn screen and the score board). The free camera asks for
  the pointer lock on its own layer while the right button is held, so the
  page's lock handler ignores it.
- **The site bar** goes from the loading screen on for a `?replay=` URL, as
  for a match; a recording dropped onto a flythrough takes it down when it
  opens.
- **Frames for the timeline** are grabbed with `createImageBitmap` on the
  WebGL canvas right after the frame renders (`map.html` `draw`), when
  playback passes a chapter (0.35 s after it) and once per storyboard slot
  (5 s, or duration / 120 for long rounds), 176 px wide. Nothing is
  re-rendered for them.
- **The camera is placed before the bodies are drawn** (the 2026-09-27
  report: the followed player vanished at some angles and came back as the
  orbit went round). The bots' renderer culls each body against the camera
  as it stands when it draws him. The replay drew its bodies first and placed
  the camera last, and before the replay ran at all the page's free camera
  had re-aimed it down -Z (`applyLook`; the effect listener's ear read
  baked it into the camera's matrices). Every body was culled from the half
  of the orbit facing +Z: 9 of 16 angles round skandia at 138 s in
  `replay_20260927-075756`. `ReplayPlayer.update` now places the camera
  after the hulls and before the soldiers, and `frameCameras` skips the free
  camera while a replay is open. The second change also turns the audio
  listener's facing with the view.

### Verification

- `tests/replay_harness.mjs` (`ReplayUxTests` in `tests/test_replay_models.py`):
  the kill lines and the team-kill merge, captures through neutral, the
  chapters and their words, next and previous, player states and tallies,
  the message log driven, rebuilt and washed (the page's log stood in), and
  the camera's three modes (distances, keys, wheel, the eye and lens, the
  free camera's travel, the dead player's first person), and the followed
  body drawn from all 16 angles of the orbit through `ReplayPlayer.update`
  and the bots' own cull (9 of 16 culled before the fix).
- Headless Chromium on both test recordings through `page.mouse` and
  `page.keyboard`: Caps Lock, Enter and M open nothing; Tab opens the
  replay's board and not the page's; Escape closes a panel, then opens the
  game menu; a drag orbits without a pointer lock; the timeline seeks on a
  click and scrubs on a drag; its tooltip shows a grabbed frame (not black);
  `,` and `.` step chapters; `=` and `-` step speed; the chrome fades while
  playing idle and returns on a move; the hit wash fires in first person at
  275.2 s; the v3 recording's kill lines carry the server's weapons (the
  recording player's `[Defgun]` kills at 145.7 s); a 390 px wide view wraps
  the bar; and `map.html?map=wake` without a replay has none of this, with
  no errors.

### Open

- The free camera's pointer lock while the right button is held is checked
  in code only: headless Chromium never grants a lock (the drag falls back to
  pointer deltas, which is what ran).
- Neither test recording has chat: the chat path is covered by the harness
  with the page's log stood in, not yet by a real round.
- The soldier's torso twist (`st`) is not applied to the first-person
  heading; only the recorded heading and the aim pitch (x 2.5) are.
- (Since done, `replay-round.js`: the level's flags, the minimap's markers
  and flag bar, and the game's ticket counter follow the recording; see
  `features/round-replay-fidelity`.)
- Touch (one finger orbits, two pinch) was laid out at phone width but not
  driven on a device.
