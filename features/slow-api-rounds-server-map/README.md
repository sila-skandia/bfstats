# Slow `GET /stats/rounds` — ServerGuid+MapName StartTime page

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 21:59 UTC 2026-10-18.

## Trace

`GET /stats/rounds?page=1&pageSize=25&sortBy=startTime&sortOrder=desc&includeTopPlayers=true&onlySpecifiedPlayers=false&serverName=*ATF%27s+Hump%27em+%26+Dump%27em&mapName=OPERATION+LUCKY`

TraceId `82a22d84c60fd187dd824dbae5d5b8c6`. HTTP 200, **22,787ms**. Opera/Chrome
Windows, not a bot. Host `bfstats.io`. Pod `bf42-stats-5ccdb46585-zvw5f`.
Request started 21:58:36Z.

| span | cost | SQL |
|---|---|---|
| resolve name | 1ms | `SELECT Guid FROM Servers WHERE Name = @serverName` |
| COUNT | **6ms** | `SELECT COUNT(*) FROM Rounds WHERE ServerGuid = @g AND MapName = @m` |
| page | **22,751ms** | same filter + `ORDER BY StartTime DESC LIMIT 25` + Servers join |
| top players | 0ms | (folded into remaining ~28ms) |

Same server without `mapName=`, two minutes earlier: **9ms** (COUNT 2ms, page
0ms). Collection #4670 at 21:57:57 was 80 / 3,837ms. No hourly overlap.

PR #36 equality is live — COUNT has no `instr(MapName)`. Closed PR #46 indexed
`(ServerGuid, MapName)` for a COUNT that was 18s on a different server and
never landed. This page's COUNT is already cheap; the ORDER BY hop is not.

## Cause

`IX_Rounds_ServerGuid_StartTime` satisfies `ORDER BY StartTime DESC LIMIT 25`
and the guid filter, but not `MapName`. SQLite walks that server's rounds
newest-first and heap-filters the map until it has 25 matches. On the Hetzner
volume each miss is a random table fetch. A map that is rare (or old) on a
busy server turns that walk into tens of seconds. COUNT of the same equality
stays on `IX_Rounds_MapName` and finishes in milliseconds.

## Change

- `IX_Rounds_ServerGuid_MapName_StartTime` so the LIMIT 25 walk is only that
  server+map slice. Left prefix also serves COUNT.
- Count before applying ORDER BY.
- Information hop: `Rounds listing minParticipants {MinParticipants} serverGuid {ServerGuid} map {MapName}: {TotalCount} rows in {ElapsedMs}ms (count {CountMs}ms, page {PageMs}ms)`.

No pragma change. First start after migrate builds the index.

Do not live-probe `GET /stats/rounds?...&mapName=` on a busy server until a
request emits that hop. After it is live, a still >=10s page whose new log
shows `page` still >=10s is a new bug — do not re-add this index. A slow page
with no new log is the old image.

Do not reopen closed PR #46 or PR #47. This is not leftover PR #66 (global
`minParticipants` COUNT + `StartTime`).
