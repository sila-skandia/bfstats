# Soldier locomotion animation

**Status: prototype, on `poses.html`, for review.** Branch
`claude/soldier-locomotion-anim`, worktree
`.claude/worktrees/soldier-locomotion-anim`. Nothing is committed to `main`.

The replay player renders every soldier as one rigid mid-run still that never
changes while the figure translates across the map. This is the investigation
of why, and a working end-to-end prototype of the fix on the pose page.

---

## 1. The answer: the animation is real, baked, and already parsed

Every question about "does BF1942 ship skeletal animation" was already settled
in this repo before this session. Recording it here because it is the load-bearing
fact and it is spread across four files:

- **`.baf` is baked keyframe data, not runtime IK.** `bf42/baf.py` carries a
  complete, measured reverse-engineering of the format: per-bone, per-frame
  quaternion + translation, RLE-compressed, 1.15 fixed point for rotations and
  `1/2^precision` for positions. Nothing is procedural. There is a clip to play.
- **`animations.rfa` holds 1,154 `.baf` clips**, 1,153 of which parse cleanly
  with this repo's own reader (the one failure,
  `Weapons/MedPack/MedPackFire.baf`, is corrupt in the shipped game). **None has
  a single frame.**
- **`bf42/animstates.py` already replays the state machine** that says which
  clip a given (state, weapon) plays, including the `copyState` / `copyState2`
  donor sharing — which is why the K98 correctly answers with the **No4's**
  `3PRunUpperNo4.baf`, and the prototype gets that for free.
- **`bf42/gltf.py` already writes multi-keyframe skinned clips.** The flags in
  every level scene are a real 49-frame `.baf` playback.

So there was never a format gap or an extraction gap. The gap was that
`extract_pose.py` sampled **one frame** of **three idle states** and wrote them
as deliberately constant two-key clips. `features/bf1942-3d-models/parity-audit/animation.md`
§"Gap 2" states this exactly; this work is that gap closed for locomotion.

### The playback rule

From the engine, via `features/bf1942-engine-reference/ledger.md` **ANIM-1**:
`AnimationStateMachineInstance::updateState` advances a **normalized** phase by
`dt * speed`, and `applyOnSkeleton` slerps frames `int(phase * N) % N` and `+1`.

Two consequences the extractor now depends on:

- **`speed` is cycles per second, so a clip's period is `1 / |speed|`** — the
  frame count sets resolution, not duration. 13-frame `3PRunLower` at 1.60 is a
  0.625 s stride; 24-frame `3PWalkLower` at 1.00 is a 1 s one.
- **The cycle wraps frame N-1 back to frame 0.** The export therefore writes
  N+1 keyframes with the last repeating the first, so a three.js `LoopRepeat`
  action seams exactly where the engine's `%` does.

Rates come from the state machine after `animations/3pAnimationsTweaking.con`
has replaced them (ledger ANIM-3), which `animstates.py` already honours.

### The clips are in place; there is no root motion to strip

Measured on `3PRunLower.baf`: the `Bip01` root translation stays at
(-0.02, +0.01, -0.93) +- 3 cm across all 13 frames. The X/Y wobble is body sway,
the Z is the vertical bob, and there is no forward drift — the engine moves the
object and the clip animates in place. A replay player can translate the figure
along its recorded path and play the clip on top with nothing to cancel out.

The bob has **two minima per cycle**, which is what identifies the 13-frame run
clip as a **full two-step stride** rather than a single step.

---

## 2. Two clips per gait, not one

The engine runs the lower and upper body as **two independent state machines
with independent phases**. Their bone sets are disjoint — 11 lower (`Bip01`,
pelvis, legs, `Spine Root`) against 44 upper (`Bip01 Spine` out to the
fingertips), 55 together, which is exactly the 55 the existing stance clips
cover.

The export mirrors that: each gait ships as `<gait>.lower` + `<gait>.upper`.
Two `AnimationMixer` actions at full weight compose rather than contend, and
nothing has to be resampled.

This is not a stylistic choice. A composite clip needs one period, and the two
halves do not always share one:

