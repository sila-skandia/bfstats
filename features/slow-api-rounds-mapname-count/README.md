# Slow `GET /stats/rounds` — ServerGuid + MapName COUNT

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 01:40 UTC 2026-09-25.

## Trace

Two real Chrome requests on `bf42-stats-7fdc675f5-m7kjn`, same SiMPLE guid,
`MmRecentSessionsList` map drill-in (`pageSize=5`, `includeTopPlayers=true`):

| When (UTC) | Map | HTTP | COUNT | page | TraceId |
|---|---|---|---|---|---|
| 01:38:11 | battleaxe | 200 / 18.2s | **18,183ms** | 0ms | `599f139f34af306e0e6e0170ad41e5a6` |
| 01:38:59 | midway | 200 / 18.3s | **18,335ms** | 1ms | `f2afa8211a6625d4eef66557bbdf6d7c` |
| 01:39:13 | Berlin | 200 / 7.0s | **2,257ms** | 2ms | — |

SQL (PR #36 equality, not leftover `instr()`):

```sql
SELECT COUNT(*)
FROM "Rounds" AS "r"
WHERE "r"."ServerGuid" = @filters_ServerGuid AND "r"."MapName" = @filters_MapName
```

No hourly/daily writer overlap. Collection cycles around the window were normal.
Ranking output starts after 01:40.

## Cause

PR #36 switched `MapName.Contains` to equality so COUNT could use
`IX_Rounds_MapName`. That index looks selective (dozens of map names) but
popular maps are huge. The planner picks it, walks every worldwide
battleaxe/midway row, and heap-fetches `ServerGuid` on the volume.

`IX_Rounds_ServerGuid_StartTime` already makes the `LIMIT 5` page free
(0–2ms). ServerGuid-only COUNT is also cheap. Adding `MapName` is what
makes the planner abandon that index.

This is not leftover 8cc6 (global `minParticipants=1` COUNT).

## Change

- Composite index `IX_Rounds_ServerGuid_MapName`.
- Count before `OrderBy`.
- Information hop log
  `Rounds listing count: {TotalCount} rows in {ElapsedMs}ms (serverGuid …, mapName …)`.

First start after migrate will spend time building the index on Rounds.
Do not live-probe
`/stats/rounds?...&serverGuid=42b98b-61f0b93-183a06c-49be6b0&mapName=`
until a request emits the new log. After it is live, a still >=10s page
whose log shows this COUNT still >=10s is a new bug — do not re-add
`instr()` and do not re-implement 8cc6.
