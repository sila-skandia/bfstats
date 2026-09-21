# The soldier: what a blast costs him, and what he plays in each stance

Stream W5-A of the [parity round](../bf1942-parity-round-2026-09-19/README.md),
2026-09-21. Branch `w5/soldier-stance-and-blast`.

Three items were handed to this stream. One of them turned out to be already
built and needed measuring rather than building; one was real and is done; the
third had moved under the brief and what replaced it is a live bug that is now
fixed. Each section below says which.

---

## 1. An explosion hurts the man on foot (HP-9, HP-10) — already built, now measured

**This was not open.** Wave 3 stream B built it and it merged in `cf7f352`:
`viewer/soldier-exposure.js` carries the sampling, `splashTargets()` in
`map.html` puts the local player in the blast's target list with his own
`Armor` and his pose, `soldierExposureFor` casts the rays, and
`VehicleDamageSet.applySplash` multiplies the exposure into the distance
falloff. The brief for this stream predates that merge.

What this stream added is the ability to *measure* it, and the measurement.

### The sampling law, re-derived from the server binary

Not taken from the module's own header. `nm -C
bf1942_lnxded-1.61-patched/bf1942/bf1942_lnxded.static`, then `objdump -d -M
intel` over `GameServer::checkForHitOnSoldier` (`0x08156090`), and the three
tables read straight out of the file's `LOAD` segments:

| pose | dispatch | loop counter | table | divisor |
|---|---|---|---|---|
| 2, prone | `cmp eax,0x2; je 0x81563e0` (`0x081560c5`) | `mov edi,0x2` (`0x081563ec`) -> 3 | `0x0871ba00` | `fdiv ds:0x86c08c8` = **3.0** |
| 1, crouch | `dec eax; je 0x81562c0` (`0x081560da`) | `mov edi,0x8` (`0x081562cc`) -> 9 | `0x0871ba40` | `fdiv ds:0x86c08cc` = **9.0** |
| 0, stand | `test eax,eax; jne` (`0x081560ed`) | `mov edi,0x8` (`0x08156101`) -> 9 | `0x0871bac0` | `fdiv ds:0x86c08d0` = **18.0** |

The loops are `dec edi; jns` (`0x081563c5`, `0x081564e5`, `0x081561fb`), so the
counts are 9, 9 and 3, not 8, 8 and 2. Anything outside 0..2 takes a `dice::ref2::Debug`
construction and `fldz` (`0x08156298`).

`BFSoldier::getPose()` (`0x0827ddc0`) is the dispatcher's input: it reads
`AnimationStateMachineInstance::getCurrentStateFlags` off `this+0x294` and
returns **1** for flag `0x20`, **2** for flag `0x40`, else **0** — so 0 stand,
1 crouch, 2 prone.

The two 9-sample tables are **byte-identical**, all 108 bytes, checked by
comparing the file bytes at `0x0871ba40` and `0x0871bac0` directly:

```
stand / crouch  (0,-0.1,0) (0,-0.3,0) (0,-0.7,0)
                (-0.2,-0.1,0) (-0.2,-0.3,0) (-0.2,-0.7,0)
                (0.2,-0.1,0) (0.2,-0.3,0) (0.2,-0.7,0)
