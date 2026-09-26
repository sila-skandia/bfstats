# Slow API: year-long populated leaderboard

## Symptom

Seq Slow `ElapsedMilliseconds >= 10000` on

`GET /stats/leaderboard?page=1&pageSize=25&sortBy=score&sortDir=desc&populatedOnly=true&days=365&minRounds=25&minPlay=0&game=bf1942`

HTTP 200. Real browser, not a bot. Same URL had been 1.4–10s every few hours for two days; 10.03s at 2026-09-21 14:20Z (TraceId `e7e7efe73be23754251077745dfe1c76`) crossed the page. Occupancy SQL 333ms (cache miss). Servers catalog 0ms. The remaining ~9.6s was raw ADO.NET on `PlayerServerStats`, which does not emit EF `CommandExecuted` so Seq showed a 5-event trace with a hole.

No overlapping aggregate/ranking writers. Sibling traffic in those seconds was sub-20ms.

## Why it is slow on this node

`populatedOnly=true` (UI default) is treated as a server filter, so the query leaves `PlayerStatsMonthly` and scans weekly `PlayerServerStats` for the high-occupancy `ServerGuid`s. `days=365` is ~52 weeks. The CTE grouped every matching week, counted every eligible player, then `ROW_NUMBER()`-paged 25 rows.

`IX_PlayerServerStats_ServerGuid_Year_Week` could find the rows. The SUM columns were not in it, so each aggregate value was a random heap fetch. On the Hetzner volume a cache miss is ~1.38ms, and a year of weekly rows across populated servers is enough random reads to land in the 2–10s band depending on page-cache warmth.

## Fix

1. Covering index `IX_PlayerServerStats_LeaderboardCovering` on `(ServerGuid, Year, Week, PlayerName, TotalKills, TotalDeaths, TotalScore, TotalPlayTimeMinutes, TotalRounds)`. Replaces the prefix `(ServerGuid, Year, Week)` index. First start after migrate will be slow while SQLite builds it.
2. `WITH eligible AS MATERIALIZED` so the GROUP BY runs once (count + page), and `ORDER BY … LIMIT/OFFSET` instead of windowing every eligible row. Rank in the DTO was already `offset + idx + 1`.
3. `INDEXED BY` the covering index on the `PlayerServerStats` path so the planner cannot prefer the player-leading PK (which still would not cover the SUMs).
4. Information logs `Global leaderboard query {Table} … in {ElapsedMs}ms` and `Leaderboard favorites for {PlayerCount} names in {ElapsedMs}ms` so the next Seq trace is not a hole.

## After it is live

A still >=10s `/stats/leaderboard` whose SQL is this year + populatedOnly shape and whose new log shows the covering hop still >=10s is a new bug — do not re-add the unbounded weekly scan. A slow leaderboard whose log is a *different* table (`PlayerMapStats` / monthly) or a different filter is also a new bug.
