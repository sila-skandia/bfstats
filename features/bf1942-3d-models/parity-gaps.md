# Parity gaps: what the game does that we do not

A deliberate sweep for unimplemented functionality, run before the gaps could be
found one at a time by looking at the viewer and noticing something missing.
Seven independent audits, each given one axis, the installed game, the archives
and the instruction to produce counts and file paths rather than opinions. The
full reports are in [`parity-audit/`](parity-audit/) — 7,181 lines, and they are
the citation for everything summarised here.

| Report | Axis | Gaps |
|---|---|---|
| [`animation.md`](parity-audit/animation.md) | `.baf` clips, rigs, animated world objects | 9 |
| [`projectiles-collision.md`](parity-audit/projectiles-collision.md) | Projectile flight, collision, materials, damage | 20 |
| [`vehicle-physics.md`](parity-audit/vehicle-physics.md) | Physics data, occupancy, drivability | 14 |
| [`effects-materials.md`](parity-audit/effects-materials.md) | Emitters, shaders, atmosphere | 26 |
| [`audio.md`](parity-audit/audio.md) | Sound scripts, coverage, spatialisation | 16 |
| [`level-content.md`](parity-audit/level-content.md) | Everything a level archive declares | 19 |
| [`infantry-gameplay.md`](parity-audit/infantry-gameplay.md) | Kits, hand weapons, on-foot, the sim loop | 27 |

Read the per-axis reports for evidence. This file is for the three things that
only appear when you put them side by side: what several audits found
independently, where they contradict each other, and where they corrected
documents already in this repo.

## The shape of it

The extraction pipeline is in much better health than the viewer runtime. Most
of the "missing" features are not missing readers — they are readers whose
output is dropped on the floor one layer later. Four of the highest-impact gaps
are a flag, a regex, a spelling and a missing `elif`.

The genuine structural absences are three:

1. **Nothing collides with anything.** A projectile is deleted by a timer or a
   range cap and passes through terrain, buildings, water, vehicles and soldiers
   identically.
2. **There are no people.** No soldier geometry exists anywhere in a level.
3. **There is no particle runtime.** 102 of 216 EffectBundles produce zero
   geometry — every smoke, fire, dust, debris and damage effect in the game.

## Corroborated across audits

Where two or three audits arrived at the same finding from different directions,
independently. These are the safest to act on.

| Finding | Found by | Note |
|---|---|---|
| Collision is extracted, parsed, tagged — and then switched **off** for maps (`extract_map.py`, `include_collision=False`) | projectiles, infantry, vehicle-physics | The single highest-leverage line in the tree |
| The per-material impact-effect table is fully parsed and never emitted | projectiles, audio, effects | **Counts disagree — see below** |
| `Materialmap.raw` never read, so ground impacts cannot know sand from stone | projectiles, effects, level-content | effects also names `TerrainPalette.pal`, which the others missed |
| Fog directives exist under a second spelling nobody parses | effects, level-content | Directly undercuts shipped work — see below |
| No soldier in the flythrough | animation, infantry | Both rank it above finishing soldier *animation* |
| `ObjectSpawner` respawn timers / TTL unparsed | vehicle-physics, level-content, infantry | Wake: `MinSpawnDelay 70 / MaxSpawnDelay 110 / TimeToLive 45` |
| `setAnimatedTextureSpeed` works in `index.html`, absent from `map.html` | animation, effects | The code exists and is debugged; it is a port |

### The one place they disagree

Three audits found the impact-effect table and counted it three ways:

| Audit | Rows | Effect templates | Source named |
|---|---|---|---|
| projectiles | 4,099 | 73 | `damage.py:308-310` |
| audio | 3,047 | 52 | 39 `damage_system/*.con` |
| effects | 4,929 | 76 | **`Bf1942/Game.rfa`** |

The third names an archive the other two do not. Someone shipping the lower
figure would ship a partial table and not know it. **Unresolved as of writing** —
it has been handed to the agent implementing that table, with instructions to
establish the real total rather than trust any one number.

## Corrections to documents already in this repo

The audits were told to read the existing feature docs first so they would
report gaps rather than re-report shipped work. Four of them came back having
falsified something.

