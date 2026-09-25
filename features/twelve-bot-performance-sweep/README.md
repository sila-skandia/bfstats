# The twelve bot performance sweep

Dylan reported the mesh map player degrading at about twelve bots on Bocage.
Three symptoms, verbatim: sound will stutter then eventually cut out; smoke
effects and propellers on planes turn into black squares rather than their
actual animation; flying a plane becomes stuttery and almost unplayable. A
`top` during a bot count of 12 on Bocage read CPU at 1330% on one process.

This document records what the machine measured, what was actually wrong, the
two fixes that landed, and the one suspect that is still open.

## What the machine measures

Probe harness: `tools/bf1942-models/scratchpad/botload/botload2.cjs`
(gitignored scratchpad). It drives a headed Chrome on this machine's Iris Xe,
loads `map.html?mod=bf1942&map=bocage&botCount=12&botSkill=0.75&shots&nopreserve`
with audio ON, spawns the local player, teleports it to the thickest bot
cluster, then puts it in an aircraft low over the heaviest fighting. It
samples per frame rAF intervals, per process CPU seconds from CDP
`SystemInfo.getProcessInfo`, a WebAudio node census (create wrappers on the
context), effect and audio budgets, renderer.info, scene census, and the GPU
process's dmabuf fds.

Runs so far, twelve bots on Bocage:

