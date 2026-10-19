# Slow `GET /stats/rounds` — GameId `instr(ServerGuid)` scan

Seq signal `bfstats/Slow as fuck (>= 10 seconds)`.

## Trace

Webhook DetectedAt 15:49:57Z and 15:51:57Z on 2026-10-19. Three overlapping
curl `GET /stats/rounds` on pod `bf42-stats-689c8c7b96-pznhc`. UA `curl/8.18.0`,
`is_bot=false`. Host `bfstats.io`. No hop log — PR #66 is not live.

| request | elapsed | COUNT | page | TraceId |
|---|---|---|---|---|
| `?page=1&pageSize=3` | **33.9s** | 667ms | **33,202ms** | `f4175b2d0a882cdf0a56b08fa9e7a349` |
| `?page=1&pageSize=3&gameId=bf1942` | **63.9s** | **3,375ms** `instr(ServerGuid)` | **60,440ms** | `6d8e224d5edada9378b3e60e5240ecc2` |
| `?page=1&pageSize=5&gameId=bf1942&gameType=conquest&isActive=false&minParticipants=16&startTimeFrom=2026-10-01T00:00:00` | **99.4s** | **45,032ms** `instr(ServerGuid)` | **54,356ms** | `6f3e96b2734195bff57c9dda7ef456df` |

The unfiltered call is leftover **PR #66** (`IX_Rounds_StartTime`). Collection
around the first two was ~4s. Hourly finished 15:51:14 (88835 / 105374ms) and
only overlapped the third COUNT.

## Cause

`RoundsService` compiled `r.ServerGuid.Contains(filters.GameId)` to `instr()`.
GameId is `GameServer.GameId` (mod id: `bf1942`, `fhsw`, `xpack2`). It is not a
substring of the guid, so the filter was both wrong and a full `Rounds` scan
on the Hetzner volume.

The same method already resolves `serverName` on the small `Servers` table
before touching `Rounds`. `ServerStatsService` already filters `s.GameId ==`.

## Change

Resolve `gameId` to server guids with `Servers.GameId ==`, then filter `Rounds`
by guid. Zero matches: empty page. One match: `ServerGuid = @g` so
`IX_Rounds_ServerGuid_StartTime` can serve the sorted page. Many matches: an
IN-list; COUNT stays on the guid index, the sorted page of an unselective
GameId still wants the global StartTime index from **PR #66**.

Hop log (only when `gameId` is set):

`Rounds listing gameId {GameId}: {TotalCount} rows in {ElapsedMs}ms (count {CountMs}ms, page {PageMs}ms)`

No new index and no pragma change. Do not re-implement **PR #66**.

**Do not live-probe** `GET /stats/rounds?...&gameId=` until a request emits
that hop log. After it is live, a still >=10s page whose new log shows `count`
still using `instr(ServerGuid)` is a new bug. A slow unfiltered / `minParticipants`
page with no hop log is leftover **#66**.
