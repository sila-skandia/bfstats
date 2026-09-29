# Round replay: the creator view

The round replay (`map.html?replay=...`, features/round-replay-ux) plays a
recorded round back the way the game drew it. Content creators want more: to
capture moments and direct the scene. The 2026-09-29 request:

- follow bullets as they fire at players, chase bazooka shots;
- isolate part of the timeline and make their own shot or camera angle;
- a separate view of the recording, for creators, behind the admin role for
  now; flexible but smart: pause, click a player to follow him, click
  anything major happening on screen;
- click a player and get his highlights: each kill streak, his longest
  shots by distance, anything else worth slicing the round by, each one a
  click away, starting 2-3 s before the moment.

## Status

Built (2026-09-29). The design below is what was built; "What was built"
at the end has the files, the decisions made on the way and what is open.

## Who gets it

A CREATOR button on the replay bar (key V), shown to an account whose
token carries the Admin role (recordings-api.js `isAdmin`), and on a page
served from this PC, where the viewer is tested and there is usually no API
to sign in to. Nothing is hidden from anyone else's view of the round: the
recording is already in their browser. The gate is one function
(`creatorAccess`), so a creator role later is one line.

## Patterns adopted

| Pattern | Taken from | Here |
|---|---|---|
| Click anything to follow it | CS2 and Fortnite spectating, Rocket League's replay | In the creator view the 3D view is pickable: hover shows what is under the pointer (a soldier, a vehicle, a round in flight) with a ring and a label; a click follows the man, the crew of the vehicle, or chases the round. Double-click: his eyes. Works paused. |
| Bullet cam | Sniper Elite's kill cam | The camera rides behind a round from muzzle to impact in slow motion, set by the round's own speed so every round crosses the screen at about the same pace; it holds on the impact while the victim falls, then follows the victim. From a kill in the dossier it starts over the shooter's shoulder before the trigger is pulled: the replay knows which round killed. |
| Player highlights | Valorant and CoD match summaries, Halo's carnage report | The Player tab: his tally, his streaks, his longest shots by distance, multi-kills, vehicles destroyed, deaths (and his nemesis), kills by weapon. Every row jumps there with a lead-in (2, 3 or 5 s); its buttons set a clip or start the bullet cam (a death's rides the round that killed him, from his killer). Ride all plays a section's bullet cams back to back. The tab stays on the man you picked while the bullet cam takes the view to his victims. |
| In and out points, loop | Every video editor (I, O) | I and O mark a range on the timeline; P plays it, looping if asked. Clips are saved per recording in the browser. |
| Dolly camera keyframes | Rocket League and CoD Theater camera paths, Unreal Sequencer | K keeps the current view as a key at the playhead; the Track camera flies a smooth path through the keys, time for time. |
| Lens and framing | Photo modes (Forza, Gran Turismo), Fortnite replay lens | Field of view, a dutch roll, letterbox guides (2.39:1, 1.85:1, 9:16 for vertical video), a rule-of-thirds grid. |
| Record a clip | OBS, in the page | The range recorded to a video file from the 3D canvas alone (no chrome), with the game's sound, cropped to the frame guide when one is set: 9:16 records a vertical clip. |

## Controls (creator view)

| Action | Mouse | Keys |
|---|---|---|
| Creator view on / off | CREATOR button | V |
| Follow a man, a vehicle's crew, chase a round | click it in the view | |
| His eyes | double-click him | |
| Chase the followed player's next round | Next round | 5 |
| Stop a chase or the track | the plate's Stop, any camera button | X, Esc, 1-4, C |
| In / out point, play the range | Clips tab | I, O, P |
| Keep the view as a camera key | Camera tab | K |
| Swing round a chased round (paused too) | drag, wheel | |

## How the round cam finds its round

