# Measurements behind the design

## The real production run (2026-09-08) — authoritative

Source: `bfstats-sqlite-latest.db`, 24 GB, 1,413,668 rounds, data current to
`2026-09-08 10:46`, no WAL alongside it.

| Step | Result |
|---|---|
| `make-e2e-fixture.sh` (defaults: 14 fact-days, 1000 obs-rounds) | **208 MB in 2 s** |
| window chosen from the source's own max | `[2026-08-25 .. 2026-09-08 10:46]` |
| contents | 49,762 rounds · 63,571 sessions · 4,149 players · 799 servers · 20,065 observations |
| orphans pruned | 0 |
| `make-e2e-graph.sh` | ETL 22 s over 49,654 rounds → 4,176 nodes / 282,337 relationships; **33 MB dump**; 2 min wall |
| full suite, graph off (default) | **138 passed, 3 failed** — the same three that fail on the synthetic seed |
| full suite, `E2E_NEO4J=1` | 136 passed, 5 failed — see "arcade + a narrow graph" in the README |

Fixture size came in at 208 MB against a predicted 450 MB. The earlier estimate
scaled from the 2025-09/10 traffic peak; late-August 2026 is quieter (4,149
players in 14 days versus 5,684), and player count drives the aggregate tables
that dominate the file.

### Production data defects found along the way

`PRAGMA foreign_key_check` on the 24 GB source:

```
45,860,683  PlayerObservations -> PlayerSessions
         6  PlayerSessions     -> Rounds
```

**33.5% of the observations table is orphaned** (45,860,683 of 136,973,929).
Sessions were deleted without their observations following, because SQLite only
enforces `ON DELETE CASCADE` when `foreign_keys=ON` and nothing in the app sets
it. `PlayerObservations` is ~78% of the file, so this is on the order of **6 GB
of dead weight in a 24 GB database**.

It is finished, and it is bounded. Orphans by month:

| Month | Orphans | SessionId range |
|---|---|---|
| 2025-06 | 4,665,356 | 31 – 267,136 |
| 2025-07 | 6,931,656 | 252,005 – 549,864 |
| 2025-08 | 6,401,405 | 543,282 – 837,862 |
| 2025-09 | 12,810,910 | 828,223 – 1,098,206 |
| 2025-10 | 13,862,749 | 1,025,023 – 1,367,896 |
| 2025-11 | 1,188,451 | 1,346,958 – 1,398,551 |
| 2026-01 | 156 | 1,906,234 – 1,906,252 |

Newest orphaned observation: **2026-01-23 11:03:58**. December 2025 is zero, and
the January remainder is 156 rows across 19 consecutive session ids. The count is
byte-identical to the 2026-08-15 snapshot taken three weeks earlier, so nothing
has orphaned since.

It was **not** a date-based purge of old data. Sessions survive evenly across
every affected month (190,651–212,356 per month, June to November 2025), and
`PlayerSessions` still starts at `SessionId` 1 with `StartTime` 2025-06-01. What
the ids show instead is a clean partition of one contiguous block:

```
1,021,476 surviving  +  377,075 orphaned  =  1,398,551  (exactly the id range)
```

Every id from 1 to 1,398,551 is accounted for, and nothing above it is affected
apart from those 19 January ids. So ~377 k sessions were deleted out of that
block, and they were unusually long ones: 45,860,683 observations across 377,075
sessions is ~122 each, against a table-wide average of ~51.

That points at sessions that never terminated and kept accumulating
observations, later cleaned up without their children — but identifying the
actual deleter needs the codebase, not the data, since the rows are gone.

Cleanup is therefore a bounded delete rather than an open-ended one, which makes
it much safer to plan. It still needs its own piece of work: a `VACUUM` on a
24 GB file on that node is exactly the class of operation
`PRODUCTION_ISSUES.md` exists for.

### A stale backup, caught by the recency check

The first backup offered (`bfstats-sqlite-20260907-100305.db`, named for the day
it was taken) turned out to be frozen at `2026-08-15 13:19`. *Every* table
stopped at that instant, including `RefreshTokens` and `TournamentComments`,
which have nothing to do with the collectors — so it was a complete snapshot of
a dead copy, not a live database with broken collection. Live production was
current when checked directly.

The most likely source is the old PVC that `BACKUP_RUNBOOK.md` deliberately
leaves bound on the boot disk as the migration rollback. Two lessons, both now
baked into the generator: **check the source's recency before trusting it**, and
**anchor the window on the source's own max timestamp** so a stale file produces
an obviously-wrong window rather than a silently empty fixture.

