# Player Wrapped crunch performance

Goal: make the on-demand Player Wrapped calculation fast enough to run for ~30k players at the
end of November 2026. A single player took **23.3s** wall clock, and the crunch job computes two
variants per player (server-specific + global), so 30k players was on track for roughly two weeks
of continuous crunching.

Baseline came from a Seq trace export of one `GET /stats/wrapped/player/{name}?year=2026` request
(cache miss, cold process).

## Where the time went

| Section | Wall | Dominated by |
|---|---|---|
| YearInNumbers | 3.30s | 3 whole-population `GROUP BY PlayerName` scans + 4 raw-SQL percentile scans |
| Trend | 9.09s | `PlayerMapStats` aggregate **4,460ms** + ~4.6s unlogged |
| FavouriteMap | 1.69s | the *same* `PlayerMapStats` aggregate again (1,675ms) |
| Medals | 0.02s | — |
| BestMoments | 6.49s | loads every `kill_streak_*` achievement in the year, for all players, then JSON-parses each |
| Squad | 0.58s | Neo4j |
| ServerRankings | 1.22s | 30 sequential per-server rank queries (44–98ms each) |
| Relations | 0.60s | already batched |

The structural finding: **~13 of the 23 seconds computed population-wide aggregates that are
identical for every player in a run** — only the comparison threshold differed.

## What changed

### 1. Shared population snapshot

`WrappedPopulationStats` / `WrappedPopulationStatsBuilder` / `WrappedPopulationStatsProvider`.

Every rank and percentile is "how many players beat this number". Those aggregates are now
computed once per year per run into sorted arrays, and each player's rank is a binary search.
Replaces, per player:

- 2 EF `GROUP BY PlayerName` counts over `PlayerStatsMonthly` (score rank, kills rank)
- 4 raw-SQL percentile scans over `PlayerStatsMonthly`
- 1 `COUNT` + 1 `GROUP BY PlayerName` over `PlayerAchievements` (placements)
- 1 full load of every kill-streak achievement in the year + JSON parse of each row
- 30 per-server rank queries via `IPlayerStatsService.GetPlayerInsights`

The provider is a singleton with a 1-hour TTL, so the on-demand endpoint benefits too and
concurrent callers share one build. `WrappedService` falls back to a per-instance snapshot when
no provider is registered (unit tests construct the service directly).

**Behaviour change:** ranks are now standard competition ranks — (count strictly better) + 1, so
ties share a place. The kill-streak rank previously used `FindIndex` over a sorted list, which
gave tied players arbitrary different ranks depending on row order.

**Staleness:** on-demand ranks can be up to an hour behind. Acceptable for a year-in-review, and
`?refresh=true` forces a rebuild (below).

### 1b. `?refresh=true`

Every Wrapped endpoint takes `refresh`. It drops both caching layers for that year: the
`PlayerWrappedCaches` row (via the service's existing `bypassCache`, which the controller never
actually passed before) and the population snapshot. Without both, tracing the same player twice
wouldn't show the same work — the second call would be served from SQL, and even a forced
recalculation would reuse the cached snapshot.

```
GET /stats/wrapped/player/GhostXXX?year=2026&refresh=true
```

For profiles the snapshot is invalidated once at the controller, not once per alias.

### 2. Index fixes

Migration `AddWrappedPerformanceIndexes`.

`IX_PlayerMapStats_PlayerName_Year_ServerGuid_MapName` is the big one. The per-player map
aggregate filters `PlayerName`/`Year`/`ServerGuid` and groups by `MapName`. SQLite was choosing
`IX_PlayerMapStats_ServerGuid_MapName` instead — because it makes the `GROUP BY` free — and then
seeking on `ServerGuid = ''`, the global sentinel that covers most of the table, **ignoring
`PlayerName` entirely**. Same planner trap as the one recorded for raw ADO.NET joins here: a
low-cardinality column that looks selective but isn't.

Measured on a real 18 GB database copy (1.45M `PlayerMapStats`, 1.43M `PlayerAchievements`),
forcing the old plan with `INDEXED BY` for the before number:

| Query | Before | After |
|---|---|---|
| Per-player map aggregate | 513ms | 0.26ms |

Cross-checked on a synthetic 30k-player database (522 MB, 2.4M `PlayerMapStats`): 150ms → 0.03ms.
Both are well short of production's observed 4,460ms, which was cold-cache I/O on top of the same
bad plan.

Two candidate indexes were dropped after benchmarking showed the planner never chose them:

- `(AchievementId, AchievedAt)` — see the kill-streak note below.
- `(AchievementType, PlayerName, AchievedAt)` — didn't match the actual grouping. The shipped
  index is `(AchievementType, ServerGuid, PlayerName, AchievedAt)`, which is covering and needs
  no temp b-tree (85ms → 21ms on synthetic data).