- **`flythrough-fidelity-gap.md`** surveyed `renderer.fogLinearStart/End` and
  recorded "5 of 23 levels declare a fog range". Nine more declare it as
  `renderer.fogStart` / `fogEnd`, and **8 levels are consequently running an
  invented `0.5 x viewDistance` heuristic over real declared values** — Omaha
  wants -50/290 and ships 150/300. Separately, Midway and Truk write
  `renderer.setFogColorVec` and so ship the grey `(0.7, 0.7, 0.7)` fallback
  instead of their declared `0.812/0.832/0.921`. Found independently by two
  audits. The fog work was correct about the engine and incomplete about the
  vocabulary.
- **`kits.md`** prescribes a kit liveness filter that returns 40 of 45 vanilla
  kits rather than the 35 it claims, and *keeps* the Canadian kits it expects to
  drop: `Liberation_of_Caen/Init.con` binds all five via `game.setKit`. The same
  file binds `game.setTeamSkin 2` twice, refuting the doc's "no level ever binds
  two skins to one team". The real rule is last-write-wins per (team, slot).
  Everything else in `kits.md` verified.
- **`spawn-points.md`** mentions the `Object.geometry.scale` grammar but frames
  it as an FHSW curiosity. It is vanilla, it is everywhere, and it is dropped —
  see below.
- Three audits had to correct **their own briefs**, which is worth recording
  because the wrong vocabulary is contagious: BF1942 has **no** `PhysicsType`
  and no `c_PT*` constants (that is Refractor 2 — the physics class here *is*
  the template type: `Engine`, `Spring`, `Wing`, `FloatingBundle`,
  `LandingGear`); **no** `setAnimationType`, `setRotationSpeed`,
  `setMaterialFilter`, `setCollisionMesh`, `NonVisibleObject` or `.cm` files;
  and never three collision LODs — the maximum is **2**, across 17 mods and
  ~35,000 meshes. There is also no terrain deformation, no wave displacement and
  no guided weapon in the engine, so the viewer's flat water and undeformed
  terrain are *correct*, not gaps.

## The ranked list

Merged across all seven reports, deduplicated, and ordered by impact over size.
"Keystone" means other gaps are blocked on it.

### Landed in this pass

| Gap | What it was |
|---|---|
| Level rotators frozen | `build_node` gathered spin specs; only `Assembler.export` baked them, and a level never calls it. 38 rotators across 20 of 23 maps stood still |
| Entry points and seats deleted | A meshless node was dropped unless it was a `Camera`, taking all 69 `EntryPoint` and 66 `SeatObject` templates with it. `setEntryRadius` and `seatFlags` were never parsed either |
| `alphaTestRef` unparsed | The other alpha-test spelling. 122 shaders gain a cutoff; 11 were exporting fully opaque — every scout helmet's foliage net, the church and iron-bridge fences |

### Keystones — do these first

| # | Gap | Size | Why it is a keystone |
|---|---|---|---|
| 1 | Collision resolved from the wrong LOD alternative | S | Buildings draw `_m2`, which ships **zero** collision; the geometry is in `_m1`. Without this, turning collision on half-fails silently |
| 2 | `include_collision=False` for every map | S | Unblocks all projectile, vehicle and infantry collision. Budget is 2.4k–7.2k triangles per map |
| 3 | Emitter data model 80% unparsed | L | `intensity` (the emission rate, on 355 emitters), spread cones, flipbooks, drag, rotation. Every particle gap is downstream of this |
| 4 | Physics scalars never reach the glb | M | No `mass`, `drag`, `setTorque`, gearbox, buoyancy or lift value is exported. The flight model's constants are typed in by hand |
| 5 | Emitter filter drops 56% of payloads | M | 102 of 216 EffectBundles produce zero geometry |

### High impact, small