prone           (0,-0.7,0) (-0.5,-0.7,0) (0.5,-0.7,0)
```

So the **only** difference between a standing man and a crouching one is the
divisor, and a fully exposed standing soldier scores `9/18 = 0.5` against a
crouching one's `9/9 = 1.0`. **Crouching in the open takes exactly double the
splash standing does**, and the cap is one deliberately doubled constant, not a
missing second sample loop. The offsets are added to `getPos()` with no basis
change anywhere in the function, so the lateral spread is always along world X
however the soldier faces.

All of that matches `viewer/soldier-exposure.js` as merged. Nothing needed
changing.

### `window.__blast(point, opts)` — new

A fired round lands where the ballistics put it, and an impact blast is centred
at `hitPos + 0.1 * normal` (HP-9), which nothing on the page reports. So the
distance term — the whole point of an assertion about the falloff — had to be
guessed. `__blast` builds the record `effects-core.js`'s `splashSpec` builds and
hands it to `applyVehicleHit`, so `splashTargets()`, `soldierExposureFor` and
`VehicleDamageSet.applySplash` all run exactly as a shell's do and only the
ballistics are skipped. It returns each soldier's exposure and the HP he lost.

There is deliberately **no damage argument**: what a blast is worth is
`materialDamage(material2) * damageMod(material2, victim)` out of the
MaterialManager tables (DMG-1), and only the geometry is the caller's.

### Measured, on El Alamein

A hand grenade's material 205 against a soldier's material 40:
`materialDamage(205) = 10.0`, `damageMod(205, 40) = 12.0`, so **120 HP at the
centre before exposure and falloff**, and a soldier has 30 hit points.

```
lost = 120 * exposure * (1 - d / radius)
```

Radius 10, blast placed west of the spawn (the east side has a building in the
way, and an obstructed reading tests the collider rather than the falloff),
healed to full between shots:

| stance | d (m) | exposure | HP lost | closed form |
|---|---|---|---|---|
| standing | 9.0 | 0.5 = 9/18 | **6.00** | 6.00 |
| standing | 8.0 | 0.5 | **12.00** | 12.00 |
| crouching | 9.0 | 1.0 = 9/9 | **12.00** | 12.00 |
| crouching | 8.0 | 1.0 | **24.00** | 24.00 |
| prone | 9.0 | 1.0 = 3/3 | **12.00** | 12.00 |
| prone | 10.0 | 1.0 | **0.00** | 0.00 (`radius > d` is strict) |

Crouching costs exactly twice what standing costs at the same point, which is
the 18-against-9 divisor and nothing else. A blast at his own feet takes 30 to
0, sets `destroyed`, and the deploy screen comes back up — the death goes
through `soldierDead` and the existing respawn flow, not a new one.

Cover is real and is the collider's: the same blast placed *east* of the same
spawn scored 0 of 9 samples standing, and on Bocage 3 of 9 at 5 m. Script:
`scratchpad/w5a/blast.mjs`.

> Review: every row of that table reproduced on an independent run
> (`scratchpad/w5a-review/blast-check.mjs`, port 5335) -- 6.00 / 12.00 /
> 12.00 / 24.00 / 12.00 / 0.00, `pose` 0/1/2 matching the stance, exposure
> read both before the blast through the pre-existing `__soldiers` hook and
> after it through `__blast`, and no console errors. `__blast` builds exactly
> the fields `gunfire.js` writes on a real record (`splashPoint`,
> `splashRadius`, `splashMaterial2`, `splashYMod`, `firer`) and hands them to
> the page's own `applyVehicleHit`, so the path it exercises is the real one;
> the single divergence is that it does not run the radius through
> `truncateRadius`, so a caller passing a fractional radius gets something the
> engine never sees.
>
> The engine law re-derived byte for byte against the same binary
> (`scratchpad/w5a-review/bin*.sh`): dispatch, the three `mov edi` counters,
> the three tables and the three divisors are all exactly as stated, and the
> two 9-sample tables are byte-identical over 108 bytes. The pose mapping is
> not inferred: `ObjTemplBFModule::init` registers `c_AsmIsCrouching` = 0x20
> (`0x0829920a`) and `c_AsmIsLying` = 0x40 (`0x0829923a`) through
> `addConstantHelper`, and `getPose()` returns 1 on 0x20 and 2 on 0x40 -- so
> 1 is crouch, 2 is prone, and standing's 0.5 cap is real.
>
> One thing the round's open list should keep: this measures the viewer's
> **linear** falloff (`1 - d/r`), which the round README itself flags at line
> 85 as the Mod Development Toolkit's formula rather than the binary's. HP-10
> (the exposure sampling) is done and merged; whether the falloff *shape*
> inside the radius is the engine's is untouched by this stream.

---

## 2. Crouch and prone play their own aim — built

### What the data says

Surveyed over vanilla's 1,458-state machine (`scratchpad/w5a/survey_stance.py`
and `fams.py`, through `bf42.animstates` over `animations.rfa`). All **28**
weapons that declare `Ub_StandAim<W>` also declare, each with a 1P clip:

> Review correction: the count is 28, not 26. Both survey scripts match a
> hard-coded weapon whitelist, and it misses `RepairPack` and spells the P38
> `P38` where the states spell it `WalterP38`. Re-derived with no whitelist
> (`scratchpad/w5a-review/surv3.py`, `surv4.py`): `Ub_StandAim*` has 29
> matches, one of which is the bare template `Ub_StandAim` with no 1P clip,
> and the other 28 all carry the eight families below, each with a 1P clip.

| state | resolves to | Thompson rate |
|---|---|---|
| `Ub_Crouch<W>` | the **same** `1PStandAim<W>.baf` | 0.33 against standing's 0.1 |
| `Ub_CrouchForward<W>` | the same `1pRun<W>.baf` | 0.86 |
| `Ub_CrouchRaiseWeapon<W>` | the crouched draw-in | |
| `Ub_Lie<W>` | a dedicated `1pLieAim<W>.baf` | 0.2 |
| `Ub_LieForward<W>` | a dedicated `1pCrawl<W>.baf` | 1.0 |
| `Ub_LieFire<W>` | a dedicated `1PLieFire<W>.baf` | 10.0 |
| `Ub_LieReload<W>` | a dedicated `1PLieReload<W>.baf` | 0.21 |
| `Ub_LieRaiseWeapon<W>` | the prone draw-in | |

So crouching is not a different clip, it is the **same clip at a faster rate** —
a crouching man breathes over his sights 3.3x as fast. Lying down is four
genuinely different clips.

Two absences are the data's, and the code reproduces them rather than filling
them in:

- **no weapon declares `Ub_CrouchFire<W>` or `Ub_CrouchReload<W>`**, so a
  crouching man fires and reloads on the standing states;
- **there is no crouch-run**: `Ub_CrouchForward<W>` is the only forward crouch
  state, so walking and running crouched are one family.

Both absences re-derived in review over the raw archive text with no weapon
whitelist at all: zero case-insensitive matches for `crouchfire`,
`crouchreload` or `crouchrun` anywhere in the 28 `.con`/`.inc` files the mesh
pool resolves (`scratchpad/w5a-review/surv.py`). `_001` layering is not a
hazard here — `ArchivePool.add_dir` registers `<name>_001.rfa` before
`<name>.rfa` so a patch wins the first-hit lookup, and vanilla ships no
`animations_001.rfa` in any case. The chains now pin both absences on the
table itself rather than only on a resolution, which is what the review's
mutation test found missing.

### What was built

- `extract_viewmodel.py` bakes eight new families: `crouch`, `crouchWalk`,
  `prone`, `crawl`, `proneFire`, `proneReload`, `crouchDeploy`, `proneDeploy`.
  The two tracked fixtures grew 2.11 MB -> 2.90 MB and 2.16 MB -> 2.93 MB
  (+37%), almost all of it the 181-frame prone reload.
  One of the eight is a duplicate in vanilla: `Ub_CrouchRaiseWeapon<W>` names
  the same `1PDeploy<W>.baf` at the same rate as `Ub_StandRaiseWeapon<W>` on
  all 28 weapons, so `crouchDeploy` and `deploy` are the same animation in a
  vanilla rig. It is baked anyway, because the chain is per mod and a mod may
  declare a real crouched draw-in.
- `viewer/stance-clips.js` (new, free of `three`, tested under node) holds the
  chains and the resolution.
- `viewer/viewmodel-anim.js` takes `stance` and `has` and resolves fire, reload,
  deploy and locomotion through them.
- `map.html` binds the new families, keeps `hasClip` on the hand weapon, stops
  every fire family rather than the standing one, and gates the idle fidgets on
  standing (`addIdle` is registered on `Ub_StandAim<W>` and on nothing else, so
  a crouched soldier fidgets in the engine no more than he does here).

**The stance has to arrive beside the gait.** `soldier.js` `#gaitFor` answers
`'stand'` for *any* stationary soldier, crouched and prone included — it exists
to pick a row of the view-bob table, which is only consulted while moving. A
selector keyed on the gait alone cannot see a crouching man standing still, and
that is exactly why the page played the standing aim in every stance.

