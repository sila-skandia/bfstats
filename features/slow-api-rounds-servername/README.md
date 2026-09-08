# Slow `GET /stats/rounds` — ServerName `instr()` scan

Seq signal `bfstats/Slow as fuck (>= 10 seconds)`. Recurring on live main because
the ServerGuid rewrite was written on 1444 / 7ac4 / 7852 / 023c and never merged.

## Traces

`GET /stats/rounds?page=1&pageSize=25&sortBy=startTime&sortOrder=desc&includeTopPlayers=true&serverName=*NEW*+SiMPLE+%7C+BF1942`

TraceId `a3a39e151bb6fc91ab277d8f23c2fdb3` at 2026-09-06 13:26:41–17Z. HTTP 200, **35.7s**.
StatsCollection.Cycle (4.1s) finished at 13:27:19 — overlapped the tail, not the cause.

| span | cost | SQL |
|---|---|---|
| COUNT | **35,217ms** | `SELECT COUNT(*) FROM Rounds WHERE instr(ServerName, @name) > 0` |
| page | **348ms** | same `instr` + `ORDER BY StartTime DESC LIMIT 25` |
| top players | 2ms | `PlayerSessions` for the 25 round ids |

The page is cheap when the server has recent rounds (StartTime DESC can stop after 25
matches). COUNT still walks the whole table.

Same path at 09:32:51Z for `MoonGamers.com+|Est.+2004` (TraceId
`07743645c00b69a5a522a82136d49963`, **61.7s**, COUNT 31.5s + page 30.1s) and on
2026-09-05 22:28 for `*NEW* SiMPLE | BF1942` (COUNT 37s). 6–55s since at least 09-03.

## Cause

`RoundsService` compiled `r.ServerName.Contains(filter)` to `instr()`. That cannot use `IX_Rounds (ServerGuid, StartTime)`. On the Hetzner volume a full `Rounds` scan is tens of seconds; doing it twice (count + page) doubled it.

Callers send the current full server name (sessions page, crawlers), not a free-text fragment of historical `Rounds.ServerName`.

## Change

Resolve the name on the small `Servers` table, then filter `Rounds` by `ServerGuid` so the existing `(ServerGuid, StartTime)` index serves both COUNT and the sorted page.

If no current server matches, return an empty page. That avoids a fallback scan for typos / unknown names. Historical name-only search (name on `Rounds` but not on `Servers`) is no longer supported; the UI and bots use the live name.

No new index and no pragma change — those are the settings that have taken this node down before.
