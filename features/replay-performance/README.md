# Round replay: performance

The 2026-09-29 request: the replay stutters and lags on the owner's laptop,
and it reads the whole recording to put the battle marks on the scrubber.
Should uploads be post-processed on the server into a highlights file, or
the replay's own overheads cut?

## Status

Done (2026-09-29). The overheads were the replay's own. Nothing server-side.

## Measured

The 45-minute public Bocage round `replay_20260928-161948`: 47 MB (11.6 MB
gzipped, as the API serves it), 8,290 lives, 562 hulls, 1,225 kits and
rounds, 495,154 position samples, 36 players. Headless Chromium on ANGLE
Vulkan on the owner's laptop, `tests/perf/replayperf.cjs`, the unmodified
main and this change served side by side.

| | Before | After |
|---|---|---|
| Ready to watch | 10.3 s, then 4.3 s frozen on the first frame | 4.2 s |
| Times the file is parsed | 2 | 1 |
| Playback at 1x, 30 s | 33 ms a frame (30 fps), 39% of frames over 33 ms | 17 ms (58 fps), 0.3% over 33 ms |
| The replay's share of a frame | 9-12 ms | 3-3.5 ms |
| Made again on the GPU after a seek | ~150 textures, ~700 buffers, a program linked | the bodies' bone textures |
| A 2.5 s drag along the timeline | 60 frames over 50 ms | 8-13 |

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
7. **A drag along the timeline rebuilt every body at every step.**
8. **Per frame:** every recorded round walked (19,744), dead hulls updated
   only to be hidden again, and the stage's size read after the frame's own DOM
   writes, a forced layout.

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
- Whatever is built per life of the round hangs under `player.root`, whose
  matrix walk visits only the visible (effects.js has the same group).
- Work over the whole round is done at the load or between frames in slices,
  never in one frame.
- A clone's dispose frees what the clone owns, never what it shares with a
  cache.
- A change meant only to be faster must leave `tests/perf/replaydump.mjs`'s
  output byte-identical.

## Open

- The parsed round is about 180 MB for 45 minutes, 107 MB of it the samples
  (about 216 bytes each). A typed-array store per life would save about
  100 MB. Not needed for smoothness: 45 s of playback at 1x and 4x had no GC
  long task.
- The 562 hulls are built before the round shows: about 0.4 s and 24 MB.
- A drag is about 45 fps: rigs for lives that change, first-time glb loads.

## Verification

- `test_replay_models.ReplayLifeIndexTests`: 14,722 indexed answers against
  the walks they replace, over a hull id reused by its respawn, seats found by
  the recorded root and by id, a kit under a hull, a death, a respawn, and a
  stand-in pushed after the first question.
  `test_replay_highlights`: the standouts read in pieces are the one-piece
  timeline. The bf1942-models suite (3,988) and the API's (692) pass.
- `replaydump.mjs`, before against after: byte-identical on five recordings
  (Wake co-op, Midway, both Bocage rounds, a 23 MB round), 26 MB of answers
  for the 45-minute one.
- In the page, before against after: the same hulls, crews, soldiers, bodies
  and props drawn at 1,300 s, 2,300 s, mid-drag and after it.
- The GPU's geometries and textures over 300 s at 4x with seeks level off as
  the round brings in new models, the programs flat at 42. The old dispose
  kept the count lower by freeing what was still in use.
- Single player: `botfight.cjs --runs fight --realtime 30` with 16 bots runs
  clean on both builds.
