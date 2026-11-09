---
name: replay-creator-studio
description: >
  Principles, code map and verification recipe for the round replay's creator
  view and its studio, the editor content creators use to cut kills into
  clips for YouTube and Shorts. Use it before changing anything a creator
  touches: the kill shot, the round cam's chase and shot styles, the clip
  strip and its lanes, the clip's cameras (Your camera, the bullet chase,
  from the victim...), their camera icons and end cameras, their hand-overs
  and camera recipes, looping a part, Clear, the strip's clock in seconds
  of the video, the tray, slow motion and bullet time,
  the studio's panels, recipes,
  grades, titles, lower thirds, kill feed, fades and kill effects, undo,
  thumbnails, recording and montages. Also use it to verify such a change in
  a real page, or when a creator reports that a control is confusing,
  rigid, or does something they can't see.
---

# Replay creator studio

The creator view turns a recorded round into clips. A creator opens a kill
as a kill shot, which puts the clip on a strip under the view, looping and
already filmed. The studio is the same clip full screen: the 3D view is the
monitor, an inspector sits on the right, and the strip is docked below.

Read these before changing it:

- `features/replay-creator-view/README.md` holds every decision and how
  each one was verified. "Cameras on the strip" and "Cameras you place"
  (both 2026-11-01) are the current design of the camera lane, the strip's
  clock, the camera icons, end cameras, loops and Clear; the sections
  before them are history (keyframes, lead-in / chase / lead-out are gone).
- `features/replay-creator-view/STUDIO_GUIDE.md` is the creator's guide.
  Keep it true when a control changes.

## Principles

These came from the owner's reviews. Each one fixed a real complaint.

1. **Arcade simple, laid out on the strip.** Most creators clip a kill,
   take the defaults and tweak one thing. Every feature is a named block or
   chip on the strip they can see and drag (cameras, slow motion, text,
   effects), with sensible defaults already laid out; a click on a block
   opens its chooser. Not an abstraction to learn (keyframes were: "not
   really clear what they're doing").
2. **One grammar on every lane.** A click goes there and a drag scrubs. A
   drag on a thing moves it, and its ends resize it. A right-click (a long
   press on touch) offers what can be done to what is under the pointer; a
   click on a camera opens its chooser too, because arcade users do not
   right-click. The owner's first complaint was separate buttons for A and
   B.
3. **What plays is drawn, in the seconds it plays.** Nothing slows, moves
   or changes the picture without a mark on a lane that names it. The kill shot's bullet time
   slowed clips for weeks with nothing on the timeline, and the owner could
   not tell why. If an automatic behaviour exists, draw it as "auto" and
   make it editable in place. The strip is laid out in seconds of the video
   (`clipClock`): bullet time makes a 0.07 s flight 2.5 s wide. Anything new
   that changes the clock must go into the clock model, or the strip lies.
4. **The monitor is the export.** `drawOverlay` (replay-studio-fx.js) draws
   the look, text and effects both over the view and into every recorded
   frame (`composeFrame`). A new visual effect goes in that function, or
   it is not WYSIWYG.
5. **Hand-overs are kept by what they happen at.** The shot, a share of the
   round's flight, the hit, the man down, each plus seconds (`anchorAt`),
   never a bare second of the round: the page's round lands where its own
   physics put it. While the take plays a hand-over at the hit or the man
   down waits for the page's round (`CutRig.reached`), so a camera never
   leaves the round early. The kill row's time is about 0.1 s before the
   page's round even leaves the muzzle; nothing may be placed by it (the
   kill effects were, and fired before the trigger).
