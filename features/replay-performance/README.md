# Round replay: performance

The 2026-09-29 request: the replay stutters and lags on the owner's laptop,
and it reads the whole recording to put the battle marks on the scrubber.
Should uploads be post-processed on the server into a highlights file, or
the replay's own overheads cut?

## Status

Done (2026-09-29), in two passes; phones on 2026-11-13 ("Phones" below).
The 2026-09-29 passes: the overheads first, then what the first
pass left open (the samples' memory, the hulls built before the round shows,
the drag). The overheads were the replay's own. Nothing server-side.

## Measured

The 45-minute public Bocage round `replay_20260928-161948`: 47 MB (11.6 MB
gzipped, as the API serves it), 8,290 lives, 562 hulls, 1,225 kits and
rounds, 495,154 position samples, 36 players. Headless Chromium on ANGLE
Vulkan on the owner's laptop, `tests/perf/replayperf.cjs`, the unmodified
main and this change served side by side.

| | Before | First pass | Second pass |
|---|---|---|---|
| Ready to watch | 10.3 s, then 4.3 s frozen on the first frame | 4.2 s | 3.6 s |
| Times the file is parsed | 2 | 1 | 1 |
| Memory of the parsed round | 178 MB | 178 MB | 85 MB (48 MB of heap, 37 MB of typed arrays) |
| Playback at 1x, 30 s | 33 ms a frame (30 fps), 39% of frames over 33 ms | 17 ms (58 fps), 0.3% over 33 ms | the same |
| The replay's share of a frame | 9-12 ms | 3-3.5 ms | 2.9 ms |
| Made again on the GPU after a seek | ~150 textures, ~700 buffers, a program linked | the bodies' bone textures | the same |
| A drag along the timeline | 25 ms a frame, 60 frames over 50 ms | 22 ms, 8-13 over 50 ms | 17 ms (59 fps), none over 50 ms |

Under node, the same round: who stands apart (`standoutsOf`) 6,981 to
206 ms, the highlights model 934 to 164 ms, the parse 984 to about 550 ms,
where every player is (`whereIs` for 36) 2.5 to 0.1 ms.

## What it was

1. **Every question about a life walked all of them.** `lifeAt` and `rootOf`
   scanned the 8,290 lives on every call, and they sit under `whereIs`,
   `playerStatusAt`, `crewOf` (each hull, each frame), each soldier's
   `place`, and the parse's own last passes.
2. **Every hull life of the round stayed in the scene.** 562 hulls of 63,650
   nodes, most of them gone at any moment. Three r169 recomposes every node's
   matrix each frame whether it is drawn or not: half the page's frame.
3. **The standouts were read in one piece, in a frame.** The first frame after
   the round was ready took 4.3 s.
4. **The file was parsed twice**, once to learn its level before the level
   loaded and again to play it.
5. **The battles re-scanned the round's activity at every step**: 12,000
   events at each of 5,464 half-second clusterings.
6. **A body's dispose freed what every other body was drawing with.**
   `skeletonClone` shares the cached pose's geometry, and the page's shading
   gives each body new materials over the cache's textures. Freeing both, and
   the last material of the skinned program, made the frames after a seek
   upload them all again and link the program. In play, each corpse did the
   same when it expired.
7. **A drag along the timeline rebuilt every body at every step**, and then,
   once that was fixed, every body whose life or held item differed at the
   step's instant, replayed every death crossed (cry, fall, corpse) and fired
   the last 0.6 s of rounds again, reports and all.
8. **Per frame:** every recorded round walked (19,744), dead hulls updated
   only to be hidden again, and the stage's size read after the frame's own DOM
   writes, a forced layout.
9. **Every sample was an object.** 495,154 of them as `{ t, p: [3], q: [4] }`,
   216 bytes each: 107 MB of the 178 MB the parsed round took, and the moving
   parts' 175,714 `{ t, q }` another 25 MB.
10. **All 562 hulls were built before the round showed**: a 0.4 s long task,
    for hulls most of which the viewer never reaches.

