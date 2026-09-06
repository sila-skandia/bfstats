# Slow `GET /stats/rounds` — ServerName `instr()` scan

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 2026-09-06 09:32:51Z.

## Trace

`GET /stats/rounds?page=1&pageSize=25&sortBy=startTime&sortOrder=desc&includeTopPlayers=true&serverName=MoonGamers.com+|Est.+2004`

TraceId `07743645c00b69a5a522a82136d49963`. Bot (`is_bot=true`), HTTP 200, **61.7s**.

| span | cost | SQL |
|---|---|---|
| COUNT | **31,538ms** | `SELECT COUNT(*) FROM Rounds WHERE instr(ServerName, @name) > 0` |
| page | **30,107ms** | same `instr` + `ORDER BY StartTime DESC LIMIT 25` |
| top players | 1ms | `PlayerSessions` for the 25 round ids |

Same shape on 2026-09-05 22:28 for `*NEW* SiMPLE | BF1942` (COUNT 37s). This path has been 6–55s for many exact server names since at least 09-03.

## Cause

`RoundsService` compiled `r.ServerName.Contains(filter)` to `instr()`. That cannot use `IX_Rounds (ServerGuid, StartTime)`. On the Hetzner volume a full `Rounds` scan is tens of seconds; doing it twice (count + page) doubled it.

Callers send the current full server name (sessions page, crawlers), not a free-text fragment of historical `Rounds.ServerName`.

## Change

Resolve the name on the small `Servers` table, then filter `Rounds` by `ServerGuid` so the existing `(ServerGuid, StartTime)` index serves both COUNT and the sorted page.

If no current server matches, return an empty page. That avoids a fallback scan for typos / unknown names. Historical name-only search (name on `Rounds` but not on `Servers`) is no longer supported; the UI and bots use the live name.

No new index and no pragma change — those are the settings that have taken this node down before.
