# BF1942 reimagined in Unreal Engine: the plan

Planning only, 2026-09-29. No code has been written for this. This document is
the plan the work will follow and the place its decisions and progress get
recorded.

## What this is

A community reimagining of Battlefield 1942 in Unreal Engine 5. It keeps the
game as players know it: the same vehicles, maps, kits, conquest rules and the
feel of driving a Sherman. It uses Unreal for what the 2002 engine and the
browser can't do well: modern lighting and materials, a real editor, dedicated
servers and native performance.

It is not a commercial product, and it gets no new art. **Every model,
texture, animation, sound and map comes from the asset tree this repo already
exports** (`tools/bf1942-models`, published to mesh.bfstats.io). Nobody on the
project is a 3D artist, so the pipeline has to carry the art across as-is, and
the plan is built around that constraint.

The gameplay reference is the browser reimplementation in
`tools/bf1942-models/viewer/` (about 117k lines of JS), together with the
engine reference in `features/bf1942-engine-reference/` and the parity docs.
Most gameplay work here is **porting code that already matches the real game**,
not working out how BF1942 behaves.

## Scope

**In scope for the first release:** vanilla BF1942 (`bf1942`) land, air and
sea vehicles, the 23 vanilla levels, conquest, bots, and multiplayer on a
dedicated server.

**Next:** Road to Rome (`xpack1`) and Secret Weapons (`xpack2`). Their model
and map trees already exist in the same formats (282 and 380 model glbs, about
30 levels each), so they are a data pass once vanilla works.

**Out of scope until asked:** EoD, FH, FHSW, DC and the other mods, matching
the parity work's current scope. Their model trees exist, but most have no
level bakes.

**Not a goal:** talking to the original game's servers or clients, or
byte-exact parity. "Feels the same" is the bar, and the parity docs say where
the feel comes from.

### Owner decisions (2026-09-29)

- **Faithful, quirks included.** The quirks are what people still love, and a
  faithful version gives us something to compare against. No gameplay
  redesign: no bigger maps, no modern movement.
- **This PC is the development machine.** Its setup is in section 0.
- **Everything runs locally for now**, dedicated server included. Hetzner
  later, when there is somewhere to put it.
- **The browser engine and the Unreal version stay in step**, so a round can
  be replayed in the browser and in Unreal and the two compared (D12, M1).

---

## 0. What Unreal is, and getting this PC ready

### 0.1 What you work in

Unreal Engine comes in two parts:

- **The Unreal Editor.** A desktop application you install, a bit like Blender
  and an IDE combined, but for games. You open the project in it and see the
  3D world. You place things in levels, edit materials, set up animation, lay
  out UI, and press **Play** to try the game inside the editor window. Most
  non-code work happens here. It runs on Linux, Windows and macOS.
- **The engine runtime**, compiled into the game. Gameplay code is **C++**,
  written in a normal code editor (JetBrains Rider or VS Code; Unreal
  generates project files for either). Unreal's build tool compiles it, and
  the editor reloads it. Blueprints are Unreal's visual scripting, edited in
  the editor. This plan uses them only for wiring content, not for logic
  (D1).

A project is a folder: a `.uproject` file, `Source/` (C++), `Config/`
(settings) and `Content/` (`.uasset` and `.umap` files: imported meshes,
materials, levels, all binary).

Out of it you **package** two things:
- **the game**: a Linux or Windows executable plus its data files
- **a dedicated server**: a headless executable with no rendering. This is
  what will later run on Hetzner, as a Linux binary in a container.

For local testing, the editor's Play button can also start a dedicated server
in the background and connect one or more client windows to it. That is how
M6 (multiplayer) gets tested on this PC before there is a server anywhere.

### 0.2 This PC against Unreal's requirements

