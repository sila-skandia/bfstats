---
name: replay-creator-studio
description: >
  Principles, code map and verification recipe for the round replay's creator
  view and its studio, the editor content creators use to cut kills into
  clips for YouTube and Shorts. Use it before changing anything a creator
  touches: the kill shot, the round cam's chase and shot styles, the clip
  strip and its lanes, the clip's cameras (Your camera, the bullet chase,
  from the victim...), their hand-overs and camera recipes, the strip's
  clock in seconds of the video, the tray, slow motion and bullet time,
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
  each one was verified. "Cameras on the strip" (2026-11-01) is the current
  design of the camera lane and the strip's clock; the sections before it
  are history (keyframes, lead-in / chase / lead-out are gone).
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
6. **Every edit is one undo step.** Everything that changes the clip goes
   through `saveKept(group)`. The words typed in one box and one slider's
   travel group into a single step.
7. **One word per idea.** The words are clip, camera (a block on the Camera
   lane, named by what it films: Bullet chase, From the victim, Your
   camera...), hand-over (Cut, Glide, Whip), slow motion, bullet time and
   recipe. Keyframe, lead-in, lead-out, A and B, "pin", "take" and "view"
   as a noun are gone from the interface. Labels say what happens: "60% of
   the way to him", "As he goes down".
8. **Glyphs, not emojis.** Cameras, moves, hand-overs, effects and the
   tray's chips have inline stroke SVGs (`MOVE_ICONS` in replay-clipbar.js,
   `GLYPHS` in replay-studio.js). The repo bans emojis.
9. **Optional layers never throw.** The replay switches the whole creator
   view off if it throws. The studio runs through `quietly`. Keep new
   panels behind it.

## Code map

All files are in `tools/bf1942-models/viewer/`.

| File | What it owns |
|---|---|
| `replay-creator.js` | The creator: the clip (`range`, `span`), the take (`take`, `takeInside`, `autoFilms`), the cameras (`cams`, `camList`, `camStretches`, `setCams`, `setCamAt`, `addCamAt`, `moveHandOver`, `applyCamRecipe`, `cameraHere`), placing your camera (`placeCam`, `usePlaced`, `cancelPlacing`), the clip's clock and moments (`timing`, `hitOf`, `seen`, `noteFlight`), the rig's scene (`leadInto`, `sceneOf`), slow motion (`ramp`, `setSlowRange`, `ownSlow`, `autoSlow`), edits (`setEdit`, `setEdits`), the kill effects' moment (`fxKill`: the hit), undo (`snapshot`, `noteHistory`, `undo`), recording (`record`, `composeFrame`, `recordMontage`), the lens hook (`shapeLens`) and the freeze (`lead`, `update`) |
| `replay-cuts.js` | Pure: the cameras (`CAMS`, `camsFor`), defaults and recipes (`defaultCams`, `CAM_RECIPES`), hand-overs kept by moments (`anchorAt`, `timeOf`), the list's edits (`insertCam`, `setCam`, `removeCam`, `moveCut`, `setHandOver`, `setPlaced`), read-back (`camsOf`), old keyframes into cameras (`camsFromKeys`) |
| `replay-clipclock.js` | Pure: the clip as it plays (`clipClock`: `toScreen`, `toRound`, `length`, `down`), the round cam's clock and the clip's own slow motion and freeze run in real-time steps |
| `replay-camtrack.js` | The cameras as a rig (`CutRig`: which camera films now, hand-overs, the live round cam or the stand-in, his eyes, the circle, your camera's moves), and `TrackRig`'s moves it borrows (`END_MOVES`) |
| `replay-roundcam.js` | The round cam, its shot styles, bullet time (`easeClock`), the drawn bullet (`drawnRoundAt`); one style for a frame (`placeAs`), the hold from each style's own start (`holdFrom`), a stand-in laid out without a page round (`modelAt`) |
| `replay-clipbar.js` | The strip: lanes laid out by the clip's clock (`sx`, `rt`, `at`, `pct`), camera blocks and their chooser (`camLane`, `camMenu`), hand-over lines (`bindCut`, `handOverWords`, `handOverMenu`), menus (`menuAt`), bars (`bindSlow`, `bindBar`), snapping, zoom, the tray's drop line (`dragOver`) |
| `replay-studio.js` | The studio: layout (`monitorBox`, `place`), inspector tabs (the Camera tab's recipes and camera list: `buildCamera`, `syncCams`), the tray (`buildTray`, `trayChip`), transport, look recipes, help, the overlay and grade preview |
| `replay-studio-fx.js` | Pure: `defaultEdits`, `editsOf`, `overlayAt`, `drawOverlay`, `punchAt`, `shakeAt`, grades, frames |
| `replay-shot.js` | Pure: the ramp (slow motion), `keysIn`, `screenSeconds` |
| `replay-creator-panel.js` | The side panel's tabs outside the studio |

The models:

- The clip's cameras, `cams`: `[{ cam, at?, into?, view?, motion? }]`, the
  first with no `at`. `cam` is a `CAMS` id; `at` is `{ ev: 'shot' | 'hit' |
  'down', dt }`, `{ ev: 'flight', p }` or `{ ev: 'time', t }` (a clip with
  no take); `into` is cut, glide or whip; a `placed` camera has `view: {
  pos, quat, fov? }` and a `motion` (`MOTIONS`). Null is the clip's default
  (`defaultCams`); a new kill shot starts on null. Kept with the recording
  in browser storage, with each kept clip, and in every undo snapshot.
- `edits` is the look, text and effects. It is kept with the recording in
  browser storage, and with each kept clip, and carries over to the next
  kill opened from the Kills tab (the cameras do not).
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
- The round cam clears its target in the frame it stops: whether the hold
  that ended was this take's is the frame before's (`CutRig.observe`).
- A camera change while paused must reset the rig (`CutRig.reset`), or a
  hand-over half done is frozen on the monitor.
- The page's guns keep the last 16 impacts newest first (`guns.hits`); the
  replay reads the new ones each frame (`noteRoundHits`) to kill a hull on
  the round that kills it rather than on the recorded hit points a fifth of
  a second later.
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
   (`scripts/steps-kill-shot.js` is a full example). It loads
   `map.html?replay=...&shots` from the viewer on :5273 (the owner's main
   checkout; the Bocage recording lives untracked in `viewer/replays/`). Run
   one headless browser at a time.
3. Measure; do not just screenshot. Record per frame which camera films
   (`creator.track.active.cam`), the round's progress
   (`rounds.target.progress`), the camera's distance to your camera's view,
   to `rounds.camPos` and to the victim, the clock (`replay.speed`),
   `creator.timing()` and lane text. For recordings, pull frames with
   `ffmpeg -ss <t> -i file -frames:v 1` and look at them.
4. Probe habits: pause before clicking Play (it toggles); never click the
   view to focus it (a click follows whoever is under it); do not call
   `replay.follow()` right before opening a kill in a creator already on (a
   follow by hand takes the clip's camera); a fresh browser per run,
   because the viewer's modules survive a reload. Drive the strip with
   `page.mouse` at positions from `clipbar.at(t)` and the strip's rect.
5. Re-run the earlier probes after a change to the rigs, the strip or the
   recording path. Several of today's bugs only showed in an older probe.

## When something changes

- Add a dated section to the feature README: the owner's words, what
  changed, and how it was verified, with numbers.
- Update `STUDIO_GUIDE.md` and the studio's Help (`buildHelp`) if a
  creator would do something differently.
- Commit only your files (`git commit --only`, adding new files first). The
  main checkout often has other sessions' work in it.
