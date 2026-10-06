# Desert Combat fix round: shared brief

A census of Desert Combat (DC) in the browser BF1942 found the gaps written up
in `~/.cache/dc-sweep/SCORECARD.md` once it is written (the domain reports it
is built from are `~/.cache/dc-sweep/reports/<domain>.md`: air, ground,
weapons, levels, soldier; your prompt names the one you build from). You own **one work package**, given in
your prompt. Deliver it end to end: code, tests, docs, commit on your branch.

## Setup (you are in your own git worktree)

1. Confirm where you are: `git rev-parse --show-toplevel` must be your worktree
   under `.claude/worktrees/`, never `<repo>`
   itself (that is the owner's checkout; another session has uncommitted work
   there). Run every git command from your worktree.
2. Link the extracted assets: `tools/bf1942-models/link_viewer_assets.sh`.
   Link node modules too:
   `ln -s <repo>/tools/bf1942-models/node_modules tools/bf1942-models/node_modules`
   (skip if it exists). Never extract through these links.
3. Temp files on disk: `export TMPDIR=~/.cache/dc-sweep/tmp` for node, python
   and Playwright. Scratch scripts go in `~/.cache/dc-sweep/<your-package-id>/`.

## How to build

- Load the knowledge map first: read `.claude/skills/bf1942-knowledge/SKILL.md`.
  Engine behaviour comes from `features/bf1942-engine-reference/ledger.md`
  (grep it; never read it whole) and its `subsystems/*.md`.
- **Where the ledger is silent, do not invent the mechanic.** Either read the
  binary (skill `.claude/skills/bf1942-ghidra/SKILL.md` and the engine-reference
  README's "How to use it"; the Linux server binary decompiles by name, see
  `~/.claude/projects/<project>/memory/project_lnxded_headless_decompile.md`)
  and record what you prove as ledger rows, or stop at what is proven and
  report the open question. A plausible guess that ships is the failure mode.
- DC's own data is the spec for DC's content: the `.con` files in
  `~/.wine/drive_c/EA Games/Battlefield 1942/Mods/DesertCombat/Archives/`
  (`bf42/rfa.py` `RfaArchive`, `.entries`), plus what the exporter puts in the
  glb extras. Keep vanilla, XPack1 and XPack2 behaviour unchanged unless the
  fix is engine-correct for them too; prove that with a before/after run.
- Match the surrounding code: its comment density, naming and idiom. No emojis.
- Keep each Write/Edit to a few hundred lines; a single huge generation trips
  a stream watchdog. Commit work in progress at each milestone.
- **Do not touch** `viewer/replay*.js` (another live session owns them) or any
  file outside your package's list without a reason you state in the report.
  If you must edit a shared hot file (`map.html`, `world-vehicle-tick.js`,
  `aircraft.js`, `test-hooks*.js`), keep the hunk small and self-contained;
  other agents are editing in parallel and the lead merges.

- **Ledger IDs collide between parallel agents.** Before writing a new
  ledger row, claim its ID in `~/.cache/dc-sweep/LEDGER_IDS.md` under the lock
  the file describes (next number after main's ledger AND every claim there).

## How to prove it

- Unit/node: `cd tools/bf1942-models && TMPDIR=~/.cache/dc-sweep/tmp python3 -m unittest discover -s tests -p 'test_<relevant>*.py'`
  for the suites you touch, then the whole suite once before your last commit
  (`python3 -m unittest discover -s tests`; report failures that are not
  yours as such — some need assets).
- Add a regression test for what you fixed (node harness + python test, the
  repo's pattern).
- In the page, only if a harness cannot show it: serve your worktree with
  `python3 -m http.server <PORT> --directory tools/bf1942-models/viewer` on the
  port in your prompt (never 5273, never stop anything on 5273), and drive it
  with Playwright (`require('<repo>/ui/node_modules/playwright')`,
  `chromium.launch({headless: true, args: ['--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist']})`).
  **One headless browser at a time across ALL agents**: run every browser
  script under the shared lock, `flock ~/.cache/dc-sweep/browser.lock node your-script.cjs`,
  keep it as short as the measurement allows, and close the browser when the
  script ends; the owner tests on this laptop. The same lock applies to the
  headless match runner (`sim/run.mjs`) when you run more than a 60 s match:
  `flock ~/.cache/dc-sweep/sim.lock node sim/run.mjs ...`. Kill your
  http.server when done. Test hooks need `?shots`; `?mod=desertcombat` must be
  explicit (the choice is sticky in localStorage). The page's mission briefing
  owns input until READY (Enter) and the spawn screen until Esc.

## Assets

If your fix changes exporter output (`bf42/*.py`, `extract_*.py`), do not
rewrite the shared trees under `viewer/models` or `viewer/maps` (they are the
owner's live trees, linked into your worktree). Prove it by extracting a few
affected files into your scratch dir, and report exactly which command(s) the
lead must run for which trees (`features/level-bake-layers/README.md` maps a
change to its layer and command). The lead runs re-bakes and publishes one at a
time after merging.

## Docs

- Engine findings: ledger rows (next free ID of the prefix, status, address).
- What you built: the relevant feature folder's README (cite ledger IDs; say
  how you checked it and what is open). A new folder needs its line in
  `features/README.md` (a unit test enforces it).
- Update the package's rows in `features/desert-combat-parity/README.md`
  **only in your report**, not in the file (the lead owns that file).

## Commit

- `git commit --only <your paths>`; never `git add -A`, `git add .` or
  `commit -a`. Re-check `git rev-parse --show-toplevel` immediately before.
- Conventional message in the repo's style (`fix(flight): ...`,
  `feat(viewer): ...`), body says what and why. **No Co-Authored-By line.**
- Do not push, do not merge, do not touch `main`.

## Report (your final message)

- What was wrong (root cause, with evidence) and what you changed.
- Commits (`git log --oneline main..HEAD`), files touched.
- Tests run and their results, before/after numbers where you measured.
- Asset commands the lead must run, if any.
- What is still open, and anything you found that belongs to another package.
