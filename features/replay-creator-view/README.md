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

Built (2026-09-29), passed over for clipping on 2026-10-18 -- the bullet
cam goes for the round that kills, and a clip carries a camera move and slow
motion -- and simplified the same day: the timeline's handles drag, a kill
row records its short in one click, and the slow motion sets itself between
the keys. The design below is what was built; "What was built" has the files
and the decisions made on the way, "The 2026-10-18 pass" what the second
round changed, "Simpler clipping" the same day's third, "The move belongs to
the action" its fourth, and "Open" what is left.

## Who gets it

A CREATOR button on the replay bar (key V), shown to any signed-in account
(recordings-api.js `signedIn`, whatever its role), and on a page served from
this PC, where the viewer is tested and there is usually no API to sign in
to. Nothing is hidden from anyone else's view of the round: the recording is
already in their browser. It began behind the Admin role (2026-09-29) and was
opened to signed-in players on 2026-10-11. The gate is one function
(`creatorAccess`).

## Patterns adopted

| Pattern | Taken from | Here |
|---|---|---|
| Click anything to follow it | CS2 and Fortnite spectating, Rocket League's replay | In the creator view the 3D view is pickable: hover shows what is under the pointer (a soldier, a vehicle, a round in flight) with a ring and a label; a click follows the man, the crew of the vehicle, or chases the round. Double-click: his eyes. Works paused. |
| Bullet cam | Sniper Elite's kill cam | The camera rides behind a round from muzzle to impact in slow motion, set by the round's own speed so every round crosses the screen at about the same pace; it holds on the impact while the victim falls, then follows the victim. From a kill in the dossier it starts over the shooter's shoulder before the trigger is pulled: the replay knows which round killed. |
| Which round to ride | - | 5 takes the next round of his that kills, 6 the next rocket, shell, bomb or grenade, and a click into a burst takes the round of that burst that kills: most rounds of a burst hit nothing, so riding one at random shows nothing (the 2026-10-18 pass). |
| Player highlights | Valorant and CoD match summaries, Halo's carnage report | The Player tab: his tally, his streaks, his longest shots by distance, multi-kills, vehicles destroyed, deaths (and his nemesis), kills by weapon. Every row jumps there with a lead-in (2, 3 or 5 s); its buttons set a clip or start the bullet cam (a death's rides the round that killed him, from his killer). Ride all plays a section's bullet cams back to back. The tab stays on the man you picked while the bullet cam takes the view to his victims. |
| In and out points, loop | Every video editor (I, O) | I and O mark a clip on the timeline; P plays it, looping if asked. A clip is saved per recording in the browser with its camera move and its slow motion. |
| Dolly camera keyframes | Rocket League and CoD Theater camera paths, Unreal Sequencer | K keeps the current view as a key at the playhead; A and B keep it at the two ends of the action inside the clip, and the clip flies through its keys while it plays, time for time. |
| A speed ramp | Every editor's time remap | The clip runs at a half, a quarter or a tenth over all of it or a stretch of it, eased in and out, as it plays and as it records. |
| Lens and framing | Photo modes (Forza, Gran Turismo), Fortnite replay lens | Field of view, a dutch roll, letterbox guides (2.39:1, 1.85:1, 9:16 for vertical video), a rule-of-thirds grid. |
| Record a clip | OBS, in the page | The range recorded to a video file from the 3D canvas alone (no chrome), with the game's sound, cropped to the frame guide when one is set: 9:16 records a vertical clip. |

## Controls (creator view)

| Action | Mouse | Keys |
|---|---|---|
| Creator view on / off | CREATOR button | V |
| Follow a man, a vehicle's crew, chase a round | click it in the view | |
| His eyes | double-click him | |
| Ride his next round that kills | Kill shot | 5 |
| Ride his next round, whatever it hits | His next round | shift 5 |
| Ride the next rocket, shell, bomb or grenade | Rocket, shell or grenade | 6 |
| Stop a chase, the camera move, the clip | the plate's Stop, any camera button | X, Esc, 1-4, C |
| In / out point, play the clip | Clip tab | I, O, P |
| Trim the clip; move a camera key | drag its handle on the timeline | |
| Keep the view where the action starts, where it ends | Clip tab (A, B) | |
| Keep the view as a camera key | Clip tab (Key here) | K |
| Fit the camera move to the action | Clip tab | |
| Record a short of a kill: its bullet cam to a file | the record button on its row (Player tab) | |
| Record the ride on screen, from the clip's start | Record on the plate | |
| Slow between the clip's keys | Between A and B (Clip tab) | |
| Swing round a chased round (paused too) | drag, wheel | |