A rig published before these families existed answers `hasClip` false for them
and every chain falls back to a standing clip.

> Review correction: "behaves exactly as it did" is not quite true, and the
> difference is the one thing the live site sees before a re-extract. A
> *stationary* crouched or prone soldier on an old rig still lands on `idle`;
> a **moving** one now lands on `walk`, where the old flat `LOCO_CLIP` sent
> both the `crouch` and `prone` gaits to `idle`. Measured by running the same
> kit matrix against a checkout of `2883708` served beside this branch
> (`scratchpad/w5a-review/fallback.mjs`, :5335 against :5336): every standing
> row is identical across the two builds on all five US kits, and the only
> rows that move are `crouch move` and `crawl`, `idle` -> `walk`. That is the
> better clip -- `Ub_CrouchForward<W>` is the same `1pRun<W>.baf` the standing
> walk uses -- but it is a change.

### Measured, on Bocage (US side, medic kit, `USSoldier__Thompson`)

`scratchpad/w5a/stance.mjs`:

| what the player is doing | stance | gait | clip playing |
|---|---|---|---|
| standing still | stand | stand | `idle` |
| walking | stand | walk | `walk` |
| running | stand | run | `run` |
| crouched, still | crouch | **stand** | `crouch` |
| crouched, moving | crouch | crouch | `crouchWalk` |
| prone, still | prone | **stand** | `prone` |
| prone, crawling | prone | prone | `crawl` |
| prone, firing | prone | stand | `proneFire` |
| prone, trigger released | prone | stand | `prone` |
| prone, reloading | prone | stand | `proneReload` |
| standing, reloading | stand | stand | `reload` |