| state pair | lower | upper |
|---|---|---|
| `Lb_RunForward` / `Ub_RunForward<W>` (3P) | 1.60 | 1.60 |
| `Lb_StrafeLeft` / `Ub_StrafeLeft<W>` | 1.30 | 1.00 |
| `Lb_RunForward` / `Ub_RunForwardThompson` (**1P**) | 1.60 | **1.40** |

A 1.6-against-1.4 pair only repeats after 7 lower cycles (5 s). Splitting the
halves also gives the replay viewer what it will actually need: **running legs
under an aiming upper body**, which is what the game shows and what one fused
clip cannot express.

> Doc nit for the engine ledger: **ANIM-3** cites `Ub_RunForwardThompson` as
> "0.7 -> 1.40". 1.40 is the **`set1pAnimationSpeed`** value; the third-person
> state is `set3pAnimationSpeed Ub_RunForwardThompson 1.60`. Both lines are in
> the shipped tweak files; the ledger entry names only one.

---

## 3. What was built

### Extractor

**`tools/bf1942-models/extract_pose.py`**

- `GAITS` table: `run` / `walk` / `crouchwalk` / `crawl` ->
  (`Lb_RunForward`, `RunForward`) and so on. Table-driven; adding
  `Lb_StrafeLeft`, the jumps, the deaths or the ladder is one row each.
- `clip_timeline(animation, speed, skeleton)` — every frame aligned into mesh
  space via the existing `pose.align_clip_roots`, plus the period `1/|speed|`.
  A negative speed reverses the frames after frame 0, which is what
  `Lb_RunBackward` (the forward clip at -1.60) means.
- `timeline_tracks(frames, period, joint_nodes)` — N+1 evenly spaced keys, the
  last repeating the first.
- `resolve_gait` / `collect_gaits` — the same shape as the stance path, but a
  gait a mod lacks is **reported, not raised**, so one missing crouch clip never
  fails a pair.
- `gait_grip` / `gait_assets` — which shared bundle a weapon's clips live in,
  and the two paths a pose file names.
- `export_gait_clips` / `write_shared_gaits` — the sidecars, written once per
  run (section 5), with `_joint_hierarchy` and `_write_clip_bundle` building a
  clips-only `.glb`.
- The `.glb` gains `gaitClips`, `gaitSource`, `gaitAssets` and a `gaits` block
  in its top-level `extras` (clip paths, resolved state names, speeds, frame
  counts, periods), which the viewer reads through `gltf.userData`. The
  manifest rows carry the same, so the sidecars can be fetched in parallel
  with the pose rather than after it.
- `--gaits {shared,embed,none}` picks the layout; `none` restores the previous
  stance-only output exactly.

**`tools/bf1942-models/bf42/gltf.py`** — `add_animation` now hemisphere-aligns
consecutive keyframe quaternions. `quat_from_matrix` picks its branch from the
matrix alone, so a bone crossing a branch boundary mid-cycle emitted a sign flip
that a spec-literal reader would interpolate the long way round. three.js
happens to slerp defensively, so this was latent rather than visible, but the
flipped value was also what any direct accessor reader saw. No-op for constant
and single-key tracks (the flags and spin clips benefit too).

### Viewer

**`tools/bf1942-models/viewer/poses.html`** — a **Motion** row
(`idle` / `walk` / `run`, keys Q/W/E, `?motion=` in the URL) beside the existing
Stance row. The gait is resolved from the pair: standing walks or runs, kneeling
and prone have one forward clip each in vanilla (`Lb_CrouchForward`,
`Lb_LieForward`) so both speeds land on it, as in the game.

The stance blend was generalised into one `poseBlend` over a flat weight map
covering stance clips and both halves of every gait, so a stance-to-gait switch
crossfades with the weights summing to 1 on every bone at every instant. The
on-demand render loop stays hot while a gait plays and returns to on-demand at
idle. Re-fitting the camera is still once-per-landing — the figure's bounds
breathe with the stride, and a per-frame fit reads as jitter.

A readout under the row names the resolved states, the frame count, the period,
the speed and the steps/second, and both source `.baf` paths.