## How the round cam finds its round

A kill names its killer and his weapon; the recording has every round
fired (v4 and later) with its muzzle and direction. The killing round is
his round before the kill that points at the victim, 0.3 m over his
origin: for guns fired 0-0.4 s before the kill and within a few degrees
(snipers 0.1-0.4 degrees at 340 m), grenades the throw nearest the 3 s
fuse (a man's second grenade is often in the air when his first kills),
bombs 0.4-8 s after release; a vehicle's kill names the vehicle and its
rounds the gun, so a gun named after the vehicle matches. Within 2 m of him
counts too, whatever the angle: from 6 m a metre and a half of running is
14 degrees. 123 of the 159 kills of the Bocage round
`replay_20260928-133433` have one, 561 of the 723 of the 45-minute
`replay_20260928-161948`; mines and packs have none (replay-dossier.js
`killingRound`). A man just out of a vehicle is placed where the recording
next has him, not at his first sample, which is where he got in
(replay-recording.js `settledTime`).

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
| `viewer/replay-shot.js` | Pure: what a clip is besides its two ends -- the speed ramp (`rampSpeedAt`, eased in and out), the keys inside it, the action inside it and the move fitted to it (`actionOf`, `fitKeys`, `screenSeconds`), and which round is worth riding (`nextKillShot`, `killByFire`). |
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
- **The gate** is a signed-in account (any role), or a page served from
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
  recording, clip names, and the gate (this PC, an Admin token and a User
  token yes, anonymous no).
- `tests/test_replay_dossier.py` (`replay_dossier_harness.mjs`, 35 cases):
  the killing round (a vehicle's gun by its name, a burst's right round,
  an old round at a better angle losing to age, a grenade by its fuse, no
  round for a mine, the frame's z), streaks and what ended them,
  multi-kills, longest shots, nemesis and prey, team kills and suicides
  kept out; and the two real rounds (a round for 123 of 159 kills in under
  10 ms; SoldierHEad's 141 m No 4 on SwissChz first among his shots;
  RuppoPeaGame, shot 0.07 s out of his Kubelwagen, 6 m from the Sg44 and not
  the 459 m of where he got in).
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

### The 2026-10-18 pass

The owner, on the view as built: "Chase next round" would be nicer as a kill
round, so you get the death of the opponent; change camera between two frames
and slow it down in the same, so you can clip shorts; a machine gun has heaps
of bullets, so chasing one is not helpful, while a bazooka is just one round
and makes sense; make the whole thing more intuitive to clip with.

### Which round the camera rides

- **5 is the kill shot.** It takes the followed man's next round that killed
  somebody -- the dossier already knows which round made each kill -- sets up
  over his shoulder and ends on the man as he falls. With nothing left of his,
  it takes the round's next kill by anybody and says whose. A round further
  off than 8 s is jumped to with the lead-in rather than waited for.
- **Shift 5 is his very next round**, the old behaviour, for watching a man
  rather than a kill.
- **6 is the next round big enough to watch**: a rocket, a tank's shell, a
  bomb or a grenade, his else anybody's. One round a shot, slow in the air --
  what a bullet cam is for. A weapon is "heavy" when `guessSpeed` knows it by
  name (replay-roundcam.js `heavyRound`), which is the same table the chase
  already used to set its slow motion.
- **A click into a burst takes the round of the burst that kills.** Most
  rounds of a burst hit nothing, so riding one at random shows nothing: a
  round clicked that kills nobody is traded for its man's killing round, the
  one in the air now, else one he fires within 2.5 s, waited for over his
  shoulder.
  Off with one tick box (`snapKill`); a rocket or a shell is always ridden as
  clicked.
- **A killing round in flight is ringed in gold and labelled with the man it
  kills**, and is asked for ahead of the rounds around it under the pointer
  (replay-pick.js `bonus`). This only shows for rounds the game draws: a hand
  weapon's round is `invisible 1`, so a rifle's or a Thompson's is not
  pickable at all and the keys above are the way to it. A burst in the Bocage
  round is eleven rounds over a second (pid 28's Thompson at 45.55-46.55 s).

### The clip bench

The Clips tab became the **Clip** tab, second of the three, and holds the
whole shot in the order it is built: the two ends, the camera move across
them, the slow motion over it, the recording, and the clips kept.

- **A camera move between two frames.** A keeps the view on screen as the
  camera at the clip's start, B at its end (K still keeps one at the
  playhead); both moved onto the action inside the clip later the same day
  ("The move belongs to the action"). While the clip plays or records, the track flies its keys, time
  for time, and hands back at the out point. Keys outside the clip are shown
  as such and are not flown. A key keeps the field of view it was set with,
  so a push in is two keys.
- **Slow motion over the same stretch.** 1/2, 1/4 or 1/10 over the whole clip
  or a stretch of it (From here, To here), eased in and out over a third of a
  second of the recording so the cut does not jolt, drawn on the timeline
  inside the clip's band and said on the plate. It runs as the clip plays and
  as it records, so a recorded clip is slow in the file.
- **A clip is the whole shot.** Keeping one keeps its camera keys and its
  slow motion with it, the list marks them (`A-B`, `1/4`), and playing it
  back puts them on the bench again. Clips kept before this pass have
  neither, and loading one leaves the bench's camera alone.
- **Trimming by eye**: each end has its time (a click takes the playhead
  there) and a nudge of a tenth of a second either way.
- The tab opens on four numbered lines of what to do, and the Camera tab
  keeps what belongs to the lens and the bullet cam.

### Decisions made on the way

- **The ramp owns the clock only where it has something to say** -- inside
  its stretch, while the clip plays, and never while a chase runs, which owns
  the clock itself. It remembers the speed it took over at and gives it back;
  a speed picked by hand while it holds the clock becomes the clip's own.
- **The slow stretch lives inside the clip.** Ends kept from a clip marked
  elsewhere are clamped to the clip, and a clip re-marked so that nothing of
  the stretch is left goes back to slowing all of it.
- **The plate says SLOW** whenever the ramp holds the clock, started with P
  or not: a replay that slows down on its own is otherwise a mystery.
- **A round is credited to its own shot inside a burst.** Checked on the
  Bocage round: pid 28's eleven Thompson rounds from 45.55 s to 46.55 s each
  matched the fire record that left them (`shotOfRound`), so the killing one
  is found by name, not by guesswork.

### Verification

- `tests/test_replay_creator.py` gained `ShotTests` (the ramp's shape and its
  easing, the stretch clamped into the clip, a ramp read back broken, the
  keys inside a clip, the kill index, and the next killing round skipping the
  rest of a burst, a kill with no round and a team kill), the pick bonus, and
  `heavyRound` with the next heavy round. 40 tests pass.
- Headless Chromium on `replay_20260928-133433`: 5 on Jano armed his No4Sniper
  round at 41.99 s, rode it 341 m and handed the view to SoldierHEad (pid 21)
  as he fell; 6 on RuppoPeaGame armed his Bazooka at 224.06 s and rode it to
  the hit; a click on pid 28's Thompson round fired at 45.95 s, which killed
  nobody, armed the burst's killing round at 46.25 s and ended on pid 32.
  A clip from 1:40 to 1:46 with A and B at its ends and 1/4 slow motion flew
  the camera A to B while the clock eased 1 to 0.25 and back, looped at its
  out point, and at its end gave the clock and the camera back; kept, it
  carried its two keys and its quarter speed; recorded at a half over 110 to
  112 s it wrote `bocage-1m50s-1m52s.mp4`, 2.9 MB. No console errors, no 404s.

### Simpler clipping (2026-10-18, the same day's review)

The owner asked for a review against what people do with the view -- slow
down between key frames, create clips, produce videos -- and for the whole
thing to be simpler. The model held up; the journey did not: a kill to a
finished short took eight actions across two tabs, the timeline could not be
dragged, and the bullet cam could not be recorded in one action. This pass
closed those:

- **The timeline drags.** The clip's gold ends and the camera keys' diamonds
  drag, each hitting a little wider than it draws. The playhead stays put
  until the handle is dropped -- a seek rebuilds every body -- then goes to
  the dragged end. A click on a diamond still goes to its key; a press that
  moves less than the click slop is still a click. The slow stretch's edges
  were tried and taken out again: a clip is a few seconds of a round that
  runs minutes, so its band is ~17 px wide and anything on it sits under the
  clip's own handles -- the stretch keeps its buttons.
- **A kill row records its short in one click.** Every row that knows its
  round (longest shots, kills, a death seen from the killer) gained a record
  button beside the bullet cam's: the clip marked round the kill with the
  lead-in and the tail, the bullet cam armed on its round, the recorder
  started, the file downloaded at the out point. It works because an armed
  chase survives the recording's own seek back -- replay-roundcam.js `step`
  lets an armed shot through a jump to before its round -- so nothing of the
  recorder changed.
- **Record on the plate.** A ride armed by hand (5, 6, a click on a round)
  offers Record on the plate: the same shot armed again from the clip's
  start and written to a file.
- **Slow between the keys.** "Between A and B" on the Clip tab sets the slow
  stretch from the clip's first inside key to its last (replay-shot.js
  `rampBetweenKeys`); with the slow motion off it picks a quarter. The
  literal ask -- slow down between the key frames -- in one press.
- **A or B away from its point seeks there first** and says so, instead of
  stamping the view on screen at a moment it does not frame; the next press
  keeps the view. At the point it stamps as before.
- A clip put back on the bench says its keys took the bench's.

Verification: `rampBetweenKeys` joined the harness (first inside key to last,
nothing with one key or no clip; 41 tests). Headless Chromium on the Bocage
round: Between A and B set 101.5-104.5 s at 1/4 from keys kept there; A
pressed at 106 s with the in point at 100 s seeked to 100 s and kept nothing,
pressed again it kept the key; the in handle dragged 60 px moved the in point
to the out point's gap and the playhead followed on the drop; a key diamond
dragged from 100 s re-knotted the track at 117.3 s and a click on a diamond
still seeked; one click on Jano's 341 m kill row marked 38.99-44.65 s, armed
his No4 round through the recorder's own seek back and downloaded
`bocage-0m39s-0m45s.mp4` (23.9 MB); 5 at 220 s armed skandia's MG42 kill with
Record on the plate, and recordRide re-armed it from its lead-in and
downloaded `bocage-4m06s-4m11s.mp4`. No page errors; the only 404s are the
wreck-glb lookups a bare file server always shows.

### The move belongs to the action (2026-10-18, the same day's fourth)

The owner, on cutting a bazooka short: "I mark A as when they fire, B when the
tank is exploded. I set speed to 1/2 and set my key frames. The problem is the
bazooka fires, hits the target and it explodes, then we slowly pan the camera
between A and B. It feels like the action is not slowed to the speed of the
transition -- so you end up with the tank blowing up, then another 10 seconds
of the pan."

Measured, on the Bocage round's bazooka (RuppoPeaGame fires at 224.058 s, the
tank goes up at 224.958 s). A clip marked from its kill row runs 221.058 to
227.458 -- the 3 s lead-in and the 2.5 s tail -- because that is what a short
needs around the moment. A and B stamped the camera at **the clip's** two
ends, so the move was spread over 6.4 s of round while the thing worth
watching took 0.9 s of it. At a quarter over the clip the move took 8.9 s to
watch and the tank blew up 5.9 s in: **3 s of pan over nothing**, and a tenth
would have trebled it. Slow motion could not fix the ratio -- it slows the
action and the camera by the same factor, so it only made the wait longer.

