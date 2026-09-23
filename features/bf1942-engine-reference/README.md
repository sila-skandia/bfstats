# BF1942.exe engine reference

A durable cross-reference between the retail BF1942 client binary and our
extraction code, so that "x-ref BF42 source with our code to verify *X*" is a
single instruction rather than a research project.

The extraction pipeline in `tools/bf1942-models/` reconstructs proprietary
Refractor formats from observation. Observation of vanilla data is often right
by coincidence and wrong on mods. This folder is where a claim gets checked
against the code that actually reads the format, and where the answer stays.

---

## Start here

This README is the single entry point for engine work: aim an agent at it and
everything else is a link from here. The corpus says what the engine does. A
piece of the viewer built from it keeps its own record — what was built, how it
was checked and **what is still open** — in its own feature folder, and is
listed in this table.

| Built from this corpus | The engine's side, here | Build record and open items |
|---|---|---|
| **Vehicle collision physics** (2026-09-20). A rammed vehicle is a rigid body on its own wheel springs: pushed, spun and hurt, and so is whoever hit it | [subsystems/collision-response.md](subsystems/collision-response.md) is the spec, and its "Still open" table is the research queue; the wheel spring is [subsystems/physics.md](subsystems/physics.md) §6 and §10; ledger COL-2…COL-12, HP-6, PHY-2, PHY-5 | [`../vehicle-collision-physics/README.md`](../vehicle-collision-physics/README.md): what is built, measured results, deliberate differences from the engine, "Not done yet". [`IMPLEMENTATION.md`](../vehicle-collision-physics/IMPLEMENTATION.md) beside it is the briefing the implementers shared (interfaces, coordinates, test pattern) |
| **The parachute and free fall** (2026-09-21). Stepping out of a flying aircraft: the fall, the scream, the 11.5 s easter egg, the ripcord on 9, the glide, the landing | ledger PARA-1…PARA-9. `setParachuteSpeed` is an **acceleration**, not a terminal speed (PARA-2, refuting the old `SOLDIER_BOUNDING_RADIUS` justification), and `lastCollisionHeight` is written inline by `Armor::update` as a running **maximum** of altitude, so the engine does not damp fall damage for a parachutist (PARA-8) | [`../viewer-parachute/README.md`](../viewer-parachute/README.md). Open: the drag radius is bounded at `2.354 <= r < 3.126` and unverified inside it (PARA-6), and free-fall look-steering runs off to 129.8 m/s at t = 2 s with no radius that tames it (PARA-9) |
| **Bots and the AI subsystem** (2026-09-21; movement and pathfinding, then sensing, the behaviour contest, Fire / Scout / TakeCover, the strategic AI and spawning read and built 2026-09-23) | ledger AI-1…AI-49. A bot is an ordinary player whose `PlayerInput` the engine writes for it (AI-1); the AI is a time budget, not a per-bot loop (AI-6); difficulty is one knob with ten call sites that vanilla never sets (AI-14, AI-15). **The navigation map is one bit a metre** (AI-26), painted as outlines through a five-pixel brush (AI-27, AI-28); the local A* is 4-connected (AI-29); the follower steers at the farthest visible of the next ten points (AI-30) and throttles only inside a 31.5 deg cone (AI-31); statics are avoided through predicted-collision restriction circles, not the stall counter (AI-32) | [`../bf1942-ai-research-2026-09-21/README.md`](../bf1942-ai-research-2026-09-21/README.md): the whole model and the level data; [`bot-movement-and-pathfinding.md`](../bf1942-ai-research-2026-09-21/bot-movement-and-pathfinding.md): the map, the search and the follower; [`bot-behaviours.md`](../bf1942-ai-research-2026-09-21/bot-behaviours.md): sensing corrected (AI-33, AI-34), the decision loop (AI-35), Fire (AI-36), Scout / TakeCover / Idle (AI-37), the strategic AI and spawning (AI-38), then the fight re-read against the binary: `traceValidPoint` is the first valid cell (AI-39), Fire skips lost and out-of-range targets on foot with per-target miss tallies (AI-40), TakeCover's urgency needs no cover object (AI-41), the medic (AI-42), vehicles: a unit's urgency, the Change decision and plan, the tank law (AI-43..AI-45), seats and bailing, the turn and reverse, aircraft and boats (AI-46..AI-49), and what `viewer/bot*.js` and `strategic.js` build from them. The class tables, `calculateFireStrength`, `BBChangeTeleport`, the `actionStatusDecision` box test, `BBFireLargeBore`, `BBFire3d` / `BBPFire3d`, `BBPIdle3d`, the ControlInfo3d limits and the water map were read and built on 2026-09-23 (AI-50..AI-58, [`../bf1942-ai-research-2026-09-21/PARITY_STATUS_2026-09-23.md`](../bf1942-ai-research-2026-09-21/PARITY_STATUS_2026-09-23.md)); then the vacated seat in the fire strength (AI-59), the plane's flight law line for line through an x87 emulator of the binary (AI-60, `lnxded/x87emu.py`), the aircraft fire gate (AI-61), the sense rays skipping the bot's own hull (AI-62) and the seated Change gated on bailing (AI-63); the armour classes, the harmless threshold and the water maps (AI-64..AI-66), the square 3D sense frustum (AI-67), vehicle AI spread (AI-68), the attack clearances (AI-69), and the strategic order's geometry, fallback, arrival and re-order with the hull's capture distance (AI-70), and the aircraft order, its 50 m clearance and the airborne flag's lifecycle (AI-71), the dead fire veto and a target's security (AI-72), the landing craft as units of their own and the boat's speed control (AI-73), and five review findings (AI-74). Open: in-air strafing precision, the AI tick rate, `SAIUpdateFrequency`. **AI-21 is a verified negative**: the retail Instant Battle AI SKILL slider is inert, so wiring one is an improvement on the game and must be labelled one |
| **Aircraft bombs and torpedoes** (2026-09-22). Research only — nothing is built. The secondary weapon every plane carries and the viewer silently drops | ledger BOMB-1…BOMB-12, [subsystems/bombs-and-torpedoes.md](subsystems/bombs-and-torpedoes.md). A bomb rack is an ordinary `FireArms`: **a pull spends one round per projectile, not one per pull** (BOMB-1), so a Stuka's `magSize 30` is fifteen drops of a pair; `asynchronyFire` is what makes the B17 drop a stick of 8 rather than salvo (BOMB-3); and `AircraftTorpedo` declares **no `damageType`** at all, which is the whole reason it is inert on land (BOMB-11) | [`../plane-bombs-and-torpedoes/README.md`](../plane-bombs-and-torpedoes/README.md): the per-plane table, the extractor and viewer gap list. Open: `fireAllAtOnce`'s template offset (BOMB-4, moot — 0 uses in 14 installs), `AmmoType`'s rearm binding (SUP-2), primary-vs-secondary HUD slot (VHUD-10), and the torpedo's water run (BOMB-12) |
| **Ships, swimming and carrier parity** (2026-09-22). Ships float at authored draft (`FloatingBundle`), answer the helm, sink on critical damage; deck aircraft child spawners (`holdObject 1`); swimming mode and drowning; beaching hull-scrape effects | ledger PHY-3; [`../bf1942-ships-research-2026-09-22/README.md`](../bf1942-ships-research-2026-09-22/README.md) | Built across waves 7–9 (`d265a6fa`, `7300024c`, `8f00bfd9`, `c8677b83`, `18852ccc`), `0e1cd1e1` and [`../carrier-destroyer-parity/README.md`](../carrier-destroyer-parity/README.md). Open: ship-to-ship ramming and Elco80/Type38 multi-floater equilibria |
| **HUD, scoreboard and camera parity** (2026-09-21 / 2026-09-22). Live seat dots, Tab/deploy scoreboard, N-key minimap zoom/rotation, turret-following chase camera, `setKitName` labels | ledger VHUD-2, VHUD-9, VHUD-10, SB-1, SB-2, CAM-1, MMAP-1, MMAP-2 | Built across Wave 4 (`w4/hud` `eab59c0`, `w4/board-map` `e173af4`, `w4/camera` `577de24`). Open: live per-seat occupant selector in `BfOccupiedVehicleData` (inferred) |
| Everything else in flight across the viewer | | [`../bf1942-parity-round-2026-09-19/README.md`](../bf1942-parity-round-2026-09-19/README.md), the live open list |