Unreal's recommended hardware is a quad-core CPU, 32 GB of RAM and 8 GB of
video memory (Epic's install docs).

| | This PC | Verdict |
|---|---|---|
| CPU | Intel i9-12900HK, 20 threads | Fine. Compiling C++ and shaders is where it counts. |
| RAM | 62 GiB | Fine |
| GPU | NVIDIA RTX 3050 Ti Laptop, **4 GB**, plus Intel Iris Xe | Workable, below the recommended 8 GB. BF1942's assets are small, so most video memory goes to the engine itself. Run the editor at reduced scalability, with Lumen in software mode and hardware ray tracing off. |
| **GPU driver** | **The NVIDIA card is on `nouveau`, with no Vulkan driver for it.** Only the Intel GPU has Vulkan (`vulkan-intel`). | **Blocker.** Unreal on Linux renders through Vulkan, and on the Intel GPU it would crawl. |
| **Disk** | **57 GB free** of 523 GB (89% used) | **Blocker.** The precompiled editor takes tens of GB, a source build well over 100 GB, plus the project and Unreal's cache of compiled shaders and assets. The biggest folders in home are `~/.cache` 67 GB, `~/projects` 58 GB, `~/.local` 46 GB, `~/.wine` 44 GB and `~/.config` 37 GB. |
| Power | Laptop | Plug in and use the performance power profile while working in Unreal. Power saving has already caused a false 2.5x "regression" once (`project_viewer_perf_power_profile`). |

### 0.3 Setup steps (the owner does these: they change the system)

1. **NVIDIA driver.** Install the proprietary driver with Vulkan support.
   Check the Arch wiki's NVIDIA page for the right package for an Ampere card
   on the `linux-lts` kernel (the open kernel modules, `nvidia-open-lts` or
   the `-dkms` variant, plus `nvidia-utils` for Vulkan and `nvidia-prime` for
   `prime-run`). Reboot, then `vulkaninfo --summary` (from `vulkan-tools`)
   should list the RTX 3050 Ti. This also gives the viewer's headless tests a
   real GPU.
2. **Disk space.** Free at least 150 GB, or add a drive for Unreal. That
   covers a source build (step 3) plus the project.
3. **Unreal Editor.** Two ways to get it on Linux:
   - **Precompiled:** Epic publishes Linux editor builds for download from
     its Linux page (it needs an Epic account). Quickest.
   - **Source build:** link your Epic account to GitHub to get access to the
     `EpicGames/UnrealEngine` repository, clone it, then run `Setup.sh`,
     `GenerateProjectFiles.sh` and `make`. Slow (hours on this CPU) and
     large.

   As far as I know, **packaging a dedicated server needs a source build**:
   the precompiled editor doesn't ship the server target. Epic's docs retrieved
   for this plan confirm that only for consoles, so M0 checks it for Linux
   servers before committing to a download. The plan is to start on the
   precompiled editor for M0-M2 and switch to a source build before M6.
4. **Code editor.** JetBrains Rider (free for non-commercial use) or VS Code
   with the C/C++ extension.
5. **Launch on the NVIDIA GPU** with `prime-run` (or the equivalent
   environment variables) if the desktop session defaults to the Intel GPU.

---

## 1. What we are starting from

### 1.1 Assets (already exported, in `tools/bf1942-models/viewer/`)

| Asset | Where | Count and size | Format facts that matter for Unreal |
|---|---|---|---|
| Vehicles, weapons, emplacements, statics | `models/*.glb` + `models.json` | 99 catalogue entries, 389 vanilla glbs | One glb per template, the full `Objects.con` hierarchy, and game data in node `extras` (see 1.2). Collision meshes are sibling nodes `"<Template> collision <layer>"`, with a defence-material id on each primitive. |
| Variants | `<Name>.wreck.glb`, `<Name>.cockpit.glb`, `<Name>.<Level>.glb` | listed in `models.json[].variants` | Wreck hulls, first-person interiors, per-map theatre skins. |
| Soldier poses | `models/poses/<Soldier>__<Weapon>.pose.glb` | 288 | **Properly skinned glTF** (`JOINTS_0`/`WEIGHTS_0`, 1-3 influences), an 80-node Biped skeleton (`Bip01 ...`), the weapon welded under `Bip01 R Hand`, kit sockets `A`, `backpack`, `HipPack`. |
| Soldier animation | `models/poses/gaits/*.gait.glb` + `gaits.json` | 29 | Skeleton-only glTF with TRS clips named by engine state (`run.lower`, `Ub_Fire`, `Ub_StandReload`, `Lb_DieChestStand` ...). The state machine data (speed, period, loop, `then`) is in extras. |
| First-person arms | `models/viewmodels/<Soldier>__<Weapon>.fp.glb` | 197 | Skinned sleeves and hands with the weapon, 17 clips each (idle, walk, run, fire, reload, deploy, crouch and prone variants), FOV and camera data in extras. |
| Kits | `models/*.kit.glb` + `kits.json` | 1,029 | Helmets, packs and pickups. `kits.json` says which socket each part hangs on. |
| Levels | `maps/<level>/scene.glb` + `scene.json` | 23 vanilla levels | `scene.glb`: 64 baked terrain tiles (256 m, on the 4 m height grid), placed statics with lightmap UVs and LOD chains, sky, water, spawner nodes. `scene.json`: control points, spawns, tickets, modes, fog, sun, water, sounds, AI (full key list in 4.3). |
| Level side files | `maps/<level>/{lightmaps,sky,minimap,terrain,pathfinding}/` | Kasserine alone has 182 lightmaps | `terrain/materials.png` = one MaterialManager id per height sample. `pathfinding/*.raw` = BF1942's baked bot maps. |
| Shared tables | `maps/_shared/` | | `damage.json` (materials, attack/defence modifiers, impact effects), `loadouts.json`, `vehicle-ai.json`, `vehicle-sounds.json`, `collision-meshes.json`, `effects.glb` (161 effect bundles), `hud/` and `menu/` layouts, fonts, sprites, sounds, voices. |
| Textures | `textures/<2hex>/<32hex>.webp` | 3,580 files, 747 MB | Published glbs reference these through `EXT_texture_webp`, marked **required**. The exporter itself writes PNG; WebP comes from the `optimise_mesh.py` post-pass. |

Everything is already converted from Refractor's left-handed, Z-forward space
to glTF's right-handed Y-up space, in metres (`bf42/gltf.py:1-14`).

### 1.2 Game data in node extras

This is what turns "a mesh called ShermanEntry" into a seat. The exporter
writes it per `templateKind` (`bf42/assemble.py:2723-3013`):

| templateKind | extras |
|---|---|
| PlayerControlObject | `physics` (mass, drag, inertiaModifier, speed and angle mods, vehicle type, exit data, water damage), `hud`, `armor` (hitpoints, critical damage, effects by HP), `heldSpawner` |
| Engine | `physics` (engineType, torque, differential, gears, gear up/down, maxRotation, maxSpeed, acceleration) |
| Spring (wheels) | `physics` (grip, strength, damping) |
| Wing | `physics` (wingLift, flapLift, pitch and position offsets, regulation) |
| FloatingBundle | `physics` (hullHeight, float lift, sinking, drag) |
| LandingGear, RotationalBundle | `physics`, `rig` (axes, control, automaticReset) |
| FireArms / HandFireArms | `fireArms` (rate, velocity, magazine, reload, projectile, muzzles, tracer, recoil, heat), `skeletonIK` |
| Projectile | `projectileMesh`, `tracerMesh`, `physics` |
| EntryPoint / SeatObject | `seat` (control, entryRadius, flags, poseAnimation) |
| Camera | `cameraView`, pivot |
| AnimatedBundle | `animatedTextureSpeed` (tank tracks), skeleton and skin refs |
| LodObject | `lodAlternative`, `propellerBlur` |
| SupplyDepot | `supply` |
| Effect nodes | `effect` (kind, size and colour over time, lifetime, billboard) |

Level nodes add `lightmap`, `lod`, `spawner` and `modes`.

### 1.3 The engine being ported

The JS engine runs a **fixed 30 Hz world tick** that consumes one buffered
`PlayerInput` per player per tick (`world.js`), with soldier bodies on a nested
60 Hz step (`fixed-step.js`). 126 of its modules run headless in Node
(`sim/env.mjs`), so gameplay is already separate from rendering. 77 files import
`three`, mostly for vectors, quaternions and `Object3D`.

| Subsystem | Main files | Lines (approx) |
|---|---|---|
| Ground vehicles | `tracked-vehicle.js`, `wheeled-vehicle.js`, `ground-engine.js`, `ground-contact.js`, `suspension.js`, `vehicle-base.js` | 4.9k |
| Flight | `aircraft.js`, `airborne.js`, `bomb-release.js` | 1.2k |
| Boats | `ship.js`, `body-float.js`, `torpedo-run.js` | 1.7k |
| Rigid bodies and contacts | `rigid-body.js`, `body-world.js`, `body-contact.js`, `hull-bodies.js`, `contact-response.js`, `crash-damage.js` | 6.3k |
| Collision world | `world-collider.js`, `static-index.js`, `heightfield.js`, `level-statics.js` | 3.3k |
| Soldier movement | `soldier.js`, `walking-body.js`, `soldier-locomotion.js`, `swim.js`, `parachute.js`, `ladder-climb.js`, `fall-damage.js` | 8k |
| Weapons and ballistics | `gunfire.js`, `gun-cycle.js`, `projectile-flight.js`, `projectile-damage.js`, `deviation.js`, `proximity-fuse.js`, `turret-rig.js`, `hand-fire.js` | 5.6k |
| Armour and damage | `armor.js`, `vehicle-damage.js`, `vehicle-hits.js`, `vehicle-wrecks.js`, `world-damage.js`, `skeleton-hit.js` | 3.3k |
| Bots | `bot*.js`, `doctrine*.js`, `strategic*.js`, `nav-*.js` | 16.7k |
| Game modes and spawning | `game-modes.js`, `round-state.js`, `spawn-flags.js`, `spawning.js`, `combat-area.js`, `supply.js` | 5k |
| Seats and entry | `seats.js`, `vehicle-entry.js`, `vehicle-occupancy.js` | 3.3k |
| Sound | `audio.js`, `engine-audio.js`, `vehicle-audio.js`, `ssc-*.js`, `area-sound.js`, `radio.js` | 5.9k |
| Effects | `effects-core.js`, `effects.js`, `world-fire.js` | 2.5k |
| Animation | `pose-compose.js`, `gait-select.js`, `stance-clips.js`, `arms-rig.js`, `viewmodel-anim.js`, `seat-ik.js` | 3.3k |
| HUD and UI | `hud.js`, `soldier-hud.js`, `vehicle-hud.js`, `scoreboard*.js`, `deploy-screen.js`, `play/*` | 6.3k+ |
| Netcode | `netcode*.js`, `server/*.mjs` | 5k |

Replay (~24k lines), rendering (~2.4k) and the camera and input page code are
not ported; Unreal replaces them.

### 1.4 The written spec

Where the JS and a spec disagree, the spec's evidence wins and the JS gets a
bug report.

- `features/bf1942-engine-reference/` (`README.md`, `ledger.md`,
  `subsystems/*.md`): physics, collision response, tank driving, damage,
  projectiles, seats, hand weapon deviation, HUD and netcode, each checked
  against the game binaries.
- `features/bf1942-ai-spec/`: the bot algorithm.
- `features/bf1942-3d-models/parity-audit/*`: known gaps by area.
- `features/bf1942-parity-round-2026-09-19/README.md`: the live open list.
- `features/netcode-play-multiplayer/README.md`: how the original netcode
  worked.
- `features/parity-lab/README.md`: how to record a real round to compare
  against.

---

## 2. Architecture decisions

Each decision records the options and the recommendation. A spike (section 3)
confirms or overturns the ones marked *spike*.

### D1. Engine version and language

**Unreal Engine 5, current release** (5.7 per the docs index at the time of
writing). Gameplay in **C++**, with Blueprints only for content wiring (which
mesh, which sound, UI layout). The JS is written as plain functions over plain
data, which ports to C++ far more directly than to Blueprint graphs, and C++
diffs review in git.

### D2. Where the Unreal project lives

A **separate repository** (`bf1942-unreal` or similar) with Git LFS for
`.uasset` and `.umap`. Unreal projects are large and binary and don't belong
in this repo.

The **converter and import tooling stay in this repo** under
`tools/bf1942-unreal/`, next to the exporter they read from.

**Imported assets are not committed; they are regenerated.** Everything the
importer makes (meshes, material instances, vehicle Blueprints, levels) is
build output of the published asset tree (D4), like `viewer/models` is build
output of the game archives today. The Unreal repo commits only what a person
made: C++, the master material, the Niagara archetypes, UI widgets, Blueprint
parent classes and config. That keeps the repo small, avoids Git LFS quotas
for gigabytes of generated content, and means an exporter fix reaches Unreal
by rerunning the importer, not by committing binaries. Generated content goes
under `/Game/BF42/Generated/`, and that folder is in `.gitignore`.

### D3. Coordinates and units

- Refractor is left-handed: X right, Y up, Z forward. Unreal is also
  left-handed: X forward, Y right, Z up. **Refractor to Unreal is a pure axis
  swap, `UE = (Rz, Rx, Ry) x 100`, with no mirroring.**
- The glTF assets and the JS engine work in glTF space (right-handed, Z
  negated). The glTF importer handles glTF to Unreal (*spike S1 confirms*).
- **Ported gameplay code works in metres internally** and converts at one
  boundary (`FBf42Units`) when it reads or writes actor transforms. Every
  constant in the JS and the specs is in metres and seconds, and con.py notes
  that forces are accelerations in m/s², not newtons (`con.py:926`). Converting
  hundreds of constants to centimetres by hand is where bugs would come from.
- Any code ported from JS has its Z negations undone at the same boundary.
  Every ported module gets a comment saying which space it works in.

### D4. The asset source of truth

**The published asset tree, not the game archives.** The converter reads the
glbs and JSON the exporter already writes, so every fix to the exporter
reaches Unreal the same way it reaches the viewer, and Unreal never gets its
own copy of Refractor format parsing.

Two exceptions need small exporter additions (section 4.1): textures as PNG,
and the raw heightmap.

### D5. Simulation: port ours, or use Unreal's (*spike S4*)

This is the decision that most shapes the project.

- **Option A, all Unreal-native:** Chaos Vehicles for wheeled and tracked
  vehicles, Character Movement for soldiers, Chaos rigid bodies for contacts,
  tuned with the `.con` numbers from extras. Least code. But BF1942's feel
  comes from exactly the rules Chaos doesn't have: the tank drive state
  machine, Refractor's wheel and spring model, its flight model, its ship
  float and drag. The parity work found many of these the hard way. Tuning
  Chaos to imitate them means redoing that work with worse tools.
- **Option B, port our simulation whole:** the collision world, rigid bodies,
  vehicles and soldiers as a C++ library stepped at 30 Hz, with Unreal only
  drawing. The most faithful, and the most code: the collision world and
  rigid bodies are 9.6k lines that Chaos already does.
- **Option C, recommended: port the movement models, use Chaos for queries.**
  Port what makes BF1942 feel like BF1942: engines, wheels and springs, the
  track and hull drive, wings, floats, soldier locomotion, weapons, damage.
  Replace our collision world (`world-collider.js`, `static-index.js`,
  `heightfield.js`) with Chaos scene queries (line traces, sweeps, overlaps)
  against Unreal collision built from our collision meshes. Rigid-body
  contacts (`hull-bodies.js`, `body-contact.js`, `contact-response.js`) are
  the open part of this decision.

**Contacts default to our ported solver** (updated 2026-09-29 after the owner
chose faithful, quirks included). Many of the quirks people remember come from
how Refractor resolves contacts: jeeps flipping off rocks, tanks climbing what
they shouldn't, the way a hull bounces off a wall. Our solver already
reproduces them, while Chaos would need tuning to imitate them and may never
match. Spike S4 still drives the Sherman both ways, but Chaos has to *match*
the JS runner to win, not merely be acceptable. Chaos stays in charge of
collision queries either way.

All ported movement code runs on a **fixed 30 Hz step** driven from Unreal's
variable tick with an accumulator, with rendered transforms interpolated
between steps. This is the same as `world.js` today, and the viewer has already
solved 30 Hz presentation.

### D6. Networking (*spike S6*)

**Unreal's own replication and dedicated server**, server-authoritative. The
Node room server design is not ported; Unreal already does what it does.

- Inputs go client to server once per 30 Hz tick, the same `PlayerInput`
  struct the JS builds, as an unreliable RPC with redundancy.
- Soldiers: client-side prediction and reconciliation. Character Movement's
  prediction is built for Character Movement, so under D5-C it doesn't apply
  directly. Evaluate Unreal's newer prediction frameworks (the Mover plugin and
  Network Prediction) against a small custom predictor that reuses the design
  already written in `features/netcode-play-multiplayer/SNAPBACK.md`. Check
  how mature Mover is at the time; it was experimental in early UE5 releases.