A kill names its killer and his weapon; the recording has every round
fired (v4 and later) with its muzzle and direction. The killing round is
his round before the kill that points at the victim, 0.3 m over his
origin: for guns fired 0-0.4 s before the kill and within a few degrees
(snipers 0.1-0.4 degrees at 340 m), grenades the throw nearest the 3 s
fuse (a man's second grenade is often in the air when his first kills),
bombs 0.4-8 s after release; a vehicle's kill names the vehicle and its
rounds the gun, so a gun named after the vehicle matches. 115 of the 159
kills of the Bocage round `replay_20260928-133433` have one, 545 of the 723
of the 45-minute `replay_20260928-161948`; mines and packs have none
(replay-dossier.js `killingRound`). A soldier the recording has just taken
back into range is not placed for 0.25 s: its first sample is where he got
into a vehicle, 26 to 740 m off in 42 of 105 cases.

The chased round is the page's own: the one `fireShot` sent through the
page's guns, found by its muzzle and direction as it appears, so the bullet
flies where the drawn round does. A round known to have killed is chased to
the man it killed ("Decisions" below).

## Left out, and why

- **Depth of field**: the page renders without post-processing; a blur
  pass would change the draw for everyone.
- **Frame-perfect export**: the recorder captures the canvas as it
  plays, so a slow machine records a choppy clip. Stepping the page's own
  frame at a fixed rate would fix it; the page has that only under `?shots`.

## What was built

### Files

| File | What it is |
|---|---|
| `viewer/replay-creator.js` | `ReplayCreator`: the gate (`creatorAccess`), the bar button, the keys, picking and what a click does, jumps to moments, the range, clips and their recording, the camera keys, the lens and the frame guides, the plate over the view. |
| `viewer/replay-creator-panel.js` | The panel's three tabs (Player, Camera, Clips) and the creator view's look. |
| `viewer/replay-roundcam.js` | `RoundCam`: arming a recorded shot, finding its round as the page fires it (`claim`), the chase, bullet time, the hold on the hit; `thrownLifeOf` for a grenade the recording carries. |
| `viewer/replay-dossier.js` | Pure: every kill's round and distance (`killFactsOf`, `killingRound`), a player's round sliced (`dossierOf`). |
| `viewer/replay-camtrack.js` | Pure: camera keys and the time-knotted Catmull-Rom path through them; `TrackRig`. |
| `viewer/replay-pick.js` | Screen-space picking of soldiers, hulls and rounds; `shotOfRound` names a live round's shooter. |
| `viewer/replay-clip.js` | `ClipRecorder` (MediaRecorder over the canvas, the page's mix tapped), the file's name, the download. |
| `viewer/replay-camera.js` | Additive: `setRig` (a rig places the camera over the mode, and takes the drags it wants), `setLensHook` (field of view, roll and near plane over every view but his eyes, before the soldiers are culled). |
| `viewer/replay.js`, `replay-ui.js` | The creator's `lead`, `update` and `afterRender` in the frame; its keys first in the key map. |
| `viewer/recordings-api.js`, `replay-social.js` | `sharedRecordingsApi`: one API client per page, so the gate and the comments never refresh one sign-in cookie twice at once (the second refresh would revoke the session). |
| `viewer/map.html` | `audioTap`: the page's mix where it leaves for the speakers. |

### Decisions made on the way

- **The chase ends at the man the round killed**, not where the page's
  round lands. The page flies its own copy of each recorded round and
  tests it against the level and the drawn bodies, and a sniper's round
  that killed at 341 m (`replay_20260928-133433`, 41.99 s) flew 460 m on
  past the drawn victim. The recording's kill is the truth: a round known to
  have killed is chased to where its victim stood at the kill line. A round
  with no known end is chased until the page's round stops, 7 s of real time
  at most.
- **Bullet time is a flight time, not a speed.** The game's rifle rounds fly
  at 1,000 to 2,000 m/s, a bazooka's at 50. A known kill's round takes the
  preset's time to land (Strong: 2.5 s) however far it went; one with no
  known end crosses the screen at the preset's pace (Strong: 40 m/s).
- **The bullet is drawn by the creator view.** The game draws no rifle round
  (`invisible 1`) and its tracer is a 50 m streak that would run through the
  camera: the chased tracer is hidden and a jacketed round 2.2 times its
  size, turning on its rifling, is drawn in its place, chased from half a
  metre with a 0.1 m near plane (the page's is 0.5).
- **A round is found by its muzzle and heading, and by when it appeared.**
  An MG burst leaves rounds 50 ms apart on the same line; each round is
  stamped with the replay's clock when it is first seen, and the armed shot
  takes the one born with it.
- **The gate** is the Admin role in the sign-in token, or a page served from
  this PC. The recording is already in the viewer's browser, so this is
  where the feature shows, not what it protects.
- **The Player tab's man is the one the viewer picked** (a click, the
  players list, the card's arrows, the Auto camera), not the victim the
  bullet cam hands the view to; a Follow button takes the camera back to him.
  Following anyone by hand, or picking a camera, lets a chase or the track go.
- **A grenade is chased along the recording.** The server flies grenades and
  the recording carries each as an object (replay-props.js), so the page
  never fires one: the chase follows the object thrown within 1.5 s and 6 m
  of the throw.
- **Clips live in the browser**, per recording (its level, start and
  length), with the camera keys and the range. Preferences (lead-in, bullet
  time, after the hit, frame) are kept across recordings.

### Verification

- `tests/test_replay_creator.py` (`replay_creator_harness.mjs`): the track
  through three keys (at each key at its moment, the short way round a
  key from the other hemisphere, no kink), picking (a round before the man
  it flies past, ten pixels for a man a kilometre off, nothing behind the
  camera), the round cam against a recording written line by line (the
  shot's own round claimed over a burst's, bullet time from the victim's
  distance, the chase ending at the victim, the hold drawing back, the view
  handed to him, a seek and a round never drawn), a grenade found in the
  recording, clip names, and the gate (this PC and an Admin token yes,
  anonymous and a User token no).
- `tests/test_replay_dossier.py` (`replay_dossier_harness.mjs`, 35 cases):
  the killing round (a vehicle's gun by its name, a burst's right round,
  an old round at a better angle losing to age, a grenade by its fuse, no
  round for a mine, the frame's z), streaks and what ended them,
  multi-kills, longest shots, nemesis and prey, team kills and suicides
  kept out; and the two real rounds (115 of 159 kills with a round in under
  10 ms; SoldierHEad's 141 m No 4 on SwissChz first among his shots).
- Headless Chromium on the Bocage round (`replay_20260928-133433`):
  the button on localhost; hovering a soldier rings and names him, a click
  follows him; 5 on Jano armed his No4Sniper round 3 s ahead over his
  shoulder in the sawmill window, rode it 341 m and held on SoldierHEad as
  he fell (the game's own LONG SHOT callout came up), then followed him at
  1x; a paused bazooka rocket clicked in flight was chased, a drag swung
  the camera round it frozen, Space played it to the hit; three camera keys
  flew time for time; a 3 s range recorded to a 3 s MP4 (VP9 and Opus in
  Playwright's Chromium, H.264 where the browser has it) of the 3D view alone.
  On SoldierHEad's Player tab (11 kills, a streak of 9, 141 m): a streak
  jumped to 3 s before its first kill; his 141 m shot's bullet cam armed
  over his shoulder, rode the round and handed the view to SwissChz with
  the tab still on SoldierHEad; Ride all went through his seven shots.

### Open

- **`whereIs` places a man just back in range at a stale spot** (where he
  got into a vehicle) for up to 0.25 s. The dossier works round it; the
  medals do not, and award >>XenaWarrior<< a 459 m Long shot at 52.2 s of
  `replay_20260928-133433`. The fix belongs in replay-battles.js.
- A close kill (2-5 m) can credit an older round of a burst: the angle
  cannot tell them apart there. The distance moves by a few metres.
- Touch: a tap on the view picks, and also shows or hides the chrome.
