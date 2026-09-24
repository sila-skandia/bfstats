---
name: bf1942-ghidra
description: Reverse-engineer BF1942 binaries with headless Ghidra in cloud sessions.
---

# BF1942 Ghidra (cloud sessions)

Reverse-engineer the BF1942 client exe and Linux dedicated server using
headless Ghidra. There is no GUI in cloud sessions — everything runs through
`pyghidra` and `analyzeHeadless`. One-time bootstrap: run
`tools/bf1942-models/ghidra-cloud/setup.sh` first; it is idempotent and
installs JDK + Ghidra 12.1.2 + PyGhidra, downloads both binaries from the
`bf1942-binaries` GitHub release, and restores both pre-analyzed Ghidra
projects.

## The two binaries

- **`bf1942_lnxded.static`** — ELF i386 dedicated server, ~15MB, built with
  **full DWARF debug info and not stripped** (~54k symbols, ~40k functions).
  Ghidra's DWARF analyzer recovers real function names, structs and types
  from it. This is the primary source of engine truth: function names, data
  structures, constants, call flow.
- **`BF1942.exe`** — PE32 client, ~5.4MB, no symbols. The import table's
  external names are the only anchors. It does NOT need its imported DLLs:
  Ghidra analyzes the exe standalone and only records import names as
  External locations. A fully analyzed project for it ships with setup (the
  label/type/enhance scripts were already applied to it).

Cross-reference both: the same engine code runs in both binaries, so
names/types recovered from the symbol-rich server binary transfer to the
client at the same addresses.

## How to run

Pre-analyzed projects live under `~/ghidra/` after setup:

- `~/ghidra/bf1942-client.rep` — program `/BF1942.exe`, analyzed + labeled.
- `~/ghidra/linux-server.rep` — program `/bf1942_lnxded.static`, analyzed.

**Python scripts must NOT run through the `pyghidra <binary> <script.py>`
CLI** — it silently re-imports a fresh, unanalyzed copy whenever the binary
MD5 doesn't match the project program, destroying the analyzed state. For
Python against an existing analyzed program use `apply_labels.py`, which
opens the program already in the project by name:

```bash
# Run Ghidra python script(s) against the analyzed program (writable, saved):
python3 tools/bf1942-models/ghidra-cloud/apply_labels.py \
  ~/ghidra bf1942-client BF1942.exe my_query.py

# Read-only ad-hoc queries: write a script that only prints (no save) and
# run it the same way, or use pyghidra.open_project() in a plain python file.

# Java scripts (ghidra_types.java / ghidra_enhance.java) use plain headless:
~/ghidra-installs/ghidra_12.1.2_PUBLIC/support/analyzeHeadless \
  ~/ghidra bf1942-client -process BF1942.exe -noanalysis \
  -scriptPath tools/bf1942-models/ghidra-cloud \
  -postScript ghidra_types.java ghidra_enhance.java

# Fresh import + analysis of a binary (battle-tested):
~/ghidra-installs/ghidra_12.1.2_PUBLIC/support/analyzeHeadless \
  ~/ghidra <project> -import <binary>
```

Passing the original binary path makes the `pyghidra` CLI match the analyzed
program by MD5 — only safe for querying, never for anything that saves.

## Existing label scripts

`tools/bf1942-models/ghidra-cloud/` holds three scripts derived from the
bf42plus mod's reverse engineering (they target `BF1942.exe` addresses):

- `ghidra_label.py` — renames known globals/functions by address
  (`pPlayerManager`, `g_pGameClient`, `Renderer__drawDebugText`, ...).
- `ghidra_types.java` — applies struct/type definitions.
- `ghidra_enhance.java` — function signatures and comments (run last).

## Workflow

1. Run `setup.sh` once; confirm both `.rep` projects exist and both binaries
   are in `.work/` with matching sha256.
2. For an engine question, query lnxded first (named symbols beat guessing).
   Write an ad-hoc Ghidra script (CPython 3): iterate
   `getFunctionManager()`, decompile with
   `ghidra.app.decompiler.DecompInterface`, search symbols, list
   cross-references. Print with `println()`, read stdout.
3. Query the client exe when the question needs client-only code (UI,
   renderer, input) — the shipped client project already has labels/types.
4. Record findings (addresses, struct layouts, constants) in a feature doc
   under `features/<feature-name>/README.md`, citing the binary and address.
5. Deterministic behaviors belong in `tools/bf1942-models/viewer/` sim code,
   grounded in what the binary actually shows.

## Pitfalls

- `gh` is NOT pre-installed in cloud sandboxes, and `GH_TOKEN` may be the
  proxy placeholder — setup.sh handles release downloads via gh, then apt,
  then raw GitHub API calls (the proxy substitutes real credentials for the
  placeholder token).
- Do not pass `-noanalysis` on a fresh `-import` of BF1942.exe — the label
  script addresses point at post-analysis function bodies.
- If a project is locked (`*.lock` files in `~/ghidra/`), delete the stale
  lock files before running headless commands.
- Ghidra must be 12.1.2 or newer to open the shipped `.rep` projects
  (layout version 3), with the matching `pyghidra` module (3.1.0) installed.
- `-process` on `analyzeHeadless` needs `-noanalysis` or it re-analyzes the
  whole program each run.
- Ghidra scripts run as native CPython 3 through PyGhidra (not Jython 2) —
  but `currentProgram`, `println()` and the flat API are the same.
- `ghidra_types.java` / `ghidra_enhance.java` wipe symbols in the ranges
  they redefine (`clearListing`). Run order: types → enhance →
  `ghidra_label.py` LAST, or the labels vanish.
- The label scripts' addresses are for the exe build shipped in the release
  (md5 `ed9f9f57…`, the bf42plus copy). The retail install copy has a
  different MD5 (`6f57155b…`) — don't mix them.
- `pyghidra` reuses the analyzed program in a project only when the binary's
  MD5 matches; otherwise it silently imports a fresh unanalyzed copy. Always
  point it at the exact binary setup downloaded (`.work/...`).
- 32-bit binaries: addresses are absolute (e.g. `0x0097D76C`), use the
  default address space, don't assume PIE.