**Next on collisions**, split by what each item needs first.

*An engine read, because the corpus does not have it:*

- **Ship-to-ship ramming.** Everything in collision-response.md applies once a ship
  is a body, but the ram collision behavior between two large floating bodies remains unverified.
- **The wake-up bounce.** A sleeping `PhysicsSpring` is skipped (PHY-5). Whether
  the wheel keeps its compressed position and `D_prev` through the sleep, and
  what detection does on the tick the root falls asleep, decides whether the
  one-tick bounce the viewer shows on first touch is the engine's.
- Everything in collision-response.md's "Still open": the client's
  `handleCollision` override, where `getSpeedDamageMod()` is consumed, the
  soldier-vs-soldier push signs, whether a body resting on contact alone ever
  sleeps.

*Building only, the spec is complete:*

- **The driven vehicle's crash response.** `ground.js` and `flight.js` keep their
  own integrators and take the solver's push through an adapter
  (`vehicle-bodies.js` `DrivenBody`), so a plane that noses in is levelled out
  rather than tumbling. The end state is one `RigidBody` per vehicle, driven or
  not (spec §3, §4, §8; [subsystems/tank-driving.md](subsystems/tank-driving.md)
  for propulsion through EngineGrip).
- **Bodies against statics.** The spec's direction rule already covers it
  (§5.3: a static is always the face side); only vehicle-against-vehicle goes
  through the solver today, and a building still stops a hull on the swept sphere.
