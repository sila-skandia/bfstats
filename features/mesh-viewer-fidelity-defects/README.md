# Mesh viewer fidelity defects — round of 2026-09-16

Four defects in the map viewer (`tools/bf1942-models/viewer/`), reported from
side-by-side captures of retail BF1942 and `map.html` taken minutes apart on
Wake, from the same reference points.

This folder holds the **agent prompts** for the round and the plan they feed.
Nothing here has been dispatched. Dispatch is a separate, deliberate act — see
[Dispatch](#dispatch).

The shape is the one that worked in the two previous rounds
(`features/bf1942-engine-reference/README.md`, "Research round, 2026-09-16"):
**researchers read the engine, a separate verifier re-derives every claim, only
confirmed claims reach the plan.** Verifiers found real errors in eleven of
thirteen reports last time, several load-bearing. They are not optional.

---

## The defects

| # | What the user sees | Where the fix probably lands |
|---|---|---|
| **D1** | **Trees have no collision.** A palm can be walked through, and a round fired into it neither stops nor registers a hit. In game trees stop both. | `bf42/treemesh.py`, `bf42/assemble.py`, re-extract, `viewer/collision.js` |
| **D2** | **The sniper's firing animation is wrong.** The round floats visibly off the muzzle, the muzzle flash is enormous and lingers, and the rifle dips awkwardly instead of cycling. The *reload* animation is right, and in game the per-shot cycle looks like the same motion. | `extract_viewmodel.py`, `viewer/soldier.js`, `viewer/gunfire.js`, `viewer/effects*.js`, `map.html` rig mount |
| **D3** | **The tank is broken.** It barely moves when driven, its first-person view is missing the periscope interior that encloses the retail view, and the HUD strip is misplaced, part-scaled and missing the soldier group and both ammo counts. | `viewer/ground.js`, `viewer/seats.js`, `viewer/hud.js`, `map.html` `drive()`/`feedVehicleHud`, `extract_models.py --cockpit` |
| **D4** | **The sniper has no scope HUD when zoomed.** Retail blacks out the frame and draws a scope circle with sight lines. The zoom factor itself looks right. | `map.html` (nothing writes `CrossHair/*`), `viewer/hud.js` |

D3 is two unrelated problems — a drivetrain one and a view/HUD one — and is
researched as two tracks (R3, R4).

---

## Evidence

Durable copies live **outside the repo** (they are large PNGs and MP4s):

    /home/dylan/bfstats-evidence/viewer-defects-2026-09-16/

| File | What it is |
|---|---|
| `game-sniper-hip.png` | retail, scout in the barracks doorway, rifle at the ready |
| `mesh-sniper-hip.png` | viewer, same doorway, same pose — rifle sits bottom-right, not centred |
| `game-sniper-zoom.png` | retail, scoped: black frame, round scope, sight lines |
| `mesh-sniper-zoom.png` | viewer, scoped: same zoom, **no overlay at all** |
| `game-tank-1p.png` | retail, Sherman driver: periscope frame, view slot, HUD with `30` / `400` |
| `mesh-tank-1p.png` | viewer, Sherman driver: open view, black wedge, HUD shifted and clipped |
| `game-tank-1p-hudstrip.png`, `mesh-tank-1p-hudstrip.png` | the bottom 20% of each, scaled to a common width |
| `_hud-scale-compare.png` | both HUD corners, **1:1 pixels**, 100 px grid, identical crop rect |
| `game-sniper-sheet.png`, `mesh-sniper-sheet.png`, `game-tank-sheet.png` | whole-clip contact sheets at 4 fps |
| `game-sniper-shot-15fps.png`, `mesh-sniper-shot-15fps.png` | the shot itself at 15 fps, 1.8 s window |
| `frames/` | every 4 fps frame, `<tag>-NNN.png` |

Source recordings (1280x720, 60 fps, with audio):

    /home/dylan/bf1942-sniper-reload.mp4       9.6 s   retail: aim, fire, bolt, reload
    /home/dylan/mesh-sniper-reload.mp4        10.4 s   viewer: the same sequence
    /home/dylan/bf1942-tank-drive-shoot.mp4    6.7 s   retail: enter Sherman, drive, MG, cannon

Sampling frames (the sheets above were made this way):

```bash
ffmpeg -y -ss 4.0 -i /home/dylan/bf1942-sniper-reload.mp4 -frames:v 1 -vf "fps=15,scale=380:-1,tile=5x6" /tmp/sheet.png
```

### Measurements already taken from the evidence

Stated as observations with their method, **not** as confirmed engine
behaviour. Confirm or refute them; do not build on them.

- Retail appears to stretch the HUD's 800x600 virtual space onto the whole
  screen with **independent x and y scale**. The vehicle health bar's layout
  rect is `(174, 525)`, 32x64 (VHUD-7). On a 2542x1440 retail capture its left
  edge measures ~545 px and its top ~1260 px; `174 x 2542/800 = 553` and
  `525 x 1440/600 = 1260`. A uniform fit with pillarboxing predicts x ≈ 729,
  which is not what the capture shows.
- In the same 1:1 crop the viewer's vehicle group sits ~30 px lower than
  retail's and runs off the bottom of the screen, its sprites read ~1.3x
  retail's, and the **soldier health bar and stance figure are absent
  entirely** while retail draws both inside the tank.
- Retail's muzzle flash on the scoped rifle occupies ~2–3% of frame width and
  is gone inside one 15 fps frame. The viewer's covers ~40% of frame width,
  sits to the left of the muzzle rather than at it, and survives two.

---

## What is already known (do not re-derive)

Each researcher's prompt repeats the part that concerns it; this is the index.

- **Corpus**: `features/bf1942-engine-reference/` — 779 symbols, `ledger.md`,
  `subsystems/*.md`, `xref.py`. Live and healthy as of this writing
  (`./xref.py check` returns the pinned sha256 `60c9452d…` MATCH).
- **D1**: `TM-1` settled — the word after a tree mesh's geometry is a collider
  class id, `CID_SimpleCollisionMesh` in 275 of 401 installed tree meshes, 0 in
  the other 126. `bf42/treemesh.py::_skip_collision` already walks the block's
  exact layout and throws it away; `bf42/assemble.py:627` returns no hull for
  any `treemesh` geometry, with a comment saying palms stay fly-through until
  that skip is promoted to a parser. `SM-6`/`SM-9` settle the same structure on
  the StandardMesh side.
- **D2**: `extract_viewmodel.py` bakes six clip families out of the state
  machine (`idle/walk/run/fire/reload/deploy`), `fire` looping while the
  trigger is held; clip span is `1/|speed|` with
  `{1p,3p}AnimationsTweaking.con` overriding rates. `CS-6`: weapon-fire shake
  is real (hardcoded 1.0) while the walking view bob is multiplied by a shipped
  zero. `VIEW-*` cover the hip↔zoom ease and deviation.
- **D3 drivetrain**: `TANK-1…6` plus `subsystems/tank-driving.md` are settled
  and already implemented in `viewer/ground.js` (`engineRatio`,
  `differentialRPM`). Whatever is wrong is very unlikely to be the gear curve.
- **D3 view/HUD**: `VHUD-1…8` settled, `VHUD-9` (what sets `ShowTurretIcon`,
  what `IconLookRotation` measures) and `VHUD-10` (whether a **driver's own**
  weapons feed the ammo panel) still open — VHUD-10 is exactly the missing
  `30` / `400`. `features/bf1942-3d-models/in-game-hud.md` closes with a note
  that fixing it means changing how `drive()` fires (a gated `FireState` per
  `vehicleGuns` entry), and records an earlier HUD **stage-size** bug of the
  same family as the misplacement seen here.
- **D4**: the scope is **already in the extracted layout**. `hud-layout.json`'s
  `crosshair` group carries a `variable-picture` bound to `CrossHair/ScopeIcon`
  with texture `sniper`, rect `[-8,-2,825,625]`, shown when
  `CrossHair/ShowCrossHair` and `CrossHair/ScopeIndex != 0` and not
  `Submarine/ShowPeriscope`, plus `fill` leaves gated on
  `CrossHair/SniperSight`. `maps/_shared/hud/sniper.png` is extracted and
  shipped. Nothing in the viewer writes a single `CrossHair/*` variable
  (`hud.js:505`), so `_visible` culls the entire group. `VHUD-5` settles the
  region's gating; `VIEW-10` and `GUN-6` settle the zoom fields.

---

## Roster

| Id | Role | Prompt | Depends on |
|---|---|---|---|
| `R1` | Engine research — tree collision | [prompts/R1-tree-collision.md](prompts/R1-tree-collision.md) | — |
| `R2` | Engine research — bolt-action fire animation, muzzle flash, visible round | [prompts/R2-sniper-fire-animation.md](prompts/R2-sniper-fire-animation.md) | — |
| `R3` | Engine research — tank drivetrain forces and real top speed | [prompts/R3-tank-driving.md](prompts/R3-tank-driving.md) | — |
| `R4` | Engine research — tank first-person view, HUD screen mapping, driver ammo | [prompts/R4-tank-first-person-and-hud.md](prompts/R4-tank-first-person-and-hud.md) | — |
| `R5` | Engine research — sniper scope overlay and zoom state | [prompts/R5-sniper-scope-overlay.md](prompts/R5-sniper-scope-overlay.md) | — |
| `X1` | Viewer-side reproduction and diagnosis of all four defects | [prompts/X1-viewer-reproduction.md](prompts/X1-viewer-reproduction.md) | — |
| `V*` | Adversarial verifier, one per report | [prompts/V-verifier-template.md](prompts/V-verifier-template.md) | its report |
| `P1` | Planner — writes `PLAN.md` from the verified reports | [prompts/P1-planner.md](prompts/P1-planner.md) | all verdicts |
| `I*` | Implementer, one per plan track | [prompts/I-implementer-template.md](prompts/I-implementer-template.md) | `PLAN.md` |

Six researchers (R1–R5 and X1) run concurrently; each verifier starts when its
own report lands, not after a barrier. P1 runs once, alone.

Suggested sizing, from what the last two rounds actually cost: researchers
Sonnet at max effort, verifiers Sonnet at max effort, X1 Sonnet (it is
mechanical but long), P1 Opus. Round 1 (24 agents) spent 9.7M subagent tokens;
budget this one at roughly half that.

---

## Dispatch

Neither form below has been run. Pick one deliberately.

**Agent tool, one researcher at a time** (they can be sent in a single message
to run concurrently):

```
Agent({
  subagent_type: 'general-purpose',
  model: 'sonnet',
  description: 'R1 tree collision',
  prompt: 'Read features/mesh-viewer-fidelity-defects/BRIEFING.md and then ' +
          'features/mesh-viewer-fidelity-defects/prompts/R1-tree-collision.md, ' +
          'and carry out R1. Return your report as your final message.'
})
```

**Workflow tool**, which is the only way to set model *and* effort per agent,
and which gives each report its verifier without a barrier. It needs explicit
opt-in from the user; do not reach for it otherwise. Skeleton:

```js
export const meta = {
  name: 'viewer-fidelity-research',
  description: 'Research four map-viewer defects against the BF1942 engine, verify every claim',
  phases: [{ title: 'Research' }, { title: 'Verify' }],
}
const TRACKS = ['R1-tree-collision', 'R2-sniper-fire-animation', 'R3-tank-driving',
                'R4-tank-first-person-and-hud', 'R5-sniper-scope-overlay',
                'X1-viewer-reproduction']
const base = 'features/mesh-viewer-fidelity-defects'
const reports = await pipeline(
  TRACKS,
  t => agent(`Read ${base}/BRIEFING.md then ${base}/prompts/${t}.md and carry it out. ` +
             `Return the report as your final message.`,
             { model: 'sonnet', effort: 'max', label: `research:${t}`, phase: 'Research' })
        .then(report => ({ t, report })),
  ({ t, report }) =>
    agent(`Read ${base}/BRIEFING.md then ${base}/prompts/V-verifier-template.md. ` +
          `The report to verify follows.\n\n${report}`,
          { model: 'sonnet', effort: 'max', label: `verify:${t}`, phase: 'Verify' })
      .then(verdicts => ({ t, report, verdicts })),
)
return { reports }
```

The second stage carries its track id through in the value it returns,
rather than assuming `pipeline` passes the original item along; check that
second stage's signature against the `workflow-authoring` skill before
running it.

**Before dispatching anything:**

1. `cd features/bf1942-engine-reference && ./xref.py check` — the Ghidra bridge
   must be up and the sha256 must MATCH, or every client-side claim is
   worthless.
2. Confirm the evidence directory above still exists; the prompts cite it by
   path.
3. Decide whether the agents work in the main checkout or in worktrees. In one
   shared checkout they must commit with `git commit --only <paths>` and never
   bare `git`, or they swallow each other's files.
4. Reports come back as the agent's **final text message** — subagents cannot
   use the Write tool. Under the Workflow tool, pull them out of
   `<transcriptDir>/journal.jsonl` (`{type:'result', agentId, result}` rows) and
   write one file per agent into `reports/` here rather than returning 6 x
   20–40 KB through the workflow's return value.
5. A quota cap kills the agents but not their worktrees. If it happens, read
   each worktree with `git -C <wt> status --short`, then relaunch the surviving
   tracks **without** worktree isolation, telling each agent its predecessor's
   absolute path.

---

## Status

Research + plan complete. **Implementation landed** (inherit/Auto), uncommitted.

| Track | Report | Verified | Impl |
|---|---|---|---|
| R1–R5, X1, P1 | written | done | — |
| T5 scope overlay | — | — | done (`map.html` CrossHair/*) |
| T2 sniper fire | — | — | done (ASM loop/`returnTo`, fire→reload, no dim tracer; **1P flash size 0.2 + shell-eject delay 2.0** baked into sniper `.fp.glb`s; `gunfire.js` honours delay) |
| T4a tank HUD ammo/soldier | — | — | done (`feedVehicleHud`, ShowSoldierIcon, `_scaleFor`) |
| T1 tree collision | — | — | done — **Wake re-extracted** (`viewer/maps/wake/scene.glb`, 306 palm collision nodes; bushes stay fly-through) |
| T4b tank cockpit graft | — | — | done (existing cockpit graft path; Sherman.cockpit.glb present) |
| T3 tank drivetrain | — | — | done (single `bodyThrust` + EngineGrip governor; unit tests green) |

### Follow-ups still open

- Other maps with TreeMesh (not Wake) still need `extract_map.py` if you want palm collision there.
- Non-sniper hand weapons still miss mesh-particle `size` / emitter `delay` until re-extracted (assembler fix is in; snipers done).
- 1P muzzle flash pixel acceptance (≤~5% frame / ≤67 ms) not re-measured headless this pass.
