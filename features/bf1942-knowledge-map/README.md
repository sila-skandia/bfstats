# Finding what the repo knows about BF1942

2026-09-29. The question was whether a hundred feature folders of engine
research should move into one place, and whether a session can find the answer
to "how does BF1942 do X" at all.

## What was measured

Of the 182 folders in `features/`, about 105 are BF1942 work: 248 markdown
files, 6.2 MB, about 1.5M tokens. `bf1942-engine-reference` is 1.1 MB of that,
most of it the ledger.

Nothing a session loads at start pointed at the engine corpus. `CLAUDE.md`
linked three BF1942 folders and not the corpus. The only route in was section 9
of the `bf1942-mod-extraction` skill. 34 BF1942 folders had no link from any
other doc.

About half of the engine facts live outside the corpus. The corpus cites 3,401
distinct binary addresses, and 59 other folders cite 3,138 between them. At
least 45 verified ledger rows sat in build records' "Ledger rows to integrate"
sections and were never pasted into the ledger. The ships research's 14 SHIP
and SPAWN rows are one example.

Five fresh agents each answered one engine question cold: parachute landings,
the Instant Battle AI slider, the Stuka's bomb count, soldier animation clips,
and the netcode's update rate and range. Each was told to report every file it
opened and every contradiction it met. The same five prompts ran again once the
skill below existed. The "after" agents were not told about it.

| | Before | After |
|---|---|---|
| Correct answers | 5 of 5 | 5 of 5 |
| Agents that loaded the skill on their own | | 5 of 5, as their first step |
| Step at which the agent first opened the answer, median | 6 | 3 |
| Tokens per question, mean | 136k | 125k |
| Tool calls per question, mean | 27 | 27 |
| Runs that met a stale or contradictory doc | 5 of 5 | 5 of 5 |

The corpus was always good enough to grep, so the answers were right both
times. Before the skill, each agent started from `ls` and `grep -r`, and
`grep -r` returns every hit once per worktree under `.claude/worktrees/`. The
netcode agent took 12 steps before it opened the right file. With the skill, every agent
went to the ledger rows or subsystem note first. Total effort barely moved,
because the prompt asked for contradictions and there were still plenty to
find.

The contradictions are the real risk, for any reader who stops at the first
doc. The engine-reference README said bombs were "research only, nothing is
built" a week after they shipped. Its parachute row read as if a parachutist
takes full fall damage, when PARA-10 says the landing is free. One README still
said its work was "not committed to main" thirteen days after it merged. The
survey found about 60 such places across the BF1942 folders.

## What was decided

The folders stay where they are. Moving them would break about 970 references
to `features/<folder>` paths, 476 of them in comments in 352 code files, plus
133 relative links, across 27 worktrees and the sessions working in them. A new
location would not tell a session where to look either.

Three changes fix the way in instead:

- The `bf1942-knowledge` skill,
  [`.claude/skills/bf1942-knowledge/SKILL.md`](../../.claude/skills/bf1942-knowledge/SKILL.md).
  Its description is in every session's context, so a BF1942 question loads it.
  It says which copy wins when docs disagree, how to look a claim up without
  reading the 660 KB ledger, which ledger prefixes, notes and folders hold each
  topic, and where a new finding goes.
- [`features/README.md`](../README.md) lists every feature folder in one line.
  `tools/bf1942-models/tests/test_features_catalogue.py` fails when a folder is
  missing from it or a line names a folder that no longer exists.
- `CLAUDE.md` names the skill and the catalogue.

The stale and contradictory claims the agents and the survey found were fixed
where they stood, and the stranded ledger rows were integrated.

## Still open

- Engine facts restated in build records drift from the ledger. Fold them into
  the ledger and the subsystem notes when a subsystem is next worked on, and
  leave the build record citing the rows.
- `bf1942-in-the-browser/console.md` and `subsystems/console.md` cover the same
  console, and the folder copy has 65 addresses the corpus copy lacks.
- Three readings disagree on what writes `lastCollisionHeight`: HP-6d says
  `SimpleObject::handleCollision`, PARA-8 says nothing calls the setter and
  `Armor::update` keeps a running maximum, and `subsystems/hitpoints-and-damage.md`
  says `exit(bool)`. The viewer charges a fall from the last contact, which is
  right only if PARA-8 is wrong. Nobody has re-read it.
- Section 15 of `round-replay-capture` disputes ledger P-2's "no interpolation
  buffer" and the functions P-1 and P-2 cite.
- Whether Instant Battle bots run at botSkill 0.5 or 0.75 depends on whether
  `AISettings::reset` runs after the client's `setBotSkill`, and nobody has
  read that order.

## 2026-10-13: the extraction skills, swept

The question this time was narrower: a session asked to extract the next ten
FHSW maps bakes the scenes and forgets the rest. Three things made that the
default outcome, and each is now fixed where it stood rather than by moving
docs.

* **No skill named the pipeline.** `mod_pipeline.py` has been the recipe since
  2026-10-11, and no skill a session loads mentioned it; section 7 of
  `bf1942-mod-extraction` still gave the 2026-09 hand recipe (`extract_all`,
  `extract_pose --matrix`, `shoot.mjs`, `build_mods_manifest`), and the
  mesh-assets skill gave `extract_all.py` alone as "the vanilla catalogue".
  A fresh session following either produced exactly the half-built level.
  Now skill `bf1942-mod-pipeline` is the procedure, its description carries
  the phrasings the owner uses, and the three older skills route to it.
* **The pipeline itself skipped the forgotten steps.** A step recorded `done`
  was not re-run when levels were added, because no step's command names the
  levels. Fixed in `mod_pipeline.py` (`inputs`, `v_levels`, `--skip-existing`,
  `--no-gates`), recorded in `features/mod-extraction-pipeline/README.md`.
* **One skill lived outside the repo.** `bfstats-mesh-assets` was only in
  `~/.claude/skills/` on this PC, so a cloud session or another checkout never
  saw it. It is now `.claude/skills/bfstats-mesh-assets/` with the user copy
  a symlink, like `bf1942-mod-extraction` and `bf1942-map-images`.

On consolidating the feature folders: the 2026-09-29 decision stands (970
references to `features/<folder>` paths). What was missing was a way in, so
the knowledge skill gained `scripts/find.py`, which ranks the folders that
mention every word given and prints each one's catalogue line, status line and
newest dated section before the matching lines, and the matching ledger rows
after. The mod work stays in its per-mod trackers (fh-mod-extraction,
fh-fhsw-open-issues, desert-combat-parity, swrtr-asset-audit, mesh-mod-assets)
and the pipeline skill carries the one table that says which is which.
