# Slow `GET /stats/data-explorer/servers/{guid}/map-rotation` — gold winners table fetches

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 02:14 UTC 2026-10-17.

## Trace

`GET /stats/data-explorer/servers/7b3a63-12e36b3-6dac2c-8c0a76c/map-rotation?pageSize=50`

| field | value |
|---|---|
| TraceId | `2ce9e8cb063ff5c6661ff3fdfc481f37` |
| started | 02:13:43Z |
| finished | 02:13:57Z |
| elapsed | **13,377ms** |
| status | 200 |
| pod | `bf42-stats-bb88959bc-k7nnw` |
| UA | `BF1942-Launcher`, `is_bot=false` |

MoonGamers. Same URL + pageSize on the new pod that afternoon:

| When (UTC) | Elapsed | Winners hop |
|---|---|---|
| 01:27:28 | 321ms | (not logged) |
| 01:37:27 | 302ms | |
| 01:52:02 | 322ms | |
| **02:13:57** | **13,377ms** | **13,324ms** |
| 02:14:47 | 1,802ms | 1,784ms |

Collection #90 finished 02:14:57 in 3.1s. Recreate extra hourly already done 01:08. No SQLITE_BUSY. Sibling `/stats/rounds?serverGuid=...` in the same second was 8–32ms. Not writer overlap.

The 01:27 Slow page on this GUID was the **detail** path (`PlayerMapStats` top-5, PR #69). This is the map-rotation winners query, not that leftover. Do not reopen #69.

## Cause

`GetTopPlacementWinnersByMapAsync` groups gold `round_placement` rows:

```sql
WHERE ServerGuid = ?
  AND AchievementType = 'round_placement'
  AND Tier = 'gold'
  AND MapName IN (36 maps)
GROUP BY MapName, PlayerName
```

`IX_PlayerAchievements_AchievementType_ServerGuid_PlayerName_AchievedAt` can seek type+server but does not carry `MapName` or `Tier`. Each matching gold row is a random table fetch. On the Hetzner volume that is ~1.4ms when the page is cold. The launcher asks for `pageSize=50`, so the IN-list is the whole rotation (36 maps here) rather than the web default of 10.

Warm cache on the same statement is 300ms. Cold is what crossed 10s.

## Change

- Partial covering index `IX_PlayerAchievements_MapGoldWinners_Covering (ServerGuid, MapName, PlayerName) WHERE AchievementType = 'round_placement' AND Tier = 'gold'`.
- The winners SQL uses those same literals so SQLite can take the filter (a bound `@p1` would not).
- Information hop log: `Map rotation {ServerGuid}: {MapCount} maps in {ElapsedMs}ms (rotation {RotationMs}ms, winners {WinnersMs}ms, rounds {RoundsMs}ms)`.

No pragma change, no connection-pool setting. First start after migrate builds the index. Gold-only keeps gamification inserts that are not placements off the extra B-tree.

Do not live-probe `/stats/data-explorer/servers/{guid}/map-rotation` on production until this is the running image. After it is live, a still >=10s page whose new log shows `winners` still >=10s is a new bug — do not re-add this index. A slow page with no new log is the old image.
