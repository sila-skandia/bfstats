# Isolated E2E runs across git worktrees

## Problem

`./scripts/verify.sh` used to pin the API to `:9222`, the UI to `:5173`, and
SQLite to `api/playertracker.db` (18 GB on this machine). Concurrent worktrees
then collided in three ways:

1. **Ports.** The second `verify.sh` reused whoever was already listening, so
   it tested the *other* worktree's code. Vite would also silently hop to 5174
   when 5173 was taken.
2. **SQLite.** The production-sized DB cannot be copied onto each worktree —
   the root filesystem is ext4, so there is no reflink/CoW, and a full copy is
   18 GB. Existing worktrees already show 0-byte `playertracker.db` stubs
   created by Docker volume mounts. Tournament E2E tests also *write* (create /
   delete tournaments), so two runs on one file race on WAL.
3. **Redis.** `IDistributedCache` used a hard-coded `InstanceName = "api"`, so
   cache entries from one run poisoned the other.

Interactive `dotnet run` / `npm run dev` on 9222/5173 is unchanged. Isolated
E2E never binds those ports, so you can keep the real API up while tests run.

## What mise does and does not do

[mise](https://mise.en.dev/) (`mise exec`, `mise run`) injects environment
variables into a **child process**. That does **not** pollute the calling
shell — the same property bash already has with `FOO=bar ./script.sh`.

mise is useful here as a task runner (`mise run e2e`) and, if you later
activate it, as directory-scoped tool versions. It is **not** the isolation
mechanism. Putting E2E ports in mise's top-level `[env]` would be worse:
`mise activate` would rewrite your interactive shell's `API_PORT` every time
you `cd` into a worktree.

Isolation lives in `scripts/e2e-env.sh`, which `verify.sh` sources. mise is
an optional wrapper around that.

```bash
# with or without mise — same isolation
./scripts/verify.sh
mise run e2e                          # if mise is installed
mise run e2e -- e2e/landing.spec.ts --project=chromium
```

Install mise with `curl https://mise.run | sh` if you want the task names.

## Isolation model

Each `verify.sh` process takes a **slot** 0–15:

| Resource | Formula | Example (slot 3) |
| --- | --- | --- |
| API port | `9300 + slot` | 9303 |
| UI port | `5273 + slot` | 5276 |
| Redis DB | `slot` (0–15) | 3 |
| Redis `InstanceName` | `e2e-{slot}` | `e2e-3` |
| SQLite | `.e2e/run/playertracker.db` | per-worktree, gitignored |
| Logs | `/tmp/bfstats-e2e-{slot}-*.log` | |

The preferred slot is a stable hash of the worktree path so the same checkout
tends to get the same ports. A `flock` on `/tmp/bfstats-e2e-slot-{n}.lock`
plus a port-free check skips to the next slot on collision, so two worktrees
that hash together still run in parallel.

Shared and **safe** to share: Docker Redis / Neo4j / Seq from
`docker-compose.dev.yml`. Redis is namespaced by DB number + instance name.
Neo4j is read-mostly for these tests. Notifications SignalR (`:9223`) is
untouched.

## Slim SQLite fixture

E2E does not need 18 GB of sessions. On startup with `E2E_SEED=true` the API
applies migrations (as it always does) then upserts a handful of players the
suite depends on:

- `Admin` / `admin@bfstats.io` — tournament create requires an existing organizer,
  and the user row avoids a unique-email race when Playwright workers log in in
  parallel
- `Alpha Player`, `Bravo Player`, `testplayer`, `[TAG]Player`, `Xanadu`,
  `Charlie` — player search (`a`, `player`, special characters)

Background collectors are off (`DISABLE_BACKGROUND_PROCESSING=true`) so the
fixture stays still and two e2e APIs don't both scrape bflist into it.

The first run in a worktree (or after a model change) creates an empty file,
`EnsureCreated`s the current EF model, seeds it, and caches `.e2e/template.db`.
Later runs `sqlite3 .backup` that template into `.e2e/run/` so each suite starts
from a clean copy in well under a second. Tournament tests mutate the run copy;
the next verify throws it away.

`EnsureCreated` is used instead of `Migrate` because worktrees often carry
pending model changes that make `MigrateAsync` refuse to run, and this database
is discarded after the suite.

A richer extract from production (`VACUUM INTO` after deleting old sessions)
is a possible follow-up if a new spec needs historical aggregates. It is not
required for the current suite: landing/server-details talk to bflist, the
leaderboard and trend inspector mock their APIs, and tournament tests create
their own rows.

## Escape hatches

| Env | Effect |
| --- | --- |
| `E2E_REUSE=1` | Old behaviour: talk to whatever is on 9222/5173 (interactive servers). Do not use across worktrees. |
| `E2E_SLOT=N` | Force a slot instead of hashing. |
| `E2E_RESET_TEMPLATE=1` | Ignore the cached template and remigrate. |
