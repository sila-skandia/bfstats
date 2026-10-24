# Slow `GET /stats/rounds` — partial `serverName` IN-list page

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 06:53 UTC 2026-10-24.

## Traces

Two HTTP 200s from `curl` (`is_bot=false`) after the 06:50 hourly finished
(102332 / 87070ms). Collection cycles in the window were 2.5–4.3s. Not a
writer lock.

| TraceId | started | query | elapsed |
|---|---|---|---|
| `8d906760e58d7d8f0c756b9e0e213045` | 06:52:22Z | `serverName=FHSW` | **18,894ms** |
| `30d5210ea6aaa6bce9f9dfeeb2d2bcb4` | 06:52:42Z | `serverName=SiMPLE` | **23,095ms** |

`SiMPLE` first request:

| span | cost | SQL |
|---|---|---|
| exact name | 1ms | `SELECT Guid FROM Servers WHERE Name = @serverName` |
| substring | 0ms | `SELECT Guid FROM Servers WHERE instr(Name, @serverName) > 0` |
| COUNT | **115ms** | `SELECT COUNT(*) FROM Rounds WHERE ServerGuid IN (@g1..@g10)` |
| page | **22,973ms** | same `IN` + `ORDER BY StartTime DESC LIMIT 5` + join `Servers` |

Ten current `Servers` rows contain each fragment. There is no
`instr(Rounds.ServerName)` — PR #24 / #36 / #42 are live. The page is the
IN-list plan those PRs already documented for exact duplicate names.

A third request in the same minute
(`serverName=FHSW 0.81+FHSWeu0.84 ! UPDATE !&mapName=rush_to_baghdad`,
TraceId `358c4db5a6274e91f75333f8dfd7c79e`, COUNT 1ms, page **14,099ms**)
is leftover **PR #71** (equality on ServerGuid+MapName, no
`(ServerGuid, MapName, StartTime)`). Do not re-implement that index here.

## Cause

PR #42 collapses exact duplicate `Servers.Name` rows to one guid so
`ServerGuid = @g ORDER BY StartTime DESC` can walk
`IX_Rounds_ServerGuid_StartTime` and stop after `pageSize` rows.
`ServerGuid IN (...) ORDER BY StartTime` cannot use that index: COUNT is
cheap (~20–115ms from the B-tree), the page materialises and sorts every
matching server's rounds (~12–23s on the Hetzner volume).

The `Contains` fallback still emitted that IN-list when a short fragment
hit more than one current name. Sessions-page callers send the live full
name (exact path). A fragment is the leftover multi-guid plan.

## Change

When more than one current server matches the substring, keep the live /
most-populated / most-recent guid and filter `Rounds.ServerGuid = @g`,
the same collapse as an exact duplicate. `serverGuid=` still lists a
specific guid. A single substring match is unchanged.

Information hop for the next page:
`Rounds listing serverName {ServerName}: {TotalCount} rows in {ElapsedMs}ms (count {CountMs}ms, page {PageMs}ms)`.

No new index and no pragma change.

Do not live-probe `/stats/rounds?...&serverName=SiMPLE` or `serverName=FHSW`
until a request emits that hop. After it is live, a still >=10s page whose
SQL is `ServerGuid IN (...) ORDER BY StartTime` is a new bug — do not
re-add the IN-list fallback. A still-slow exact name + `mapName=` page
without this hop is leftover **PR #71**.