## What changed

| File | Change |
|---|---|
| `replay-recording.js` | Lives indexed by id and soldiers by player (`soldierLivesOf`), built on first use and again when lives are added; `rootOf` steps down the twelve ids below a seat; `hpAt` by halves. Every answer is the walk's, including a damaged file's ids that are not whole numbers. |
| `replay-chapters.js` | `playerStatusAt` asks the index, and finds a man's last death by halves in his own lines. |
| `replay-battles.js` | Clustering looks at the window's run of the activity only; `standoutSteps` reads who stands apart a few seconds at a time (`standoutsOf` runs it through). |
| `replay-highlights.js` | The standouts read within 3 ms of each frame until done; the battle map says "Reading the round" meanwhile. |
| `replay.js` | The replay's root walks only its visible children. The rounds a frame fires are found by halves. A hull put away and outside its life is skipped. `recordingInfo`'s parse is handed to the open that follows, and the text is let go once read. A seek during a drag moves the men instead of rebuilding them. |
| `replay-hulls.js` | `putAway`, set by `hide`. |
| `replay-bodies.js` | `jump`: the corpses go, the living stay and are placed afresh. |
| `bot-visuals.js` | `disposeCorpses`. |
| `foot-body.js` | `disposeFootBodyScene` frees only the skeleton the clone owns, as `undress` already did for the kit (single player's corpses too). |
| `replay-ui.js`, `replay-markers.js` | The stage's size as the ResizeObserver keeps it. |

The second pass:

| File | Change |
|---|---|
| `replay-recording.js` | `SampleTrack`: a life's samples as eight numbers each in one Float64Array (`t, x, y, z, qx, qy, qz, qw`), a moving part's as five, the numbers the file wrote. It reads like the array it replaces (`length`, `at`, `some`, `every`, `find`, `filter`, `forEach`, `map`, iteration), each read made on the spot; `sampleAt`, `positionAt`, `latestIndex` read the numbers in place, and `sampleInto` answers into a caller's room for the lookups of every frame. |
| `replay-kinematics.js`, `replay-battles.js`, `replay-hulls.js` | `poseAt`, `headingAt` and the moving parts read through `sampleInto`. |
| `replay-camera.js`, `replay-chapters.js`, `replay-battlemap.js`, `replay-standins.js`, `gait-select.js` | `keys.at(i)` for `keys[i]`, the same on a plain array. |
| `replay.js` | A hull is built when the round first has it (`buildHulls`), within 4 ms of a frame while the timeline is dragged; the rest are built ahead, 1.5 ms a frame, until every one is. What a hull is (air, sea, tank) is its template's, surveyed once (`hullKind`, replay-hulls.js `modelKind`), so the standouts know who flies before his plane is built. A seek while dragging fires no rounds again. |
| `replay-bodies.js` | While the timeline is dragged, a man keeps the body he has whatever his life or item at the step, and nobody dies on the way; the seek the drag ends on builds each as he is. |

## Phones

The 2026-11-13 report: on a phone the live replay had become unwatchable,
"the lowest of low FPS", where it used to be watchable. On a phone a replay
has to do one thing, scrub and play the round, and the page drew it as a
desktop draws it.

### Measured

The 30-minute Liberation of Caen round `c8z2nt8m7u` (23 MB), at 900 s,
headless Chromium on the owner's M5 Max with a 390x844 phone's screen (3x,
touch), `scratchpad` probes beside `tests/perf/replayperf.cjs`. CPU throttled
4x stands in for a phone's CPU; a phone's GPU cannot be measured here, so its
share is the canvas and the draw calls.

| | Before (prod) | Phone profile |
|---|---|---|
| Canvas | 780x1688, 4x MSAA (5.3 M samples) | 585x1266, no MSAA (0.74 M) |
| Draw calls a frame | 430-460 | 250 |
| Frames a second asked of the GPU | 60 | 30 |
| Frame at 4x CPU throttle | 44 ms | 35 ms |
| Script a drawn frame at 4x | 34.5 ms | 29 ms |
| DOM elements | 21,060 (19,469 of them the hidden replay log) | 1,326 |
| Level nodes the matrix walk visits a frame | 10,437 | ~760 (the shown ones) |
| A forced layout a frame | yes (the minimap read `clientWidth`) | no |

The October 20 build (`067338626`) on the same round, same probe: 38 ms at 4x,
so the CPU side grew some 15 % since; the page was already drawing a phone
the desktop's canvas then. Nothing composited over the canvas (no
full-screen `backdrop-filter`) costs a frame.