The two rows where `gait` reads `stand` in a non-standing stance are the point.

The clips really move the arms, not just the name of the action
(`scratchpad/w5a/stance-shots.mjs`, the welded weapon's position in the rig's
own frame): prone puts it **4.7 cm lower and 5.8 cm further forward** than
standing. Crouch is within 1.5 mm of standing at a matched instant — which is
correct, because it is the same clip; the difference is temporal, and over 120
stepped frames the weapon travels **3.00x** as far crouched as standing
(`scratchpad/w5a/sway.mjs`) against the data's rate ratio of 0.33/0.1 = 3.3.
The shortfall is that the path is measured along a curved sway, so it is not
proportional to phase in general; it is a demonstration that the rate differs,
not a second derivation of it.

### Not done, and named so it is visible

The same 26 weapons also declare `{Crouch,Lie,}{Backward,StrafeLeft,
StrafeRight,Turn*}` and the two jumps, all with 1P clips. The viewer plays the
**forward** clip for every direction in every stance, standing included. That is
a separate gap from this one and was not in this stream's brief.

**Re-extraction the lead owns**: only the two tracked fixtures
(`USSoldier__Thompson`, `GermanSoldier__MP40`) carry the new families. The
other rigs in `viewer/models/viewmodels` are the main checkout's and were not
touched — the shared tree is read-only to a stream. One `extract_viewmodel.py`
pass over the published pairings puts the families on all of them; until then
every other weapon falls back down its chain, as above.

> Review correction: there are **99** `.fp.glb` rigs in the published tree,
> not 196, so it is 97 others, not 194 (`find viewer/models -name '*.fp.glb' |
> wc -l`). The tree is 163 MB today; at the fixtures' +37% a full re-extract
> takes it to roughly 224 MB, about +60 MB. Narrowing it buys little: the
> growth is per rig and almost all of it is the prone reload, which every
> weapon has.

---

## 3. Spawn-pad soldiers — the brief had moved, and what replaced it was broken

### The pads are already empty, and should stay empty

The decorative figures were **removed** before this stream started, and the
reason is in `map.html`'s own comment: `Object3D.clone()` does not rebind a
skeleton, so every clone's `SkinnedMesh.skeleton` still pointed at the
template's bones, which are not in the scene and sit at the origin. Every body
skinned to the same spot near (0, 1.5, 0) while the weapon — a plain `Mesh`
parented into the *cloned* bone tree — stayed out at the pad. Twenty-eight
floating Sg44s on Berlin.

They are not coming back. BF1942 spawn points are invisible markers; a row of
motionless mannequins at every one of them is a departure from the game, not a
step toward it. `splashTargets()` lost them as blast targets with no
replacement, which is correct — the player's own body is still in that list.

### The third-person soldier that does exist was drawn wrong

The remaining 3P soldier in the viewer is another player in a room
(`netcode-render.js`). It was broken in three name-level ways, none of which
could throw:

1. The gait halves are baked as `run.lower` / `run.upper` and bound as
   `runLower` / `runUpper`; selection asked for `actions.run` and
   `actions.walk`. Both lookups came back `undefined`, the fallback took them
   to `stand`, and **a remote soldier never played a walk or a run at all** —
   he slid across the ground in the standing pose with the gait bundle loaded
   and unused.
2. The prone pose clip is baked as **`lie`** (the engine's own word: `Lb_Lie`,
   `c_BfSoldierLying`) and selection asked for `prone`, so a prone remote stood
   up.
3. `crouchwalk` and `crawl` are in **every** published gait bundle and nothing
   referenced them.

