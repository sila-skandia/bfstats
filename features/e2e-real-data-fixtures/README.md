# Real-data E2E fixtures, isolated per worktree

**Status: built and validated end to end against a real 24 GB production backup**
(`bfstats-sqlite-latest.db`, data current to 2026-09-08 10:46, 1,413,668 rounds).

    scripts/make-e2e-fixture.sh bfstats-sqlite-latest.db --force   # 208 MB, 2 s
    scripts/make-e2e-graph.sh --force                              # 33 MB, 2 min

Full suite on the result: **138 passed, 3 failed** — the same three that fail on
the old synthetic seed, so the fixture is a clean drop-in. One caveat with
`E2E_NEO4J=1`, in "Known interaction" below.

Extends `features/isolated-e2e-worktrees/`, which already solved ports, Redis
namespacing and a **7-player synthetic** SQLite seed. This document covers what
it deliberately deferred:

> "A richer extract from production (`VACUUM INTO` after deleting old sessions)
> is a possible follow-up if a new spec needs historical aggregates."

Goal: every worktree gets its own SQLite **and** its own Neo4j, both carrying
real production data, cheap enough to rebuild on every `verify.sh` run.

Every number below was measured on this machine, not estimated.

---

## Summary of the approach

Three artifacts, built rarely, cached once per machine, cloned per run:

| Artifact | Built from | Size | Build | Per-run clone |
|---|---|---|---|---|
| `playertracker.db` fixture | 24 GB prod SQLite backup | **208 MB** | 2 s | ~0.5 s (`.backup`) |
| `neo4j.dump` | the SQLite fixture, via the app's own ETL | **33 MB** | 2 min | 2 s load + 6.5 s boot |
| Redis | nothing — already namespaced by slot | — | — | — |

**The prod Neo4j backup is not used to build the fixture**, even when one is to
hand (`bfstats-neo4j-latest.tar`, 3.5 GB). The graph is a pure function of SQLite
via `PlayerRelationshipEtlService`, so it is rebuilt from the *fixture*.

The reason is not merely that the prod graph carries ~45 k players the 14-day
fixture does not. It is that `PLAYED_WITH.sessionCount` accumulates over the
graph's entire history, so even for the ~4 k players that *are* in the fixture,
every edge weight would reflect 15 months of play against 14 days of relational
data. The two would disagree on every edge, and community detection keys off
those weights (`sessionCount >= 5`), so it would cluster on numbers the SQLite
cannot explain. Deriving takes 22 s and makes the two agree by construction.

This says nothing about whether to *back up* production Neo4j — do keep doing
that. Rebuilding the production graph is a 15–45 minute job on a node with no
headroom, and its community-detection step has a history of failing at that
scale. Derivable is a reason to rank it below SQLite in a restore, not a reason
to skip it.

---

## Part 1 — the SQLite fixture

### Where the 18 GB actually is

| Table | Rows | Share of file |
|---|---|---|
| **PlayerObservations** | **101,089,882** | **~78%** |
| PlayerSessions | 1,702,055 | |
| PlayerMapStats | 1,456,609 | |
| PlayerAchievements | 1,436,381 | |
| Rounds | 709,843 | |
| *everything else* | < 300 k each | |

One table is the whole problem. `PlayerObservations` is a per-poll snapshot —
~140 rows per round — and it carries two indexes on top of the row data.

**This is why a date slice alone does not work.** Two months of the dense period
is ~43 M observations ≈ 7 GB. The window has to be applied to observations on a
*different axis* from everything else.

### The shape of the slice

Three independent knobs, because the tables want different treatment:

```
ANCHOR      = MAX(Rounds.StartTime) in the SOURCE file
FACT_DAYS   = 14    rounds, sessions, aggregates: [ANCHOR-14d, ANCHOR]
OBS_ROUNDS  = 1000  only the newest 1000 rounds keep their PlayerObservations
```

`OBS_ROUNDS` is a **round count, not a time span**, on purpose: fixture size then
does not swing with how busy production happened to be that fortnight.

Tables fall into six tiers, applied in order:

