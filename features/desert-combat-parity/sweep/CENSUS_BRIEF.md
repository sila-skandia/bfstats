# Desert Combat implementation census: shared brief

The owner has ported Desert Combat (DC) into the browser BF1942 (the mesh
viewer's playable map page, `tools/bf1942-models/viewer/map.html?mod=desertcombat&map=dc_<level>`).
Playing it, it "feels very unfinished". Two concrete reports from the owner:

- The US **Harrier** (AV-8, a VTOL jet): after take-off it responds almost
  opposite to the input; keying down (S) makes it rotate sideways like a
  chopper. It does not fly like a jet.
- The **Black Hawk** (UH-60) behaves much the same.

Those are examples, not the job. The job is a **census**: what fraction of
Desert Combat works, per domain, and the list of work packages that would close
the gap. Fix agents will be launched from your work packages afterwards, so
make each package something one agent can own end to end.

## Scope

- Primary: `desertcombat` (DC 0.7). Secondary: `dc_final` (DC Final 0.8); note
  it only where it differs or has content DC 0.7 lacks.
- Game install (source of truth for DC data):
  `~/.wine/drive_c/EA Games/Battlefield 1942/Mods/DesertCombat/Archives/`
  (and `.../Mods/DC_Final/Archives/` or similar; `ls` the Mods dir).
  Read `.rfa` archives with `tools/bf1942-models/bf42/rfa.py` (`RfaArchive`,
  use `.entries`, not `.names()`), `.con` with `bf42/con.py`.
- Extracted trees (what the viewer serves):
  `tools/bf1942-models/viewer/models/mods/desertcombat/` (glbs + `*.report.json`),
  `tools/bf1942-models/viewer/maps/mods/desertcombat/<level>/` (`scene.json`,
  `scene.glb`, ...) and `.../_shared/` (damage.json, collision meshes, effects).
  The manifests: `viewer/models/mods.json`, `viewer/maps/mods/desertcombat/maps.json`.
- Viewer code: `tools/bf1942-models/viewer/*.js` (+ `map.html`). Exporter:
  `tools/bf1942-models/bf42/*.py` and `tools/bf1942-models/extract_*.py`.
  Node harnesses: `tools/bf1942-models/tests/*_harness.mjs` driven by
  `tests/test_*.py` (`python3 -m unittest discover` from tools/bf1942-models;
  there is no pytest). `tests/flight_harness.mjs` can fly an aircraft built
  from a real glb in node.

## How to find what the repo already knows

Read `.claude/skills/bf1942-knowledge/SKILL.md` first; it maps each topic to
its ledger prefix, subsystem note and feature folders. Key rules from it:

- For engine behaviour, a ledger row (`features/bf1942-engine-reference/ledger.md`,
  660 KB — grep it, never read it whole) beats a subsystem note beats a
  feature doc beats a code comment.
- **For whether something is built, the code and git beat every doc.** Status
  lines go stale. Check `git log -- <path>` and grep the code before repeating
  a doc's claim. Feature docs grow by appending; read the top and the newest
  dated section.
- Use `git grep`, not `grep -r` (the latter walks ~27 worktrees).
- The shell is zsh: quote globs; an unmatched glob aborts the command.

## Method

1. **Enumerate what DC actually contains** in your domain, from the DC data
   (the `.con` files in the archives, and/or the extracted glbs' extras and
   `report.json`, and the levels' `scene.json`). Count things; name examples.
   Note what is DC-specific (absent or rare in vanilla) — those are the likely
   gaps.
2. **For each item, decide what the viewer does with it**, by reading the code
   path that handles it and, wherever a harness can show it, running it.
   Prefer measured evidence (a harness run, a parsed glb) to reading. Look for
   features the data carries that no code reads (grep the viewer for the con
   word or extras field).
3. **Classify** each item:
   - `Works` — behaves like retail as far as you can tell;
   - `Partial` — present, but a real part is missing or approximated;
   - `Broken` — present and wrong in a way a player notices;
   - `Missing` — DC uses it and the viewer has nothing.
   And give each a player weight: `High` (meets it every round), `Med`, `Low`.
4. **Score the domain**: Works 1.0, Partial 0.5, Broken 0.2, Missing 0;
   weights High 3, Med 2, Low 1. Domain % = sum(score*weight)/sum(weight).

## Rules

- **Read-only.** Do not edit, create or delete anything under the repo, the
  game install or the asset trees. Do not commit. Do not run extractors that
  write into `viewer/models` or `viewer/maps`.
- Scratch files go in `~/.cache/dc-sweep/<your-domain>/` (create it), named
  with your domain prefix. Set `TMPDIR=~/.cache/dc-sweep/tmp` for node/python
  runs.
- **No browsers.** Do not start Playwright, Chromium, a dev server or the
  preview tools; the owner is testing on this PC. Node harnesses and Python are
  fine. If something can only be judged in the page, say so and classify from
  the code.
- Do not launch sub-agents.
- Where the engine's behaviour is not in the ledger, say "needs an engine read"
  rather than inventing what retail does.
- Keep each command's output small (pipe through `head`, summarise in a
  script); you have a lot of ground to cover.

## Report (your final message, plain markdown, under ~25 KB)

1. **Summary**: domain %, three-line verdict.
2. **Inventory table**: `Item | DC usage (count, examples) | Status | Weight | Evidence (file:line, harness result, data) `.
3. **Root causes**: where several items fail for one reason, say so once.
4. **Work packages**, most valuable first. Each:
   - title (imperative), the items it closes, size S/M/L;
   - the problem and the evidence;
   - engine source: the ledger rows / subsystem notes to build from, or
     "needs an engine read: <what>";
   - files it will likely touch (so packages can be assigned without
     two agents editing the same file — flag any shared hot files);
   - how a fix agent proves it (harness, test, measurement);
   - whether it needs a re-extract / re-bake / asset publish (see
     `features/level-bake-layers/README.md`).
5. **Open questions** you could not settle.
