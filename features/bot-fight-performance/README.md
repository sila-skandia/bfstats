# Why a 16-bot fight is laggy, and what was cut

Dylan's report (2026-09-26): the browser BF1942 is very laggy with 12 or more
bots, worst when the bots are fighting at close quarters, and the real game is
neither choppy nor as heavy on the CPU. This pass measured where a frame goes
with sixteen bots in a close fight, cut what was waste, and names the limits
that remain. Every number here is from this machine (Iris Xe, Chromium on the
system GL, 1280x800, DPR 1) unless it says headless.

## The short version

- **On the owner's own conditions the frame was CPU-bound on the main thread
  at 25 ms** (39 fps, p95 46-50 ms, 145 of 783 frames over 33 ms), sixteen bots
  on foot in two lines 30 m apart on El Alamein. It is 18.8 ms after this pass
  (53 fps, p95 25 ms, 23 of 1,066 frames over 33 ms) with idle time appearing
  in the profile again.
- **Half of it was the bots' AI and bodies, half the draw.** Of the 25 ms:
  the bots' referee 9 ms (every bot's sensing, decision and path search, run
  at 60 Hz), the sixteen soldier bodies 3.7 ms, the level and bodies draw
  8.7 ms, presentation 1.5 ms.
- **The engine does neither of the two things that cost most.** Its AI is a
  time budget shared by all bots (ledger AI-6: `AIMain::action` hands
  `BotManager::action` a slice of the tick, split between plan execution,
  decisions, pathfinding and sensing), so more bots means each senses less
  often, not more work; ours ran every bot's full pass every display frame,
  twice per world tick. And its renderer draws a soldier as one skinned body
  with one skeleton; ours drew each bot as eight skinned primitives with eight
  separate skeletons, so 123 skeleton composes and 123 bone-texture uploads a
  frame for sixteen men.
- **Seven changes, all measured, all behaviour-preserving** except that a
  route's widening searches are now spread over ticks (below): the referee
  runs once per world tick; one cloned skeleton per source skin; bot bodies
  culled by a sphere; 8 m collision cells; the hull box memoised per pass; a
  round's capsule test gated by a sphere; one path widening per tick.
- **What remains is structural**: a JavaScript sim of sixteen soldiers at 60
  body ticks a second (1.5 ms a frame), a three.js scene of 9,000 objects
  walked twice a frame (4 ms), four skins per soldier in the exported rigs,
  and an AI that still gives every bot a full pass every tick. Those are the
  limits section.

## How it was measured

Two harnesses, both new, both in `tools/bf1942-models/tests/perf/`:

- `simphase.mjs` runs a match on the headless runner (`sim/match.mjs`, the
  page's own AI, bodies and vehicles with no renderer) and times each phase of
  the 30 Hz tick: the referee (sensing, decision, plan execution per bot), the
  world step (soldier bodies, guns, the body world), the vehicle bodies, the
  collider's casts. `--stage <flag>` pins every bot on foot and lays the sides
  out in two lines `--gap` metres apart every `--restage` seconds: the "bots in
  a battle in close proximity" case. `--viewer <dir>` loads another checkout's
  modules against this one's assets, which is how the before/after pairs below
  were taken on identical level data.
- `botfight.cjs` drives `map.html` through the `?shots` hooks: the same staged
  fight in the browser, stepped frames headless with a CPU profile, or
  `--headed --realtime 20` for the player's own conditions (a window on the
  system GL, the page's own loop, frame intervals off `requestAnimationFrame`,
  per-thread CPU from `/proc`). Three runs: `fight`, `noai` (the same bodies
  with every bot's tick emptied) and `base` (no bots).

The headless CPU profile is not the player's frame: under Vulkan ANGLE the GPU
process pegs a core and the renderer stalls in `uniformMatrix4fv` (38 % of the
profile) waiting on it, 50-67 ms a frame. It is right about *shares* of the
JavaScript and useless about milliseconds, which is why every frame time above
is headed.

## Where the frame went (before)

Headed, El Alamein, sixteen bots on foot, two lines 30 m apart across
EastOpenBase, camera 48 m behind one line, 20 s.

| | fight | no AI | no bots |
|---|---|---|---|
| frame mean | 25.0 ms | 16.9 ms (vsync) | 17.8 ms (vsync) |
| p95 / p99 | 50.1 / 83.4 ms | 16.8 / 33.3 ms | 20.5 / 22.5 ms |
| frames over 33 ms | 230 / 802 | 10 / 1,185 | 1 / 1,124 |
| draws | 264 | 247 | 87 |
| skinned meshes / skeletons / bone textures | 131 / 131 / 123 | 123 / 123 / 123 | 2 / 2 / 2 |
| GPU process | 29 % of a core | 44 % | 11 % |

Inclusive time per frame from the fight's profile, the main thread 98 % busy:

| phase | ms / frame | what |
|---|---|---|
| `simulate` | 14.1 | the sim half |
| `referee.tick` | 9.1 | every bot's pass, at 60 Hz |
| `findLocalPath` | 2.9 | the local A* (spikes: one tick ran 428,000 node expansions, 350 ms) |
| `lineClear` | 1.9 | sense rays and the fire plan's line to its target |
| `world.step` | 3.7 | sixteen soldier bodies at 60 body ticks a second |
| `cast` + `sweepSphere` | 3.9 | the collision broadphase under both of the above |
| `draw` | 8.7 | `renderer.render` |
| `updateMatrixWorld` | 2.8 | 2,400 bone and mesh nodes recomposed a frame |
| `projectObject` | 2.3 | 9,000 scene objects visited a frame |
| `uploadTexture` | 0.8 | 123 bone textures a frame |
| `updateBotVisuals` | 1.2 | mixers, morphs, the interpolated pose |
| `presentWorld` | 1.5 | |

The same fight in the headless runner (30 Hz ticks, no renderer, `simphase`),
which is where the sim's own scaling shows:

| level, bots | ms / tick before | p95 / max | ms / tick after | p95 / max |
|---|---|---|---|---|
| El Alamein, 16 on foot (seeds 1-3) | 2.64, 3.01, 2.58 | 4.7-5.6 / 25-29 | 1.42, 1.29, 1.47 | 2.6-3.3 / 16-20 |
| El Alamein, 24 on foot | 4.28 | 8.9 / 31 | | |
| Berlin, 16 on foot (seeds 1-3) | 8.58, 9.46, 8.40 | 12-14 / 26-34 | 2.57, 3.15, 3.11 | 4.9-8.5 / 17-51 |
| Berlin, 16 on foot, seed 3, 70 s | 12.90 | 14.7 / **348.7** | 4.15 | 9.9 / 33.0 |
| El Alamein, 16, natural match (14 mounted) | 7.52 | 12.5 / 66 | 7.48 | 11.1 / 54 |

Berlin was the case to worry about: 6.8 of its 12.9 ms were the soldier bodies,
because the collision grid's 32 m cells held 411 triangles on average and 1,813
in the fullest, and every probe a body casts (a metre or two, several a body
tick) and every sense ray walked the whole cell: 1,444 candidate triangles a
query, 42 us a cast. The natural El Alamein match does not move because it is
75 % mounted and its cost is the vehicle AI (below, "what is left").

## What was changed

1. **The bots' referee runs once per world tick, not once per frame**
   (`map.html` `simulate`). Each pass reads the tick just run and writes the
   input word the next tick consumes -- the headless runner's own order
   (`sim/match.mjs`), so the sim is unchanged; the second pass a 60 Hz frame
   used to run only wrote a word the first pass's replaced, at the full price
   of every bot's sensing, decision and path search. At 60 fps the pass lands
   on the frame between two ticks, predicted from the clock's alpha, so a
   tick frame does not carry both the bodies and the AI; at or under 30 fps it
   runs right after the step. The pass is given the sim time it covers
   (`owed / 30`), so the referee's clock stays sim time whatever the frame
   rate. The human's fire edge, which the bots hear, is latched every frame
   and drained by the next pass. Referee: 9.1 ms a frame to 2.9.
2. **One cloned skeleton per source skin** (`vendor/utils/SkeletonUtils.js`
   `clone`). Upstream clones a `Skeleton` for every `SkinnedMesh`, so a rig
   whose primitives share a glTF skin came out with one skeleton per
   primitive: 123 skeletons for sixteen bots, each composed and uploaded as
   its own bone texture every frame. Meshes that shared a skeleton in the
   source now share the clone; every clone site benefits (bots, remote
   players, seats, the local third-person body, the arms, replays). 123
   skeletons to 67. The floor is the rigs themselves: each soldier pose glb
   carries four skins over different joint subsets (body, hands, face, the
   weapon), so four per body until the exporter merges them.
3. **Bot bodies are frustum-culled by a sphere** (`bot-visuals.js`
   `updateBotVisuals`). Every skinned mesh of a rig is `frustumCulled = false`
   (a posed body leaves its bind-pose sphere), so every bot on the level was
   composed, uploaded and drawn wherever the camera looked. A 3.5 m sphere
   1 m over the feet, tested against last frame's frustum, hides the rig's
   scene; the body stays animated and `capsulesOf` keeps reading it, so a
   round meets a culled bot exactly as it did, and a corpse's rig is shown
   again before it joins the corpse list.
4. **8 m collision cells** (`static-index.js` `CELL_SIZE`, was 32). The same
   triangle tests in a different order: a query walks a sixteenth of the
   candidates, and the DDA's step guard is sized from the grid instead of a
   fixed 256 (at 8 m a 1,500 m diagonal round crosses 375 cells and a fixed
   cap ended it short of a real hit). Berlin: 59 triangles a cell mean, casts
   42 us to 6.5, the soldier bodies 6.8 ms a tick to 1.1.
5. **The hull box memoised per referee pass** (`bot-units.js` `unitInfo`).
   `Box3.setFromObject` over a hull's whole tree, per bot, per target, per
   frame; it feeds only the fire plan's precision. The runner already memoised
   it per tick (`sim/stage.mjs`); the page did not, and it was 15 % of a
   vehicle match's sim in the runner's own profile even memoised.
6. **A round tests a body's capsules only after a sphere says it can reach
   him** (`bot-referee.js` `resolveShot`, `withinReach`). The capsules read
   the drawn rig's bones through a full `updateMatrixWorld`; every round
   built every living body's capsules, most for targets it was flying away
   from. The sphere is 2.5 m about the body centre, a superset of every
   capsule in any pose, and accepts a shooter standing inside it.
7. **One path widening per tick** (`bot-route.js` `extendRoute`). A leg the
   local search could not close was searched again up to six times in the
   same tick, in wider boxes with larger node budgets: up to 428,000 node
   expansions in one 30 Hz tick, the 350 ms stall on Berlin. The widening is
   carried on the route (`r.widen`) and one search runs a tick, so the bot
   waits at most six ticks longer for a leg that needs the widest box. This
   is the one change that alters a seeded match's trace: routes resolve a few
   ticks later, and everything after a chaotic fight differs.

## After

Headed, same level data, same camera, same staging, same machine, minutes
apart (`botfight.cjs --headed --realtime 20`; before served from a pristine
worktree on another port):

| | fight before | fight after | no AI before | no AI after |
|---|---|---|---|---|
| frame mean | 25.0 ms | **18.8 ms** | 16.9 | 18.0 |
| p50 | 16.7 | 18.3 | 16.7 | 18.1 |
| p95 / p99 | 50.1 / 83.4 | **24.9 / 37.2** | 16.8 / 33.3 | 19.8 / 20.3 |
| max | 100 | 51 | 83 | 30 |
| frames over 33 ms | 230 / 802 (29 %) | **23 / 1,066 (2 %)** | 10 / 1,185 | 0 / 1,110 |
| skeletons / bone textures | 131 / 123 | 83 / 71 | 123 / 123 | 67 / 67 |
| skinned meshes drawn | 121 of 131 | 105 of 152 | 121 of 123 | 76 of 123 |
| main thread idle | 0 % | 12.7 % | | |

Per frame after: `simulate` 5.4 ms (referee 2.9, `world.step` 1.5,
`findLocalPath` 0.4, `cast` + `sweepSphere` 1.0), `draw` 9.4, `presentWorld`
1.4. The p50 moved up because the frame no longer alternates between a cheap
frame and a 30 ms one; the p95 and the count over 33 ms are the "laggy".

Pixel and behaviour checks: 159 unit tests over the collider, the bodies, the
bots and the seeded match pass (`test_collision`, `test_body_statics`,
`test_pose_compose`, `test_world`, `test_bot_ai`, `test_sim_match`); a seeded
match still replays byte for byte for its seed. The bots fight in every run
above (13-15 of 16 alive at the end of 20 s, kills logged), take flags and
respawn. `test_sim_vehicles`' `test_the_tank_pair_both_reach_north_outpost`
pins one seeded capture line (`144.67 North_outpost 0->1 bot_0`); it fails on
pristine HEAD already (no samples at all there) and differently with this pass
(the Sherman takes the outpost at 191 s instead of the PanzerIV at 144 s):
change 7 moves the tick a route resolves on, and that recipe's outcome is a
chaotic function of it. The other failures in the full suite
(`test_verify_mutations`, `test_meme`) are on pristine HEAD too and read the
catalogue and the menu art, which this pass does not touch.

## What is left, and why the real game is still cheaper

- **The AI still gives every bot a full pass every tick.** Referee cost is
  linear in bots times the enemies each can see: 24 bots on foot cost 1.7x
  sixteen in the runner. The engine's AI is a time budget (AI-6): with more
  bots each one senses and decides less often, and the budget, not the bot
  count, bounds the cost. A budget here would be a round-robin over the
  bots' sense passes (a bot re-tests its memory every other tick, say) and
  would change the trace; it is the next lever, and a design decision.
- **Sensing rays are the engine's, unbudgeted.** A remembered enemy inside
  the near frustum is re-tested every pass with up to ten rays when blocked
  (`clamp(round(30 r / d), 1, 10)`), and a close fight is where every enemy
  is remembered and close. `lineClear` is still 0.7 ms a frame after this
  pass.
- **Vehicle fights are the next profile.** A natural El Alamein match is 75 %
  mounted and its sim is 7.5 ms a tick in the runner, unchanged here:
  `chooseVehicleTarget` scores every enemy for every mounted bot every pass
  (`decisionMaking` 2.1 ms a tick), `urgencyChange` walks every candidate
  seat, `coverCandidates` walks every cover on the level. The page's copy is
  now no worse than the runner's (change 5); it is not better.
- **Sixteen soldier bodies at 60 body ticks a second** are 1.5 ms a frame:
  two body ticks a world tick each, several collision probes a body tick.
  That is the engine's own rule, in JavaScript.
- **The draw is three.js walking 9,000 objects twice a frame** (matrix walk
  and `projectObject`, 4 ms) plus 400 draws with a material each, and the
  earlier passes' open items still stand: instancing the level's repeated
  statics, sharing materials in `bindDynamicShading`
  (`features/mesh-viewer-performance`). The bots add 2,400 bone and mesh
  nodes to the walk; a rig with one skin instead of four would take a
  quarter of the skeleton work off it, and that is the exporter's.
- **Audio is bounded, not measured for pacing.** The bots' rounds play out of
  `WorldFire`'s pooled slots (three a weapon, dropped past the cap), not a
  panner a shot; the foley one-shots are skipped past 40 m. The headed runs
  hold 300-600 HRTF panners created over a whole run, none in the top threads.
- **The fifth of the frame that is the level** (17 ms base at vsync, `draw` 8
  ms of the after frame with the bots in view) was measured in the earlier
  passes and is unchanged here.