### What changed

| File | Change |
|---|---|
| `replay-phone.js` (new) | Who is on the profile (a coarse pointer on a screen whose short side is under 600 px, in a replay; `?phone=0/1`), the profile's numbers, and the frame gate. |
| `map.html` | On the profile, no MSAA unless chosen (`?aa`, OPTIONS > VIDEO), a pixel ratio of at most 1.5, the profile's video settings when none are stored, and the animation loop drawing 30 frames a second (`?fps=` lifts it). |
| `video-apply.js` | `ratioCap` (held only while no DISPLAY MODE is chosen) and `initial` settings. |
| `shown-walk.js` (new), `replay.js` | The level's root walks only shown nodes at every depth while nothing above has moved: the placed vehicles' `spawners` group, the collision meshes and the LOD rungs not chosen are skipped. Every replay, not only a phone's. Checked in the page against three's own forced walk at three instants and camera modes: every shown matrix bit-identical. |
| `map-surfaces.js` | The minimap's stage size from a ResizeObserver, not `clientWidth` read after the frame's DOM writes (a forced layout every frame, every page). |
| `replay-ui.js` | The replay log's rows are built when the log is first opened. |

The profile: VideoLow.con's LOD (0.6) and effects (0.3), no reflections,
75 % view distance; lightmaps stay (a level lit flat reads badly) and
textures drop one mip, not three. A stored OPTIONS > VIDEO wins over all of
it, DISPLAY MODE over the ratio cap.

### Open

- The replay's own frame (`the soldiers`, the hulls) and three's render of
  what is shown are the CPU that is left, about 10 and 11 ms of the 35 at 4x.
  The visible soldiers' bones are most of the scene walk that remains.
- The minimap is still painted every drawn frame (about 6 % of the script).

## Quality on the fly

The owner's follow-up the same day: on every device, when a replay cannot
hold its frame rate, lower the quality on its own, with the level shown under
the bar's "..." menu where the viewer can change it.

`replay-quality.js` keeps a ladder below the viewer's own settings, each rung
a cap over OPTIONS > VIDEO and a share of the canvas's pixel ratio, all live
through `video-apply.js` `setRuntime` (nothing stored; the options screen
shows `videoApply.chosen`, the frame draws `videoApply.settings`):

| Rung | Pixel ratio | Caps |
|---|---|---|
| Full | the page's | none |
| Reduced | x0.85 | graphics 2, effects 2, no shadows, view 90 % |
| Low | x0.7 | graphics 1, effects 1, no reflections or shadows, view 75 % |
| Lowest | x0.5 (never under 0.5) | Low's, view 50 %, textures 40 % |

Anti-aliasing (the WebGL context's) and lightmaps (the level's build) are not
on it. A cap only lowers: a setting chosen below it stays.

