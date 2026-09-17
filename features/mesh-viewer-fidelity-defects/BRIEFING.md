# Shared briefing — map viewer fidelity round, 2026-09-16

Read this first, then your own prompt in `prompts/`. Everything here applies to
every agent in the round.

---

## 1. What this round is

The map viewer (`tools/bf1942-models/viewer/map.html` and its modules) puts a
player on foot and in vehicles inside an extracted BF1942 level. Four things it
does are visibly not what retail does, evidenced by captures taken minutes
apart from the same reference points. Your job is to find out **what the engine
actually does**, precisely enough that someone can implement it without
guessing, and to say honestly which parts you could not establish.

The standard for this codebase: **a number read out of the binary or the
shipped data beats a number fitted to a screenshot.** A plausible answer with
no evidence is worse than "open", because the next agent will trust it.

`features/mesh-viewer-fidelity-defects/README.md` has the defect list and the
evidence index. Read it.

---

## 2. The corpus: what the engine has already been read to say

`features/bf1942-engine-reference/` is a durable cross-reference between the
retail client binary and this codebase. 804 symbols, 25 subsystems.

```bash
cd features/bf1942-engine-reference
./xref.py check                  # bridge alive? right binary? run this FIRST
./xref.py sym 0x005d0140         # what do we know about this address?
./xref.py sym StandardMesh       # ...or this name
./xref.py list geom              # everything in a subsystem
./xref.py decompile 0x005d0140
./xref.py xrefs 0x00908a90
./xref.py strings 'StandardMesh'
```

- `ledger.md` — every assumption this codebase makes and its verification
  status. **Read the rows your prompt names before you start.**
- `subsystems/*.md` — narratives: `physics`, `tank-driving`, `ingame-hud`,
  `manned-guns`, `seats-and-entry-points`, `hitpoints-and-damage`,
  `handweapon-view-and-deviation`, `projectiles-and-impacts`, `supply-depots`,
  `standardmesh-vertex-format`.
- `symbols.json` — the address index. `include/` — format headers.
  `surveys/` — scripts that measure real game data to test an assumption.

**Two binaries, and they are not interchangeable:**

| | |
|---|---|
| Retail client | `~/.wine/drive_c/EA Games/Battlefield 1942/BF1942.exe`, sha256 `60c9452d1ddb…`, base `0x00400000`, stripped. Reached through Ghidra's HTTP bridge via `xref.py`. **The only source for anything about drawing, HUD, camera or input.** |
| Linux dedicated server | `/home/dylan/projects/public/bf42plus/bf1942_lnxded.static` — same engine, 54,895 symbols intact, no renderer at all. Use it to *name* things and to read parsing, physics and simulation. `objdump`/`nm` work on it directly. |

**Traps that have each cost a real round trip:**

- gcc vtables begin 8 bytes before the vptr: in lnxded, `call [reg+N]` is
  `vtable for X` + 8 + N. Counting from the symbol lands two slots early.
- Direct3D 8 keeps `CreateImageSurface` at slot 27, which D3D9 dropped. Device
  offsets: `SetTransform` +0x94, `SetRenderState` +0xc8, `SetTexture` +0xf4,
  `SetTextureStageState` +0xfc, `DrawPrimitive` +0x118, `DrawIndexedPrimitive`
  +0x11c, `DrawPrimitiveUP` +0x120, `SetVertexShader` +0x130. The client keeps
  the device at `ds:0x9c0184`.
- x87 comparisons invert easily. Work every `fnstsw` / `test ah,…` out from the
  flag encodings; several first readings in earlier rounds had a comparison
  backwards.
- The client's `.data` holds raw bytes only up to `0x00960000`; the loader
  zero-fills the rest. A "constant" read from past that is a zero at start-up
  (this is how `cameraShakeFactor` turned out to be 0.0f).
- Functions created through the Ghidra bridge in earlier sessions can be gone
  (the project was not saved). Check `/get_function_by_address` before
  decompiling; recreate at a proven entry if you must.
- The simulation is a fixed 30 Hz step (`g_simulationFps` `0x00957640`). Every
  per-call quantity in weapon and physics code is per-1/30 s. `handleVisualUpdate`
  runs once per **rendered** frame instead; so does the HUD's variable refresh
  (HUD-3).