- Vehicles: server-authoritative with interpolation for passengers and
  observers, and prediction for the driver only if playtests need it. BF1942
  itself was forgiving here.
- Target: 64 players, as the original. Budget bandwidth with the 30 Hz
  snapshot rate.
- **Hosting.** Local first: the editor's Play button with a dedicated server,
  then the packaged Linux server binary run on this PC with clients joining
  `127.0.0.1`. Hetzner later, in a container. The production node is already
  near its memory budget (`CLAUDE.md`, "Deployment constraints"), so measure
  the server's memory with 64 players in M6 before planning where it goes.

### D7. Look: faithful or modern

**Modern lighting, original art.** Lumen global illumination and reflections,
Virtual Shadow Maps, and a sky driven by `scene.json` sun, fog and ambient
values. The original lightmaps are dropped by default but kept importable (the
statics carry `TEXCOORD_1`) for a possible "classic" look. BF1942's textures
are low resolution and have lighting painted in, so this needs a tuning pass
(see M4): expect to lower Lumen's intensity and add a colour grade so
low-resolution albedo doesn't look washed out.

Nanite is not a goal: the meshes are low-poly. Draw calls from thousands of
small statics are the likely cost, so the import dedupes meshes (4.4) and uses
instanced static meshes for repeated statics.

