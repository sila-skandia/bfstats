# Slow `GET /stats/rounds` — GameId `instr(ServerGuid)` scan

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 15:49 UTC 2026-10-19.

## Traces

Overlapping curl `GET /stats/rounds` on pod `bf42-stats-689c8c7b96-pznhc`, host
`bfstats.io`, UA curl/8.18.0, `is_bot=false`. No `Rounds listing minParticipants`
hop log — leftover [PR #66](https://github.com/sila-skandia/bfstats/pull/66) is
not live. The `gameId=` calls are a second bug on the same path.

| request | elapsed | COUNT | page `ORDER BY StartTime DESC LIMIT` | TraceId |
|---|---|---|---|---|
| `?page=1&pageSize=3&gameId=bf1942` | **63,870ms** | 3,375ms `instr(ServerGuid)` | **60,440ms** | `6d8e224d5edada9378b3e60e5240ecc2` |
| `?page=1&pageSize=3` | **33,895ms** | 667ms unfiltered | **33,202ms** | `f4175b2d0a882cdf0a56b08fa9e7a349` |
| `?page=1&pageSize=5&gameId=bf1942&gameType=conquest&isActive=false&minParticipants=16&startTimeFrom=2026-10-01` | **99,412ms** | 45,032ms | **54,356ms** | `6f3e96b2734195bff57c9dda7ef456df` |

The unfiltered page is leftover #66 (no global `IX_Rounds_StartTime`). Ranking
finished 15:42:49. Collection around the first two was ~3.9s. Hourly incremental
finished 15:51:14 (88835 / 105374ms) and overlapped only the third request.

`game=` on the 16:55Z 10-13 leftover was ignored (`GetRounds` binds `gameId`).
This page sent `gameId=bf1942`, which applied.

## Cause

`RoundsService` compiled `r.ServerGuid.Contains(filters.GameId)` to
`instr("r"."ServerGuid", @filters_GameId) > 0`. Game ids (`bf1942`, `fhsw`) are
not substrings of `ServerGuid`. The filter is wrong, and `instr()` cannot use
`IX_Rounds_StartTime` or `(ServerGuid, StartTime)`, so SQLite walks `Rounds` on
the Hetzner volume. COUNT of that predicate was 3.3s; the LIMIT 3 page was 60s
because it also had to heap-filter until it found matches (or exhaust the table).

The DTO already loads `GameId` from `GameServer.GameId`. The filter never used
that column.

## Change

Filter `r.GameServer.GameId == filters.GameId`. That is a join to the small
`Servers` table (PK `Guid`) instead of `instr` on every `Rounds` row. Same
pattern as MapName equality and serverName-to-guid. No new index and no pragma
change.

Information hop `Rounds listing gameId {GameId}: {TotalCount} rows in {ElapsedMs}ms
(count {CountMs}ms, page {PageMs}ms)` so the next page can tell old image from
this one. Distinct from #66's `Rounds listing minParticipants` log.

Do not live-probe `/stats/rounds?...&gameId=` until a request emits that hop log.
After it is live, a still >=10s page whose new log shows `page` still >=10s on
an unscoped `gameId=bf1942` listing is leftover #66 (almost every round is
bf1942, so the page still needs `IX_Rounds_StartTime`). A slow page with no new
log is the old image. A slow page whose log still shows `instr(ServerGuid)` is
a new bug — do not re-add this join.

This does not replace #66. Unfiltered `/stats/rounds` is still that leftover.