- **The soldier as a body**: the crash-damage soldier branch (§9) is built and
  unused, because being run over is still the old code (PHY-6 for how a soldier
  moves under contact).

---

## The binary

Addresses are meaningless without the exact image they came from.

| | |
|---|---|
| File | `~/.wine/drive_c/EA Games/Battlefield 1942/BF1942.exe` |
| sha256 | `60c9452d1ddb6a09a7b2bd6aa49a8a5508504d0f0e458cc61f0aebff53cd3699` |
| Size | 5,648,384 bytes |
| PE timestamp | 2004-10-19 |
| Image base | `0x00400000`, x86 32-bit, MSVC 7.0 |
| Ghidra project | `bf1942-mp-enabler` |

**Other BF1942 builds relocate everything.** `./xref.py check` verifies the hash
before you trust a single address.

### The Linux dedicated server is the naming key

The retail client is stripped: of 16,601 functions, essentially all are
`FUN_xxxxxxxx`. Ghidra recovers 262 "classes" and they are almost entirely DLL
import groups and MSVC STL instantiations — the only real game types are
`IService`/`IJoinService`/`IHostService`, `UserInterface`, `Vec2/3/4` and
`ParserException`.

`/home/dylan/projects/public/bf42plus/bf1942_lnxded.static` is the same engine
source compiled for Linux **with debug info and 54,895 symbols intact**:

```
dice::ref2::io::FlatArchive        dice::ref2::geom::TreeMeshTemplate::Block
dice::ref2::io::ZipArchive         dice::ref2::geom::SimpleCollisionMesh
dice::bf::ai::AIMeshVertex::vertexFormat
```

It has no renderer, but it does have the file-format readers — a dedicated
server still loads meshes for collision and AI. Confirmed: 461 `StandardMesh`
symbols, the full class, and two adjacent globals named exactly after the fields
in ledger row SM-1:

```
087473a4 D dice::ref2::geom::g_vertexFormat
087473a8 D dice::ref2::geom::g_vertexStride
```

**Use it only for parsing questions.** There is no D3D8, no vertex buffer, no
shader anywhere in it. Anything about *drawing* — and that includes how a
material's components reach the GPU — can only come from the client.