### D8. Animation

Import soldiers as **Skeletal Meshes on one shared `Bip01` skeleton** per
soldier family. Import gaits as **Anim Sequences** on that skeleton. Rebuild
the gait selection and upper/lower-body split of `pose-compose.js` and
`gait-select.js` as an **Animation Blueprint** with a layered blend per bone
(lower body from `Bip01 Pelvis`, upper body from the spine). The state
transitions (`states{...: {morph, then}}` in the gait extras) become the state
machine's transition rules.

First-person arms (`*.fp.glb`) are separate skeletal meshes with their own
anim instance. Kits attach to sockets named after the kit bones.

### D9. Bots

- Port the **decision layer**: `strategic*.js`, `doctrine*.js`, `bot-plans.js`,
  `bot-sense.js`, `bot-aim.js`, `bot-fire.js`, `bot-vehicle*.js`, following
  `features/bf1942-ai-spec/`.
- Use **Unreal's NavMesh and path following for infantry**, which saves porting
  `nav-*.js` and gives bots paths through the new collision directly.
- Vehicles keep BF1942's own search maps: port `nav-baked.js` over
  `pathfinding/*.raw` and `scene.json` `ai`. BF1942's tank, car and boat
  routing depends on those maps' per-type costs, and a vehicle NavMesh in
  Unreal needs a lot of setup to match.
- Revisit infantry if bots route differently enough to change how fights play
  out (for example, avoiding routes the original AI takes).

### D10. Audio

- Re-export samples as **WAV** with the exporter's existing flag
  (`extract_map.py --audio-format wav`). Unreal's audio importer is built
  around WAV.
- Port the `.ssc` rules (layering, pitch and volume modulators, near and far
  hand-overs, the voice limit and the coherence guard from
  `project_ssc_coherent_duplicates`) as a C++ audio component that drives
  Unreal audio components.
- MetaSounds only where a patch is simpler as a graph (engine note layers).
- Keep the invariant from the viewer: never two voices of one sample at one
  rate.

### D11. Effects

Build **a small Niagara library by hand**: sprite particle, smoke, fire, spark,
debris, water splash, tracer and muzzle flash. That's roughly eight archetypes
with exposed parameters. A generator maps each of the 161 bundles in
`effects.glb` to archetypes and fills in size and colour over time, lifetime,
velocity and texture from the extras. Generating arbitrary Niagara graphs from
data is not worth it. BF1942's effects are simple and parameter-driven, and
`effects-core.js` shows the whole parameter set.

### D12. Staying in step with the browser engine

The owner wants both to stay in sync so they can be tested against each other.
There are two sides to that: comparing them, and noticing when one has moved
and the other hasn't.

**Comparing: replays first.** A bf42plus recording (`replay_<stamp>.ndjson`,
formats 1-4, 10 Hz samples of every object plus the event stream; see
`features/round-replay-capture/README.md`) is the one input both can play
without any simulation. So Unreal gets a **replay player early (M1)**, ported
from the browser's.

- `replay-recording.js` (2,114 lines) is documented as a pure function of the
  recording's text: object lives, seats, hit points, poses and gaits at any
  time. It ports to C++ as-is.
