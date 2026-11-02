# verify.sh test selection

`./scripts/verify.sh` runs only what a change can reach. Before this, every run
started with all ~490 BF1942 tool test files (8,154 tests, 25 minutes on
2026-11-02) and then the API tests, even for a one-file viewer edit.

Asked 2026-11-02: "add some categories to these tests so if we change a subset
of the system we don't re-run everything, it's wasteful."

## What runs

The change is every file that differs from `origin/main`: commits since the
branch left it, plus the working tree, untracked files included
(`scripts/select_model_tests.py --changed`).

| Suite | Runs when |
|---|---|
| BF1942 tool tests | the test files the change reaches (below); none if it reaches none |
| API unit tests | anything under `api/`, `tests/api/`, or the solution's build files changed |
| Playwright E2E | anything under `ui/`, `api/`, `tests/e2e/` or `docker-compose.dev.yml` changed, or spec arguments were given |

Everything runs when `verify.sh` or the selector changed, under `--all` or
`VERIFY_ALL=1`, and in CI (`CI=true`, which GitHub Actions sets). CI therefore
still runs everything, so a selection that misses a test is caught before main.

In the shared main checkout, other sessions' uncommitted files are part of the
change, because the script verifies the tree as it stands. A sibling's edit to
`ui/` brings in the E2E run.

## How the tool tests are picked: references, not tags

Nothing is tagged by hand, because tags rot. `scripts/select_model_tests.py`
scans every code file in the repo (`.py .js .mjs .cjs .html .sh .ts .vue`) for
the files it uses:

- a string literal that is only a path: `'./replay-recording.js'`,
  `imp('replay-accuracy.js')`, `ROOT / "audit_mod.py"`, `"damage.json"`;
- a Python import: `import audit_mod`, `from bf42 import con`.

A name in a comment or a sentence is not a use. Counting those tied everything
together: `bf42/con.py`'s docs mention `map.html`, `map.html` imports
`replay.js`, so every replay edit selected every test.

From each changed file the selector walks to every file that names it, then to
every file that names those, and so on. The test files it reaches are the ones
to run. `--explain` prints the chain for each test, for example
`test_replay_accuracy.py <- replay_accuracy_harness.mjs <- replay-accuracy.js`.

### Tests that scan a folder

A test that reads `VIEWER.glob("*.js")`, `iterdir()` or `readdirSync()` names
no file, so no change would reach it. Such a test runs on every change unless
it states what it watches, in a comment:

```
# watches: tools/bf1942-models/viewer/*.js tools/bf1942-models/viewer/map.html
// watches: nothing
```

The patterns are fnmatch, from the repo root (`*` crosses folders). `nothing`
means the scans read temp, game-install or generated (gitignored) folders, so
the reference walk alone decides. A shared helper's scan, or its `watches:`, is
passed on to every test that uses it (`controls_menu_harness.mjs`).

On 2026-11-02, 45 files scanned a folder. Eleven watch real paths: viewer
JavaScript, the features catalogue, `extract_*.py`, the relay templates and a
fixtures folder. The rest are `nothing`. A new folder-scanning test without a
`watches:` line just runs every time, so forgetting one costs time, not
coverage.

## How much it saves

Each of the last 25 commits that touched `tools/bf1942-models`, replayed
through the selector: 48 to 209 test files of ~490 (10 to 40%). The accuracy
dashboard commit (`cc402123`) picks 50. An `api/`-only change picks none. A
change to a widely used module (`bf42/con.py`, `replay-recording.js`, `map.html`)
picks more, which is what it should do.

## Checked

A mutation test: in a throwaway worktree, `nameAt` in
`viewer/replay-recording.js` (used by every replay module) was changed to
prefix every name. All 351 test files that mention the replay or the viewer were
run before and after. Six files failed only with the change (`test_replay_accuracy`,
`_debrief`, `_dossier`, `_highlights`, `_models`, `_support`), and all six are
among the 78 the selector picks for `replay-recording.js`. Seventeen files
failed in the bare worktree either way: they need assets an untracked tree
holds (the kit and viewmodel glbs, the relay's tables), so the check says
nothing about them.

## Open

- Selection is per test file, not per test.
- A test that finds its code by a built name (`f"extract_{x}.py"`) and does not
  scan a folder is invisible to both rules. None was found; the CI full run
  is the backstop.