Section 5's dedup then moved the clips out of the pose file: the page loads a
pose's mesh and skeleton, loads its two clip sidecars (cached for the session),
and hands the clips to the same `AnimationMixer`, which binds them onto that
pose's own bones by name.

**`tests/test_gaits.py`** — 23 tests: period from speed, frame-count
independence, per-frame root alignment, reversed playback, the wrap keyframe and
its spacing, independent half-periods, error-not-raise on a missing or corrupt
clip, the quaternion hemisphere alignment, and for the dedup — grip resolution
through a donor, metadata without frame decoding, one lower bundle per run, one
upper bundle per *grip* rather than per weapon, a bundle carrying no geometry,
and channels targeting uniquely named joints so name binding is unambiguous.
Full suite: **725 pass** (717 after the first pass, 702 before any of this).

---

## 4. Verification (first pass: clips embedded per pose)

Loaded in the browser against a freshly extracted full matrix
(**224/224 pairs, all four gaits, zero errors** — 8 soldiers x 28 weapons, which
is what the page's "224 pose pairs" counts).

Sampling `Bip01 L Foot` / `Bip01 R Foot` / `Bip01 Pelvis` world positions while
`run` plays:

- feet swing in antiphase, stride length ~0.79 m in Z;
- feet alternate in height, peak lift 0.475 m against the other foot's 0.12 m;
- pelvis bobs 0.9165..0.9609 m — **two peaks per cycle**, so 2 steps per stride;
- the pose at 630 ms matches the pose at 0 ms: the cycle wraps at 0.625 s.

Mixer weights read `gait:run.lower = 1`, `gait:run.upper = 1`, stances at 0;
returning to idle restores `stance:<stance> = 1`. Switching pair mid-gait keeps
the gait, and `GermanSoldier + K98` correctly resolves `Ub_RunForwardK98` to
`3PRunUpperNo4.baf` — the `copyState` donor sharing survives the new path.

### Against `soldier.js`

`soldier.js`'s `STEP_PERIOD.run = 0.36` is **not** an animation rate — its own
comment says so: it is `setRunFrequency 0.36` from
`Objects/Soldiers/Common/Sounds/SoldierSound.inc`, the **footstep sound** clock,
and the same comment already notes that the locomotion clips are in-place and
played at a rate the movement speed drives.

The extracted animation gives **0.3125 s per step** (0.625 s / 2). So the two
shipped clocks are 15% apart and the engine does not synchronise them. Same
shape for the others: walk 0.5 s/step animated against `setWalkFrequency 0.66`,
crawl and crouch 0.5 s against 0.6 and 0.5.

Nothing here needs changing — but **a future "footsteps in the replay" feature
must drive audio off `STEP_PERIOD`, not off the animation phase**, or the sound
will drift against the feet. Worth a line in `soldier.js` if anyone wires the
two together.

---

## 5. Second pass: the dedup, shared clip sidecars

The first pass embedded a private copy of all eight clips in every pose file:
**+267 KB per file, +22%**, and a 224-pair tree of **320.7 MB**. That is
1,792 embedded clips carrying only **96 distinct values**, because neither
half of a gait varies per pose. The second pass moved them out.

### What is actually shared, verified rather than assumed

| | varies with | distinct sets |
|---|---|---|
| lower body | nothing | **1** (4 clips) |
| upper body | the weapon's *grip* | **23** (4 clips each) |

Both premises were measured against the game before any code moved:

- **All 8 vanilla soldiers declare the same rig.** `BritishSoldier`,
  `GermanSoldier`, `GermanDesertSoldier`, `JapaneseSoldier` and
  `RussianSoldier` name `animations/UsSoldier.ske`; `USSoldier`,
  `USMarineSoldier` and `CanadianSoldier` name `animations/USSoldier.ske` —
  two spellings of one case-insensitive path, 67 bones, identical hash. So one
  joint hierarchy retargets onto all of them. `write_shared_gaits` re-checks
  this per run and warns if a mod ships two genuinely different rigs.
- **`Lb_RunForward` takes no weapon**, so the lower half is weapon-independent
  by construction.
- **28 weapons resolve to 23 grips, not 28.** `copyState`'s donor argument has
  K98 / K98Sniper / No4 / No4Sniper share one clip set, Bazooka / Panzershreck
  another, Colt / WalterP38 a third. Every weapon resolves to the *same* donor
  folder on all four gaits, and weapons sharing a folder share the playback
  rate — checked across all 28, and asserted in the tests.
- **Name-based retargeting is unambiguous here.** The 55 bones a gait touches
  all exist in every pose file, and none of them is a duplicated node name.
  (A pose file does have one duplicate — the soldier's `Thompson` prop bone
  against the weapon node — but no gait clip targets it, and the bone comes
  first in node order so it keeps the plain name anyway.)

### Layout

```
viewer/models/poses/
  <Soldier>__<Weapon>.pose.glb     mesh + skeleton + 3 stance clips
                                   extras.gaitAssets -> its two sidecars
  gaits/lower.gait.glb              67 joints, 4 clips, no geometry   67 KB
  gaits/<Grip>.gait.glb             67 joints, 4 clips, no geometry  227 KB x 23
  gaits/gaits.json                  grip map + weapon -> grip
```

A sidecar is joints and animations, nothing else — no meshes, no materials, no
skin. `gltf.py`'s `build` now omits an empty `meshes` array rather than
emitting `[]`, because glTF 2.0 gives every top-level array `minItems: 1`.

Retargeting needs no track rewriting. three.js derives a clip's track names
from the nodes its channels target, and binds them against whatever root the
`AnimationMixer` holds — here, the pose's own scene. The sidecar's bone names
*are* the interface.

`extract_pose.py` gains `--gaits {shared,embed,none}`, default `shared`.
`embed` restores the first pass's layout (kept because it is the reference the
equivalence check below compares against, and because a single self-contained
file is occasionally what you want); `none` is stance stills only. The
per-pair pass also stops decoding frames it will not write — `resolve_gait`
takes `load_frames=False` — since the metadata is all a pose file needs.