6. **An edit shows itself at once, and everything is placed.** Every change
   to a camera or a hand-over loops the part it changed (`loopPart`),
   never the whole clip from its start ("you have to replay the full clip
   to see the changes"). Every camera carries an icon that says whether it
   frames itself (dashed, "automatic") or is set, and a click on it sets
   it. Nothing films from a place the strip does not show ("the camera
   ends up in these random places that I can't control").
7. **Every edit is one undo step.** Everything that changes the clip goes
   through `saveKept(group)`. The words typed in one box and one slider's
   travel group into a single step.
8. **One word per idea.** The words are clip, camera (a block on the Camera
   lane, named by what it films: Bullet chase, From the victim, Your
   camera...), hand-over (Cut, Glide, Whip), slow motion, bullet time and
   recipe, a camera's camera and end camera, Loop it, Whole clip and Clear.
   Keyframe, lead-in, lead-out, A and B, "pin", "take" and "view" as a noun
   are gone from the interface. Labels say what happens: "60% of
   the way to him", "As he goes down".
9. **Glyphs, not emojis.** Cameras, moves, hand-overs, effects and the
   tray's chips have inline stroke SVGs (`MOVE_ICONS` in replay-clipbar.js,
   `GLYPHS` in replay-studio.js). The repo bans emojis.
10. **Optional layers never throw.** The replay switches the whole creator
   view off if it throws. The studio runs through `quietly`. Keep new
   panels behind it.

## Code map

All files are in `tools/bf1942-models/viewer/`.

| File | What it owns |
|---|---|
| `replay-creator.js` | The creator: the clip (`range`, `span`), the take (`take`, `takeInside`, `autoFilms`), the cameras (`cams`, `camList`, `camStretches`, `setCams`, `setCamAt`, `addCamAt`, `moveHandOver`, `setAbMoveAt`, `removeEndAt`, `applyCamRecipe`, `cameraHere`, `clearClip`), setting a camera or its end camera (`placeCam(i, { which })`, `usePlaced`, `cancelPlacing`), a part over and over (`loopPart`, `partRange`, `startPart`, `stopPart`, `partClock`), the clip's clock and moments (`timing`, `hitOf`, `seen`, `noteFlight`), the rig's scene (`leadInto`, `sceneOf`), slow motion (`ramp`, `setSlowRange`, `ownSlow`, `autoSlow`), edits (`setEdit`, `setEdits`; more text `addText`, `setTextAt`, `removeText`, `textBars`; effects placed by hand `addFx`, `setFx`, `removeFx`), the kill effects' moment (`fxKill`: the hit), undo (`snapshot`, `noteHistory`, `undo`), recording (`record`, `composeFrame`, `recordMontage`), the kept clips as the montage (`saveClip`, `drawKeepShot`, `moveClip`, `playMontage`, `montageNext`, `stopMontage`), the lens hook (`shapeLens`) and the freezes (`lead`, `update`) |
| `replay-cuts.js` | Pure: the cameras (`CAMS`, `camsFor`), defaults and recipes (`defaultCams`, `CAM_RECIPES`), hand-overs kept by moments (`anchorAt`, `timeOf`), the list's edits (`insertCam`, `setCam`, `removeCam`, `moveCut`, `setHandOver`, `setPlaced` with its `end` and `move`), the moves to an end camera (`AB_MOVES`, `abMoveOf`), read-back (`camsOf`), old keyframes into cameras (`camsFromKeys`) |
| `replay-clipclock.js` | Pure: the clip as it plays (`clipClock`: `toScreen`, `toRound`, `speedAt`, `length`, `down`), the round cam's clock and the clip's own slow motion and freeze run in real-time steps |
| `replay-camtrack.js` | The cameras as a rig (`CutRig`: which camera films now, hand-overs, the live round cam or the stand-in, his eyes, the circle, your camera's moves and its move to its end camera, `placedPose`; `NO_SWING` for the cameras on the round), and `TrackRig`'s moves it borrows (`END_MOVES`) |
| `replay-roundcam.js` | The round cam, its shot styles, bullet time (`easeClock`), the drawn bullet (`drawnRoundAt`); one style for a frame (`placeAs`), the hold from each style's own start (`holdFrom`), a stand-in laid out without a page round (`modelAt`) |
| `replay-clipbar.js` | The strip: lanes laid out by the clip's clock (`sx`, `rt`, `at`, `pct`), camera blocks, their icons and their chooser (`camLane`, `camIcon`, `camMenu`), the looping part's band (`partBand`, Whole clip), hand-over lines (`bindCut`, `handOverWords`, `handOverMenu`), menus (`menuAt`), bars (`bindSlow`, `bindBar`), snapping, zoom, the tray's drop line (`dragOver`) |
| `replay-studio.js` | The studio: layout (`monitorBox`, `place`), the top bar's Clear menu (`toggleClear`), inspector tabs (the Camera tab's recipes and camera rows: `buildCamera`, `syncCams`; the Montage tab's cards: `buildMontage`, `syncClips`, `clipCard`), the tray (`buildTray`, `trayChip`), transport, look recipes, help, the overlay and grade preview |
| `replay-studio-tour.js` | The tour: the kill it picks (`pickTourKill`), the studio read as plain facts (`tourFacts`), the steps with what each lights and waits for (`TOUR_STEPS`, `stepState`, `nextStep`), the ring and the card (`StudioTour`, made by `Studio.withTour`; offered on the first opening, Take the tour in Help) |
| `replay-studio-fx.js` | Pure: `defaultEdits`, `editsOf`, `overlayAt`, `drawOverlay`, `punchAt`, `shakeAt`, grades, frames; more text and placed effects (`textBars`, `fxMoments`, `freezesOf`, `MAX_TEXTS`, `MAX_FX`) |
| `replay-shot.js` | Pure: the ramp (slow motion), `keysIn`, `screenSeconds` |
| `replay-creator-panel.js` | The side panel's tabs outside the studio |

The models:

- The clip's cameras, `cams`: `[{ cam, at?, into?, view?, motion?, end?,
  move? }]`, the first with no `at`. `cam` is a `CAMS` id; `at` is `{ ev:
  'shot' | 'hit' | 'down', dt }`, `{ ev: 'flight', p }` or `{ ev: 'time', t
  }` (a clip with no take); `into` is cut, glide or whip (a new camera
  glides, his eyes cuts); a `placed` camera has `view: { pos, quat, fov? }`
  and a `motion` (`MOTIONS`), or an `end` view and a `move` (`AB_MOVES`)
  it takes over its part instead. Null is the clip's default
  (`defaultCams`); a new kill shot starts on null. Kept with the recording
  in browser storage, with each kept clip, and in every undo snapshot.
- `edits` is the look, text and effects. It is kept with the recording in
  browser storage, and with each kept clip, and carries over to the next
  kill opened from the Kills tab (the cameras do not). Its `title` and
  `lower` are the clip's own; `texts` is every piece of text after them and
  `fx` every effect placed away from the kill, both from the clip's start.
- The kept clips (`clips`) are the montage, in the order they are kept:
  `playMontage` plays them one after another and `recordMontage` records
  them in that order. Each carries a `thumb` taken as it was kept.
- A kept clip carries `kill: { t, victim }`. Without it, a clip that
  contains another kill cannot find its own, and its lower third and kill
  effects vanish.
- The clip's own slow motion (`ramp`) and the round cam's bullet time are
  exclusive. When the clip has slow motion of its own, the round cam's
  `clockOwned` hook makes it stand aside.

## Pitfalls already paid for

- The page's `map.css` makes every `canvas` absolutely positioned. A canvas
  inside a panel needs `position: static`.
- The replay's key handler drops every Ctrl or Cmd chord. The studio
  catches Ctrl+Z itself (`onKey`) and leaves text boxes to the browser.
- Keys typed in form fields are skipped, but Escape still reaches the
  creator. Escape in a field must only blur it.
- Redrawing a lane during a drag throws away the element under the pointer,
  and with it the drag. Move the held element directly. `sync` does
  nothing while `dragging`.
- The studio pins `#stage` (fixed, sized to the frame). The renderer
  follows through its ResizeObserver, so wait two or three frames after a
  size change before reading the canvas (`Studio.record`).