| run | browser | phases flown | fps | worst p95 | renderer cores | GPU cores | notes |
|-----|---------|--------------|-----|-----------|----------------|-----------|-------|
| run-1 | Playwright Chromium 141 | spectate, foot, 60 s flight | 59.3 to 59.8 | 16.8 ms | about 1.0 | 0.25 | clean, no loss |
| run-149 | Chrome 149 | spectate, foot | 59.6 | 16.8 ms | about 1.0 | 0.25 | WebGL context lost at about 2 min, page never restored |
| run-149b | Chrome 149 | spectate, foot, 240 s flight | 59.3 to 57.3 | 18.8 ms | 0.85 to 1.1 | 0.26 to 0.32 | clean |
| run-long | Chrome 149 | spectate, foot, 660 s flight | 57.1 to 59.7 | 18.8 ms | 0.94 in flight | 0.25 | clean; player died early and parked on the spawn screen for most of it |
| run-fix | Chrome 149, audio fixes in | spectate, foot, flight to 5 min | 59.9 to 60 | 16.8 ms | about 1.0 | 0.28 | budget holds at 5 |
| run-final | Chrome 149, audio fixes in | spectate, foot, flight (invalid, canvas dead) | n/a | n/a | n/a | n/a | GPU process crashed at about 1.5 min; context never restored for 9 min |
| run-stderr | Chrome 149, audio fixes in, browser stderr captured | spectate, foot, 300 s flight | 54.8 to 60.4 | 22.7 ms | n/a | n/a | clean; the sibling agent's test suite was running (load 15), which is why fps dips |
| run-crash | Chrome 149, recovery fix in | spectate, foot, 420 s flight | 49 to 55.5 | 29.1 ms | n/a | n/a | clean (load 14 from the sibling's suite); budget 5, max 6, panners max 89 |

The frame budget never broke in any clean run. The renderer sat near one core
and the GPU process near a quarter core with vsync at 60. A 20 second CDP CPU
profile of the flight phase put the main thread at 39% idle with the largest
items `updateMatrixWorld` at 8.7% self and the statics collider `cast` at
about 4% through bot sensing and round sweeps. Nothing in the page's own
per-frame cost explains Dylan's collapse.

## Finding 1: the vehicle audio rack exceeded its own budget (fixed)

`vehicle-audio.js` documents a five hull budget (`MAX_LIVE_VEHICLES`). The
cap only gated new builds. A hull built while near kept its whole graph
forever while its crew stayed aboard, because the hold at master 0 rule never
tore anything down, and nothing re-sorted the queue after a claim. Bots board
and leave hulls all over the map, so over minutes the live count climbed past
the budget. Measured in run-1: `vehiclesAudio.live` walked 6, 7, 8, 9 with
nine bot-driven hulls. Each live hull is about eleven looping buffer sources
plus its gun patch, so at nine hulls the audio graph ran at roughly twice the
voices the design budgets for. That is the structural lead for the audio
stutter under a twelve bot fight.

The fix makes the budget real. `_rebalance` sorts wanted hulls nearest first
on every claim and release, and also on a 0.5 second beat from `update`
(churn needs the beat because a hull crewed for minutes never fires a claim
while it drifts out of the front). A built hull past slot five is demoted:
`EngineAudio.release()` plays the shut down tail, then the entry's graph is
disposed, and the next rebalance rebuilds it if it comes near again. The
rebuild re-rolls the loop phases, which is what the old hold at master 0 rule
existed to avoid, but a demote only fires on hulls far enough to be outside
the budget, where the phase is inaudible. Measured in run-fix with the fix
live: `live` stayed at 5 with a transient 6 during the 0.4 second tail, while
nine hulls held claims.

The churn regression test in `tests/test_vehicle_audio.mjs` crews three hulls
near, drives them away, claims three fresh near hulls, and asserts the live
count lands back on `MAX_LIVE_VEHICLES`.

## Finding 2: footstep foley built voices for nobody (fixed)

Every bot footstep builds up to three one shots (surface, fabric, harness),
each its own buffer source, gain, and HRTF panner. Nothing gated the call by
distance. The panner clamps at 40 m, so past 40 m a step plays at about
-32 dB, effectively nothing, but the nodes were still built and still
rendered. Twelve bots walking is about a hundred one shot panners a second,
most of them for nobody. The audio service measured 0.25 to 0.5 cores on this
machine just absorbing the churn.

The fix is one early return in `playSoldierOneShot`
(`viewer/page-audio.js`): with a world space position, skip the voice when it
sits beyond 40 m from the listener's camera matrix. The listener's own
first person sounds pass no position and are untouched. Peak live panners in
the probes fell from 113 to 94, and the remaining population is the near bots
plus engine and gun patches that the pools already budget.

## Finding 3: the GPU process is unstable on Chrome 149 (open)

This is the suspect for the two symptoms the fixes above do not explain:
black squares and the 1330% reading.

Evidence on the table:

* Chromium 141 ran the same scenario twice, clean, no context loss.
* Chrome 149 lost the WebGL context in two of five full runs (run-149 about
  two minutes in, run-final about ninety seconds in), always during the
  twelve bot fight. Chromium 141 never lost it.
* Chrome's own log in run-final names the event
  (`chrome.log`, captured with `--enable-logging --v=1`):
  `ERROR: content/browser/gpu/gpu_process_host.cc:1005] GPU process exited
  unexpectedly: exit_code=8704`, then `The GPU process has crashed 1 time(s)`
  and `Reinitialized the GPU process after a crash. The reported
  initialization time was 1607 ms`.
* After that crash the page's `webglcontextrestored` never fired for the
  remaining nine minutes of the run (draw calls sat at 8, the page's own
  card stayed up). Chrome restarted its GPU process and still the context
  did not come back.
* Dylan's own profile holds a GPU process crash dump from Sep 17 21:35
  (`~/.config/google-chrome/Crash Reports/completed/b4c6c338-*.dmp`,
  `--type=gpu-process`). Two other dumps that morning are Claude automation
  headless runs on SwiftShader, not this.
* The kernel log is not readable without sudo, so driver side resets during
  play sessions are unconfirmed. The GPU process's own stderr (Mesa's words)
  was captured for one clean run and showed nothing; the crashing runs were
  not captured yet. One clean-run stderr note worth keeping: mid-run, Chrome
  spun up a Dawn adapter on the Iris Xe's Vulkan backend (the WebGL context
  itself runs on ANGLE over OpenGL ES), so two driver backends share one GT
  in a session. Routine adapter discovery, but a possible stressor on a
  driver that is already dying under load.

