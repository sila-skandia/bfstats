# Slow `GET /stats/relationships/servers/{guid}/proximity` — unbounded history

Seq signal `bfstats/Slow as fuck (>= 10 seconds)`.

## Trace

`GET /stats/relationships/servers/7b3a63-12e36b3-6dac2c-8c0a76c/proximity?minPing=0&maxPing=250&limit=50`

TraceId `0c921814e76eed1b5afe64917783291f` at 2026-09-10 04:06:20–32Z. HTTP 200, **12.0s**. Not a bot. Firefox. Server is `MoonGamers.com | Est. 2004`. Pod `bf42-stats-7846d8b758-q9jlk` (PR #26 live: first hop is `PlayerServerStats` GROUP BY PlayerName).

| span | cost | notes |
|---|---|---|
| `PlayerServerStats` top 200 | **4,648ms** | EF `CommandExecuted` — all-time weeks |
| `PlayerSessions` named lookup | **~7.3s** | raw ADO.NET — Seq never logs it |
| HTTP total | **11,971ms** | 200 |

Same GUID cache-misses over the previous 48 hours sit at 6–10s; Redis hits are 2ms. Ranking for this GUID wrote **1,103** `ServerPlayerRankings` at 03:55 — a busy server with years of `PlayerSessions` rows per regular.

Daily aggregate refresh (Neo4j sync) was still running across 04:06, which inflated the first hop versus a quiet miss. It is not the cause: MoonGamers misses page at 7–9s on an idle volume too.

PR #35 (`cursor/api-performance-and-exceptions-999e`) already diagnosed this on SiMPLE RtR+SW (17.7s, ~16s unlogged sessions hop) and was closed unmerged (745-file branch, E2E failed). This change is that fix on a clean branch.

## Cause

PR #26 stopped scanning every session on the server, then still asked `PlayerSessions` for **all-time** ping / peak hour / last-played for those 200 names:

```sql
FROM PlayerSessions
WHERE ServerGuid = @serverGuid
  AND PlayerName IN (@p0, …, @p199)
  AND AveragePing IS NOT NULL
```

No `StartTime` / `LastSeenTime` bound. Regulars on MoonGamers have years of rows. After the 1-hour Redis key expires, each table lookup is a ~1.4ms volume round trip. EF does not log this hop, which is why the trace looks like "4.6s then silence".

Candidate ranking summed **every** `PlayerServerStats` week, so veterans who have not played in years still occupied IN slots.

## Change

1. Rank candidates from the last 8 ISO weeks (`IX_PlayerServerStats_ServerGuid_Year_Week`).
2. Load ping / peak hour / last-played only for sessions with `LastSeenTime` in the last 28 days, so `IX_PlayerSessions_PlayerName_LastSeenTime` can range-scan.
3. Log the raw sessions query elapsed at Information so the next miss is visible in Seq.

No new `PlayerSessions` index and no pragma change. Orbit radius / peak hour now reflect recent play, which matches the widget (who is on this server around your ping *now*).

The empty-weekly fallback (brand-new server) uses the same 28-day bound.