**Do not write to the corpus.** Not `ledger.md`, not `symbols.json`, not
`subsystems/`. Propose rows in your report — id, finding, status, evidence —
and the lead merges them after a verifier has been over them. Merging rows is
how two agents stop overwriting each other.

---

## 3. The shipped data

14 mods are installed under
`~/.wine/drive_c/EA Games/Battlefield 1942/Mods/` (`bf1942`, `XPack1`,
`XPack2`, `DesertCombat`, `DC_Final`, `FH`, `FHSW`, `EoD`, `bf1918`,
`interstate`, `GCMOD`, `bg42`, `FinnWars`, `Pirates`, …). Nothing is unpacked
on disk; read `.rfa` archives directly:

```python
import sys; sys.path.insert(0, "tools/bf1942-models")
from pathlib import Path
from bf42.rfa import ArchivePool

MODS = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"
pool = ArchivePool()
for rfa in sorted((MODS / "bf1942" / "Archives").glob("*.rfa")):
    try: pool.add(rfa, rfa.name)
    except Exception: pass
names = [n for n in pool.names() if n.lower().endswith(".con")]
text = pool.read("objects/vehicles/land/sherman/physics.con").decode("latin-1", "replace")
```

The pool is one case-insensitive namespace, first-mounted-wins, matching the
engine's own precedence (RFA-1). `features/bf1942-engine-reference/surveys/stride_vs_flags.py`
is a worked example that sweeps all 14 mods; copy its shape.

**Mods are the test, vanilla is not.** Most of this pipeline's wrong
assumptions are accidentally true of vanilla. If you claim "always", sweep all
14 and say how many files you looked at.

Parsers you can reuse rather than rewrite, all under `tools/bf1942-models/bf42/`:
`rfa.py` (archives), `con.py` (the `.con` object/template language),
`stdmesh.py` (`.sm`), `treemesh.py` (`.tm`), `baf.py` (animation), `ske.py`
(skeletons), `animstates.py` (animation state machines), `meme.py` (menu and
HUD node graphs), `font.py`, `gltf.py`.

---

## 4. The viewer you are explaining

```
tools/bf1942-models/viewer/
  map.html        the page and the game loop; on-foot state, drive(), HUD feed
  ground.js       GroundVehicle and TrackedVehicle (tanks, half-tracks)
  flight.js       aircraft, and the cockpit-interior graft
  seats.js        seats, manned guns, per-seat HUD block
  soldier.js      the on-foot body, stance, movement
  gait-select.js  which locomotion clip plays
  gunfire.js      firing, rounds in flight, hits
  deviation.js    aim deviation
  collision.js    heightfield, water and static hulls; cast() and sweepSphere()
  hud.js          the in-game HUD painter, fed from one `vars` table
  effects.js / effects-core.js   particle and sprite effects
  armor.js supply.js physics.js replay.js audio.js engine-audio.js
  maps/_shared/hud/hud-layout.json   menu/InGame flattened into 11 named groups
  maps/_shared/hud/hud.json          the packed sprite atlas that goes with it
```

Extractors that feed it live one level up: `extract_map.py`,
`extract_models.py`, `extract_viewmodel.py`, `extract_hud_layout.py`,
`extract_hud_pack.py`, `extract_kits.py`, `extract_effects.py`.

Feature documentation for the viewer's own subsystems is in
`features/bf1942-3d-models/`: `in-game-hud.md`, `first-person-soldier.md`,
`ground-vehicles.md`, `seats-and-manned-guns.md`, `projectile-collision.md`,
`firing-effects.md`, `weapon-grip.md`, `parity-gaps.md`, `map-parity.md`.

---

## 5. Running the viewer headlessly

A dev server is usually already up on `:5273` (`.claude/launch.json` entry
`model-viewer`, serving `tools/bf1942-models/viewer`). Reuse it —
`preview_start {url}` — rather than starting a second one; there is a
five-per-folder cap. From inside a worktree the launch entry is invisible, so
serve the worktree yourself:

```bash
python3 -m http.server 5373 --directory <worktree>/tools/bf1942-models/viewer
```

The page's headless contract:

- `?shots` enables `preserveDrawingBuffer` and exposes
  `window.__renderOnce(w, h)`, which forces one deterministic sized frame.
- `?cam=x,y,z,yaw,pitch` pins the camera (yaw 0 = +z, π = −z, glTF coords).
  `?mod=bf1942&map=wake` selects content.