The clip now knows **the action** inside its ends, and the move and the slow
motion go there:

- **`actionOf`** (replay-shot.js): the round leaving the barrel to
  `ACTION_SETTLE` (0.4 s) past what it hit, never shorter than `ACTION_MIN`
  (1 s), held inside the clip. The bazooka's is 224.058-225.358, 1.3 s; a
  sniper's round kills 0.16 s after the trigger, which is a cut rather than a
  move, so his is grown to a second. The settle is the camera landing on the
  wreck or the body rather than dead on the flash.
- **`clipAround` keeps it** and puts the slow stretch on it, so the lead-in
  and the tail run at speed and the viewer waits only over the action. Kept
  with the clip, and carried in the browser's storage.
- **A and B stamp there, not at the clip's ends** (`keyAtPoint`, over
  `creator.beat`). The move is then 1.3 s of round, 3.8 s on screen at a
  quarter, ending with the wreck; the camera holds A's framing through the
  lead-in and B's through the tail, which is what the padding is for.
- **A clip with no action of its own derives one** from the single killing
  round inside it (`actionInside`), so a clip marked by hand round a kill, or
  one kept before this pass, behaves the same. A clip with several kills in it
  is a stretch of the round, not one shot, and keeps the whole clip as its
  action.
- **Fit to the action** (Clip tab) slides and scales the keys already there so
  the first lands where the action starts and the last where it ends
  (`fitKeys`), the ones between keeping their places proportionally. One press
  for a move built the old way.
