# Slow `GET /stats/rounds` — MapName `instr()` scan

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 21:54 UTC 2026-09-09.

## Trace

`GET /stats/rounds?page=1&pageSize=5&sortBy=startTime&sortOrder=desc&includeTopPlayers=true&serverGuid=42b98b-61f0b93-183a06c-49be6b0&mapName=battle+of+britain`

TraceId `72e3fbdaa09a593d6bdade855a12abe2`. HTTP 200, **13,464ms**. Firefox Android,
not a bot. Pod `bf42-stats-669dc67f9f-dgs59`. Caller is the server-map drill-in
(`MmRecentSessionsList`, limit 5).

| span | cost | SQL |
|---|---|---|
| COUNT | **13,440ms** | `SELECT COUNT(*) FROM Rounds WHERE ServerGuid = @g AND instr(MapName, @map) > 0` |
| page | 0ms | same filter + `ORDER BY StartTime DESC LIMIT 5` |
| top players | 3ms | `PlayerSessions` for the 5 round ids |

`ServerGuid` alone is cheap (same pod, 18:38 UTC: COUNT of two SiMPLE guids was
17ms). Adding `instr(MapName)` makes SQLite walk `Rounds` instead of
`IX_Rounds_MapName` / `(ServerGuid, StartTime)`. The page is then free because
the COUNT already faulted the pages in.

## Cause

`RoundsService` compiled `r.MapName.Contains(filter)` to `instr()`. That cannot
use `IX_Rounds_MapName`. On the Hetzner volume a full `Rounds` scan is tens of
seconds; COUNT does it even when the UI only wanted five recent rows.

Callers send the stored map name (data-explorer drill-in, sessions `mapName=`
query, tournament link panel), not a free-text fragment. Data explorer already
filters `MapName ==` on the aggregate tables.

## Change

Filter `Rounds.MapName` with equality, the same as `GameType`. Existing
`IX_Rounds_MapName` can serve COUNT. No new index and no pragma change.

Also: when resolving `serverName=`, prefer an exact `Servers.Name` match before
`Contains`. A full live name that is a prefix of another server produced
`ServerGuid IN (g1, g2) ORDER BY StartTime DESC` (18:38 UTC, **13,540ms** page)
which cannot use `(ServerGuid, StartTime)`.

Do not live-probe `/stats/rounds?...&mapName=` on a busy server until this is
the running image. After it is live, a still >=10s COUNT with `instr(MapName)`
is a new bug.
