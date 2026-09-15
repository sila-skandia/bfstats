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

576 symbols across 22 subsystems: 225 from bf42plus, the rest read from the binaries — 138 of them in the 2026-09-16 research round.

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
  exponential (EMT-5), and vehicles have a second, box-shaped drag law
  (physics.md §3, PHY-4); the first spawn and `startRotation`'s degrees (EMT-2,
  EMT-3); the client's sprite particles (SPR-2…SPR-6), including 791 flipbook
  sprites our pipeline ignores; wheel grip and `submarineData` (PHY-2, PHY-3);
  the client's jump gate, down to its `c_SstJump` sound-trigger test (PHY-1); the anti-tank deviation words the engine
  ignores (DEV-8); the default frame cap (GL-2).

The corpus itself had five things wrong: +0x31 of a StandardMesh sub-shader is
`textureFade`, not `transparent`; `FireArms::setZoom` sets flag bits through
`updateFlags` and publishes no component 0x5000; `cameraShakeFactor` lies in
zero-filled `.data`; a `BFSoldier` holds four animation machines, not three; and
`c_SstJump` is sound trigger 4, not a name for the jump bit 0x80. Still open from the round: MEME-10, SM-5, LM-3's
apply/reset pairing, jump velocity, what selects `PhysicsNode`'s Advanced drag,
and the blend-mode mapping (SPR-5).

**SM-1/SM-2 are settled** ([subsystems/standardmesh-vertex-format.md](subsystems/standardmesh-vertex-format.md)):
a `.sm` material's `flags` word is the engine's vertex format, the stride is
derived from it (`rend::getStride`, client `0x00640f20`) and the buffer is a
Direct3D FVF buffer (`0x00672a40`), so the components sit in D3D order. The file's
stride is only a byte count for the stream read. The reader now lays vertices out
from `flags`; the one mesh in 234,144 descriptors where the two disagreed decodes
to geometry whose bounds equal its header. Still open there: bit 29's meaning, the
static DX8 block's `CreateVertexBuffer` site, and the vertex-shader declaration path.