- **The panel says what the move costs**: "2 keys, 1.3 s of the round, 3.8 s
  on screen", and where a move still spans the lead-in and the tail, how much
  of it does and what to press. `screenSeconds` integrates the clock over the
  ramp, so that number is the seconds the viewer actually waits -- the figure
  that was missing.

One trap found on the way, and closed: **A and B now stop the replay** when
they seek to their point. The playhead drifts past `POINT_SLOP` (0.3 s) in a
third of a second of playing, so with the clip running the second press only
ever seeked again and no key was ever kept. The clip's own camera move lets go
of the view at the same time, or there is nothing to frame by hand.

### Verification

- The harness gained `ActionTests` (the action's two ends, a sniper's grown, a
  moment's, held inside the clip, the fit with two and three keys and a key
  outside it, a move already fitted left alone, and the report's own numbers --
  8.89 s to watch with the tank up at 5.90 s, against 3.79 s fitted). 49 tests
  pass.
- Headless Chromium on `replay_20260928-133433`, the owner's own shot. The
  bazooka clipped from its kill row: the clip 221.058-227.458, the action
  224.058-225.358, the slow stretch set to the action. A pressed while the
  replay ran stopped it at 224.058 -- the action's start, not the clip's
  221.058 -- and the second press kept the key there; B the same at 225.358.
  Played at a half, sampled every frame against the camera's progress along
  A to B:

  | wall | clock | speed | along the move | |
  |---|---|---|---|---|
  | 0.0-2.9 s | 221.1-224.0 | 1x | 0 | the lead-in, held on the shooter |
  | 3.0-3.4 s | 224.1-224.4 | 1 -> 0.5 | 0.04-0.21 | the round leaves, the ramp eases in |
  | 4.57 s | 224.96 | 0.5 | 0.69 | **the tank goes up** |
  | 5.24 s | 225.42 | 1x | 1 | the move lands, on the wreck |
  | 5.2-7.3 s | 225.4-227.5 | 1x | 1 | the tail, held on the wreck |

  0.67 s of camera after the explosion, against 3 s of crawl before this pass,
  and the padding no longer runs in slow motion at all.
