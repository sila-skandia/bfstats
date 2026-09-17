# P1 — Write the implementation plan

You are the planning agent on the map-viewer fidelity round. Read
`features/mesh-viewer-fidelity-defects/BRIEFING.md` and
`features/mesh-viewer-fidelity-defects/README.md` first.

Your inputs are in `features/mesh-viewer-fidelity-defects/reports/`: five
engine-research reports (R1–R5), the viewer diagnosis (X1), and one verifier
verdict per report. Your output is
`features/mesh-viewer-fidelity-defects/PLAN.md`, written so that an implementer
who has never seen this conversation can carry out one track from end to end.

## What the plan must contain

**One section per track.** Expect roughly: trees, sniper firing, tank
drivetrain, tank view and HUD, scope overlay — but let the reports decide. If
two defects share a root cause, say so and make it one track; if one defect
splits, split it.

Each track:

1. **The behaviour to reproduce**, in engine terms, with the numbers, each
   number carrying its confidence and its source (`TANK-3`, an address, a
   file). **Only claims a verifier confirmed may appear as fact.** A corrected
   claim appears in its corrected form. An open one appears as an explicit
   assumption with what happens if it is wrong.
2. **The files to change**, in order, with what changes in each. Name
   functions. Do not write the implementation, but do not be vague either: "in
   `bf42/treemesh.py`, promote `_skip_collision` to a parser returning
   vertices, faces and their material words" is the right altitude.
3. **Whether extraction has to re-run**, and the exact command. Several of
   these fixes are in the Python pipeline, and a viewer change alone will not
   show them.
4. **Acceptance checks** — the measurement that decides the track is done, in
   the headless recipe X1 already used, with the number it must produce and the
   tolerance. "Looks right in the browser" is not an acceptance check. Where a
   retail capture is the ground truth, name the file and the measurement.
5. **The tests to add or extend**, from `tools/bf1942-models/tests/`
   (`collision_harness.mjs`, `ground_harness.mjs`, `soldier_harness.mjs`,
   `effects_harness.mjs`, the Python parser tests). Every parser change needs a
   test over real installed data, not a synthetic fixture alone.
6. **What this track must not touch**, so parallel implementers do not collide.

**Then, across tracks:**

- **The seams.** In the last round three tracks each wrote HUD variables into
  their own object and the painter saw only one of them until they were pointed
  at the same table. Name every shared surface this round touches — `hud.vars`,
  the collision grid, the effects registry, `drive()`, the `fire` clip
  selection — and give each exactly one owner.
- **An integration pass**, budgeted explicitly: after the tracks land, someone
  walks the whole user-visible path (spawn, walk into a tree, shoot it, scope
  in, fire, enter the tank, drive, fire both weapons) and reports. Say who.
- **Order and parallelism.** What can run at once, what must wait.
- **Proposed corpus rows**: the ledger ids, findings, statuses and evidence the
  round produced, ready for the lead to merge into
  `features/bf1942-engine-reference/ledger.md` and `symbols.json`. Do not edit
  those files yourself. Include the closures for `VHUD-9` / `VHUD-10` if the
  reports earned them, and any correction to an existing row.
- **Documentation to update**: which files under `features/bf1942-3d-models/`
  each track must bring in line (`in-game-hud.md`, `first-person-soldier.md`,
  `ground-vehicles.md`, `projectile-collision.md`, `parity-gaps.md`), including
  the stale claim X1 was asked to check (`TrackedVehicle` "not wired into
  `map.html`").

## Judgement you are expected to exercise

- **Rank by user-visible value per unit of risk.** The scope overlay may be
  four variables; the tank drivetrain may be a force law. Say which is which,
  and do not let a cheap fix hide behind an expensive one in the ordering.
- **Say what you are not going to fix.** If a report leaves something open and
  the honest answer is "the viewer keeps the current approximation, documented",
  write that down as a decision with its reason, rather than leaving a track
  that cannot be finished.
- **Flag anything the user must decide.** The two-state first-person FOV is the
  obvious candidate: it is unresolved, it changes how the rig looks in every
  capture, and it is not a planner's call. Put such items in a short "needs a
  decision" section rather than assuming.

## House style for the document

Match the repo's existing feature docs (`features/bf1942-3d-models/*.md`):
prose that explains *why*, tables for the numbers, no emojis, file paths as
links relative to the repo root, ledger ids cited inline. Write it for someone
picking it up cold in a month.

You may use the Write tool for `PLAN.md` if you have it; if you are running as
a subagent and it refuses, return the complete document as your final message
and say where it belongs.