1. **Reference / config — copied whole.** `Servers`, `Users`, all `Tournament*`,
   `HourlyActivityPatterns`, `MapGlobalAverages`, `ServerHourlyPatterns`,
   `PlayerComments`, `ServerComments`, `app_data`, `__EFMigrationsHistory`.
2. **Rounds define the window.** Everything else keys off the retained round set.
3. **Players implied by retained sessions.**
4. **Aggregates**, scoped to retained `(PlayerName, ServerGuid)` pairs.
5. **Observations** for the newest `OBS_ROUNDS` rounds.
6. **Referential closure** — pull in parents the whole-copied tables reference.

**Never copied:** `RefreshTokens`, `AdminPins` (credentials),
`PlayerWrappedCaches`, `ServerWrappedCaches` (regenerable JSON blobs),
`AdminAuditLogs`, `AIChatFeedback`, `TournamentImageIndices`,
`__EFMigrationsLock`.

### Result

| `FACT_DAYS` | Size | Build | Rounds | Sessions | Players | Servers | FK violations |
|---|---|---|---|---|---|---|---|
| 14 | **347 MB** | 4 s | 51,048 | 89,552 | 5,684 | 127 | 0 |
| 30 | 546 MB | 6 s | 107,728 | 191,592 | 8,631 | 184 | 0 |
| 60 | ~1.0 GB | 18 s | 221,548 | 388,122 | 14,760 | 289 | 0 |

**14 days is the recommendation.** 5,684 real players across 127 servers and all
three games (bf1942 / fh2 / bfvietnam) is three orders of magnitude more than the
current 7-player seed, and nothing in the suite needs more history than that. Bump
to 30 if a spec ever needs month-over-month comparisons.

### Five things that bite, all found by hitting them

**1. Anchor on the source's clock, never `now()`.**
The local 18 GB copy stops collecting in Feb 2026 while its newest row is dated
Sep 2026. `now() - 60 days` against it yields **141,910** observations — a fixture
that looks built but is empty of anything real. Backups are always stale; anchor
on `MAX(Rounds.StartTime)` in the file you are reading.

**2. The window needs an upper bound too.**
Filtering `StartTime >= FACT_FROM` with no `<= ANCHOR` retained 648 k of 713 k
rounds and 26.8 M observations. Obvious in hindsight, silent at runtime.

**3. Select sessions by their round, not by their own date.**
A session that starts inside the window can belong to a round that started
before it. Filtering sessions on `StartTime` leaves those pointing at rows that
were not kept. Use `RoundId IN (retained rounds) OR (RoundId IS NULL AND …)`.

**4. Scope aggregates by `(player, server)` pair, not by player.**
Filtering `PlayerMapStats` on `PlayerName` alone drags in every server that
player ever touched. `PlayerMapStats` alone was 169 MB of a 456 MB fixture;
pair-scoping took the whole file to 347 MB.

Note the month-granular tables (`PlayerMapStats`, `ServerMapStats`,
`ServerPlayerRankings`, `PlayerStatsMonthly`) can only be cut to whole months —
a 14-day window still pulls the containing month. That is a floor on fixture size.

**5. The whole-copied tables reference rows outside the window.**
Without a closure pass: **492 FK violations** — 470 from `Tournaments.Organizer`
alone, plus `TournamentTeamPlayers`, `UserBuddies`,
`TournamentMatchResults.RoundId`. Pull the parents in rather than dropping the
children; a tournament with a dangling organizer breaks the tournament list.
With the closure pass, `PRAGMA foreign_key_check` returns clean.

Also: zero `PlayerSessions.ObservationCount` for sessions whose observations were
dropped, or the round report advertises rows that are not there.

### Mechanics

Schema-only target, `ATTACH` the source read-only, `INSERT … SELECT`. Indexes are
created *after* the inserts — building 122 indexes incrementally is far slower.
Then `ANALYZE` (the app relies on `sqlite_stat1`; see
`SqliteConnectionInterceptor`) and `VACUUM`.

Read DDL from `sqlite_master`, **not** `.schema` — index DDL here spans multiple
lines and a line-oriented split tears statements in half.