- Fit to the action moved a move keyed at 221.058/227.458 onto
  224.058/225.358, and a second press left it alone. A clip marked by hand
  from 100.8 to 107.9 -- round pid 4's lone kill, fired 103.053, killed pid 23
  at 106.053 -- derived 103.053-106.453 with nothing stored; the same window
  round the bazooka carries a second kill (SoldierHEad's at 224.218) and
  derived none, as did 40-90 s, both keeping the whole clip as their action.
- The Clip tab's own words, read out of the page. Marked: "6.4 s long, the
  action is 3:44.1 to 3:45.4, 1.3 s of it". Keyed the old way: "2 keys, 6.4 s
  of the round, 8.9 s on screen. 5.1 s of it is the lead-in and the tail: fit
  it to the action and the camera arrives with the hit." Fitted: "2 keys,
  1.3 s of the round, 3.8 s on screen." The slow motion: "1/4 over the
  action, 3:44.1 to 3:45.4, eased in and out." A 50 s clip with no action
  says its length alone and names no action.
- `replay.guard.report()` empty, no page errors; the only 404s are the
  wreck-glb lookups a bare file server always shows.

## Open

- A close kill (2-5 m) can credit an older round of a burst: the angle
  cannot tell them apart there. The distance moves by a few metres.
- Touch: a tap on the view picks, and also shows or hides the chrome.
- A hand weapon's rounds are not drawn (`invisible 1`), so they cannot be
  hovered or clicked in the view: 5 and 6 are the way to them.
- Slow motion plays in real time, so a 6 s clip at a quarter takes 24 s to
  watch and to record. The Clip tab says how long a move takes to watch
  (`screenSeconds`); the clip as a whole does not say it yet.
- Recording is the canvas as it plays ("Left out"), so a slow machine
  records a choppy file and a background window degrades it. The structural
  fix is an offline export: step the clock at a fixed rate the way `?shots`
  already steps the frame, encode through WebCodecs, faster than real time
  and deterministic. The sound would need its own pass -- the tap is real
  time only -- so it is its own feature, not a patch here.