| Gap | Evidence |
|---|---|
| `Object.geometry.scale` / `.color` dropped by the `_COMMAND` regex itself — it cannot match a three-segment command | **8,596 of 18,258 placed statics (47%) carry a scale, none of them 1.0**; 5,123 carry a colour. Kursk is 1,331/1,458. It is all foliage: every forest in the game renders as identical clones at one size and one flat tint |
| A level's own `StandardMesh/` folder is never added to the mesh pool | All **45** `missingMeshes` in the vanilla corpus are sitting in the level's own archive — Pegasus Bridge (a Caen control point), 3 B-17 wrecks, 3 Ju-88 wrecks, the PAK40, Battle of Britain's factory and both radar towers |
| Both missed fog spellings | 8 levels wrong-fogged, 2 grey-fogged |
| Sniper rifles absent from the armoury | `K98Sniper` and `No4Sniper` are declared inside their parent's `Objects.con`, so a folder walk misses them. 26 of 28 hand weapons reach `models.json`. They are the primary weapon of all eight Scout kits and the only scoped optic in the game |
| Engine sound reaches 3 of 54 extracted vehicles | 111 of 136 extracted vehicle samples (2.04 MB) are unreachable by any user action. Every parked tank, jeep and ship is silent |
| 93 sounding static buildings, all silent | Windmills, watermills, factories, guard towers, hangars and radar carry `loadSoundScript`, but only `Sounds/*.con` *inside the level archive* is scanned |
| `stereo` extracted then ignored | The two-channel cockpit gun layers are HRTF-panned at 1.2 m when the data says 2D. Wrong on the one surface that ships |
| EoD's 239 extracted maps are schema-stale | All predate the control-point work; every one lacks `controlPoints`, `soldierSpawns`, `minimap`, `gameplayMode`. `extract_maps_all.py` already has the resumable machinery — it is a re-run |
| `envmap true` on 494 materials dropped | The cubemap is already extracted for water. Biggest single material look gap; all glass |

### Structural, larger

| Gap | Scale of it |
|---|---|
| No projectile collision loop | The headline complaint. Blocked on the two collision keystones |
| Soldier animation is three frozen stills | **1,154 `.baf` clips, none of them single-frame; 1,458 state-machine states** covering walk, run, crouch, prone, jump, swim, ladder, parachute, death, ragdoll, vehicle entry and seated. The pipeline samples frame 0 of six of them |
| No soldier anywhere in a level | `soldierSpawns` renders as 2D minimap dots; `map.html` never fetches from `models/` |
| Ground vehicles are not drivable | The viewer drives **3 of 49** categorised vanilla vehicles, all fighters, all on one aircraft's hardcoded constants. Land vehicles are 61% of spawner slots |
| Only Conquest is ever extracted | **1,420 vehicle-spawn and 1,736 soldier-spawn placements** in `SinglePlayer/`, `Tdm/`, `Ctf/` and `ObjectiveMode/` are never read |
| No hand weapon can fire | Every hand-weapon report has `fireArms: []` — no muzzle nodes, and `poses.html` never imports `GunFire` |
| Sun lens flare | Fully declared on 21 of 23 levels. Flare textures only recoverable from another mod's archive |
| No dynamic shadows | A flown aircraft casts nothing |

## Two things that are cheaper than they look

- **Audio is not a size problem.** Every `.wav` any vanilla `.ssc` references —
  all 643 — transcodes to **7.59 MB** of MP3 (48.15 MB raw). A full voice pack is
  another 2.00 MB. The tree ships 147 files / 3.1 MB today, so complete vanilla
  audio parity is a **+6.5 MB delta against a 14 GB `viewer/maps` tree**. What is
  missing is extraction reach and event plumbing, not bytes.
- **`aiMeshes.rfa` holds 90 simplified collision hulls** that the project's own
  `stdmesh.parse` reads without error — far cheaper than the 55,381 collision
  triangles in `standardMesh.rfa`, and a plausible shortcut for a walkable level.

## Two things that are not gaps

Recorded so they are not "fixed" later by someone who has not read this.

- **Reverb and occlusion.** No `.ssc` directive, no settings command and no EAX
  preset exists in vanilla; `air-raid-siren-pitched-reverb.wav` has its reverb
  baked into the sample. Adding a ConvolverNode would be a *departure* from
  parity, not a step toward it.
- **`shaders.rfa`.** 12 compiled DX8 shader objects, no source, referenced by
  nothing. Its only value is as evidence that five distinct sprite paths exist
  which the pipeline collapses into one.

## Method, and how to redo it

Each audit was given one axis, the repo, the installed game at
`~/.wine/drive_c/EA Games/Battlefield 1942/Mods/`, and three standing rules: read
the existing feature docs first so you report gaps rather than shipped work;
every claim needs a file path or a command that reproduces it; mark anything you
could not verify as UNVERIFIED rather than asserting it. They were told not to
implement anything, which is what kept them cheap enough to run seven at once.

That last rule earned its place — the reports carry 20-odd UNVERIFIED markers
between them, several on questions that would need the decompiled `BF1942.exe`
corpus to settle (which collision layer the engine queries, `c_CGProjectiles`
semantics, whether splash damage is occluded, whether `fogStart` and
`fogLinearStart` are the same renderer state). Those are honest open questions
rather than plausible-sounding guesses, which is the difference between an audit
you can build on and one you have to re-do.
