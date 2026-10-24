# Slow `GET /stats/rounds` — substring `serverName` IN-list

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 06:53 UTC 2026-10-24.

## Trace

Three curls in one minute, `is_bot=false`, host `bfstats.io`, pod
`bf42-stats-685bc5c8b9-gbjzm`. Hourly incremental had already finished
(`Aggregate calculation: 102332 … in 87070ms` at 06:50:12). Collection cycles
around the requests were 2.5–4.3s.

| TraceId | URL | elapsed | slow hop |
|---|---|---|---|
| `358c4db5a6274e91f75333f8dfd7c79e` | exact `FHSW 0.81+…` + `mapName=rush_to_baghdad` | 14,124ms | leftover **PR #71** (COUNT 1ms, page 14,099ms) |
| `8d906760e58d7d8f0c756b9e0e213045` | `serverName=FHSW` | 18,894ms | COUNT 113ms, page **18,758ms** |
| `30d5210ea6aaa6bce9f9dfeeb2d2bcb4` | `serverName=SiMPLE` | 23,095ms | COUNT 115ms, page **22,973ms** |

The map request is leftover [PR #71](https://github.com/sila-skandia/bfstats/pull/71).
Do not re-implement that index here.

The two prefix searches resolved through `Servers.Name.Contains`, then:

```sql
WHERE "r"."ServerGuid" IN (@g1, …, @g10)
ORDER BY "r"."StartTime" DESC
LIMIT 5
```

## Cause

PR #24 moved the name lookup onto `Servers`. PR #42 collapses **exact**
duplicate names to one guid so the page can use `IX_Rounds_ServerGuid_StartTime`.
A short prefix (`FHSW`, `SiMPLE`) still matches many distinct live names.
`ServerGuid IN (… ) ORDER BY StartTime` cannot use that composite index:
SQLite COUNTs the IN-list from the B-tree in ~100ms, then materialises and
sorts every matching round for the page. On the Hetzner volume that sort is
19–23s. A single-guid listing of the same table is ~0.19s.

[slow-api-rounds-duplicate-name](../slow-api-rounds-duplicate-name/README.md)
already called this out: after #42 is live, a still-slow
`ServerGuid IN (@g1, @g2) ORDER BY StartTime` page is a new bug. Do not
re-add the exact-name-first path, and do not collapse distinct names to one
guid (that would hide every other FHSW community).

Not leftover PR #66 (global `StartTime` / `ParticipantCount`) and not
leftover PR #71 (single guid + map).

## Change

Keep the IN-list for COUNT. For the default StartTime page, seek each resolved
guid with equality (`ServerGuid = @g ORDER BY StartTime LIMIT page*pageSize`),
merge the short slices in memory, then skip/take. Ten index walks of five rows
replace one sort of every FHSW/SiMPLE round.

No new index and no pragma change.

Do not live-probe `/stats/rounds?...&serverName=FHSW` or `SiMPLE` until a
request emits `Rounds listing serverName {ServerName}: {TotalCount} rows in
{ElapsedMs}ms (count {CountMs}ms, page {PageMs}ms, guids {GuidCount})`.
A still >=10s exact `serverName` + `mapName` page is leftover **PR #71**.
