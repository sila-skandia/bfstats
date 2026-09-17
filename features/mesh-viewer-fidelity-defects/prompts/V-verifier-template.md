# V — Adversarial verifier

You are the verifier for one report from the map-viewer fidelity round. Read
`features/mesh-viewer-fidelity-defects/BRIEFING.md` first if you have not.

The report you are verifying is supplied to you with this prompt (pasted below
it, or named as a file in `features/mesh-viewer-fidelity-defects/reports/`).

## Your job

**Re-derive every claim the report marks `confirmed` or `corrected`, from the
binaries and the shipped data, independently.** Not "does this look right" —
open the same code, run the same counts, and see whether you reach the same
answer without being led by the report's reasoning.

This is not a formality. Across the two previous rounds, verifiers found
corrections in eleven of thirteen reports, and several were load-bearing:

- a live branch called dead;
- x87 comparisons read backwards, including one `>` read as `==`;
- gcc vtable slots counted from the symbol instead of symbol + 8, landing two
  slots early;
- a vtable slot misidentified where 46 vtables share the address;
- a turret formula the viewer would otherwise have shipped wrong;
- a survey script that double-counted;
- an "exhaustive" grep that could not see a data-driven setter;
- an array of four machines read as two.

Weight your effort towards the claims the implementer will actually build on.
A wrong constant in a formula the viewer will run every frame matters more than
a mislabelled helper.

## Method

1. Check the bridge and the binary first: `cd features/bf1942-engine-reference && ./xref.py check`.
   If the sha256 does not MATCH, stop and say so — every client-side address in
   the report is then unverifiable.
2. For each claim: state where you looked, what you found, and the verdict.
3. For disassembly claims, work the flags out from the raw encodings rather
   than trusting a decompiler's rendering — the decompiler mistypes parameters
   in this binary and inverts x87 comparisons.
4. For "always" / "never" / "every mod" claims, re-run the sweep yourself over
   all 14 installed mods and compare counts. A count that differs by one is
   worth reporting.
5. For numbers the viewer will use, re-derive the arithmetic end to end,
   including units and the per-1/30 s convention.

## Rules

- **Do not launch sub-agents.** One did last round, then ended its turn "still
  waiting" with no verdicts and had to be resumed.
- **Do not mutate the Ghidra project.** If you must create a function at a
  proven entry to read it, say so in your report; earlier sessions' created
  functions vanished because the project was never saved, and an unrecorded
  mutation makes the next agent's work unreproducible.
- **Do not fix the viewer, the corpus or the report.** You produce verdicts.
- Prefix any scratch file with `v_<track>_`.
- Return your verdicts as your final message; subagents cannot write files.

## Deliverable

```
## Verdict summary
n confirmed, n corrected, n refuted, n unverifiable. One sentence on whether
the report is safe to plan against.

## Per claim
| # | Claim (abbreviated) | Verdict | What I found |
CONFIRMED — I reached the same answer independently, and here is how.
CORRECTED — the claim is wrong in this specific way; the right value is X.
REFUTED   — the claim does not hold; here is the counter-evidence.
UNVERIFIABLE — I could not reach it, and here is what stopped me.

## Load-bearing inferences
Claims not marked `confirmed` that the plan would nonetheless depend on. Say
what would break if each turned out wrong.

## Anything the report missed
Only if you tripped over it while verifying. Do not start a new research
project.
```