The shipping script is [scripts/make-e2e-fixture.sh](../../scripts/make-e2e-fixture.sh).

---

## Part 2 — Neo4j

### Community allows exactly one database

Verified against the running `neo4j:5.15-community`:

```
> CREATE DATABASE e2etest;
Unsupported administration command: CREATE DATABASE e2etest
```

So `Neo4j__Database=e2e_{slot}` against one shared container is **not** available.
Per-slot isolation means per-slot *instance*. (Enterprise would allow it and is
free for development, but it is a different edition from production and a
licence to reason about — not worth it, given the numbers below.)

### The graph is derivable, so don't back it up

`PlayerRelationshipEtlService` builds the entire graph from `Rounds` and
`PlayerSessions`, watermarked by `SyncedToNeo4jAt`, and
`ResetNeo4jSyncWatermarkAsync` + `SyncPendingRelationshipsAsync` are already
wired to `POST /admin/jobs/neo4j-relationships-backfill`.

`scripts/make-e2e-graph.sh` drives this through a one-shot `E2E_BUILD_GRAPH` mode
in `Program.cs`. The HTTP endpoint is admin-authed and fire-and-forget, so a
build script can neither call it nor wait on it; the one-shot mode runs the same
ETL synchronously and exits with a meaningful code.

Measured against the 14-day fixture: **50,934 rounds, 61 s**, producing 5,748
nodes and 388,378 relationships — within 1.2% of what the overlap rule predicts
from SQLite alone (1.3 s to compute), which is a useful cheap pre-check.

| | Production today | 14-day fixture |
|---|---|---|
| `Player` nodes | 45,030 | 5,684 |
| `Server` nodes | 537 | ~127 |
| `PLAYED_WITH` | 1,181,508 | 383,065 predicted / 388,378 actual (both edge types) |
| `PLAYS_ON` | 91,844 | 10,049 |

### Per-slot cost, measured

Timed on a synthetic graph of matching shape (5,684 nodes / 442,913 rels):

| Step | Time |
|---|---|
| `neo4j-admin database dump` (offline, container stopped) | 2.2 s → **39 MB** |
| `neo4j-admin database load` into a fresh slot dir | 2.0 s → 293 MB on disk |
| container cold boot (512 m heap, `--tmpfs /data`) | 6.5 s |
| **total, dump on disk → usable bolt endpoint** | **~8.7 s** |

Container RSS ~1.0 GB each. Four concurrent worktrees ≈ 4 GB — fine on this
62 GB machine, and instances only exist while a run is in flight.

Cypher-replaying the graph instead of loading a dump takes ~10 s for 442 k
relationships, so `load` is only marginally better — but it is exact, and it does
not need the API running.

### Two traps

**Do not hand-prune `transactions/`.** The store dir is 37 MB but tx logs default
to 514 MB, which makes raw directory cloning look attractive. Deleting them
produces an instance that **fails to start** — `Recovery.performRecovery` throws
during init. Use `dump`/`load`, which handles this correctly.

**Neo4j is optional at API startup.** `Program.cs:868` only registers the services
when `Neo4j:Uri` is non-empty, and migration failure is logged, not fatal. So a
`NEO4J=0` mode that starts no instance at all is a legitimate default for the
specs that never touch a graph page — and saves ~9 s and 1 GB on most runs.

---

## Part 3 — how it fits together

Everything hangs off the existing slot mechanism in `scripts/e2e-env.sh`, which
already hands out ports 0–15 under a `flock`. Add one line:

| Resource | Formula | Slot 3 |
|---|---|---|
| API port | `9300 + slot` | 9303 |
| UI port | `5273 + slot` | 5276 |
| Redis DB | `slot` | 3 |
| **Neo4j bolt** | **`7690 + slot`** | **7693** |

### Shared cache, per-worktree clones

