# Slow API: map player rankings COUNT

Seq signal `bfstats/Slow as fuck` (>= 10s) fired around 09:06 UTC on 2026-09-07
with an empty webhook body. The newest HTTP page was the 08:03 UTC server-map
detail request (already covered on `cursor/api-performance-and-exceptions-5bab`).
The same Chrome session immediately loaded map rankings, which missed the 10s
signal at **9.2s**.

## What was slow

| Time (UTC) | Path | Elapsed |
|---|---|---|
| 08:03:22 | `GET /stats/data-explorer/servers/7b3a63-12e36b3-6dac2c-8c0a76c/maps/market garden?days=60` | **10.6s** (5bab) |
| 08:03:32 | `GET /stats/data-explorer/maps/market garden/rankings?...&serverGuid=7b3a63-12e36b3-6dac2c-8c0a76c&days=60` | **9.2s** (this) |

Trace `812b686b6cf5dbe3aad2e0ccbf300311`. Real Chrome user, HTTP 200.

| Step | Elapsed |
|---|---|
| `Servers` by game | 0ms |
| `PlayerMapStats` COUNT + `HAVING SUM(TotalRounds) >= 3` | **7,261ms** |
| paginated ranking SELECT (same HAVING, plus wins CTE) | **1,939ms** |

## Cause

`GetMapPlayerRankingsAsync` counts and pages:

```sql
FROM PlayerMapStats
WHERE MapName = @p0
  AND ((Year > @p1) OR (Year = @p1 AND Month >= @p2))
  AND ServerGuid IN (@p3)
GROUP BY PlayerName
HAVING SUM(TotalRounds) >= @p4
```

`IX_PlayerMapStats_MapRanking_Covering` could seek `(MapName, ServerGuid)` and
avoid a temp GROUP BY, but it only covered `TotalScore`. The COUNT (and the
ranking SELECT) also read `TotalRounds`, `TotalKills`, `TotalDeaths`, and
`TotalPlayTimeMinutes`, so each matching player-month row was a random table
fetch. On the Hetzner network-attached volume that is ~1.4ms each.

This is the same class of miss as `AddCoveringIndexesForRankingQueries` and the
server-map covering index on 5bab. 5bab leads with `(ServerGuid, MapName)` for
`GetServerMapDetailAsync`. This query leads with `MapName`, so it needs the
MapName-leading covering index to carry the SUM columns.

## Fix

Rebuild `IX_PlayerMapStats_MapRanking_Covering` as

`(MapName, ServerGuid, PlayerName, Year, Month, TotalScore, TotalKills, TotalDeaths, TotalRounds, TotalPlayTimeMinutes)`.

The first API start after this migration will be slow while SQLite sorts
`PlayerMapStats` to rebuild the index.

`ROW_NUMBER()` already ranks the full result set, so displayed rank no longer
adds `OFFSET` a second time (page 2 used to show #5 for the third player).

Do not live-probe `/stats/data-explorer/maps/*/rankings` on a busy map until
this is deployed (it can page). The 10.6s server-map endpoint remains on 5bab.
