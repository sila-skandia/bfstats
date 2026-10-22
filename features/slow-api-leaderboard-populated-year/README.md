# Slow API: year-long populated leaderboard

## Symptom

Seq Slow `ElapsedMilliseconds >= 10000` on

`GET /stats/leaderboard?page=1&pageSize=25&sortBy=score&sortDir=desc&populatedOnly=true&days=365&minRounds=25&minPlay=0&game=bf1942`

HTTP 200. Edge, not a bot. Host `bfstats.io`. Pod `bf42-stats-58994ccf96-vbf8g` (Application started 12:04Z 10-06).

| When (UTC) | Elapsed | HTTP | TraceId | Pod |
|---|---|---|---|---|
| **10-06 15:29** | **10.38s** | 200 | `3398a4f57a506dabd71d27feac55911e` | `58994ccf96` |
| 10-05 18:45 | 6.78s | 200 | — | `d5fccf66b` |
| 10-05 16:34 | 5.04s | 200 | — | `d5fccf66b` |
| 10-05 14:51 | 9.62s | 200 | — | `d5fccf66b` |
| 10-04 15:25 | 6.23s | 200 | — | `59dcdcf8fb` |
| 10-04 10:30 | 8.91s | 200 | — | `59dcdcf8fb` |
| 10-04 16:51 | 0.15s | 200 | — | `59dcdcf8fb` (warm) |

Occupancy SQL 476ms (cache miss). Servers catalog 0ms. The remaining ~9.85s was raw ADO.NET on `PlayerServerStats`, which does not emit EF `CommandExecuted`, so Seq showed a 9-event trace with a hole. No Seq body-limit. No overlapping aggregate/ranking writers.

Closed **PR #44** had this same covering index; the owner closed it on 10-03 because that branch was based on rewritten `main` history. This is a clean re-implementation, not a reopen.

## Why it is slow on this node

`populatedOnly=true` (UI default) is treated as a server filter, so the query leaves `PlayerStatsMonthly` and scans weekly `PlayerServerStats` for the high-occupancy `ServerGuid`s. `days=365` is ~52 weeks. The CTE grouped every matching week, counted every eligible player, then `ROW_NUMBER()`-paged 25 rows.

`IX_PlayerServerStats_ServerGuid_Year_Week` could find the rows. The SUM columns were not in it, so each aggregate value was a random heap fetch. On the Hetzner volume a cache miss is ~1.38ms, and a year of weekly rows across populated servers is enough random reads to land in the 5–10s band when cold and ~150ms when the pages are already in cache.

## Fix

1. Covering index `IX_PlayerServerStats_LeaderboardCovering` on `(ServerGuid, Year, Week, PlayerName, TotalKills, TotalDeaths, TotalScore, TotalPlayTimeMinutes, TotalRounds)`. Replaces the prefix `(ServerGuid, Year, Week)` index. First start after migrate will be slow while SQLite builds it.
2. `WITH eligible AS MATERIALIZED` so the GROUP BY runs once (count + page), and `ORDER BY … LIMIT/OFFSET` instead of windowing every eligible row. Rank in the DTO was already `offset + idx + 1`.
3. `INDEXED BY` the covering index on the `PlayerServerStats` path so the planner cannot prefer the player-leading PK (which still would not cover the SUMs).
4. Information logs `Global leaderboard query {Table} … in {ElapsedMs}ms` and `Leaderboard favorites for {PlayerCount} names in {ElapsedMs}ms` so the next Seq trace is not a hole.

No `SqliteConnectionInterceptor` or PRAGMA changes.

## After it is live

A still >=10s `/stats/leaderboard` whose SQL is this year + populatedOnly shape and whose new log shows the covering hop still >=10s is a new bug — do not re-add the unbounded weekly scan. A slow leaderboard whose log is a *different* table (`PlayerMapStats` / monthly) or a different filter is also a new bug. A slow page with no new log is the old image.