---

## Earlier exploratory run (2026-09-07)

Superseded by the production run above, but retained because the design
decisions were made from it. Measured against an 18 GB *local* copy of the
tracking database, not production.

## Environment

| | |
|---|---|
| Host | 62 GB RAM, 43 GB available, NVMe; `/tmp` is a 32 GB tmpfs |
| Source DB | `/home/dylan/projects/skandia/bfstats/api/playertracker.db`, 18 GB |
| Neo4j | `neo4j:5.15-community` (same tag as `docker-compose.dev.yml`) |
| Fixtures built in | the tmpfs scratchpad |

**Caveat 1 — fixtures were built on tmpfs.** Build times (4–18 s) and the
0.1 s directory copy are optimistic against a cold spinning disk. On this
machine's NVMe the difference is small; on the network-attached prod volume
(307 MB/s write, per `deploy/NODE_TUNING.md`) it would not be. The fixture is
built on a developer's laptop, so tmpfs/NVMe is the right assumption.

**Caveat 2 — the local source is stale.** Collection tails off after Feb 2026:

| Month | PlayerObservations |
|---|---|
| 2025-09 | 21,095,650 |
| 2025-10 | 22,538,397 |
| 2025-11 | 8,775,884 |
| 2026-02 | 2,737,621 |
| 2026-03 | 96,331 |
| 2026-07 | 85,826 |
| 2026-09 | 20,823 |

All sizing runs therefore forced `FIXTURE_ANCHOR="2025-11-01"` so the window
lands on production-density data. Against a fresh 24 GB prod backup the anchor
is the file's own `MAX(Rounds.StartTime)` and no override is needed. Prod is
~33% larger than this copy, so **treat the fixture sizes as ±35%**: 347 MB at
14 days could plausibly be ~450 MB.

**Caveat 3 — superseded.** The Neo4j lifecycle was first timed on a synthetic
graph (5,684 nodes / 442,913 relationships). The real ETL has since been run
end-to-end via `scripts/make-e2e-graph.sh`; both sets of numbers are below and
they agree closely.

## Source database

51 tables, 122 indexes, no views, triggers or virtual tables. Rounds span
2025-06-01 → 2026-09-06 (713,256 rounds).

Row counts from `sqlite_stat1` (`ANALYZE` output, not `COUNT(*)`):

```
101,089,882  PlayerObservations
  1,702,055  PlayerSessions
  1,456,609  PlayerMapStats
  1,436,381  PlayerAchievements
    709,843  Rounds
    280,720  MapServerHourlyPatterns
    205,806  PlayerServerStats
     45,080  Players
        670  Servers
```

`PlayerObservations` carries `IX_PlayerObservations_Timestamp` and
`IX_PlayerObservations_SessionId_Timestamp` on top of the row data —
`SqliteConnectionInterceptor` puts its indexes alone at ~8.8 GB.

## Fixture build results

`make-fixture.sh <src> <dst> <FACT_DAYS> <OBS_ROUNDS>`, anchor forced to
2025-11-01, `OBS_ROUNDS=1000` throughout.

| `FACT_DAYS` | inserts | +indexes | +analyze/vacuum | final | FK violations |
|---|---|---|---|---|---|
| 14 | 2 s / 175 MB | 1 s / 359 MB | 1 s | **347 MB** | 0 |
| 30 | 2 s / 262 MB | 3 s / 566 MB | 1 s | **546 MB** | 0 |
| 60 | 7 s / 491 MB | 6 s / 1.1 GB | 5 s | ~1.0 GB | 0 |

Contents at 14 days: 51,048 rounds · 89,552 sessions · 5,684 players ·
127 servers · 134,210 observations.

Game coverage in the 60-day window (all three survive the cut):
bf1942 251 servers / 304,021 sessions · fh2 21 / 68,408 · bfvietnam 17 / 15,693.

### Where the pair-scoping win came from

`dbstat`, MB per logical table (table + its indexes), 14-day fixture *before*
scoping aggregates to `(PlayerName, ServerGuid)`:

```
PlayerMapStats           169
PlayerSessions            62
PlayerAchievements        61
MapServerHourlyPatterns   50
PlayerServerStats         31
Rounds                    24
PlayerObservations        17
```

`PlayerMapStats` held 490,497 rows across 5 indexes because filtering on
`PlayerName` alone retains every server a player ever touched. Joining against
the retained `(player, server)` pairs, plus restricting
`MapServerHourlyPatterns` / `ServerMapStats` to retained servers, took the file
from 456 MB → 347 MB.