- **The rAF loop does not tick while the pane is hidden**, so real-time waits
  leave the simulation frozen. Step frames instead: each `__renderOnce` call
  runs `frame(1/60)`, advancing guns, effects and the soldier.
- A working on-foot recipe: `__setOnFoot(true)`, step 30,
  `__deploy.select('The_Airfield'); __deploy.spawn()`, step 30 plus a real
  1.5 s wait for the rig glb, step ~150 for the deploy clip, `__teleport(x,y,z,yaw)`,
  then `__setTrigger(true)`, step N, `__setTrigger(false)`. Read back
  `__getFire().hits`, `__handWeapon().shots`, `__effects()`.
- Under SwiftShader a tight `__renderOnce` loop with the first-person viewmodel
  near the camera crashes the browser after 30–45 calls. Batch in 20s with
  retries.
- Measure `canvas.toDataURL` output, never a page screenshot: the page
  screenshot includes the site nav (75 px at 1280x720) and a CSS-stretched
  canvas. Prefer `toDataURL('image/jpeg', 0.85)` crops of ~800x450; a returned
  data URL too big for a tool result gets saved to a file the harness names.
- For audio, launch with the **default** autoplay policy and issue a real
  click; `--autoplay-policy=no-user-gesture-required` hides context-suspension
  bugs.

Test harnesses that run the modules under node with no GL:
`tools/bf1942-models/tests/*_harness.mjs` (`collision`, `ground`, `physics`,
`flight`, `soldier`, `deviation`, `effects`, `armor`, `supply`,
`gait_select`) and the Python tests beside them. `pytest` is not installed —
use `uv run --with pytest pytest …` or `python3 -m unittest discover`.

---

## 6. How to report

You are a subagent. **The Write tool refuses you** ("Subagents should return
findings as text"). So:

- Put scratch scripts and data under the session scratchpad with a filename
  prefix that is your own agent id (`r1_`, `r4_`, …). Parallel agents share the
  scratchpad and a sibling will overwrite a generic `fn.py`.
- Return the report as your **final message**. Include any script you wrote in
  full inside it — the lead saves it.
- Long extractions and renders run in the **foreground** (the Bash tool allows
  a 600000 ms timeout) or are polled by you. A background-task notification
  never wakes a subagent: an agent that ends its turn "waiting for the
  notification" simply stalls.
- **Do not launch sub-agents.** One did last round, then ended with "still
  waiting" and no findings.

Report shape:

```
## Summary
Three sentences: what the engine does, and what the viewer must therefore change.

## Findings
| # | Finding | Status | Evidence |
confirmed / corrected / inferred / open, one row each.
"confirmed" means: an address you read, a file you parsed, a count you ran.

## What the viewer must change
File by file, with the numbers. No code unless the prompt asks for it.

## Open
What you could not establish, what you would do next, and — important — any
claim above that is load-bearing for the viewer but rests on inference.

## Proposed ledger rows
id | finding | status | evidence — for the lead to merge. Do not edit the corpus.
```

Confidence words mean what `ledger.md` says they mean: `verified` (read out of
the binary, evidence cited), `working` (shipping third-party code depends on
it), `inferred` (deduced from strings, xrefs or shape; the code was not read),
`open` (hypothesis — do not build on it). "The viewer renders correctly" is not
evidence.

---

## 7. House rules

- The Bash tool runs **zsh**. An unmatched glob aborts the whole command line
  under zsh's default `nomatch`, silently killing every `;`-chained step after
  it. Put anything with globs or bash-only syntax (`shopt`, `[[ ]]`) in a
  script file with a bash shebang and run it with `bash script.sh`.
- Never use emojis, anywhere, including in report prose and any UI copy you
  propose. This codebase uses CSS, SVG and PrimeIcons instead.
- Player and server names are stored as raw mojibake and decoded for display
  only (`$pn()` in Vue, `decodePlayerName` in TS, `PlayerNameDecoder` in C#).
  Irrelevant to this round unless you touch a name.
- If you are working in a shared checkout, commit with
  `git commit --only <paths>` naming your own files, and run every git command
  as `git -C <your path>`. A bare `git commit -a` swallows a sibling's
  uncommitted work.
- Confirm before any `kubectl` command. None of this round should need one.
