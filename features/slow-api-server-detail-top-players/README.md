# Slow `GET /stats/data-explorer/servers/{guid}` — PlayerMapStats top-5 row fetches

Seq signal `bfstats/Slow as fuck (>= 10 seconds)`.

## Trace

`GET /stats/data-explorer/servers/7b3a63-12e36b3-6dac2c-8c0a76c`

TraceId `393dd9acc2c700b5336ba07383cf1ca8` at 2026-10-17 01:27:00–25Z. HTTP 200, **24.8s**. UA `BF1942-Launcher-check`, `is_bot=false`. Host `bfstats.io`. Pod `bf42-stats-76b9c5cb87-5dfjc`.

The same path on 2026-10-15 16:26 for `42b98b-61f0b93-183a06c-49be6b0` was **11.2s** (bot; Slow did not page). TraceId `dd69ee0e6270661b705e95b9d0b4de64`. Same hop.

| hop | 01:27Z 10-17 | 16:26Z 10-15 |
|---|---|---|
| `Servers` by Guid | 0ms | 0ms |
| `ServerMapStats` rotation | 83ms | 2ms |
| `PlayerAchievements` gold winners | 307ms | 674ms |
| `PlayerMapStats` top 5 per map (10 maps) | **24,379ms** | **10,422ms** |
| `ServerHourlyPatterns` | 0ms | 2ms |

Collection cycle #60 finished 01:28:05 in 3646ms. Recreate extra hourly finished 01:08. Not writer overlap. Sibling `.../map-rotation` for the same guid was 321ms.

V4 map-popularity still calls this endpoint to resolve a server name (`MmServerMapPopularity.fetchServerNameIfNeeded`). The launcher hits it directly.

## Cause

```sql
FROM PlayerMapStats
WHERE ServerGuid = @p0 AND MapName IN (@p1 ... @p10)
GROUP BY MapName, PlayerName
```

plus `ROW_NUMBER() OVER (PARTITION BY MapName ORDER BY SUM(TotalScore) DESC)` then `Rank <= 5`.

`IX_PlayerMapStats_ServerGuid_MapName` served the WHERE. It did not cover `PlayerName`, `TotalScore`, `TotalKills`, or `TotalDeaths`, so every matching monthly row was a random table fetch. On the Hetzner volume that is ~1.4ms each; tens of thousands of rows is a 10–24s request. Same class of miss as `IX_PlayerMapStats_MapRanking_Covering`.

## Change

Replace `IX_PlayerMapStats_ServerGuid_MapName` with covering

`IX_PlayerMapStats_ServerDetail_Covering (ServerGuid, MapName, PlayerName, TotalScore, TotalKills, TotalDeaths)`.

Same prefix, so every seek the old index served still seeks. GROUP BY PlayerName is sequential. No pragma change. Skip the IN-list when the server has no maps.

Hop log:

`Server detail {ServerGuid}: {MapCount} maps in {ElapsedMs}ms (rotation {RotationMs}ms, winners {WinnersMs}ms, topPlayers {TopPlayersMs}ms)`

First start after migrate builds the index (sorts PlayerMapStats; expect a slower first start).

After it is live, a still >=10s page whose new log shows `topPlayers` still >=10s is a new bug — do not re-add this index. A slow page with no new log is the old image.
