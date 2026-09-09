# Slow `GET /stats/relationships/servers/{guid}/proximity` — unbounded history

Seq signal `bfstats/Slow as fuck (>= 10 seconds)`.

## Trace

`GET /stats/relationships/servers/42ba49-61f1d04-183a4bc-49bf3d2/proximity?minPing=0&maxPing=250&limit=50`

TraceId `7a69c92f29ae6cc99bd71b5694620e3f` at 2026-09-09 05:01:27–45Z. HTTP 200, **17.7s**. Not a bot. Chrome Windows. Server is `*NEW* SiMPLE | RtR+SW`.

Pod `bf42-stats-86c959fb84-7v2c6` — PR #26 is the running image (first hop is `PlayerServerStats` GROUP BY PlayerName, not a full `PlayerSessions` GUID scan).

| span | cost | notes |
|---|---|---|
| `PlayerServerStats` top 200 | **973ms** | EF `CommandExecuted` |
| `PlayerSessions` named lookup | **~16.6s** | raw ADO.NET — Seq never logs it |
| same-visit game-trends | 170–218ms | not the page |

Stats collection cycle #50 ran 41.5s across the same window (normally ~3s) and skipped the next tick. ServerWrapped was also reading `PlayerSessions`. No hourly ranking/aggregate cycle.

Same GUID earlier: 2.5s (00:15, bot, warm process cache) and 1.0s (09-08 04:04). MoonGamers cache-misses sit at 8–9s on the #26 path without paging.

Same window, not this page: bot `network-graph?depth=2` for `ANCHOA  [Girl_Panzer]` **53s** (TraceId `c72bed415aae0ce124808dfda2bd9cd9`). Leftover on `cursor/api-performance-and-exceptions-5e18`. Do not re-implement.

## Cause

PR #26 stopped scanning every session on the server, then still asked `PlayerSessions` for **all-time** ping / peak hour / last-played for those 200 names:

```sql
FROM PlayerSessions
WHERE ServerGuid = @serverGuid
  AND PlayerName IN (@p0, …, @p199)
  AND AveragePing IS NOT NULL
```

No `StartTime` / `LastSeenTime` bound. Regulars on RtR+SW have years of rows. After the 04:35 Recreate the process cache was empty, so each table lookup was a ~1.4ms volume round trip. The 1-hour Redis key from 00:15 had expired. EF does not log this hop, which is why the trace looks like "973ms then silence".

Candidate ranking summed **every** `PlayerServerStats` week, so veterans who have not played in years still occupied IN slots.

## Change

1. Rank candidates from the last 8 ISO weeks (`IX_PlayerServerStats` on `ServerGuid, Year, Week`).
2. Load ping / peak hour / last-played only for sessions with `LastSeenTime` in the last 28 days, so `IX_PlayerSessions_PlayerName_LastSeenTime` can range-scan.
3. Log the raw sessions query elapsed at Information so the next miss is visible in Seq.

No new `PlayerSessions` index and no pragma change. Orbit radius / peak hour now reflect recent play, which matches the widget (who is on this server around your ping *now*).

The empty-weekly fallback (brand-new server) uses the same 28-day bound.