The story that fits every symptom is a cascade. The GPU process dies under
load (driver fault or memory pressure). Chrome restarts it, but the page's
WebGL context stays lost, the canvas freezes, and the page parks on its
reload card. If the context does come back (Chrome's own restore path, which
the probes have not yet observed), some texture re-uploads can fail and
those meshes draw as untextured quads, which reads as black squares on
exactly the things Dylan named, smoke puffs and prop blur discs. If the
process dies repeatedly the browser falls back to software rendering, and a
software rendered twelve bot Bocage on a 20 core box is the kind of thing
`top` reports at 1300% and more, with everything, audio included, stuttering.

The viewer now helps itself: on `webglcontextlost` the page schedules a
forced `WEBGL_lose_context.restoreContext()` 1.5 s in (Chrome's own restore
never arrived in the observed run, and a forced restore is a no-op if the
browser is already restoring), and `webglcontextrestored` now clears the
page's `contextLost` flag and hides the card instead of only updating its
message, because three r169 re-initialises its GL state (`initGLContext`)
on that event and textures re-upload as they are drawn. The page keeps
playing through the blip instead of freezing until a manual reload. The real
crash did not reproduce in the run that carried the fix (two of six runs
crashed so far), so this path still has to be verified against a real
`GPU process exited unexpectedly` rather than a SwiftShader simulation,
where `restoreContext()` is a no-op.

What would still settle it: the crashing run's GPU stderr (`DEBUG=pw:browser`
with the harness, so Mesa's own words are captured), `top -H` during a bad
session to name the busy process, `journalctl -k | grep -iE "hang|reset"`
for i915 resets, and whether the "Graphics context lost" card appears in
Dylan's real sessions.

## Ruled out

* No Web Workers, no OffscreenCanvas: the whole simulation is main thread.
* The frame budget at twelve bots: spectate, on foot near the thickest
  cluster, and in flight all hold 59 to 60 fps with p95 at or under 19 ms on
  both browser generations.
* The effects pool is capped at 1200 particles and observed at 8 to 10 runs
  and 114 to 269 live particles during fights.
* No JS leak in six minutes: heap flat at 170 to 220 MB, textures 708 to 830,
  geometries climb from 119 and saturate near 477 as kit drops, corpses and
  cockpit grafts reach their steady state, all TTL bounded.
* The GPU process's dmabuf footprint sat flat at 54 MB across a whole run,
  so the viewer alone does not walk GPU memory upward.
* Bot sensing is ray banded with a hard ray cap per tick; round sweeps share
  a 192 cast frame budget (heavy fire can visibly stall rounds in the air,
  a correctness oddity, not a load problem).
* Wrecks linger 10 s plus a 2.5 s fade, corpses have a TTL, decals cap at
  128, world fire holds 12 slots, effect audio arbitrates a 26 voice budget.

## Changed files

* `tools/bf1942-models/viewer/vehicle-audio.js`: demote path, the 0.5 s
  rebalance beat, `demoting` in the snapshot, budget rule comment rewritten.
* `tools/bf1942-models/viewer/page-audio.js`: the 40 m foley gate.
* `tools/bf1942-models/viewer/map.html`: forced context restore after a
  `webglcontextlost`, and `webglcontextrestored` now resumes the frame loop
  instead of leaving the page parked until a manual reload.
* `tools/bf1942-models/tests/test_vehicle_audio.mjs`: the churn regression
  test.
* `tools/bf1942-models/scratchpad/botload/` (gitignored): the probe harness,
  the restore probe and run artifacts.

## Verification

`python3 -m unittest discover -s tools/bf1942-models/tests` runs the suite
that `verify.sh` runs. `tests.test_vehicle_audio`, `tests.test_engine_audio`
and `tests.test_effect_audio` pass with the changes; the churn test is new.
The full `python3 -m unittest discover -s tools/bf1942-models/tests` (the
command `verify.sh` runs) completed green with the changes too; its output
carries pre-existing `ResourceWarning: unclosed file` notes from the archive
reading tests, harmless.
The probe runs in the table above are the behavioural check: the vehicle
audio budget holds (72 of 102 samples at 5, max 6 during a demote tail, and
lower when bots genuinely leave hulls), the foley census peaked at 89 live
panners against 113 before the gate, and heap, texture count and the GPU
process's dmabuf footprint are flat across every run. The recovery fix's
real-crash verification is still pending a crash in a run that carries it.
