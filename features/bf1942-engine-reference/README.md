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
server still loads meshes for collision and AI. For anything about *parsing*,
name it in the server and carry the name across. For anything about *drawing*,
the client is the only source.

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

233 symbols from bf42plus, 16 from this session, across 15 subsystems.
Everything about the file formats is `open`: the corpus has the anchors and the
tooling, and one assumption under active investigation.

Open investigation: **SM-1/SM-2** — our `.sm` reader infers vertex layout from
stride and ignores the format's own `flags` word. A 234,144-descriptor survey
found one mesh where the two disagree, and our reader silently invents a
lightmap UV channel for it. The loader has not been located yet. Full write-up
and the three routes forward are in [ledger.md](ledger.md).