Read back out of the published tree rather than assumed:
`USMarineSoldier__Colt.pose.glb` holds exactly `stand`, `crouch`, `lie`;
`gaits/lower.gait.glb` holds `run.lower`, `walk.lower`, `crouchwalk.lower`,
`crawl.lower`; `gaits/Colt.gait.glb` the four `.upper`. That check is a test
(`test_the_clip_names_are_the_published_files_own`), not a note.

`viewer/remote-gait.js` (new, node-testable) owns the selection and the
fallback chains; the renderer keeps one table of families to actions. The speed
bands are the engine's own tables — `directionalSpeed` 6 / 2 / 1 m/s by pose
(`0x009581b4`) and `walkSpeedFactor` 1/3 — with each boundary at the midpoint of
the two speeds it separates, which is `gait-select.js`'s own rule. The chains
fall back toward the stance before they fall back toward standing.

Also fixed: the speed estimate ran *after* `poseSoldier`, so a gait change
always spent the previous frame's speed on this frame's state.

### Measured, two browsers on one real room server

`scratchpad/w5a/remote-stance.mjs`, the P2 smoke's scaffolding with the stances
driven. A plays; B reads `window.__remotes()` (new):

| A does | A reports | B draws |
|---|---|---|
| stands still | stand / stand | `stand` |
| runs | stand / run | `run` |
| walks | stand / walk | `walk` |
| crouches, still | crouch / stand | `crouch` |
| crouch-walks | crouch / crouch | `crouchwalk` |
| lies still | prone / stand | `prone` |
| crawls | prone / prone | `crawl` |

All seven families bind on B's rig. Before this, every one of those rows drew
`stand`.

One honest limit of that harness: B's speed estimate divides a lerped position
delta by the page's *forced-frame* dt, so the magnitudes it reports (4-8 m/s
for a 1-2 m/s crawl) are an artefact of driving both pages by
`__renderOnce` rather than in wall-clock time. The ordering is right and the
stance branch does not depend on the magnitude; the band boundaries themselves
are pinned by the node tests, not by this.

> Review, on a **three**-client room (`scratchpad/w5a-review/room3p.mjs`): all
> seven families bind on both observers' rigs, every stance resolves, and
> there are no page errors. Each observer's drawn family is consistent with
> the crouch/prone flags its own client held. The two observers do disagree
> with each other, and that is the harness: whichever page is stepped last in
> a tick is the fresh one, and swapping the step order swaps which of them
> tracks the stance (`room3p.mjs` against `room3q.mjs`). A stationary
> replica's smoothed speed reads exactly 0.
>
> One real gap in the bands, fixed in review: `physics.js`
> `rampedDirectionalSpeed` applies `walkSpeedFactor` in **every** pose, so a
> crouched man holding `c_PIWalk` makes 2 x 1/3 = 0.67 m/s and a crawling one
> 1 x 1/3 = 0.33 m/s. Boundaries at half the *run* speed (1.0 crouched, 0.5
> prone) sit above both, so a walking crouch was drawn as a still one. The
> boundary a stance with one movement family needs separates still from its
> **slowest** speed, so each is now half the stance's own walk speed: 1/3 and
> 1/6. `test_remote_gait.py` gained the two walk-key cases.

---

## Tests

`python3 -m unittest discover -s tests` from `tools/bf1942-models`: **2,272
green**, up from 2,218 at the start of this stream (the count also moves with
whether the shared asset trees are linked into the worktree — several suites
skip without them).

New:

- `tests/test_stance_clips.py` + `tests/stance_clips_harness.mjs` — 11 tests
  (10, plus one added in review)
- `tests/test_remote_gait.py` + `tests/remote_gait_harness.mjs` — 10 tests
- `tests/test_viewmodel.py` — the family list, the crouch rate identity, the
  four prone clips
- `tests/viewmodel_anim_harness.mjs` — 16 new stance cases (37 -> 53)

## Scripts

Everything under
`/tmp/claude-1000/-home-dylan-projects-skandia-bfstats/792e4718-d2c1-4282-91fc-863b6f4b3be3/scratchpad/w5a/`:
`survey_stance.py`, `fams.py` (the ASM survey), `stance.mjs`,
`stance-shots.mjs`, `sway.mjs` (the viewmodel on Bocage), `blast.mjs`,
`expo-probe.mjs` (the splash on El Alamein), `remote-stance.mjs` (two
browsers).