Auto reads the median interval of the drawn frames over 4 s while the replay
plays undisturbed: not loading, paused, dragged, hidden, or within 2 s of a
seek (`replay.seek` holds it). Under 75 % of the target (60, or a phone's 30)
it steps down one rung and waits 2 s for the page to settle. A rung that buys
under 8 % more frames is undone and Auto stops there: the frame rate is held
down by something the ladder does not lower (a CPU busy with the round, a
display or browser capped at 30). It never steps back up on its own.

The menu's Quality row reads `AUTO · LOW` while Auto picks and the rung alone
when pinned, with the last measured rate in its title; a click steps Auto,
Full, Reduced, Low, Lowest and round, kept in this browser
(`bf42-replay-quality`). `?quality=auto|full|reduced|low|lowest` picks for
the page; `?shots` and `?dpr` (screenshots, the Shorts runner, benches) draw
at Full unless they ask, and `replayperf.cjs` asks for Full.

Checked headless on the Caen round: software GL at 1280x720 x2, Auto stepped
to Lowest as the rate rose 5, 6, 8, 10 fps; Metal at 6x CPU throttle, Reduced
bought nothing (15 fps either side), so Auto put Full back and stopped. On a
phone's screen the row cycles every rung, the canvas following (1.5, 1.275,
1.05, 0.75), and a pinned rung survives a reload. `test_replay_phone.py` runs
the governor on synthetic pages (GPU-bound, enough at Low, CPU-bound, fast,
a phone at 26 of 30, busy only, pinned) and the cap.

## A highlights file on the server

Not done. Playback needs the whole recording anyway, and what the marks and
the heat strip are made of now costs about 0.2 s of the browser's time, a
tenth of it before the round shows and the rest between frames. A second
upload would save that at the price of a derived file to keep in step with
the viewer's rules (a new medal or threshold means reprocessing every upload),
and a recording opened from disk would still work it out itself. A summary on
the server would pay only for marks on the feed's cards, which today would
mean downloading every recording.

## Rules for replay code

- Never walk `rec.lives` per frame or per player: `lifeAt`, `rootOf` and
  `soldierLivesOf` answer from the index.
- A time-ordered list is searched by halves (`latestAt`, `firstWhere`).
- A life's samples are a `SampleTrack`: read one with `keys.at(i)`, never
  `keys[i]`, and what `sampleInto` answers is read at once, never kept (the
  next call writes over it).
- A hull may not be built yet: ask `player.hullOf(life)` for one that must
  exist, `player.hullKind(life)` for what it is.
- Whatever is built per life of the round hangs under `player.root`, whose
  matrix walk visits only the visible (effects.js has the same group).
- Work over the whole round is done at the load or between frames in slices,
  never in one frame.
- A clone's dispose frees what the clone owns, never what it shares with a
  cache.
- A change meant only to be faster must leave `tests/perf/replaydump.mjs`'s
  output byte-identical.
- A phone is a viewer, not a creator: whatever a replay adds per frame is
  measured on the phone profile too (`?phone=1` on a desktop), and what a
  phone does not need to scrub and watch stays off it.

## Open

- The bodies' states (`rec.stances`, 15.7 MB) and the engines' records
  (13.9 MB) are still objects. The first-person HUD and weapon
  (replay-hud.js, replay-viewmodel.js) read the stances as arrays, and were
  being changed in another session when this was done.
- The frame a drag lets go on builds every body afresh: one frame of up to
  about 100 ms, as a click on the timeline has.

## Verification

- `test_replay_models.ReplayLifeIndexTests`: 14,722 indexed answers against
  the walks they replace, over a hull id reused by its respawn, seats found by
  the recorded root and by id, a kit under a hull, a death, a respawn, and a
  stand-in pushed after the first question.
  `test_replay_highlights`: the standouts read in pieces are the one-piece
  timeline. The bf1942-models suite (4,009) and the API's (706) pass.
- `replaydump.mjs`, before against after: byte-identical on five recordings
  (Wake co-op, Midway, both Bocage rounds, a 23 MB round), 38 MB of answers
  for the 45-minute one, the poses, motion, headings, moving parts and gaits
  among them since the second pass.
- In the page, before against after: the same hulls, crews, soldiers, bodies
  and props drawn at 1,300 s, 2,300 s, mid-drag and after it; paused at five
  exact instants, the same sets of hulls (their positions to the millimetre
  and their crews), props, soldiers (place, stance, seat, death) and camera.
- The GPU's geometries and textures over 300 s at 4x with seeks level off as
  the round brings in new models, the programs flat at 42. The old dispose
  kept the count lower by freeing what was still in use.
- Single player: `botfight.cjs --runs fight --realtime 30` with 16 bots runs
  clean on both builds.