**Kill-streak leaderboard: `LIKE` was kept, not replaced.** The obvious-looking fix is to rewrite
`AchievementId LIKE 'kill\_streak\_%'` as a range so it can seek `IX_PlayerAchievements_AchievementId`.
On synthetic data that looked like a 26× win (156ms → 6ms). On real data it is **10× slower**
(72ms → 700ms): the prefix matches ~65k rows and each one then needs a random row lookup for
`Metadata`, whereas driving off the `AchievedAt` range keeps those lookups in roughly rowid
order. The `LIKE` predicate stands; the win here is purely that the scan runs once per run
instead of once per player.

There is no `sqlite_stat1` in this database — `ANALYZE` has never been run. The indexes above are
shaped so the right plan is chosen without stats, but running `ANALYZE` (and re-checking
`EXPLAIN QUERY PLAN`) is still worth doing.

### 3. Duplicate map aggregation removed

Trend and FavouriteMap ran the same `PlayerMapStats` aggregation twice, differing only by a
`TotalPlayTimeMinutes` column and a top-5 ordering. Now one query returns all six sums and the
ordering happens in memory over a few dozen rows.

### 4. ServerRankings no longer goes through `GetPlayerInsights`

That path ran one full per-server `GROUP BY` for every server the player had ever played on
(~30 queries), plus an activity-by-hour query Wrapped never reads, then took the top 2. Now the
per-server leaderboards come from the snapshot; only the player's own scores and the ping average
for the two qualifying servers are still queried. `PlayerStatsService` is untouched, so its other
callers are unaffected.

### 5. No-tracking reads + per-player scopes

None of the Wrapped reads used `AsNoTracking`, and the crunch loop reused one scoped `DbContext`
for the whole run — so the change tracker accumulated every entity loaded for every player, and
identity-map fixup got slower as the run progressed. The 23.3s baseline was a *fresh* request;
player #10,000 would have been worse. All Wrapped reads are now `AsNoTracking`, and each crunch
item runs in its own DI scope.

### 6. Bounded parallelism

Crunch work is distributed over N workers, each with its own scope/DbContext/connection.
Configurable via `PlayerWrapped:CrunchParallelism` (default 4, clamped 1–16). SQLite in WAL mode
serves concurrent readers well; past a handful of workers they mostly contend for the write lock
on `PlayerWrappedCaches`. Falls back to sequential when no `IServiceScopeFactory` is available.

### 7. SQLite pragmas

`SqliteConnectionInterceptor` only set `busy_timeout`. Added per connection:

- `cache_size = -262144` (256 MiB) — the default 2 MiB page cache is thrashed by whole-table
  aggregate scans, so every repeat scan paid full I/O again
- `temp_store = MEMORY` — group-by/order-by sorters were spilling to disk temp files
- `mmap_size = 1 GiB` — avoids a `read()` + copy per page on a read-mostly workload

These help every stats/leaderboard query, not just Wrapped.

## Expected result

Per player, the population work drops from ~13s to a binary search, and the map aggregate from
~6s to sub-millisecond. What's left is genuinely per-player: Neo4j squad lookup (~0.6s),
Relations (~0.6s), and a handful of indexed queries.

## Not done

- **Squad and Relations are duplicated between the two variants.** `CrunchAllPlayersWrappedAsync`
  calls the calculation twice per player (server-specific + global), and the Squad lookup,
  server rankings and the Relations wins/losses query are all server-agnostic — identical across
  both passes. Memoising them per player would halve ~2.4s/player.
- **Relations ignores `ServerGuid`.** The wins/losses SQL has no server filter, so the
  server-specific variant counts rounds from every server. This looks like a correctness bug
  rather than a performance one, and fixing it changes output — left alone deliberately.
- **The ~4.6s unlogged gap inside Trend.** It sits after the map aggregate returns, where the
  code only does LINQ over a few dozen rows. On a cold first request that is most likely EF query
  compilation (one-time). If it shows up in a warm trace, the change-tracker accumulation in (5)
  is the next suspect.

## Verification

89 API unit tests pass (11 new). **E2E has not been run against these changes** — the suite was
cancelled part-way for time. Worth a run before this ships.

New tests:

- `tests/api/Wrapped/WrappedPopulationStatsTests.cs` — cohort filters (≥5 rounds, ≥20 kills),
  cross-month summing, year isolation, placement tallies, streak resolution from metadata
  (including malformed JSON), per-server ranking scores, and the tie semantics of
  `CountLess`/`CountGreater`.
- `WrappedServiceTests.GetPlayerWrappedAsync_RanksAndPercentilesComeFromTheWholePopulation` —
  three seeded players with a known ordering, pinning every rank and percentile.
- `WrappedServiceTests.GetPlayerWrappedAsync_RanksBestStreakAgainstEveryOtherPlayersStreaks`.
