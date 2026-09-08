# Slow `GET /stats/relationships/servers/{guid}/proximity`

Seq signal `bfstats/Slow as fuck (>= 10 seconds)`.

## Trace

`GET /stats/relationships/servers/42b98b-61f0b93-183a06c-49be6b0/proximity?minPing=0&maxPing=250&limit=50`

TraceId `8087d219958a7697fa59e3474fb9c890` at 2026-09-08 04:31:30–41Z. HTTP 200, **11.6s**. Not a bot.

Server is `*NEW* SiMPLE | BF1942`. Same GUID cache-misses over the previous 30 hours:

| Time (UTC) | Elapsed | Bot |
|---|---|---|
| 09-08 04:31 | **11.6s** | no |
| 09-08 02:01 | 3.7s | no |
| 09-07 21:57 | 2.6s | no |
| 09-07 17:51 | 2.4s | no |
| 09-07 14:14 | 2.5s | no |

Other busy servers (MoonGamers, 5488456-…) sit at 2–5.6s on a miss. The 1-hour Redis cache hides this until the next miss. This page started in the same millisecond as three game-trends cache misses for the same GUID, so the volume paid four cold reads at once.

No hourly ranking / aggregate / gamification write overlapped 04:30–04:32.

Same window, not this page: `GET /stats/relationships/players/Smoikkelii/network-graph?depth=2` **18.7s** (bot, TraceId `36a80b719bfb6c54fa732a2ac4ef76c7`). That is the leftover on `cursor/api-performance-and-exceptions-5e18`. Do not re-implement.

## Cause

`ServerProximityService` scanned `PlayerSessions` for the whole server:

```sql
FROM PlayerSessions
WHERE ServerGuid = @serverGuid
  AND IsDeleted = 0
  AND AveragePing IS NOT NULL
```

then grouped twice (per-player stats + peak hour). `IX_PlayerSessions_ServerGuid_StartTime_MapName` can seek the GUID, but AveragePing / PlayerName / IsDeleted are not in that index, so every session on SiMPLE is a table lookup. On the Hetzner volume that is thousands of ~1.4ms round trips.

## Change

1. Count and rank regulars from `PlayerServerStats` (weekly, indexed on `ServerGuid`).
2. Load ping / peak hour / last played from `PlayerSessions` only for those names so the planner can use `PlayerName + ServerGuid`.
3. If a server has no weekly rows yet, keep the old session scan — that is a quiet server.

No new `PlayerSessions` index and no pragma change.

`TotalRegulars` is now the distinct weekly-regular count, not "how many of the scanned sessions passed the ping HAVING". The orbit still plots the ping-filtered top-N.