Observations are a non-issue once bounded by round count: 17 MB at 14 days,
versus 26.8 M rows when the window bound was missing.

### Progression of the prototype

Worth recording because each was silent at runtime:

| Fixture | Cause |
|---|---|
| 5.7 GB, 492 FK violations | no upper window bound; no closure pass |
| 1.1 GB, 492 violations | upper bound added |
| 456 MB, 0 violations | closure pass; observations bounded by round count |
| **347 MB, 0 violations** | aggregates scoped by `(player, server)` |

## Neo4j

Community multi-database, against the running dev container:

```
$ cypher-shell -d system "SHOW DATABASES;"
"neo4j",  "standard", ... TRUE
"system", "system",   ... FALSE

$ cypher-shell -d system "CREATE DATABASE e2etest;"
Unsupported administration command: CREATE DATABASE e2etest
```

Current dev graph: 45,030 `Player` · 537 `Server` · 6,112 `Community` ·
1,181,508 `PLAYED_WITH` · 91,844 `PLAYS_ON`.

Lifecycle timings (`--tmpfs /data`, 512 m heap, 256 m pagecache):

| Step | Result |
|---|---|
| cold boot, empty store → bolt ready | 8,522 ms |
| build 442,913 rels via `CALL { } IN TRANSACTIONS OF 20000` | 10 s |
| `neo4j-admin database dump` (stopped) | 2,252 ms → 39 MB |
| `neo4j-admin database load` into fresh dir | 2,014 ms → 293 MB |
| load + boot, dump → verified bolt endpoint | 8,654 ms |
| container RSS | 1.015 GiB |

Post-load verification returned 5,684 players and 442,913 relationships, indexes
intact.

Note `CALL (x, y) { }` scoped-variable syntax is 5.23+; 5.15 needs
`CALL { WITH x, y … }`.

### Tx logs cannot be pruned by hand

Raw store after the build: `databases/` 37 MB, `transactions/` **514 MB**. That
asymmetry makes deleting tx logs look like an easy 14x win. It is not:

```
$ find data/transactions -type f -delete && docker run … neo4j:5.15-community
org.neo4j.kernel.recovery.Recovery.performRecovery(Recovery.java:732)
… Neo4j Server shutdown initiated by request
```

The instance never reaches bolt. This is the same hazard
`deploy/volume-migration/BACKUP_RUNBOOK.md` warns about for prod backups
("`databases/` **and** `transactions/`"), and it is why the design uses
`dump`/`load` rather than directory cloning.

### Real ETL, end to end

`scripts/make-e2e-graph.sh` against the 347 MB fixture:

| Step | Result |
|---|---|
| watermark reset | 51,048 rounds, 89,552 sessions |
| `SyncPendingRelationshipsAsync` + `SyncPlayerServerRelationshipsAsync` | 50,934 rounds, 568,318 relationship ops, **61 s** |
| resulting graph | 5,748 nodes, **388,378 relationships** |
| whole script (Neo4j boot → dump on disk) | ~2 min → **46 MB** |

The SQL-only prediction (383,065 `PLAYED_WITH` + 10,049 `PLAYS_ON` = 393,114)
came within 1.2% of the 388,378 the ETL actually produced, which makes the 1.3 s
SQLite query a cheap way to sanity-check a fixture before spending two minutes on
the graph.

Note 51,048 rounds went in and 50,934 came out: the ETL skips rounds with fewer
than two overlapping sessions.

### Full suite

Against the real fixture: 138 passed, 3 failed, 47.9 s. The same 3 fail with
`E2E_SYNTHETIC=1` (38 passed / 3 failed on those two spec files), so they are
pre-existing on this branch rather than fixture-related.

## Not measured

- Community detection (`DetectAndStoreCommunities`, 6,112 `Community` nodes in
  dev) is not part of the graph template build. Unknown cost; a spec that needs
  `Community` nodes will have to trigger it or the builder will have to add it.
- Prod backup pull time. `BACKUP_RUNBOOK.md` measures the on-server copy at
  ~80–90 s for 24 GB; the download to a laptop is a separate, larger cost.
- Whether 14 days is enough for `PlayerWrappedCaches`-backed pages, which the
  fixture deliberately empties.
- Concurrent worktrees each running a slot Neo4j. Single-slot memory (~1 GB) is
  measured; contention between two live slots is not.
