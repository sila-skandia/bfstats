# Slow `GET /stats/rounds` — ServerGuid + MapName COUNT

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 01:38 UTC 2026-09-25.

## Trace

Two real Chrome (not bot) hits from the data-explorer server-map drill-in
(`MmRecentSessionsList`, pageSize 5) on `42b98b-61f0b93-183a06c-49be6b0`:

| When (UTC) | Map | Elapsed | HTTP | TraceId |
|---|---|---|---|---|
| 01:38:11 | battleaxe | **18,210ms** | 200 | `599f139f34af306e0e6e0170ad41e5a6` |
| 01:38:59 | midway | **18,345ms** | 200 | `f2afa8211a6625d4eef66557bbdf6d7c` |
| 01:39:08 | Berlin | 7,010ms | 200 | — |

Pod `bf42-stats-7fdc675f5-m7kjn`. No hourly/daily writer overlap. Rankings
recalc logged after 01:39:27. Collection cycle at 01:39:50.

| span | cost | SQL |
|---|---|---|
| COUNT | **18,183ms / 18,335ms / 2,257ms** | `SELECT COUNT(*) FROM Rounds WHERE ServerGuid = @g AND MapName = @m` |
| page | 0-2ms | same filter + `ORDER BY StartTime DESC LIMIT 5` |
| top players | 1-2ms | `PlayerSessions` for the 5 round ids |

PR #36 (MapName equality, no `instr()`) is the running image. This is not a
regression of that filter — the SQL is already `MapName = @m`.

## Cause

`IX_Rounds_MapName` and `(ServerGuid, StartTime)` exist. There is no
`(ServerGuid, MapName)` pair. COUNT with both equalities walks every round for
that server on `(ServerGuid, StartTime)` and heap-filters `MapName`. On the
Hetzner volume that is 2-18s for a busy server. The page query is free because
it can stop after five matches.

Same path as `features/slow-api-rounds-mapname/README.md`, after equality.

## Change

- `IX_Rounds_ServerGuid_MapName` so COUNT is an index-only range.
- Count before `ORDER BY`.
- Information hop log
  `Rounds listing count for {ServerGuid} map {MapName}: {TotalCount} rows in {ElapsedMs}ms`.

First start after migrate will be slow while SQLite builds the index. Do not
live-probe `/stats/rounds?...&serverGuid=42b98b-61f0b93-183a06c-49be6b0&mapName=`
until a request emits that log. After it is live, a still >=10s page whose log
shows the COUNT hop still >=10s is a new bug — do not re-add this index.

This is not leftover 8cc6 (global `minParticipants=1` COUNT) and not leftover
61d4 (map rankings COUNT).
