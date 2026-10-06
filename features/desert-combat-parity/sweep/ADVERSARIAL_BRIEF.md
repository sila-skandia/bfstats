# Desert Combat adversarial gap hunt: shared brief

A census sized Desert Combat (DC) in the browser BF1942 at about 78% and
listed known gaps: `~/.cache/dc-sweep/SCORECARD.md` and the five domain
reports in `~/.cache/dc-sweep/reports/`. Fix agents are working those gaps
now. **Your job is to find what the census missed**, and to prove wrong any
census "Works" verdict that is actually broken. The owner does not want to
discover basic gameplay faults by playing: everything a player would hit in
the first minutes must be found here.

Read the census brief for the data locations, the rules for finding what the
repo knows, and the scoring: `~/.cache/dc-sweep/CENSUS_BRIEF.md`. All of its
rules apply (read-only, no browsers, no sub-agents, scratch in
`~/.cache/dc-sweep/<your-id>/`, `TMPDIR=~/.cache/dc-sweep/tmp`, `git grep`
not `grep -r`, zsh globs quoted). In addition:

- **Be adversarial.** Assume each subsystem is wrong for DC until you have
  evidence it is right. A code path that "handles it" is not evidence; a
  measurement or a value traced from the `.con` through the glb extras to the
  line that uses it is.
- **Do not re-report known gaps.** Check the reports first; if you find a
  known gap is worse or different than reported, say so in one line.
- **Prefer systematic sweeps to samples**: every template, every command,
  every file, then the outliers.
- Where retail's behaviour is not settled by the ledger, say "needs an engine
  read" and name what to read; do not decide what retail does.

## Report (final message, plain markdown, under ~20 KB)

1. **Findings table**: `Id | Finding | Evidence | Player impact (High/Med/Low) | Confidence`.
2. **Census verdicts overturned**, if any.
3. **Work packages** in the census format (title, items, size, problem and
   evidence, engine source, files, proof, assets), most valuable first.
4. **What you could not settle** without real play or an engine read.