### Results

```
                      embed        shared
224 pose glbs        314.6 MB     262.1 MB
gait sidecars              -        5.1 MB   (24 files)
tree total           320.7 MB     269.1 MB      -51.6 MB  (-16.1%)
gait bytes            57.1 MB       5.1 MB      -52.0 MB  (-91.1%)
distinct clips          1,792           96
```

A pose file is back to within ~1.5 KB of its no-gait size (the `gaits` and
`gaitAssets` extras). Extraction takes 80 s for the full matrix, up from 70 s —
the sidecar pass is a few seconds and the per-pair saving does not quite cover
it.

The win shows up in requests too, not just bytes: browsing six soldiers across
five weapons in one session fetched **5** sidecars — `lower` once, plus one per
distinct grip. Panzershreck reused Bazooka's; all six soldiers reused
Thompson's.

### Still on the table

`add_animation` allocates a fresh time accessor per track even though every
track in a clip shares one timeline. A 44-bone upper clip therefore carries 44
identical time accessors; the sidecars are ~227 KB against ~106 KB of real
sampler payload, so better than half of a bundle is accessor and bufferView
JSON. Sharing one input accessor per clip would take roughly a third of that
back. Not done here — it changes `add_animation` for the flag and spin clips
too, and it is a different change from the dedup.

---

## 5a. Verifying the dedup changed nothing but the layout

A refactor of the loading path can look perfect in a screenshot and still be
subtly wrong, so this was checked three ways.

**The data is byte-identical.** For 5 pairs across 5 soldiers and 5 grips, all
4 gaits and both halves — 40 clips — the sidecar's sampler payload (keyframe
times, quaternions, translations) was compared against the same clip from an
`--gaits embed` build, **keyed by the bone name each channel targets** so that
different node numbering between the two layouts cannot hide a difference.
**40/40 byte-identical.**

**The retargeting is exact across soldiers.** One gait sampled at 16 fixed
phases of its cycle, on six soldiers holding the Thompson — US, Russian,
Japanese, Canadian, German Desert, US Marine — comparing every coordinate of
six bones at every phase:

```
max |difference| vs USSoldier:  RU 0   JP 0   CA 0   GermanDesert 0   Marine 0
```

Zero, exactly, everywhere. One clip, six different pose files, six different
skeleton instances.