**It decompiles, by name, in seconds (found 2026-09-19).** The server has been
sitting fully analysed in a second Ghidra project, `~/ghidra/linux-server`
(39,983 functions, every symbol attached), and it is also in the
`bf1942-mp-enabler` project. The GUI and the bridge refuse to open either copy
("minor language change 4.6 -> 4.7 ... can only be opened read-only until it is
upgraded"), which is why earlier rounds believed the server was "not in Ghidra"
and hand-read it as x87 assembly. A headless Ghidra upgrades on open, so
[`lnxded/decompile.sh`](lnxded/decompile.sh) copies the project to a temporary
directory and decompiles whatever you name:

```bash
./lnxded/decompile.sh /tmp/out 'ResponsePhysics::solveImpulse' 'world::PhysicsNode::update' 0x08253930
./lnxded/vt.py ResponsePhysics          # a gcc vtable, offsets from the VPTR (symbol + 8)
./lnxded/vt.py --float 0x86d16cc        # a float constant;  --u32 for an IID_/CID_;  --sym for "which function is this in"
```

About 15 s plus 0.1 s per function; names inside the C are mangled (`c++filt`).
It never touches the original project or the GUI's open one. Two runs must not
share a project copy (they collide on its lock) - the script makes its own.
Reading the decompiler's x87: `(byte)(x < 0.0 | NAN(x)<<10>>8 | (x == 0.0)<<0xe>>8)
== 0x40` is just `x == 0.0`; `param_1[0x1a]` on an `int *this` is the float at
byte `+0x68`. **The decompiler is a reader, not evidence**: a sign, a comparison
direction or a subtraction order still gets confirmed in `objdump`, and the
2026-09-19 verifiers did find decompile-level misreadings that way.

**It does not give you struct layouts.** The binary reports `with debug_info`,
but the DWARF covers only the statically linked libstdc++ and libgcc
(`locale.cc`, `eh_throw.cc`, `libgcc2.c`); there is not one DICE compilation
unit in it. Checked 2026-09-12 — do not re-run it. What you get is the symbol
table: names, addresses, and mangled signatures. Field offsets still have to be
read out of the code.

---

## How to use it

```bash
cd features/bf1942-engine-reference

./xref.py check                  # bridge alive? right binary?
./xref.py sym 0x005d0140         # what do we know about this address?
./xref.py sym StandardMesh       # ...or this name
./xref.py list geom              # everything in a subsystem
./xref.py list --confidence open # everything unproven
./xref.py decompile 0x005d0140
./xref.py xrefs 0x00908a90
./xref.py strings 'StandardMesh'
```

Ghidra must be running with the project open and the GhidraMCP extension
enabled; `xref.py` talks to its HTTP bridge on `127.0.0.1:8089`. There is no MCP
server registered with Claude Code for this — the bridge is a plain REST API and
`xref.py` wraps the parts worth wrapping. To register the MCP anyway:

```bash
claude mcp add --scope user ghidra -e GHIDRA_MCP_URL=http://127.0.0.1:8089 -e PYTHONIOENCODING=utf-8 -- /home/dylan/.local/bin/uv run --no-sync --directory /home/dylan/projects/public/ghidra-mcp bridge-mcp-ghidra --transport stdio
```

It exposes 239 tools, which is a large context cost for what `xref.py` already
does. `curl http://127.0.0.1:8089/mcp/schema` returns the full self-describing
endpoint list if you need an endpoint the script does not cover.

### Traps that cost real time

- **gcc vtables begin 8 bytes before the vptr.** In lnxded, `call [reg+N]` is the
  entry at `vtable for X` + 8 + N; counting from the symbol lands two slots
  early. That produced the old "component 0x5000" and a misread `getClassID`.
- **Direct3D 8 has `CreateImageSurface` at slot 27**, which D3D9 dropped. Device
  offsets: `SetTransform` +0x94, `SetRenderState` +0xc8, `SetTexture` +0xf4,
  `SetTextureStageState` +0xfc, `DrawPrimitive` +0x118, `DrawIndexedPrimitive`
  +0x11c, `DrawPrimitiveUP` +0x120, `SetVertexShader` +0x130. The client keeps
  the device in `ds:0x9c0184`.
- **x87 comparisons invert easily.** Work every `fnstsw` / `test ah,…` out from
  the flags, and decode register-pair `fsub`/`fdiv` forms from their bytes or
  from Ghidra's decompile of the client twin. Several first readings in the
  2026-09-16 round had a comparison backwards.
- **The client's `.data` holds raw bytes only up to 0x00960000**; the loader
  zero-fills the rest.
- **Functions created through the bridge can be missing later** — several from
  2026-09-15 sessions were, presumably because the project was not saved. Check
  `/get_function_by_address` before decompiling.

---

## Layout

```
symbols.json    address <-> name <-> subsystem <-> confidence <-> source
xref.py         lookup + Ghidra driver + `add` to record findings
ledger.md       every assumption our code makes, and its verification status
lnxded/         decompile.sh + vt.py: the Linux server, decompiled by name
include/        C stubs: the shape of each format, with per-field provenance
subsystems/     narrative notes per subsystem, as they accumulate
surveys/        scripts that measure real game data to test an assumption
```

Files are named for what they describe, not for addresses — `symbols.json` is
the address index and `xref.py sym 0x…` is the lookup. One file per address
would be unreadable and would not survive a second binary.

`symbols.json` is written as `json.dumps(doc, indent=1) + "\n"` and **sorted by
address**, which is what `xref.py add` does on every write. Some hand-merged
rounds have left it unsorted; the 2026-09-20 integration re-sorted it, which is
why that commit's diff is large for 65 new entries. Merge it **by address, in
Python** — never by text, and never by replacing an entry: an existing address
keeps its name and gets its note extended.

### Confidence

Recorded per symbol, and the reason this corpus is worth anything:

| | |
|---|---|
| `verified` | read out of the binary; evidence in `ledger.md` |
| `working` | used by shipping third-party code (bf42plus hooks it and works) |
| `inferred` | deduced from strings, xrefs or shape; the code has not been read |
| `open` | hypothesis — do not build on it |

Never promote a symbol without evidence. A corpus that quietly launders guesses
into facts is worse than no corpus.

---

## Seeded from

**bf42plus** (`/home/dylan/projects/public/bf42plus`) — a DLL that hooks the
retail client to improve online play. Its `ghidra_label.py` carries 233 verified
addresses across ~30 subsystems, contributed here at `working` confidence
because the DLL patches them at runtime and functions. `ghidra_types.java` holds
struct definitions in Ghidra-script form that have not yet been ported to C.

**This session's Ghidra work** — the engine type-name strings, the archive name
table, and the StandardMesh anchors.

---

## Working rules

1. **Record as you go.** `./xref.py add` in the same breath as the discovery.
   Anything not written down will be paid for again.
2. **Evidence or `open`.** "The viewer renders correctly" is not evidence. Most
   of these assumptions are accidentally true of vanilla and false on mods.
3. **Never invent a mapping.** If a field's meaning is unknown, it stays
   `reserved`/`[open]` in the header. A plausible name is worse than no name,
   because the next agent will trust it.
4. **Mods are the test, vanilla is not.** 14 mods are installed; `surveys/` is
   how you check a claim against all of them at once.
5. **Update `ledger.md` when a status changes** — that table is the thing the
   "x-ref to verify *X*" instruction actually consults.

---

## Current state

**Netcode, 2026-09-20.** The P0 multiplayer research stream
([`features/netcode-play-multiplayer/`](../netcode-play-multiplayer/README.md))
verified and filed: the wire action record is `PlayerAction` — six 12-bit
channels in fixed order (Yaw, Pitch, Roll, Throttle, MouseLookX, MouseLookY)
plus a u32 button mask at byte 12, 104 bits — the server delivers exactly one
buffered action per player per tick from a queue trimmed to four drop-oldest,
with seq dedupe and a backlog `> 9 → 1`, and the client predicts its own
player from the same actions it sends while remotes are ghost-overwritten at
0.1 s with no interpolation buffer. Write-up in
[subsystems/netcode.md](subsystems/netcode.md); ledger rows
W-1…W-5, D-1…D-6, J-1…J-4, P-1/P-2, R-1/R-2. It overturns two of that design
doc's assumptions: `operator<<`/`>>` are console name helpers, not the wire
format (W-5), and IService/IJoinService/IHostService are empty stubs, not a
join/host split (J-2). **30 symbols added, 17 notes extended, six of them
promoted from bf42plus `working` to `verified`**; two items stay `open` — the
ghost apply step `0x00498ce0`, and the client send-loop batch cap (R-2b: the
≤ 3 cap exists only server-side in `PlayerActionManager::add` `0x08148120`).

**The drivetrain, the console, IK and the combat area, 2026-09-20.** A second
integration pass carried in the build streams of two waves, the reviewers who
re-derived their work from the binaries, and a dedicated verifier who settled
the gearbox. Four new ledger sections — the in-game console
([subsystems/console.md](subsystems/console.md), CON-2…CON-13), skeleton IK
([subsystems/skeleton-ik.md](subsystems/skeleton-ik.md), IK-1…IK-4),
environment maps (EM-1…EM-3, written up beside the lightmap combine in
[subsystems/standardmesh-vertex-format.md](subsystems/standardmesh-vertex-format.md))
and the combat area
([subsystems/combat-area.md](subsystems/combat-area.md), CA-1…CA-7, which is
where level-scope rules live now) — plus the round's largest reversal:

- **`engineType` is a bit field read at nine virtual call sites, and bit 0
  makes `PhysicsEngine::updatePhysics` return at its second instruction for a
  car or a tank.** TANK-1's "no simulation code calls `getEngineType()`" came
  from a grep that could not see a virtual call, and TANK-7's hull-thrust model
  is refuted with it: **a ground vehicle is propelled by the same EngineGrip
  contact-speed target a car uses** (TANK-9, whose "×½" was a countdown's seed
  mistaken for its steady value). The gearbox itself —
  `Engine::handleUpdate`, its per-call rev filter, the roll angle that is not
  the pedal, and the load feedback whose divisor is TANK-4's torque curve — had
  never been opened: TANK-12 and TANK-13.
  [subsystems/tank-driving.md](subsystems/tank-driving.md) is rewritten around
  it, with the fleet's top speeds against the real vehicles.
- **Damage**: the contact recycle that decides which rounds ever reach a fuse
  (HP-9e), the three flak shells whose flag is not dead after all (HP-9f), the
  blast centre 0.1 m up the normal (HP-9), and what a tank HE round really
  splashes — no ground armour at all, but 150 HP on an aircraft (DMG-2).
- **One thing was opened rather than closed.** LOOP-1 records a single
  reader's finding that **lnxded**'s own loop targets 60 Hz with a measured
  frame dt, which would make PHY-1's apex and PHY-6's ramp times frame-rate
  figures rather than constants. It is one reader, it is not re-derived, and
  the 30 Hz section below — read on the **client** — is deliberately left
  standing. Both rows now carry an "if LOOP-1 holds" qualifier; the row itself
  says what a second reader must check.

All 29 items of the parity round's
[`viewer-changes.md`](../bf1942-parity-round-2026-09-19/viewer-changes.md) are
now built and marked with their merge commits, and that file's new "Open after
wave 2" is the queue a later round should start from.

**Rigid-body collisions, 2026-09-19.** How two vehicles collide - contact
finding, the mass-ratio push, the integrator and its box inertia, sleeping,
the friction solver and crash damage - is written up in
[subsystems/collision-response.md](subsystems/collision-response.md), from six
reports and five verifications kept in
[`features/vehicle-collision-physics/`](../vehicle-collision-physics/README.md).
It **reverses this corpus on one point that the viewer was built on**: a
collision does cost a vehicle hit points, against another object and against the
ground (ledger HP-6, COL-2...; hitpoints-and-damage.md §3 rewritten). It also
closes PHY-2's friction magnitudes, corrects physics.md §3 (only the root node
integrates, one step per tick; `+0xcc` is `isSleeping`), names the
`responsePhysicsManager` vtable (`update` is `+0x14`; `+0x1c` is the cache
reset), and adds
a `collision` subsystem of about 200 symbols, server and client.
**Built 2026-09-20**: the viewer now runs that solver for every parked vehicle
and for whatever the player rams it with. The build record, its measured
results and its open items are in
[`features/vehicle-collision-physics/README.md`](../vehicle-collision-physics/README.md),
and "Start here" at the top of this file carries the queue that follows from it.


