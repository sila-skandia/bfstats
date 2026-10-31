---
name: replay-creator-studio
description: >
  Principles, code map and verification recipe for the round replay's creator
  view and its studio, the editor content creators use to cut kills into
  clips for YouTube and Shorts. Use it before changing anything a creator
  touches: the kill shot, the round cam's chase and shot styles, the clip
  strip and its lanes, keyframes and their moves, the lead-in, chase and
  lead-out, slow motion and bullet time, the studio's panels, recipes,
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
  each one was verified. The sections from "Keyframes on the strip" on
  cover the current design.
- `features/replay-creator-view/STUDIO_GUIDE.md` is the creator's guide.
  Keep it true when a control changes.

## Principles

These came from the owner's reviews. Each one fixed a real complaint.

1. **One grammar on every lane.** A click goes there and a drag scrubs. A
   drag on a thing moves it, and its ends resize it. A right-click (a long
   press on touch) offers what can be done to what is under the pointer. Do
   not add a button for something a lane can offer. The owner's first
   complaint was separate buttons for A and B.
2. **What plays is drawn.** Nothing slows, moves or changes the picture
   without a mark on a lane that names it. The kill shot's bullet time
   slowed clips for weeks with nothing on the timeline, and the owner could
   not tell why. If an automatic behaviour exists, draw it as "auto" and
   make it editable in place.
3. **The monitor is the export.** `drawOverlay` (replay-studio-fx.js) draws
   the look, text and effects both over the view and into every recorded
   frame (`composeFrame`). A new visual effect goes in that function, or
   it is not WYSIWYG.
4. **Automatic and manual share the clip.** The chase (the round cam) and
   the creator's keyframes film different parts of one kill shot: lead-in,
   chase, lead-out (`ShotRig`). Adding a keyframe must never silently
   switch the chase off. That was the "your A → B move is off" bug.
5. **A hand-over never pulls the shot off its round.** The camera may leave
   the chase only once the round has landed (`busy`, `freeSince`). The
   kill row's time is about 0.1 s earlier than the page's own round, so
   the kill time alone is not enough.
6. **Every edit is one undo step.** Everything that changes the clip goes
   through `saveKept(group)`. The words typed in one box and one slider's
   travel group into a single step.
7. **One word per idea.** The words are clip, keyframe, chase, lead-in,
   lead-out, slow motion, bullet time and shot style. A and B, "pin",
   "take" and "view" as a noun are gone from the interface. Labels say what
   happens: "holds 1, whips into the chase" or "cuts to 3".
8. **Glyphs, not emojis.** Moves, shot styles, hand-overs and effects have
   inline stroke SVGs (`MOVE_ICONS` in replay-clipbar.js, `GLYPHS` in
   replay-studio.js). The repo bans emojis.
9. **Optional layers never throw.** The replay switches the whole creator
   view off if it throws. The studio runs through `quietly`. Keep new
   panels behind it.

## Code map

All files are in `tools/bf1942-models/viewer/`.

| File | What it owns |
|---|---|
| `replay-creator.js` | The creator: the clip (`range`, `span`), the take (`take`, `takeInside`, `autoFilms`), keyframes (`keyframeHere`, `setKeyMove`), slow motion (`ramp`, `setSlowRange`, `ownSlow`, `autoSlow`), the chase hand-overs (`setChase`, `setHandover`, `chaseSpan`), edits (`setEdit`), undo (`snapshot`, `noteHistory`, `undo`), recording (`record`, `composeFrame`, `recordMontage`), the lens hook (`shapeLens`: punch, shake) and the freeze (`lead`, `update`) |
| `replay-camtrack.js` | Keyframes and their moves (`TrackRig`, `KEY_MOVES`, `END_MOVES`), the kill shot's three parts (`ShotRig`, `HANDOVERS`, `BLEND_INTO`) |
| `replay-roundcam.js` | The chase: the round cam, its shot styles, bullet time (`easeClock`), the drawn bullet from the muzzle (`drawnRoundAt`) |
| `replay-clipbar.js` | The strip: lanes, menus (`menuAt`), drags (`bindSlow`, `bindBar`, `bindKey`), snapping, zoom, `cameraSegments` (what the Camera lane says) |
| `replay-studio.js` | The studio: layout (`monitorBox`, `place`), inspector tabs, transport, recipes, help, the overlay and grade preview |
| `replay-studio-fx.js` | Pure: `defaultEdits`, `editsOf`, `overlayAt`, `drawOverlay`, `punchAt`, `shakeAt`, grades, frames |
| `replay-shot.js` | Pure: the ramp (slow motion), `keysIn`, `screenSeconds` |
| `replay-creator-panel.js` | The side panel's tabs outside the studio |

The models:

- A keyframe is `{ t, pos, quat, fov?, move? }`. `move` is a `KEY_MOVES`
  id (to the next keyframe), or an `END_MOVES` id when it is the last of
  its part. The last lead-in keyframe's end move runs until the shot.
- `edits` is the look, text, effects and chase settings: `chase`, `into`
  and `out`. It is kept with the recording in browser storage, and with
  each kept clip.
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
- `stopRigs` marks the take as taken by hand (`takeHeld`), which switches
  the chase off. A preview or keyframe must stop the rigs without it.
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
3. Measure; do not just screenshot. Record the camera's distance to each
   keyframe and to `rounds.camPos` per frame, the clock (`replay.speed`),
   `creator.overlayState()`, and lane text. For recordings, pull frames with
   `ffmpeg -ss <t> -i file -frames:v 1` and look at them.
4. Probe habits: pause before clicking Play (it toggles); never click the
   view to focus it (a click follows whoever is under it); a fresh browser
   per run, because the viewer's modules survive a reload.
5. Re-run the earlier probes after a change to the rigs, the strip or the
   recording path. Several of today's bugs only showed in an older probe.

## When something changes

- Add a dated section to the feature README: the owner's words, what
  changed, and how it was verified, with numbers.
- Update `STUDIO_GUIDE.md` and the studio's Help (`buildHelp`) if a
  creator would do something differently.
- Commit only your files (`git commit --only`, adding new files first). The
  main checkout often has other sessions' work in it.