**The negative control passes.** Same soldier, different grips: the lower-body
bones are identical (`0`, they share `lower.gait.glb`) while the upper-body
bones genuinely differ — Thompson against No4 by 0.10 m, against Bar1918 by
0.21 m, against Bazooka by 0.28 m. If retargeting were silently failing to
apply the upper bundle, that would read `0` too. And the two donor pairs the
state machine says share a bundle do read `0`: K98 against No4, Bazooka
against Panzershreck.

**The motion is still a real gait**, sampled deterministically over one full
cycle (`__poseInspector.sampleCycle`, which settles the weights and parks both
halves at exact clip times, so it never waits on the render loop):

| gait | period | stride L/R | foot lift | pelvis height | bob | peaks | foot antiphase |
|---|---|---|---|---|---|---|---|
| run | 0.625 s | 0.80 / 0.82 m | 0.354 m | 0.924 m | 0.051 m | 2 | -0.97 |
| walk | 1.000 s | 0.74 / 0.78 m | 0.132 m | 1.012 m | 0.048 m | 2 | -0.90 |
| crouchwalk | 1.000 s | 0.74 / 0.70 m | 0.146 m | 0.704 m | 0.099 m | 2 | -0.98 |
| crawl | 1.000 s | 0.42 / 0.39 m | 0.077 m | 0.158 m | 0.039 m | 2 | -0.93 |

Every row is physically sensible and distinct: pelvis height descends
standing > running (a forward-leaning run) > kneeling > prone; a run lifts the
feet 35 cm against a walk's 13 cm; and the crawl has the smallest foot lift
but by far the largest hand swing (0.38 m against the run's 0.10 m), because a
prone crawl is pulled along by the arms. Two pelvis peaks per cycle on all
four confirms each clip is a two-step stride.

Suite: **725 tests pass** (717 before the dedup, 702 before any of this).

> Measurement note for anyone repeating this: the Browser pane throttles
> `requestAnimationFrame` hard when it is not on screen, so anything that waits
> on a crossfade to settle reads stale weights. That is why `sampleCycle`
> applies the target weights itself instead of sleeping. An `idle` switch that
> appears not to take is the same artifact — it lands as soon as the pane
> renders a few frames.

---

## 6. Carrying this into the replay viewer (not done here)

1. ~~**Deduplicate the clips first.**~~ Done — section 5. The replay viewer can
   load one `lower.gait.glb` plus one bundle per grip actually present in the
   round, and share them across every soldier on the map.
2. **Pick the state from the recorded motion.** The replay already has per-tick
   positions; ground speed plus the recorded stance selects
   `idle / walk / run / crouchwalk / crawl` the same way `GAIT_FOR` does here.
   The full `Lb_` vocabulary (85 states) is enumerated in the parity audit if
   turns, strafes, jumps and deaths are wanted later.
3. **Keep the halves split.** A soldier running while aiming is
   `run.lower` + `Ub_StandAim<W>` — the engine's own composition, and only
   possible because the export does not fuse them.
4. **Phase-offset each soldier** so a squad does not march in lockstep. The
   engine has a primitive for exactly this: `setUserRandomStartTime`, a start
   phase of `(rand & 0xff) / 255` (ledger ANIM-6). `animstates.py` already
   parses it into `State.random_start`.
5. **Use the engine's own crossfade rate** rather than a fixed one. Ledger
   ANIM-4: the blend weight ramps `w += dt * morphFactor`, so a fade is
   `1 / morphFactor` seconds, and `State.morph_factor` is already parsed. The
   `map.html` viewer already reads this from extras for its stance fades.
6. **Do not sync footstep audio to the animation phase** (section 4).

### Noticed in passing, not investigated

Re-extracting a pose `.glb` from current `main` pulls the Thompson's
muzzle-flash emitter geometry into the file (`em_MuzzThomp`,
`em_MuzzThomp_glow`, `e_MuzzThomp`, `Em_shell9mm1P`, `e_shell9mm`,
`Thompson muzzle 1`), which `poses.html` renders as a **permanent orange flash
hanging off every weapon**. It reproduces with `--no-gaits`, so it is not from
this work — it is the assembler's effects support reaching the pose export,
against shipped assets that predate it. Whoever re-extracts the pose tree next
will see it; `extract_pose.py` presumably wants the same
`geometry_is_first_person`-style filter for effect emitters.

The detached-hand bug in `replay.js` was not investigated (out of scope), and
nothing in the pose/skinning path here pointed at a second cause — the pose
export builds one skeleton per file and never clones it, so it cannot reproduce
the symptom.

---

## 7. Stance capture (2026-09-16)

**Confirmed, not assumed: the current recorder cannot tell crouch or prone
from standing.** A replay-viewer gait selector (`tools/bf1942-models/viewer/
gait-select.js`) can therefore only ever answer idle/walk/run. This section is
the evidence for that, and what a *future* recorder change would need — no
change to bf42plus was made here; that needs a real build+install+play cycle
on the LAN server, which only the project owner can run (this repo's own
convention for BF1942 asset/tooling work — see this file's own history of
being verified live rather than assumed).

### What the recorder actually samples

`bf42plus/src/replay.cpp`'s per-object sampler (`sampleObjects`, called from
`replay_onFrame` at up to 10 Hz) keeps exactly this much state per networked
object:

```cpp
struct ObjectState {
    Pos3 pos;
    Quat rot;
    int occupant;   // declared, never written past its -1 default
    bool seenThisSample;
    bool hasArmor;
    float hitPoints;
    int lastHitPlayer;
};
```

and writes `pos`/`rot` (from `getAbsoluteTransformation()`) and the Armor
fields (`readArmor`, via `IObject::queryComponent(IID_IArmor, IID_IArmor)`,
`IID_IArmor = 0xc4a4`) to the `s`/`a`/`o` records
(`features/round-replay-capture/README.md` sec 9). There is no third
category. Grepping all of `bf42plus/src` and `bf42plus/include` for
`pose|crouch|prone|stance|c_Sst` turns up nothing but coincidental substring
matches on `distance`. `viewer/soldier.js`/`physics.js`'s own
`POSE_FLAG_CROUCH`/`POSE_FLAG_PRONE`/`poseFromFlags` — the client's real
0x20/0x40 stance bits, reverse-engineered independently of this recorder for
the standalone movement viewer — describe a byte the *retail client* reads
internally; bf42plus's recorder never reads or writes anything resembling it.
So: every recording made with the recorder as it ships today (format v1
through v3) has no field to read a stance out of, for any life, full stop.

This also settles a subtler question worth stating explicitly: **even a
perfect speed-based classifier could not recover stance from position alone**,
because the speed bands overlap. `soldier.js`'s `GAIT_SPEED` gives crouch a
top speed of 2 m/s — identical to standing walk's 2 m/s — and prone tops out
at 1 m/s, which is not obviously distinguishable from a standing soldier
moving slowly for some other reason (e.g. mid-turn, or the first tick of
acceleration). Stance is not merely unrecorded; it is not recoverable
after the fact from what *is* recorded. It has to be captured at the source.

### Two candidate reads, and the precedent to hold either one to

Hit points are the recorder's one precedent for adding a field that is not
position/rotation, and the bar it set is worth restating exactly, because a
stance field should clear the same bar before it ships: `readArmor` does not
trust a hardcoded offset blind. `armorVtableMatches` disassembles the actual
getter machine code at four vtable slots (5, 7, 11, 30) *every time a new
vtable is seen* and only then trusts the fixed offsets `+0x38`/`+0x3C`/`+0xF0`/
`+0x14` — checked once per vtable, cached, and logged (`debuglogt`) the one
time it fails. The offsets themselves were cross-checked against the Linux
dedicated server's symbolised binary before being trusted at all. Nothing
below should ship without the same two things: a runtime signature check
before trusting an offset, and a second binary (or a live LAN server session)
to check it against.

