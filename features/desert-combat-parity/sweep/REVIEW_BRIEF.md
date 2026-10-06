# Desert Combat fix round: adversarial review brief

A fix agent has finished a work package on its own branch and worktree (given
in your prompt with its report). **Your job is to break it** before the lead
lands it in main. The owner will not test it by hand. If it ships broken, or
breaks vanilla, that is on this review.

Read `~/.cache/dc-sweep/FIX_BRIEF.md` for the rules the fix agent followed.
They bind you too: no browsers except under the shared lock, TMPDIR on disk,
scratch in `~/.cache/dc-sweep/review-<package>/`, port given in your prompt.
Do not launch sub-agents. Read the knowledge map,
`.claude/skills/bf1942-knowledge/SKILL.md`, before judging engine claims.

## What to check

1. **Does it do what the report says?** Re-run the agent's own proof from a
   clean shell. Then write at least one test of your own that the agent did
   not write, aimed at the change's weakest point.
2. **Is the engine claim right?** For every ledger row added or cited, check
   it against the ledger and the binary (`xref.py sym`; skill `bf1942-ghidra`;
   lnxded decompiles by name). Researchers in this repo have been wrong in 8
   of 9 reports before, often on load-bearing details: inverted x87
   comparisons, vtable slots read 8 bytes early, a live branch called dead.
   Where the agent says "needs an engine read" and then implemented something
   anyway, flag it.
3. **Did it invent?** Any constant, threshold, fallback or law not traced to
   data or a ledger row. Any tuning that makes a number look right.
4. **Regressions.** Vanilla, XPack1 and XPack2 behaviour must be unchanged
   unless the change is engine-correct for them, and proven so. Run the full
   Python suite in the worktree:
   `cd tools/bf1942-models && TMPDIR=~/.cache/dc-sweep/tmp python3 -m unittest discover -s tests`.
   Compare its failures with main's: run the same suite in a clean detached
   worktree of `main` if needed. Also run the harnesses for neighbouring
   subsystems.
5. **Other mods.** DC Final, and any other mod whose data takes the changed
   path (FH, FHSW, EoD, ...): a change made for DC must not crash or
   misbehave there.
6. **Seams.** Remote players and netcode (`world-*.js`, `netcode*.js`), bots,
   the replay viewer (read only: another session owns `replay*.js`), the
   headless runner `sim/`, and the touch controls. Does the change reach all
   of them, or only the local player?
7. **Docs.** Feature README and ledger rows updated, with no stale status
   lines left behind.

You may fix small, certain defects yourself, on the same branch, in the same
worktree. Use `git commit --only <paths>`, no Co-Authored-By line, and
re-check `git rev-parse --show-toplevel` first. Report anything larger.

## Report (your final message)

- **Verdict:** LAND, LAND WITH FIXES (list your commits), or DO NOT LAND
  (what is broken, with the evidence).
- **Findings:** `Finding | Evidence | Severity | Fixed here?`.
- **New gaps** you found that belong to other packages or need new ones.