- **Data comparison.** `tools/bf1942-models/tests/perf/replaydump.mjs`
  already writes everything the replay works out of a recording as one JSON
  file: lives, feed, every player's place and state every 7.3 s, seats,
  crews, hit points, poses, gaits and moving-part rotations. The Unreal port
  gets a command that writes **the same JSON**, and the two are diffed. Floats
  are compared within a tolerance, not with `cmp`, because JS doubles and C++
  floats differ. A difference is a porting bug, or a fix that landed on one
  side only.
- **Visual comparison.** A harness takes a recording plus a list of shots
  (time, camera position, yaw, pitch) and captures each shot in both engines.
  Browser: the existing hooks (`window.replay` seek, `__look.yaw/pitch`,
  `__camera.position`). Unreal: console commands `bf42.Replay.Open`,
  `bf42.Replay.Seek`, `bf42.Camera.Set` and a screenshot, run from the command
  line (`-ExecCmds`). Output is a side-by-side page per shot. It shows
  animation, turret angles, effects, the HUD and placement differences at a
  glance, and it's the answer to "replay a round in the browser, then compare
  it with Unreal."
- **Gameplay comparison.** Replays carry recorded results, not inputs, so they
  can't test the simulation. Gameplay is compared per subsystem against the JS
  runner (5.2).

**Noticing drift.** Every ported C++ file starts with the JS file and commit it
was ported from:

```cpp
// Ported from tools/bf1942-models/viewer/tracked-vehicle.js @ 1a2b3c4d
```

`tools/bf1942-unreal/drift.py` reads those headers and lists every JS module
whose git history has moved past its recorded commit, with the commits in
between. A JS parity fix is not finished until it is either ported or listed
in `features/unreal-reimagining/SYNC.md` as owed. Fixes found on the Unreal
side go back to the JS the same way, so neither engine becomes the one that's
wrong.

---

## 3. Spikes (risk first, before any milestone)

Each spike is small, answers one question and produces a note in this folder.
Nothing after M0 is planned in detail until S1-S4 have reported.

| # | Question | Method | Done when |
|---|---|---|---|
| S1 | Does Unreal's glTF import (Interchange) take our models as they are, apart from WebP? Axes, scale, hierarchy, materials, doubleSided, alpha modes, `KHR_materials_unlit`, and **do node extras survive anywhere** (asset user data or metadata)? | Convert `Sherman.glb` to PNG textures (4.1) and import it. Check it in the editor and with a Python dump of the imported assets. | A note listing what imports correctly and what doesn't. The converter design (4.2) is then confirmed or changed. The docs confirm `EXT_texture_webp` is **not** among the importer's supported extensions (`GLTF::EExtension`), so PNG is required regardless. |
| S2 | Can a `pose.glb` import as a Skeletal Mesh, and a `gait.glb` as Anim Sequences on the same skeleton? | Import `GermanSoldier__K98.pose.glb`, then `lower.gait.glb` and a grip gait targeting its skeleton. The gaits have 67 nodes and the pose rig has 80, so check that retargeting by bone name holds. | A soldier plays `run.lower` with `run.upper` in the editor. |
| S3 | Can a level import from `scene.glb` + `scene.json` by script? | Editor Python: import Kasserine's 64 terrain tiles and statics (placements read from the glb JSON), deduped against the models tree, plus control points and spawns from `scene.json`. | Kasserine renders in the editor at the right scale, with statics in place. Record the import time and draw-call count. |
| S4 | D5: do Chaos contacts or our ported contact solver give the better tank? | Port `ground-engine.js` + `tracked-vehicle.js` + the hull drive (`buildHullDrive` in `map.html`, copied by `sim/stage.mjs`) for the Sherman. Drive it on Kasserine with Chaos contacts, then with `hull-bodies.js`/`body-contact.js` ported. | Top speed, turn rate, climbing and hitting a wall compared against the JS runner and the owner's feel. A decision recorded as D5 final. |
| S5 | Per-face armour materials. | Build complex collision for the Sherman with one material slot per `defenseMaterial`, each mapped to a Physical Material. A trace with face-index and physical-material return should report the right id. | A line trace at the hull front returns defence material 50, and at the tracks their own id. |
| S6 | D6: prediction for soldiers under custom movement. | A two-client test map with the ported soldier locomotion, first with Mover/Network Prediction, then with a custom predictor. | Walking and jumping at 150 ms simulated latency without visible correction. A decision recorded. |

---

## 4. The asset pipeline in detail

### 4.1 Exporter additions (this repo)

1. **PNG glbs for Unreal.** `optimise_mesh.py` is what writes WebP, so an
   Unreal build **skips that pass** and keeps the exporter's PNG output. For
   converting published glbs without re-extracting, add a small
   `glb_webp_to_png` step: decode the lossless WebP (so the conversion is
   exact), embed it as PNG and drop `EXT_texture_webp`. Pick one route after
   S1. Re-extraction is the cleaner source, the converter is quicker.
2. **Raw heightmap per level.** `bf42/level.py:554` (`class Heightmap`)
   already reads the 16-bit `Heightmap.raw`. Write it next to the level as
   `terrain/heightmap.r16` (with size and scale in `scene.json.terrain`) for
   the Landscape route in 4.4. This is a new file in the `scene` layer's
   output, and the exporter rules in `features/level-bake-layers/README.md`
   apply.
3. **WAV audio**, using the existing `--audio-format wav` flag.

Nothing else needs to change in the exporter. Everything else Unreal needs is
already in the glb extras and the JSON files.

### 4.2 The converter: `tools/bf1942-unreal/`

A Python tool that reads the asset tree and writes an **Unreal import bundle**:
the PNG glbs plus sidecar JSON manifests. It runs outside Unreal, so it can
use the existing `bf42` code and its tests.

- **`<Name>.ue.json` per model.** The node tree with transforms (converted
  per D3), every node's `extras`, the mesh behind each node, collision nodes
  with their defence-material ids per primitive, LOD alternatives, and the
  variants from `models.json`. This is what makes the import independent of
  whether the importer keeps extras (S1).
- **`<level>.ue.json` per level.** Terrain tiles and heightmap reference,
  static placements (geometry, transform, lightmap, LOD chain, modes),
  spawners, and `scene.json` passed through.