**Path A — the pose-flags byte.** `soldier.js`'s `poseFromFlags` cites a real
engine function, `0x005013f8` (`pose = (flags & 0x20) ? 1 : (flags & 0x40) >>
5`), that takes a flags byte and returns a pose index — so the bits exist in
BF1942.exe. What is *not* established is where that byte lives between
frames. `features/bf1942-engine-reference/ledger.md` **PHY-1** is the direct
caution here: tracing the jump bit (0x80) of the same byte led to "a word at
`[esp+0x2c]`" inside `BFSoldier::handlePlayerInput` — a stack temporary,
recomputed every call from the crouch/prone/action inputs of that frame, not
demonstrated to be parked anywhere `sampleObjects`'s separate, later,
once-per-10Hz-tick walk over `ObjectManager_getAllRegisteredObjects()` could
independently re-read. Crouch and prone (0x20/0x40) were not traced by that
entry and may sit differently than jump does — genuinely open — but "the byte
`poseFromFlags` reads" and "a field on the live object" are not yet known to
be the same claim, and treating them as interchangeable without checking
would be exactly the kind of assumption this document's confidence ladder
exists to catch.

**Path B — the lower-body animation state.** `ledger.md`'s "Soldier camera
shake / view bob" section already places and cross-checks something more
promising: a `BFSoldier` holds four `AnimationStateMachineInstance`s, 68 bytes
each, at a fixed offset confirmed on *both* binaries — `+0x2c0` on the client
(the binary bf42plus hooks), `+0x294` on the Linux dedicated server — slot 0
being the lower body, the exact machine that owns every `Lb_Stand`/
`Lb_Crouch*`/`Lb_Lie*` state (the same vocabulary `extract_pose.py`'s `GAITS`
table and `bf42/animstates.py` already resolve gait names through on the
extraction side). If that instance exposes its current state's name or id at
some sub-offset — not yet located; the ledger's own account of this struct
stops at "a fourth [slot] that... nothing here has read" — a recorder could
read it the same way `sampleObjects` already walks live objects: downcast the
generic `IObject*` to `BFSoldier` via its template's class id
(`CID_BFSoldierTemplate = 0x9493`, `bf42plus/src/bf/generic.h:6`), then read
the lower-body instance's state and map its name to a stance exactly the way
gait names are already mapped to clips — a name lookup, not a bit test. This
is more speculative than Path A (the field to read is not yet found at all)
but more likely to be *stable* if found, since it is the same kind of
per-instance state a gait itself already comes from, rather than a
per-frame-recomputed input flag.

**Either path is `open`, not `working`**, in this document's own terms
(`features/round-replay-capture/README.md`'s confidence ladder). Neither
should be wired into `replay.cpp` without first: (1) confirming on a live
session (Ghidra bridge or the LAN server, per `round-replay-capture/
README.md` sec 6) that the candidate field is populated and stable across at
least one full crouch/stand and prone/stand cycle while the object is *not*
being polled via `handlePlayerInput`, the way `armorVtableMatches` confirms
Armor's vtable before every read; and (2) a real build+install+play recording
that shows the new field changing exactly when the recording player's own
stance changes and not otherwise. Both are out of scope here.

### What the recorder change would look like, once a field clears that bar

One more value per soldier object, written only on change — the same shape
`a` (hit points) already uses, not a new record kind: e.g. a stance code
(0 stand / 1 crouch / 2 prone, matching `physics.js`'s own `poseFromFlags`
encoding so the two conventions do not diverge) appended to the `s` record's
per-object tuple, or its own `st`-keyed record parallel to `a`. Format version
bumps to 4. Whichever field wins, `gait-select.js`'s job gets strictly easier,
not harder: with a real stance signal, gait selection stops being "infer
idle/walk/run from position deltas and hope" and becomes "read the stance,
then use the matching one of `GAIT_SPEED`'s four (not two) speed tables" —
the hysteresis and heading-direction logic this module already has would
carry over unchanged.

---

## Reproduce

```bash
cd tools/bf1942-models
python3 extract_pose.py USSoldier Thompson --out ./viewer/models/poses   # one pair
python3 extract_pose.py --matrix --export --out ./viewer/models/poses -j 8   # all 224, ~80 s
python3 extract_pose.py --matrix --export --gaits embed --out ./out-embed    # the old layout
python3 -m unittest discover -s tests -p "test_*.py" -q
```

Then serve `viewer/` and open `poses.html`; keys 1/2/3 for stance, Q/W/E for
motion.