1,214 symbols across 26 subsystems (1,184 before the 2026-09-20 netcode round; 1,119 before the second 2026-09-20 integration; 817 across 25 before the two 2026-09-19 rounds): 225 from bf42plus, the rest read from the binaries — 138 in the first 2026-09-16 research round (formats, menus, rendering, physics, effects), 198 more (193 net new, plus five corrections to earlier entries) in the second, on the mechanics below, a further 10 (SSC-1/SSC-2/SSC-5's SoundScript addresses) from an unrelated fix landed the same day, 25 more (plus five corrections) across two rounds on 2026-09-17, and **96 (plus 14 corrections) from the 2026-09-19 parity round** on damage, the vehicle HUD and soldier movement. That 2026-09-17 pair closed HP-6 by proving a collision never costs hit points — which 2026-09-18 and then 2026-09-19 refuted outright; see [ledger](ledger.md) HP-6 and [subsystems/hitpoints-and-damage.md](subsystems/hitpoints-and-damage.md) §3. The same evening's collision round added **207 more** (the `collision` subsystem, plus 21 extended notes); the two were merged by address on 2026-09-20 with one overlap (`0x08173fc0`, `Armor::getSpeedMod`, which keeps the collision round's entry and carries the parity round's evidence in its note). The same day's second integration added **65 more** (the console class in both binaries, the skeleton-IK chain, the combat area, the projectile contact recycle and the gearbox) **and extended 17 existing notes**, one of which — `getEngineType` `0x0823fd00` — had been carrying a refuted claim. The netcode round later the same day added **30 more** (the `net` and `game` subsystems' wire, delivery and join code) and extended a further 17 notes, six promoted from bf42plus `working` to this round's `verified`. Recompute with `python3 -c "import json;print(len(json.load(open('symbols.json'))['symbols']))"`.