```
~/.cache/bfstats-e2e/                    one per machine, not per worktree
├── source/playertracker-YYYY-MM-DD.db   the prod backup (24 GB, kept or deleted)
├── template.db                          347 MB  ← cloned per run
├── neo4j.dump                            39 MB  ← loaded per run
└── template.meta                        source date, FACT_DAYS, OBS_ROUNDS, schema hash

<worktree>/.e2e/run/                     gitignored, thrown away each run
├── playertracker.db
└── neo4j/data/
```

The cache is keyed on a hash of `api/Migrations/*.cs` +
`PlayerTrackerDbContext.cs` + the generator's own knobs — the same trick
`verify.sh:migrations_hash()` already uses. Schema change ⇒ rebuild.

### Build path (rare — when the schema changes or the data goes stale)

1. Pull a fresh SQLite backup from prod per Appendix A of
   `deploy/volume-migration/BACKUP_RUNBOOK.md`. **SQLite only** — skip the Neo4j
   half.
2. Run the generator → `template.db` (4 s).
3. Start a scratch Neo4j, point an API at `template.db` with
   `DISABLE_BACKGROUND_PROCESSING=true`, `POST /admin/jobs/neo4j-relationships-backfill`,
   wait for the log line, `docker stop`, `neo4j-admin database dump`.
4. Both artifacts land in the shared cache.

### Run path (every `verify.sh`)

1. Slot + flock — unchanged.
2. `sqlite3 template.db ".backup .e2e/run/playertracker.db"` — ~0.5 s.
3. Unless `NEO4J=0`: `neo4j-admin database load` into `.e2e/run/neo4j/data`, start
   a container on `7690+slot`, wait for bolt — ~9 s, overlapped with the API build.
4. Export `Neo4j__Uri=bolt://127.0.0.1:$((7690+slot))`.
5. Existing `cleanup()` trap also `docker rm -f`s the slot's Neo4j.

Added wall-clock per run: **~0.5 s** without Neo4j, **~9 s** with — and the Neo4j
boot overlaps `dotnet run`, so in practice it is closer to free.

---

## What was built

| | |
|---|---|
| `scripts/make-e2e-fixture.sh` | Carves the fixture. `foreign_key_check` and per-tier row counts are hard gates; writes `template.meta`. |
| `scripts/make-e2e-graph.sh` | Builds `neo4j.dump` from the fixture and republishes the fixture with matching watermarks. |
| `api/Program.cs` | `E2E_BUILD_GRAPH=true` one-shot ETL mode; `E2E_SEED` now migrates a real fixture instead of no-opping `EnsureCreated` on it. |
| `scripts/e2e-env.sh` | Adds `NEO4J_PORT` (`7690+slot`), data dir and container name to the slot. |
| `scripts/verify.sh` | Uses the shared cache when present, falls back to the synthetic seed; `E2E_NEO4J=1` starts and tears down the slot's graph. |

`E2eDatabaseSeed` still runs, **on top of** the real fixture — verified: 5,684
real players plus the 5 seeded ones, 677 real servers plus `E2E Test Server`.
This is the part not to drop. A fixture rebuilt from a newer backup has different
top players, so any spec asserting on real names breaks when the data is
refreshed rather than when the code regresses. Real data is a *backdrop*;
assertions keep targeting seeded rows.

Full suite against the real fixture: **138 passed, 3 failed**. The same 3 fail on
the synthetic seed (`E2E_SYNTHETIC=1`), so they are pre-existing on this branch,
not fixture-related:

- `leaderboard.spec.ts:792` and `:843` (Leaderboard — Mobile)
- `server-details.spec.ts:498` (Chrono-Wave)

## Running in CI

`.github/workflows/e2e.yml` runs the same `./scripts/verify.sh` developers run,
so a CI failure reproduces locally with one command.

The repository is public, which cuts both ways. Standard GitHub-hosted runners
are free with no minute cap, and release storage and bandwidth are free — but
anything attached to a release is world-readable. The fixture is a slice of
production, so what gets published is a deliberate decision, not a logistics one.

Most of it is already public on bfstats.io: player names, servers, rounds,
scores. What is not, and how it is handled:

