# Slow `GET /stats/rounds` — duplicate exact `serverName`

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 20:40 UTC 2026-09-10.

## Trace

`GET /stats/rounds?page=1&pageSize=25&sortBy=startTime&sortOrder=desc&includeTopPlayers=true&serverName=*NEW*+SiMPLE+%7C+BF1942`

Four HTTP 200s in one minute. Caller is the server sessions page (`MmSessionsPage` sends `serverName=` from the URL; the map drill-in already sends `serverGuid=`).

| TraceId | started | elapsed |
|---|---|---|
| `39a6f34f694de44da2e14103c7573f4a` | 20:38:53Z | **14,700ms** |
| `12a215e505518391f6314740689ba1c2` | 20:39:08Z | **12,216ms** |
| `e9c5a317bdbfd4233ac31614b6711859` | 20:39:08Z | **12,217ms** |
| `f63371f2e64dc0bf1f5e1e954ef556e2` | 20:39:08Z | **12,211ms** |

First request:

| span | cost | SQL |
|---|---|---|
| resolve name | 2ms | `SELECT Guid FROM Servers WHERE Name = @serverName` |
| COUNT | **23ms** | `SELECT COUNT(*) FROM Rounds WHERE ServerGuid IN (@g1, @g2)` |
| page | **14,650ms** | same `IN` + `ORDER BY StartTime DESC LIMIT 25` + join `Servers` |
| top players | 2ms | `PlayerSessions` for the 25 round ids |

PR #24 (name to guid) and PR #36 (exact name before `Contains`) are the running image: there is no `instr(ServerName)` and no prefix match on `*NEW* SiMPLE | BF1942 RtR+SW`. Live bflist still has a single `*NEW* SiMPLE | BF1942` (`42b98b-61f0b93-183a06c-49be6b0`). The second guid is a leftover `Servers` row with the same exact name.

## Cause

`ServerGuid IN (g1, g2) ORDER BY StartTime DESC` cannot use `IX_Rounds_ServerGuid_StartTime`. SQLite can COUNT the IN-list from the index in ~20ms, then has to materialise and sort both servers' rounds for the page. On the Hetzner volume that sort is 12-14s. A single-guid listing of the same table is ~0.19s.

## Change

When more than one `Servers` row has that exact name, keep the live / most-populated / most-recent guid and filter `Rounds.ServerGuid = @g`. Equality walks the composite index backwards and stops after `pageSize` rows. Same-name leftovers belong in an admin merge; `serverGuid=` still lists a specific guid.

No new index and no pragma change.

Do not live-probe `/stats/rounds?...&serverName=*NEW*+SiMPLE` on this server until this is the running image. After it is live, a still >=10s page whose SQL is `ServerGuid IN (@g1, @g2) ORDER BY StartTime` is a new bug — do not re-add the exact-name-first path.