- `stopRigs` marks the clip as taken by hand (`takeHeld`), which hands the
  view to the replay's camera (the Camera lane then reads Replay camera). A
  follow by hand does it too (`noteFollow`): anything that follows a man
  for the clip's sake must `followQuietly` (playing a kept clip did not,
  and its cameras vanished the next frame).
- A loop can only ride the page's own round if it starts before the shot:
  the round has to be fired. `partRange` pulls a start inside the flight
  back to 0.3 s before the shot (`part.live`); a part after the hit runs
  the clock the clip runs there (`partClock`, `clipClock.speedAt`) on the
  stand-in. A part's speed is the replay's pace, never the clock bullet
  time has slowed it to (`rounds.savedSpeed`).
- The round cam's drag swing (`orbit`: yaw, pitch, distance, kept from any
  earlier drag of the view) turned the cameras on the round off their
  framing: the owner's "random places". Armed cameras take `NO_SWING`.
- The round cam clears its target in the frame it stops: whether the hold
  that ended was this take's is the frame before's (`CutRig.observe`).
- A camera change while paused must reset the rig (`CutRig.reset`), or a
  hand-over half done is frozen on the monitor.
- The page's guns keep the last 16 impacts newest first (`guns.hits`); the
  replay reads the new ones each frame (`noteRoundHits`) to kill a hull on
  the round that kills it rather than on the recorded hit points a fifth of
  a second later.
