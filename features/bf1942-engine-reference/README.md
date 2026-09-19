# BF1942.exe engine reference

A durable cross-reference between the retail BF1942 client binary and our
extraction code, so that "x-ref BF42 source with our code to verify *X*" is a
single instruction rather than a research project.

The extraction pipeline in `tools/bf1942-models/` reconstructs proprietary
Refractor formats from observation. Observation of vanilla data is often right
by coincidence and wrong on mods. This folder is where a claim gets checked
against the code that actually reads the format, and where the answer stays.

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


804 symbols across 25 subsystems: 225 from bf42plus, the rest read from the binaries — 138 in the first 2026-09-16 research round (formats, menus, rendering, physics, effects), 198 more (193 net new, plus five corrections to earlier entries) in the second, on the mechanics below, a further 10 (SSC-1/SSC-2/SSC-5's SoundScript addresses) from an unrelated fix landed the same day, and 25 more (plus five corrections) across two rounds on 2026-09-17, which closed HP-6 by proving a collision never costs hit points and settled what makes a vehicle burn — see [ledger](ledger.md) HP-6 and [subsystems/hitpoints-and-damage.md](subsystems/hitpoints-and-damage.md) §3.

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

**779 symbols across 25 subsystems** (up from 576/22; 804 after the two 2026-09-17 collision rounds): this round recorded
198 addresses (193 net new, five corrections to existing rows) for **769**;
merging in a further 10 from an unrelated same-day SoundScript fix
(SSC-1/SSC-2/SSC-5) brings the corpus to **779**. Three new subsystems
(`hitpoints`, `seat`, `supplydepot`), and three prior
`ghidra-session`-sourced `EngineTemplate` entries plus `SpawnScreen_singleton`
upgraded from bf42plus's unread `working` label to this round's `verified`,
now that independent work reached the same code from the HUD side.
