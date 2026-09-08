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

1. Rank regulars from `PlayerServerStats` (weekly, indexed on `ServerGuid`) and take the
   top `MaxRegularCandidates` (200) by rounds played.
2. Load ping / peak hour / last played from `PlayerSessions`, binding those names as
   individual `IN (...)` parameters (well under SQLite's variable limit) rather than
   scanning the whole server, so the planner can use `PlayerName + ServerGuid`. One round
   trip either way — no temp table.
3. If a server has no weekly rows yet, the candidate list is empty and the query falls
   back to scanning every session — that is a quiet server, there isn't much to scan.

No new `PlayerSessions` index and no pragma change.

`TotalRegulars` keeps its original meaning — how many of the *considered* players had an
average ping inside `[minPing, maxPing]` — computed in the same query via the same `total`
CTE the old single-scan query used. It's now bounded by the 200-candidate cap instead of
every regular on the server, so on a server with more than 200 weekly regulars it can
undercount slightly. That trade favors the ping-filtered count staying meaningful (and
responsive to the slider) over exactness for an edge case this project doesn't have yet.