- **`catalogue.ue.json`.** `models.json`, `kits.json`, `loadouts.json`,
  `damage.json`, `vehicle-ai.json`, `vehicle-sounds.json` and the effects
  bundles, in one index.
- **Mesh dedupe.** Each unique geometry gets one entry, keyed by its source
  `.sm` name (`sourceGeometry`), so a house placed 40 times imports once.

Tests follow the project's convention (`python3 -m unittest discover`; see
`project_bf1942_models_tests`): each manifest is checked against a known
glb, for example the Sherman's seat count, a wheel's spring values, and a
collision layer's material ids.

### 4.3 The importer: Unreal editor Python, in the Unreal repo

It runs inside the editor and reads the bundle.

1. **Static Meshes**, one per unique geometry, through glTF import of each
   PNG glb. After import it renames assets to `SM_<geometry>` and files them
   in `/Game/BF42/Meshes/<category>/`.
2. **Materials.** One master material, `M_BF42`, with instance parameters:
   base texture, tint (`baseColorFactor`), two-sided, blend mode (opaque,
   masked with `alphaCutoff`, translucent, additive), unlit, envmap strength
   and optional lightmap. Imported materials get replaced by instances of
   it, with parameters read from the glTF material and its extras
   (`additive`, `alphaTest`, `textureFade`, `envmap`). Material counts in the
   current tree: 4,977 opaque, 2,905 blend, 35 mask. Many BLEND materials are
   probably alpha-tested in practice, and M4 should check whether masked
   rendering suits them better, since sorting thousands of translucent
   objects is expensive.
3. **Collision.** Collision nodes become the matching Static Mesh's collision:
   complex collision for statics and for armour traces, split into one
   section per `defenseMaterial`, each section's material mapped to a
   Physical Material `PM_Def_<id>` carrying the `damage.json` material row
   (S5). Vehicles also need simple collision for Chaos bodies: convex hulls
   generated from the collision meshes, or boxes and capsules per part if
   convex decomposition gives bad hulls. BF1942 collision meshes aren't
   convex.
4. **Vehicle Blueprints.** One `BP_<Template>` per vehicle from its
   `.ue.json`: a component tree mirroring the node tree (static mesh
   components per part, scene components for muzzles, cameras, entry points,
   seats and effect points), plus a `UBf42VehicleData` Data Asset holding the
   extras (engine, springs, wings, floats, armour, weapons, seats, HUD). The
   C++ vehicle class reads only the Data Asset, so re-running the importer
   updates stats without touching Blueprint logic.
5. **Soldiers.** Per S2: Skeletal Meshes from the pose glbs, one skeleton per
   soldier family, Anim Sequences from the gaits, kit parts as Static Meshes
   attached to sockets, and `UBf42SoldierData` from `kits.json` and
   `loadouts.json`. The 288 pose glbs are the 8 soldiers x 28 weapons matrix
   (`poses-matrix.json`), and the weapon is welded into each. Import **one**
   body per soldier and attach weapons at `Bip01 R Hand` at run time, not
   288 meshes, if S2 shows the bodies are identical across weapons (they
   should be, the weapon only changes the grip gait).
6. **First-person arms.** Skeletal Meshes from the 197 `fp.glb` with their 17
   clips, and view data (FOV, camera position, zoom) into the weapon's data
   asset.
7. **Levels.** Per level, a `.umap`:
   - Terrain: either the 64 baked tiles as Static Meshes (exact, quick, right
     for M1), or a **Landscape** from `heightmap.r16` with a landscape
     material whose layers come from `terrain/materials.png` (MaterialManager
     ids to layers: sand, dirt, rock, road...). The Landscape route is the
     one that looks modern and lets people edit maps. Height grid sizes are
     `worldSize / 4 + 1` samples per side (513 on a 2 km map), which may not
     be one of Unreal's recommended Landscape sizes, so check whether it needs
     resampling or padding. Terrain physical materials come from the same
     material map, so friction and dust effects follow the ground type as they
     do in BF1942.
   - Statics: actors or instanced static meshes at the placements, per D7.
   - Gameplay actors from `scene.json`: `ABf42ControlPoint`,
     `ABf42SoldierSpawn`, `ABf42VehicleSpawner` (vehicle, team, delays),
     combat area volume, water plane at `waterLevel`, and mode filtering from
     `modes` so one map serves conquest, CTF and co-op.
   - Environment: directional light from `sunDirection`, exponential height
     fog from `fogColor/fogStart/fogEnd`, sky from `sky/*.png` (or a
     procedural sky tinted to it), ambient from `lighting`.
   - AI data: `scene.json.ai` and `pathfinding/*.raw` copied into a
     `UBf42LevelAIData` asset for the ported vehicle routing (D9).
   - Ambient sound areas from `scene.json.sounds.areas`.
8. **Effects.** Per D11, Niagara archetypes plus generated parameter assets.
9. **UI assets.** HUD sprites and bitmap fonts imported as textures and
   Unreal fonts, and layouts from `hud/*.json` into UMG widget data (see M7).

