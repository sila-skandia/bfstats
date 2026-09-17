# I — Implement one track of the plan

You are an implementer on the map-viewer fidelity round. Read
`features/mesh-viewer-fidelity-defects/BRIEFING.md`, then
`features/mesh-viewer-fidelity-defects/PLAN.md`, and carry out **track
`<TRACK>` only**.

Fill in before dispatch: `<TRACK>`, and — if you are working in a worktree or
alongside siblings — the absolute path of your checkout, which every git
command must name as `git -C <path>`.

## What you are building

The track's section of `PLAN.md` is the specification. It carries the numbers,
their confidence and their source. Where it marks something an assumption, keep
the assumption visible in the code as a comment naming the open ledger id —
this codebase's convention is that a rule no report confirmed is called out by
its open claim id, never stated as the engine's own behaviour.

## Rules that are not negotiable here

- **Do not widen the track.** The plan names what this track must not touch,
  and other agents may be inside those files right now.
- **Run the acceptance checks in the plan**, and paste their actual output into
  your report. A track is done when its measurement produces its number, not
  when the code looks finished.
- **Extraction changes need a re-run.** If your track touches
  `tools/bf1942-models/*.py`, re-extract whatever the plan says and verify
  against the re-extracted output, not against the old assets.
- **Tests.** Extend the harnesses the plan names. A parser change is tested
  over real installed data across mods, not one synthetic fixture.
- **Commit as you go**, one self-contained piece at a time, with
  `git -C <path> commit --only <the files you changed>`. Never a bare `git`,
  never `-a`: in a shared checkout that swallows a sibling's uncommitted work.
  If a quota cap lands mid-run, committed work survives and uncommitted work
  costs the next agent an hour of archaeology.
- **No emojis**, anywhere — the codebase uses CSS, SVG and PrimeIcons.
- Use current C# and modern JS idiom matching the surrounding file; match the
  comment density of the module you are editing. These modules carry long
  explanatory headers for a reason — if you add a rule the engine dictates,
  say where it came from.
- Long renders and extractions run in the **foreground** (Bash timeout up to
  600000 ms). A background-task notification never wakes a subagent.

## Verification

Use the headless recipe in the briefing's section 5 and whatever X1's report
established as the reproduction for your defect. Verify on the tree the plan
tells you to verify on: if several tracks are landing at once, an individually
clean branch means little — the last round's five perf agents were each clean
and only the merged tree showed the interaction.

Where the defect is visual, prove it with a canvas capture and a measurement
(pixel fractions, rects, positions), not with "it looks correct now".

## Report

- What changed, file by file, and why.
- The acceptance checks, with their real output.
- What you did **not** do, and why — including anything in the plan you found
  to be wrong. "The bug did not reproduce" is a valid and valuable outcome; say
  so plainly rather than shipping a plausible fix for something that was not
  broken.
- Any documentation or ledger row your change makes stale.
