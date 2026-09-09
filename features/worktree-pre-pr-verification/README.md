# Verifying a worktree before it becomes a PR

Two changes that share one idea: **the verification a developer runs locally and
the verification CI runs should be the same code, in the same order, on the same
data.**

1. `scripts/bootstrap-worktree.sh` — one idempotent command that takes a bare
   `git worktree add` checkout to "can run `./scripts/verify.sh`", including
   pulling the seed database from the `e2e-fixture` release and generating a JWT
   signing key. CI now runs this same script instead of its own inline copy.
2. `.github/workflows/claude-cursor-review.yml` — reordered. Claude reviews
   first (with build and unit tests), and the Playwright E2E suite only runs for
   PRs that survive the review.

---

## Part 1 — bootstrapping a worktree

### The problem

`features/isolated-e2e-worktrees/` made concurrent worktrees safe to *run*:
ports, Redis namespacing and the SQLite copy are all per-slot. It did not make a
worktree runnable in the first place. A fresh `git worktree add` has the source
and nothing else, and `verify.sh` needs four things it does not create:

| Missing | Symptom |
| --- | --- |
| `ui/node_modules` | Playwright container starts, `npx playwright test` finds no install |
| `bf1942-redis` | `verify.sh` exits 1 at the infrastructure check |
| `~/.cache/bfstats-e2e/template.db` | silently falls back to the 7-player synthetic seed |
| a JWT signing key | API refuses to start — `Jwt:PrivateKey not configured` |
| `tournament-images/` | gitignored, so never present; the API's `ASSETS_STORAGE_PATH` points at it and every lookup is `Directory.Exists`-guarded, so map art and dossiers are silently absent |

The last one is the kind of difference that is only ever found the slow way: it
produces no error, just a worktree that renders differently from the checkout
next door. Bootstrap creates the four subdirectories (`tournaments`, `maps`,
`dossiers`, `hud`). Their *contents* are large binaries that live on the assets
volume rather than in git, so a spec that needs real map art still wants a copy
from another checkout or a run of the `bf1942-map-images` skill.

The last one was the interesting one. It *appeared* to work on this machine
because the key lives in `dotnet user-secrets`
(`~/.microsoft/usersecrets/fd03f769-…`), which is per-machine, invisible in the
repo, and set up by hand a long time ago. CI has no such thing, which is why the
workflow had grown its own `openssl genrsa` step. Two implementations of the same
prerequisite, one of them undocumented — and a brand-new machine would have
neither.

`ui/e2e/helpers/auth.ts` logs in through the real `/stats/auth/login` endpoint
and puts a genuine signed token in `localStorage`, so this is not stubabble; the
tournament and admin specs need a real key.

### What it does

```bash
./scripts/bootstrap-worktree.sh              # everything that is missing
./scripts/bootstrap-worktree.sh --refresh    # re-download the fixture, re-npm-ci
./scripts/bootstrap-worktree.sh --no-fixture # deliberately use the synthetic seed
mise run bootstrap                           # same thing
```

| Scope | What |
| --- | --- |
| per machine | `bf1942-redis` (via `docker-compose.dev.yml`), `~/.cache/bfstats-e2e/{template.db,neo4j.dump,template.meta}`, the Playwright image |
| per worktree | `ui/node_modules`, `.e2e/jwt-e2e.pem`, `.e2e/refresh-secret`, `tournament-images/{tournaments,maps,dossiers,hud}` |

Everything is skipped if already present, so re-running costs a couple of
seconds. Measured on a cold worktree with a warm machine cache: **~20 s**, almost
all of it `npm ci`. With a cold fixture cache, the release download adds ~23 s
for 60 MB compressed.

### The signing key

`scripts/e2e-secrets.sh` is the single implementation, sourced by both
`verify.sh` and the bootstrap script. It generates `.e2e/jwt-e2e.pem` and
`.e2e/refresh-secret` (both gitignored, both throwaway) and exports them.

`verify.sh` now passes them to the API explicitly:

```
Jwt__PrivateKey='<base64 PEM>'
RefreshToken__Secret='<random>'
```

Two details worth knowing:

- **Base64, not a path.** `TokenServiceConfigHelpers.ReadConfigStringOrFile`
  checks `Jwt:PrivateKey` *before* `Jwt:PrivateKeyPath`, so on a machine whose
  user-secrets hold an inline key, setting only the path would have been
  silently ignored — the run would have used the developer's real key and CI
  would have used a different one. Setting the inline value wins deterministically
  in both places, and `DecodePemIfBase64` exists precisely so a multi-line PEM
  can travel as one environment variable.
- **Environment beats user secrets.** `WebApplicationBuilder` adds the
  environment-variable provider after the user-secrets provider, so the
  throwaway key wins over whatever a developer has configured. That is the point:
  no E2E run should depend on hand-set local state.

### CI uses the same script

The E2E job's setup is now one step:

```yaml
- name: Bootstrap the checkout
  run: ./scripts/bootstrap-worktree.sh
```

This replaces the workflow's separate Redis `docker run`, `openssl genrsa`,
`npm ci` and `gh release download` steps. A setup bug that only exists in CI is
now structurally impossible, and the fallback behaviour (no fixture ⇒ synthetic
seed) is written once.

---

## Part 2 — review first, E2E second

### Why the order changed

The old workflow ran `./scripts/verify.sh` in full *before* invoking Claude. That
optimised for the wrong thing. These PRs come from a site-reliability agent
reacting to Seq threshold alerts, and the most common correct outcome is
**reject** — a narrow patch for an alert that fired once. Spending ~15 minutes of
Playwright on a change that is about to be closed buys nothing, and it delays the
verdict that actually decides whether the PR lives.

The new order:

```
review job  ─ dotnet build ─ dotnet test ─ Claude ─ verdict ──┐
                                                              │ open & not rejected
                                              e2e job ◄───────┘
                                              bootstrap ─ verify.sh ─ comment
```

Build and unit tests still run first, because they are cheap (~2 min), they are
deterministic, and a red build is something Claude should *see* — and can fix in
place — rather than something that stops it running.

### How the verdict is carried

Claude picks one of three outcomes and labels the PR:

| Label | Meaning | E2E |
| --- | --- | --- |
| `claude:approved` | sound as-is | runs |
| `claude:edited` | amended in place, pushed to the branch | runs |
| `claude:rejected` | not worth merging; PR closed | skipped |

The gate does not trust the label alone. **PR state is the authoritative
signal** — a rejected PR is a closed PR — and the label is the readable record on
top of it. Anything ambiguous (Claude errored, no label applied) falls through to
*running* E2E: the repo is public so runner minutes are free, and skipping
verification is the more expensive mistake.

The labels are created with `gh label create --force` in a workflow step before
the review, because `gh pr edit --add-label` fails on a label that does not exist
and that failure would otherwise surface as an opaque Claude tool error.

### What this removed

The old workflow had a "Post-review verification if Claude made edits" step that
compared `git rev-parse HEAD` against a recorded base SHA and re-ran the whole
suite. That is gone. The E2E job checks the branch out **by name**, so it
naturally covers whatever Claude pushed, and there is only one place where the
suite runs.

### Continuity

Unchanged, and still load-bearing:

- **No `synchronize` trigger.** Claude pushes to the PR branch; a `synchronize`
  trigger would re-invoke the workflow on its own commit and loop.
- **No PR-authored text in the prompt.** Only repo, PR number and branch are
  interpolated. Title and body are untrusted input the action fetches itself.
- **`workflow_dispatch` input validated as numeric** before it reaches a shell.
- **Subscription auth** via `CLAUDE_CODE_OAUTH_TOKEN`, not a metered API key.

The prompt gained a `BUILD` / `API UNIT TESTS` header carrying the two step
outcomes, permission to run `dotnet build` and `dotnet test` itself, and an
explicit instruction that the E2E suite has *not* run yet — the old prompt
asserted the opposite, which was true then and would have been a lie now.

### Cost

| | Rejected PR | Approved PR |
| --- | --- | --- |
| Before | build + unit + E2E + review (~25 min) | same (~25 min) |
| After | build + unit + review (~8 min) | build + unit + review, then bootstrap + full verify (~28 min) |