**The game loop is settled (2026-09-15).** The client is a fixed-step
simulation at `g_simulationFps` = 30 Hz (`0x00957640`; the same 30.0 in the
Linux server) with a frame-rate-independent tick count per rendered frame:
`Setup::mainLoop` 0x0044abc0 → `GameClient::update(nTicks, 1/30)` 0x0048fca0 →
`GameClient::simulateFrame(1/30)` 0x004b6cb0 (the address bf42plus labelled
"`World::update`"). One buffered `PlayerInput` per tick reaches
`handlePlayerInput(…, 1/30)`, so every per-call quantity in the weapon code —
deviation decay, fire bloom — is a per-1/30-s quantity, while
`handleVisualUpdate` (the hip↔zoom ease) runs once per rendered frame from the
drawer. Write-up in [subsystems/physics.md](subsystems/physics.md) §3 and
[subsystems/handweapon-view-and-deviation.md](subsystems/handweapon-view-and-deviation.md) §2.

**The `physics` subsystem is the worked example of what this corpus is for.**
34 symbols, almost all `verified`, written up as a narrative in
[subsystems/physics.md](subsystems/physics.md): the lift equation, the
integrator, gravity, thrust, springs, the grip bitfield, the soldier speed
tables and the camera shake. It replaced nine fitted constants in the viewer's
flight model with read ones, and settled several things the feature docs had
asserted wrongly for months — `setTorque` drives the engine *sound*, not thrust;
`setRegulateToLift 4.91` is g/3 because gravity is −14.73, not 9.81; and retail
BF1942 has no first-person walking view bob at all.

**Research round, 2026-09-16.** Nine agents took the open ledger items that
needed nobody at the game, four more followed their best leads, and a second
agent re-derived every report's claims from the binaries before anything was
recorded here. Settled:

- **Formats** — SM-3, SM-4, SM-6, SM-7 and a new SM-9 confirmed; TM-1 refuted
  (the tree mesh's "collision magic" is a class id); RFA-1's case rule and
  first-mounted-wins precedence confirmed; BAF-1 confirmed (`toMat` is
  row-vector, so `baf.py`'s conjugate is a transpose — and `baf.py` divides
  positions by `2^p` where the engine uses `2^p − 1`); the ten unparseable
  meshes explained.
- **Menus and HUD** — every menu action and event class read (MEME-11),
  including a 1-byte "Event type" that `meme.py` reads as 4; the `.font` grammar
  (FONT-1); the minimap's size, zoom and rotation (MEME-13, MMAP-1, MMAP-2).
  MEME-11's own remainder is now closed by **MEME-15**: `BfTransformNodeSize`
  puts its two floats *before* its two data objects, which was the last thing
  desyncing the reader (`menu/InternetMenu`, `menu/LocalMenu`). Nothing in any
  installed archive overruns the stream now, and clean pages go 110 → **137 of
  236**. Two rows came with it: **MEME-16**, front-end pages position panels
  with `AddData` / `SubData`, and **MEME-17**, a page placed by a `PathNode`
  layer carries page-local coordinates and no way yet to read where they go.
- **Rendering** — the object-lightmap combine (LM-1…LM-4).
- **Physics and effects** — particle drag is an acceleration, not an
  exponential (EMT-5), and every `PhysicsNode` vehicle always runs the box-shaped
  drag law (the sphere-`r = 0.1` selector bit is never set; physics.md §3, PHY-4);
  the first spawn and `startRotation`'s degrees (EMT-2,
  EMT-3); the client's sprite particles (SPR-2…SPR-6), including 791 flipbook
  sprites our pipeline ignores; wheel grip and `submarineData` (PHY-2, PHY-3);
  the client's jump gate, down to its `c_SstJump` sound-trigger test (PHY-1); the anti-tank deviation words the engine
  ignores (DEV-8); the default frame cap (GL-2).

The corpus itself had five things wrong: +0x31 of a StandardMesh sub-shader is
`textureFade`, not `transparent`; `FireArms::setZoom` sets flag bits through
`updateFlags` and publishes no component 0x5000; `cameraShakeFactor` lies in
zero-filled `.data`; a `BFSoldier` holds four animation machines, not three; and
`c_SstJump` is sound trigger 4, not a name for the jump bit 0x80. Still open from the round: MEME-10, SM-5, LM-3's
apply/reset pairing, jump velocity,
and the blend-mode mapping (SPR-5).

**SM-1/SM-2 are settled** ([subsystems/standardmesh-vertex-format.md](subsystems/standardmesh-vertex-format.md)):
a `.sm` material's `flags` word is the engine's vertex format, the stride is
derived from it (`rend::getStride`, client `0x00640f20`) and the buffer is a
Direct3D FVF buffer (`0x00672a40`), so the components sit in D3D order. The file's
stride is only a byte count for the stream read. The reader now lays vertices out
from `flags`; the one mesh in 234,144 descriptors where the two disagreed decodes
to geometry whose bounds equal its header. Still open there: bit 29's meaning, the
static DX8 block's `CreateVertexBuffer` site, and the vertex-shader declaration path.

**HUD, supply depots, hit points, seats, manned guns and tank driving,
2026-09-16.** A second research pass read the client and lnxded binaries for
the mechanics the map viewer needs to take a soldier from admiring a Defgun
to firing one from inside it — the same read-then-independently-re-derive
process as the first pass, run by a second agent before anything below was
recorded. Settled, each narrated in full under `subsystems/`:

- **In-game HUD** ([subsystems/ingame-hud.md](subsystems/ingame-hud.md)) —
  the whole soldier and vehicle HUD is one generic named-variable registry
  behind four typed registrars; the soldier group's pose/icon refresh runs
  once per rendered frame, not the 30 Hz sim tick; three fill-node classes
  share one `draw()` and one fill-fraction formula; `TransformNode` is the
  entire coordinate law; and a vehicle's hit points live on its root object
  only — switching seats never changes the displayed HP (HUD-1…10,
  VHUD-1…8).
- **Supply depots** ([subsystems/supply-depots.md](subsystems/supply-depots.md))
  — ammo boxes, medical lockers, repair pads and mobile depots are one
  `SupplyDepot` class with a twelve-vector template, a self-throttled
  real-time update that ignores its own `dt` argument, and an ammo
  mechanism that is a genuine per-type leaky bucket, not a flat top-up. The
  same class, given a negative rate, is Forgotten Hope's area-damage
  kill-trap (SUP-1…17).
- **Hit points and damage** ([subsystems/hitpoints-and-damage.md](subsystems/hitpoints-and-damage.md))
  — Armor's clamp/death chain, `handleDamage`'s real
  find-nearest-Armor-then-sign-dispatch shape (not a parent/root split), and
  the soldier explosion-exposure sampling, where standing is deliberately
  capped at half of prone/crouch's maximum exposure (HP-1…13).
- **Seats and entry points** ([subsystems/seats-and-entry-points.md](subsystems/seats-and-entry-points.md))
  — entry is `c_PIUse` behind two independent gates, `validateBFEntryPoint`
  adds a second team/hostility check beyond the obvious one, and the
  seat-switch map is built once, at spawn, for the root PCO only
  (SEAT-1…12).
- **Manned guns** ([subsystems/manned-guns.md](subsystems/manned-guns.md)) —
  `RotationalBundle`'s angle update is two cooperating accumulators, not the
  accel·dt/clamp formula a first read suggests (the exact closed form stays
  open); input-axis binding is a Vec3 slot, not a fixed semantic axis
  (Katyusha is yaw-only, correcting an earlier yaw+roll claim); and the
  extended fire-gate order includes a rate-of-fire timer no earlier pass
  reported (GUN-1…11).