- A kill shot's round is not the recorded shot's timing: the shot is 0-0.3 s
  before the death and the round needs up to 0.7 s, so the round cam fires
  it early and steers it to land on him at the kill line (`LANDING`,
  `planLanding`, `replay.js` `holdShot` / `fireHeld` / `strikeHull`). Anything
  that keys on the shot's time for the take (`claim`, the ramp, `GIVE_UP`)
  reads `leaves()`, not `f.t`. Measure a change here with the Shorts
  runner's `--trace`, not a screenshot.
- `.rp-btn` styles are global, but the `--rp-*` tokens live on `.rp-root`.
  The studio is outside `.rp-root` and redeclares them.

## Verifying a change

1. Unit tests, from `tools/bf1942-models/tests`:
   `python3 -m unittest test_replay_creator`, then the whole replay set with
   `ls test_replay*.py | sed 's/\.py$//' | xargs python3 -m unittest`. Put
   new pure logic (a segment label, a rig's pose, an overlay's timing) where
   `replay_creator_harness.mjs` can reach it, and assert it in
   `test_replay_creator.py`.
2. The real page, with `scripts/studio-probe.cjs` and a steps file
   (`scripts/steps-kill-shot.js` is a full example: a camera set by its
   icon, an end camera measured every frame, a hand-over looped, Clear and
   Ctrl+Z, a recording). It loads
   `map.html?replay=...&shots` from the viewer on :5273 (the owner's main
   checkout; the Bocage recording lives untracked in `viewer/replays/`: as
   of 2026-11-09 it is `replays/feed/zz4g8tz9ph.ndjson`, so pass `--replay`,
   and pick the kill with `creator.moments()` as the tour does rather than
   by a killer id, since the file changes). Run one headless browser at a
   time, and check `ps -eo args | grep -c "[h]eadless_shell"` is 0 first:
   the replay unit tests run one too.
3. Measure; do not just screenshot. Record per frame which camera films
   (`creator.track.active.cam`), the round's progress
   (`rounds.target.progress`), the camera's distance to your camera's view
   and its end camera, to `rounds.camPos` and to the victim, the clock
   (`replay.speed`), what loops (`creator.part`), `creator.timing()` and
   lane text. For recordings, pull frames with
   `ffmpeg -ss <t> -i file -frames:v 1` and look at them.
4. Probe habits: pause before clicking Play (it toggles); never click the
   view to focus it (a click follows whoever is under it); do not call
   `replay.follow()` right before opening a kill in a creator already on (a
   follow by hand takes the clip's camera); a fresh browser per run,
   because the viewer's modules survive a reload. Drive the strip with
   `page.mouse` at positions from `clipbar.at(t)` and the strip's rect.
5. Re-run the earlier probes after a change to the rigs, the strip or the
   recording path. Several of today's bugs only showed in an older probe.
6. The tour (`scripts/steps-tour.js`) walks every step with the mouse; each
   step's `movedOn` in the report says whether the studio's own state moved
   the tour on. `scripts/make-tour-videos.sh [out-dir]` runs it with the
   page captured (`studio-probe.cjs --video`) and cuts the tutorial videos
   (`cut-tour-videos.cjs`): one per step and `studio-tour.mp4`, in
   `~/.cache/bfstats-studio-tour/videos` by default. It refuses to start
   while another headless browser runs.

## When something changes

- Add a dated section to the feature README: the owner's words, what
  changed, and how it was verified, with numbers.
- Update `STUDIO_GUIDE.md` and the studio's Help (`buildHelp`) if a
  creator would do something differently.
- A control the tour lights (`TOUR_STEPS` targets: the strip's camera
  blocks, icons and hand-over lines, the tray's chips, the recipes, the
  `data-tour` buttons) renamed or moved breaks the tour's test first; fix
  the step, then make the videos again (`make-tour-videos.sh`) so they show
  the studio as it is.
- Commit only your files (`git commit --only`, adding new files first). The
  main checkout often has other sessions' work in it.