Approved PRs cost slightly more, because unit tests run twice — once as a fast
pre-review signal, once inside `verify.sh` on the possibly-edited branch. That is
deliberate: the second run is the one that covers Claude's own commits, and
re-using `verify.sh` unmodified is worth more than the two minutes.

---

## Verification

- `actionlint` (which includes shellcheck over `run:` blocks) passes clean on the
  workflow.
- `shellcheck -x` on the new scripts reports only two info-level notes: SC1091
  (a sourced path the container cannot resolve) and SC2012 (an `ls` used purely
  for display).
- The bootstrap script was exercised both ways in a genuinely cold worktree
  (no `ui/node_modules`, no `.e2e/`) — once with a warm machine cache (~20 s,
  almost all `npm ci`) and once against an empty `BFSTATS_E2E_CACHE`, which
  downloaded and decompressed the release assets in 23 s. Re-running it is a
  no-op that skips every step.

### The E2E suite, before and after the signing-key change

Five runs against the real-data fixture. **The suite is not green on `main`**, so
the baseline had to be established before any of this could be read:

| # | Where | Code | Result | Failures |
|---|---|---|---|---|
| 1 | worktree | + the change | 138 passed, 3 failed | `arcade:73`, `data-explorer:52`, `public-tournament:5` |
| 2 | worktree | + the change | 139 passed, 2 failed | `data-explorer:52`, `public-tournament:5` |
| 3 | worktree | `verify.sh` **at HEAD** (key from user-secrets) | 140 passed, 1 failed | `public-tournament:5` |
| 4 | worktree | + the change, those 3 spec files only | **20 passed** | none |
| 5 | **main checkout** | clean `8b53e0e`, idle machine | 140 passed, 1 failed | `data-explorer:52` |

Run 5 is the control: your own main checkout, nothing of this branch in it, run
on an otherwise idle machine. It fails too. So no failure below is attributable
to the signing-key change.

**`public-tournament.spec.ts:5`** is the auth-dependent one — it calls
`loginAsAdmin`, which mints a real RS256 token through `/stats/auth/login`, so it
is the spec that would break if the key wiring were wrong. It fails on the
unmodified `verify.sh` too (run 3) and its failure mode is a 30 s page timeout,
not a 401. `loginAsAdmin` throws a distinctive `Failed dev auth login: <status>`
on a rejected token; that string appears in no run. Run 4 is the positive proof
the generated key works: that spec creates a tournament through the admin API
with a token signed by `.e2e/jwt-e2e.pem`.

**`data-explorer.spec.ts:52`** is the one to be careful about, and the first read
of it here was wrong. It failed on clean `main` (run 5) while its siblings
passed, which looked like a specific broken route — the per-player redirect at
[ui/src/router/index.ts:121](../../ui/src/router/index.ts:121) never firing.

A sixth run on the merged tree, taken while the machine was at **load average
50–66**, failed the *entire* legacy-redirect family together: `/explore`,
`/explore/servers`, `/explore/servers/:guid`,
`/explore/servers/:guid/maps/:map` and `:52`. They all assert on a URL that only
changes once the SPA has booted and the router has resolved, so what they really
measure is whether Vue hydrates inside the assertion timeout. Under load it does
not.

So `:52` is best read as *the most timing-sensitive member of a timing-sensitive
family* rather than a dead route — it is the only one that also needs a
`:playerName` param resolved. Whether there is a genuine slow path underneath is
open; it is not established, and nothing here touches it.

**`arcade.spec.ts:73`** appeared in one run of five and passed in the other four,
including on main. Parallel-load flakiness at 10 workers.

### A caveat on all of these numbers

Every run above is on one developer machine that is also running the developer's
editor and browser. Run 6 is the illustration: the same suite that had just gone
140/1 fell apart at 8 failures and climbing once `electron` was taking 200%+ CPU.
A full run here is worth something only when the box is quiet, and a single red
spec on a busy machine should be re-run before it is believed. The CI job does
not have this problem — a fresh runner does nothing else.

API unit tests: **311 passed, 0 failed** in every run.

End-to-end workflow behaviour can only be confirmed once the workflow is on the
default branch — GitHub schedules `pull_request` workflows from the base branch —
so the first real exercise is the next `cursor/*` PR, or a manual
`workflow_dispatch` against an existing one.