The importer is **idempotent and rerunnable**: it overwrites generated assets
in place and never touches hand-made content (the master material, Niagara
archetypes, UI widgets, C++ Blueprints' parents).

### 4.4 Budgets to check early

- Vanilla asset set in Unreal: meshes (389 models plus level statics after
  dedupe) and textures (a subset of the 747 MB WebP store, larger as PNG and
  after Unreal's compression). Measure after S1 and S3.
- Per-level draw calls after instancing, measured on Kasserine in S3.
- Import time for the full vanilla set, since the importer gets rerun
  whenever the exporter changes.

---

## 5. The gameplay port in detail

### 5.1 How to port

- **One JS module becomes one C++ file**, where possible with the same name
  and functions, so the JS stays a readable reference next to it.
  `tracked-vehicle.js` becomes `Bf42TrackedVehicle.cpp`.
- **Keep the data flow.** The JS passes plain objects between plain functions.
  Port those as plain C++ structs and functions (`FBf42HullState`,
  `StepTrackedVehicle(...)`), with Unreal actors and components as thin
  wrappers that own the state and call the step. This keeps the simulation
  testable without a running world, as `sim/` does today.
- **Replace `three`** with a small math header over Unreal's `FVector`,
  `FQuat` and `FTransform` (in metres, per D3). Most `three` use in the sim is
  math, and the rest (`Object3D` as a transform tree) becomes components.
- **Randomness** goes through one seeded stream per world (as `sim/rng.mjs`),
  so a test can replay a match.

### 5.2 Proving a port matches

The JS runner (`sim/run.mjs`) already plays seeded matches headless. For each
ported subsystem:

1. Record inputs and outputs from the JS for a fixed scenario (a Sherman
   driving a set route, a Spitfire's climb, a K98 round's flight and damage).
2. Feed the same inputs to the C++ step in an Unreal automation test and
   compare within a tolerance, since float differences between JS doubles and
   C++ floats mean exact matches aren't expected.
3. For systems where D5 swaps in Chaos, compare behaviour, not ticks: top
   speed, turning circle, stopping distance, climb angle.

Matches diverge within seconds from small differences
(`project_runner_flip_switch`), so compare **per-subsystem, step by step**,
never whole matches. The final check on feel is playing it, with the parity lab
(`features/parity-lab/`) to record the real game for comparison.

### 5.3 Subsystem map

| JS subsystem | Unreal home | How |
|---|---|---|
| `world.js`, `fixed-step.js` | `UBf42WorldSubsystem` | Owns the 30 Hz accumulator, the input buffer per player (cap 4, as `world.js`), and the step order. |
| Ground vehicles | `ABf42Vehicle` + `UBf42GroundDrive` component | Ported per D5-C. Wheels and springs query ground with sweeps against Chaos collision. Track texture scroll from `animatedTextureSpeed`. |
| Flight | `UBf42AircraftDrive` | Ported `aircraft.js`, `airborne.js`, driven by Wing and Engine data. |
| Boats | `UBf42ShipDrive` | Ported `ship.js`, `body-float.js`, against the level's water level. |
| Rigid contacts, crash damage | Chaos or ported (S4) | |
| Collision world | Chaos | Queries only. `heightfield.js` and `static-index.js` are not ported. |
| Soldier movement | `ABf42Soldier` + `UBf42SoldierMovement` | Ported `soldier.js`, `walking-body.js`, `soldier-locomotion.js`, `swim.js`, `parachute.js`, `ladder-climb.js`, `fall-damage.js`, on the nested 60 Hz step. Not Character Movement (D5, D6). |
| Seats and entry | `UBf42SeatComponent` | Ported `seats.js`, `vehicle-entry.js`, `vehicle-occupancy.js`. Entry points and seat flags come from extras. |
| Weapons and ballistics | `UBf42FireArm` + `FBf42Projectile` | Ported gun cycle, heat, magazine, deviation, projectile flight (as simulated projectiles, not actors, for count), proximity fuse, turret rig. |
| Armour and damage | `UBf42Armor` + damage tables | Ported `armor.js`, `vehicle-damage.js`, `vehicle-hits.js`, `projectile-damage.js`, using `damage.json` and the Physical Material per face (S5). Wreck swap to `<Name>.wreck` meshes. `addArmorEffect` HP thresholds drive Niagara effects. |
| Game modes | `ABf42GameMode` + `ABf42GameState` | Ported `game-modes.js`, `round-state.js`, `spawn-flags.js`, `spawning.js`, `spawn-safety.js`, `combat-area.js`, `supply.js`. Tickets, bleed, capture timing and radius from `scene.json`. |
| Bots | `ABf42BotController` | Per D9. |
| Sound | `UBf42SoundComponent` | Per D10. |
| Effects | Niagara | Per D11, with `effects-core.js`'s random-variable sampling moved into Niagara parameters. |
| Animation | `UBf42SoldierAnimInstance` | Per D8. `seat-ik.js` and `arms-rig.js` become Control Rig or two-bone IK nodes. |
| Cameras | `ABf42PlayerCameraManager` | 1P and 3P cameras from each Camera node's `cameraView`. Vehicle cameras from seat data. |
| HUD and UI | UMG | Per M7. |
| Netcode | Unreal replication | Per D6. `netcode.js`'s input struct is kept as the RPC payload. |

---

## 6. Milestones

Each milestone ends in something playable, with its own exit check. The
sizes are rough guesses for one developer who knows the codebase and is new to
Unreal, working with AI assistance. Revise them after the spikes.

### M0. Foundations (after S1-S3)

- Unreal project and repo (D2), C++ module `Bf42`, units and axis helpers
  (D3), automation test harness.
- Exporter additions (4.1) and the converter (4.2) for models and one level.
- Importer steps 1-4 and 7 (terrain tiles only) for the Sherman and Kasserine.

**Exit:** Kasserine opens in the editor with every static in place, and a
`BP_Sherman` with a correct component tree and Data Asset sits on it.
*Rough size: 3-5 weeks.*

### M1. Replay player and the comparison harness

Before any physics, Unreal learns to **play a recorded round**. It exercises
nearly the whole asset pipeline (levels, vehicles with turrets and seats,
soldiers with gaits and first-person arms, effects, sounds, HUD pieces) with
none of the simulation, and it gives D12's comparison tool from the start.

- Port `replay-recording.js` and the replay modules it needs for poses,
  gaits, seats and moving parts (the 45 `replay*.js` files are mostly UI; the
  port takes the model, not the page).
- Draw every life on the imported level: soldiers posed and animated from
  their recorded states, vehicles with turret and gun angles and crews,
  projectiles and impacts from the v4 shot records.
- `bf42.Replay.Dump` writes the same JSON as `tests/perf/replaydump.mjs`.
  `tools/bf1942-unreal/compare/` diffs the two within a float tolerance, and
  captures matching shots from both engines into a side-by-side page (D12).
- A free camera and a follow camera, enough to inspect a round. The browser's
  creator view, feed and highlights stay in the browser.
- Soldier skeletons and gaits (S2) land here, earlier than M3 would need them.

**Exit:** `replay_20260928-161948` (the 45-minute Bocage benchmark;
`project_replay_performance`) plays in Unreal. Its dump matches the browser's
within tolerance, and a 20-shot side-by-side comparison shows the same
people in the same places doing the same things. *Rough size: 4-6 weeks.*

### M2. One tank on one map

- `UBf42WorldSubsystem`, fixed step and interpolation.
- Ground vehicle port (S4's outcome), Sherman engine, gears, tracks.
- Enter and exit, driver camera, turret and gun rotation.
- Main gun: projectile flight and impact effects, no damage yet.

**Exit:** drive the Sherman around Kasserine, shoot, and it feels like the
game's Sherman to the owner. The JS comparison tests for the drive pass.
*Rough size: 4-6 weeks.*

### M3. Soldiers

- Skeletal soldiers and gaits (S2), Animation Blueprint (D8).
- Soldier movement port: walk, run, crouch, prone, jump, swim, ladders,
  parachutes, fall damage.
- Kits and loadouts, hand weapons with first-person arms, deviation and
  recoil.
- Entering vehicles as a soldier, seats with poses.

**Exit:** spawn as any vanilla kit, fight on foot, get in the Sherman as driver
or gunner. *Rough size: 6-8 weeks.*

### M4. Damage and the look

- Armour, damage tables and per-face materials (S5), wrecks, critical damage,
  burning, soldier hit zones (`skeleton-hit.js`).
- Master material tuning, Lumen and grade tuning, fog and sky from
  `scene.json`.
- Niagara archetypes and the effects generator (D11).

**Exit:** a tank fight between the Sherman and a Panzer IV ends in a burning
wreck, and Kasserine looks like Kasserine, better lit. *Rough size: 4-6 weeks.*

### M5. Conquest

- Game mode, control points, capture, tickets, bleed, spawn selection, vehicle
  spawners with their delays, supply depots, combat area.
- Deploy screen, scoreboard and the core HUD (M7 starts here).

**Exit:** a full conquest round on Kasserine, alone, from start to ticket
loss. *Rough size: 3-4 weeks.*

### M6. Multiplayer

- Dedicated server build, replication for world, vehicles, soldiers,
  projectiles and game state, the prediction outcome of S6.
- Joining, team choice, server browser or direct connect.

**Exit:** a round with several players on a dedicated server, at realistic
latency, with nothing that visibly snaps. *Rough size: 6-10 weeks, the widest
range because the prediction work is the least predictable.*

### M7. HUD and front-end

- UMG screens from the layout JSON: HUD (health, ammo, vehicle, compass,
  minimap from `minimap.png` and its affine transform), deploy screen, kit
  selection, scoreboard, chat, radio menu, console, main menu.
- The bitmap fonts and sprites as-is, for the original look.

Runs alongside M5-M6.

### M8. Bots

- Decision layer port (D9), NavMesh for infantry, baked search maps for
  vehicles, bot gunners and drivers.

**Exit:** a bot conquest round on Kasserine that plays out like the parity lab's
recordings, with bots capturing, driving tanks and firing.
*Rough size: 6-8 weeks.*

### M9. Air and sea

- Aircraft (Spitfire, Bf 109, Zero, Corsair, bombers), carriers and
  destroyers, landing craft, submarines, bombs and torpedoes.
- The flight and ship ports, AA guns, deck-mounted spawns.

**Exit:** Midway and Wake play, with carrier take-off, dogfights and a
torpedo run. *Rough size: 6-8 weeks.*

### M10. All vanilla levels

- Import all 23 levels, fix each level's problems, performance per level.
- The Landscape terrain route for levels that people want to edit.

**Exit:** every vanilla level plays a conquest round with bots.
*Rough size: 3-5 weeks.*

### Later

Road to Rome and Secret Weapons (a data pass plus their new vehicle types,
such as Secret Weapons' jet packs and experimental aircraft), and map editing for
the community with the Unreal editor.

---

## 7. Risks

| Risk | Why it matters | How to handle it |
|---|---|---|
| The feel doesn't match | It's the reason to do this at all. | D5-C keeps our movement models. Per-subsystem JS comparison tests (5.2). Owner playtests at each milestone exit. |
| glTF import loses what we need | Game data in extras, alpha modes, hierarchy. | S1 first. The sidecar manifests (4.2) make game data independent of the importer. |
| Soldier skeleton and gait mismatch | 67-node gait rigs against an 80-node pose rig. | S2 first. The viewer already retargets by bone name, so the mapping is known. |
| Old art under modern lighting looks worse, not better | Low-resolution albedo with lighting painted in. | D7 tuning pass in M4. The original lightmaps remain available as a classic mode. |
| Prediction with custom movement | Character Movement's prediction doesn't apply to a ported soldier. | S6 before M6. `SNAPBACK.md` already has the design. |
| Draw calls from thousands of small statics | BF1942 maps are made of many small props. | Mesh dedupe and instancing (4.2, 4.3). Measure in S3. |
| BLEND materials sorting | 2,905 translucent materials. | Check which are really alpha-tested, and use masked where so (4.3 step 2). |
| Exporter and Unreal pipeline drift apart | Fixes land in one and not the other. | The converter reads only the published tree (D4). The importer is rerunnable. Re-import is part of the "done" rule for an exporter fix, as it already is for level bakes. |
| Laptop hardware | 4 GB of video memory, below Unreal's recommended 8 GB. The owner also tests the browser viewer on the same laptop. | Section 0: driver and disk first, reduced editor scalability, software Lumen. Run one heavy thing at a time: Unreal or the browser comparisons, not both at full tilt (`feedback_limit_headless_browsers`). |
| The two engines drift | Fixes land in the JS and not the C++, or the other way. | D12: port provenance headers, `drift.py`, `SYNC.md`, and the replay dump diff in M1. |

---

## 8. Questions and answers

Answered by the owner 2026-09-29. The answers are recorded under "Owner
decisions" at the top, and in D2, D5, D6 and D12.

| Question | Answer |
|---|---|
| Faithful, or can gameplay change? | Faithful, quirks included. D5 now defaults contacts to our own solver. |
| Commit imported assets or regenerate them? | Asked before explaining what Unreal is (now section 0). Decided as a default: regenerate (D2). Revisit if cloning and re-importing turns out to be slow. |
| Where do dedicated servers run? | Locally for now, Hetzner later (D6). |
| What machine runs the editor? | This PC. It needs the NVIDIA driver and disk space first (section 0). |
| Keep the browser engine in step? | Yes, to test one against the other (D12, M1). |

Still open:
- Whether a dedicated server needs a source build of the engine on Linux (M0
  checks, section 0.3).
- Where the Unreal repo is hosted (GitHub, like this one, is the default).

---

## 9. Progress

| Item | Status |
|---|---|
| Plan | written 2026-09-29; owner's answers folded in the same day |
| This PC: NVIDIA driver, disk space | not started (owner) |
| S1-S6 | not started |
| M0-M10 | not started |