- **Tank driving** ([subsystems/tank-driving.md](subsystems/tank-driving.md))
  — there is no tank-specific code path at all: differential steering is
  ordinary per-wheel friction code reading whichever axes an Engine happens
  to expose, and the gear-ratio curve is a 101-slot array authored at only
  five control points, so only a `numberOfGears` of 1 or 5 ever touches its
  shape — M3A1 is 17.5, not the ≈5.5 a smooth curve would predict
  (TANK-1…6).

The same pass closed out four items an extraction follow-up had flagged
while wiring this data into the pipeline: **SM-8** and **TM-1** are fixed,
not just diagnosed (`stdmesh.py` now accepts exactly file versions 8–10;
`treemesh.py`'s collision word is read as the class id it is, not a vertex
count); **FONT-1** has a real reader (`bf42/font.py`'s `parse_hud_font`);
**MEME-11**'s clean-page count is corrected from a wrong "228 of 230" to
the true **80 of 230** its own ten classes and the Event-type width fix
actually reach, with the shortfall now attributed to named classes outside
that row's scope; **EMT-2**'s viewer divergence (the burst-length edge, not
the spawn-at-t=0 edge, which was already right) is closed; **SPR-6**
flipbook sprites are implemented. Two new rows came out of the same work:
**CON-1** (the extractor was silently dropping every bare `include` line,
hiding `CommonSoldierData.inc`'s hit points from every soldier template
until fixed) and **MEME-14** (the in-game HUD's eleven-group top-level
shape, flattened by the new `extract_hud_layout.py`).

**Parity round, 2026-09-19 (damage, vehicle HUD and seats, soldier movement).**
Three research streams, each re-derived from the binaries by an independent
verifier before anything was recorded, and the verifier's text is what the
corpus carries. Settled:

- **Movement** — the soldier jump is **6.0 m/s**, applied as a one-tick
  acceleration, and the *server* computes it too: the arming bit 0x40 is set at
  lnxded `0x0827d566`, so the old "dead code behind an always-equal `0.0 == 0.0`
  test" reading was the not-armed arm only (PHY-1). Wheel friction is Coulomb
  with a material-sourced coefficient and a 1.5:1 static/kinetic hysteresis, and
  a soldier has its own pair, 3.2× a vehicle's with a quintic falloff in contact
  tilt (PHY-2). The car spring's force law, **and that there is no ray anywhere
  on the wheel path** (PHY-5). Locomotion reaches the speed tables through a
  signed-char ramp — 0.21 s up, 0.35 s down (PHY-6) — and `+0x44` is submersion
  depth (PHY-7).
- **Damage** — explosion falloff is linear, `1 − d/radius`, to the victim's
  origin with no occlusion for anything but a soldier (HP-9); `hasCollisionEffect`
  is the impact-versus-fuse discriminator, **not** a splash capability flag
  (HP-9d); `defaultDamageMod` is 0.0 and unreachable, so an unlisted material
  pair really does mean no damage (DMG-1); a soldier's impact speed has 8.0
  subtracted before any fall damage, with an early return if that goes negative
  (HP-14); and `SimpleObject+0xed`/`+0xee` are persistent wreck state that stops
  a destroyed vehicle being driven and cuts a critical one's traverse to 0.2×,
  which **retires ARM-6** (HP-13, HP-15).
- **Vehicle HUD, seats and driving** — the turret dial's trigger and angle
  (VHUD-9), the `Ammo` and `Overheat` registrar tables (VHUD-10),
  `setVehicleIconPos` as the seat-dot positions the extractor never parsed
  (VHUD-11), `setHudAmmoType`'s enumeration (HUD-10), the seat switch never
  stealing a seat (SEAT-11), `RotationalBundle`'s closed form (GUN-2), and
  **TANK-3 refuted**: the gear curve is piecewise-linear between its control
  points, so M3A1 is 5.512, not 17.5.

Four of the round's own recommendations were refuted by verification and are
recorded as "do NOT" items in
[`features/bf1942-parity-round-2026-09-19/viewer-changes.md`](../bf1942-parity-round-2026-09-19/viewer-changes.md).

**779 symbols across 25 subsystems** (up from 576/22; 804 after the two 2026-09-17 collision rounds): this round recorded
198 addresses (193 net new, five corrections to existing rows) for **769**;
merging in a further 10 from an unrelated same-day SoundScript fix
(SSC-1/SSC-2/SSC-5) brings the corpus to **779**. Three new subsystems
(`hitpoints`, `seat`, `supplydepot`), and three prior
`ghidra-session`-sourced `EngineTemplate` entries plus `SpawnScreen_singleton`
upgraded from bf42plus's unread `working` label to this round's `verified`,
now that independent work reached the same code from the HUD side.