| Data | Treatment |
|---|---|
| `RefreshTokens`, `AdminPins`, `AdminAuditLogs` | never extracted |
| `Users.Email` | redacted to `user{Id}@e2e.invalid` |
| `UserPlayerNames`, `UserBuddies`, `UserFavoriteServers` | dropped unless `--keep-profiles` names the user id |

`--keep-profiles` exists because those three are leaf tables — nothing has a
foreign key into them — so they can be emptied without dangling anything, while
`Users` itself has to stay as an FK target for tournaments and comments. Keeping
exactly one real profile gives the profile pages something to render without
publishing everybody's account-to-gamertag mapping:

```bash
scripts/make-e2e-fixture.sh bfstats-sqlite-latest.db --keep-profiles 1 --force
scripts/make-e2e-graph.sh --force
scripts/publish-e2e-fixture.sh          # prompts before uploading
```

Distribution is a **GitHub Release asset** on the `e2e-fixture` tag — a storage
tag carrying no code. `zstd -19` takes the pair from 243 MB to **60 MB**
(`template.db` 210 MB → 28 MB; `neo4j.dump` is already internally compressed and
barely moves), and it decompresses in 0.15 s.

Release assets rather than `actions/cache` because cache entries evict after
seven days unused and the scoping rules bite on pull requests from forks. Cache
is still used in the workflow, for `node_modules` and NuGet, where it earns its
keep.

The workflow degrades rather than breaks: if the release does not exist the
fixture step is `continue-on-error`, and the run falls back to the synthetic
7-player seed. So it is useful before anything is published, and a
`workflow_dispatch` input forces either mode.

Two CI details worth knowing. `verify.sh` gates on `docker ps | grep bf1942-redis`,
so the workflow starts Redis under that exact name rather than diverging the
script. And Playwright still runs through the same
`mcr.microsoft.com/playwright:v1.56.1-jammy` container as locally — pulling it
costs about a minute per run, which is worth paying for zero divergence when
minutes are free.

## Known interaction: arcade + a narrow graph

With `E2E_NEO4J=1`, `e2e/arcade.spec.ts` fails intermittently — a different test
each run. With the graph off it is 10/10. Isolated by running that one spec both
ways.

Root cause is not a crash: the driver initialises cleanly and nothing is logged.
`ArcadeService` resolves `IPlayerRelationshipService` through an **optional**
`serviceProvider.GetService(...)` (`ArcadeService.cs:39`), so the graph-backed
question types are dormant when Neo4j is unconfigured and activate when it is
not. Against a 14-day / ~4 k-player graph, at least one of them emits a question
with **zero options** — the page snapshot shows "Question 1 of 5" rendered with
no `trivia-option` elements at all, and `toHaveCount(4)` sees 0. It varies run to
run because the quiz is assembled randomly.

Two separable things:

- **An app robustness gap.** A question with no answers should never be emitted,
  however thin the graph. The fix belongs in `ArcadeService` — drop a question
  that cannot be populated rather than shipping it empty — and matches how the
  rest of the API is expected to degrade.
- **A fixture question.** Whether 14 days is simply too narrow for arcade's
  graph-backed content. Widening `--fact-days` would mask the first problem
  rather than fix it, so fix the service first and re-measure.

Until then `E2E_NEO4J` stays opt-in and off by default, so the default suite is
unaffected.

## Next

Write the specs this unlocks: leaderboard paging against real rankings, player
detail with real aggregates, round reports off real observations, co-play graph
pages, `admin-to-public-sync` without mocks.

## Open questions

- **Does the backup get committed or fetched?** 347 MB + 39 MB is too big for
  git. Options: build on demand from a backup the developer already has; or push
  both to the assets volume and `curl` them (the `Dockerfile.sqlite-seed` /
  `BLOB_SAS_URL` pattern already does exactly this for prod).
- **Is real player data acceptable in a local fixture?** Names are public, but
  `Users.Email` and `UserPlayerNames` link real accounts. Cheap mitigation: hash
  emails during extraction. `RefreshTokens` and `AdminPins` are already excluded.
- **How often is the fixture refreshed?** Schema hash forces it on migrations.
  Data staleness has no trigger — suggest quarterly, or whenever a spec needs
  something the current window lacks.
