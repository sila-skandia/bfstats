# Seq: single-server liveservers waits on BFList then 500s

Webhook: `bfstats/Slow as fuck (>= 10 seconds)` at 2026-09-08 13:47:54Z
(window 13:46:24Z–13:47:24Z). A sibling Slow at 13:44:53Z is the same shape.

PR #30 already serves last-known-good for `GET /stats/liveservers/{game}/servers`
without waiting on BFList. The per-server route does not.

## What fired

| TraceId | Route | HTTP | Elapsed | Pod |
| --- | --- | --- | --- | --- |
| `2dcb72c9e8d1fc1fc2ab36dd2622985c` | `GET /stats/liveservers/bf1942/51.81.48.224/14567` | 500 | 18,769ms | `bf42-stats-549697b4dd` |
| `dfd8943f4d7c9c7478593753c7f5d10f` | `GET /stats/liveservers/bf1942/37.187.92.162/14567` | 500 | 18,889ms | `bf42-stats-5d749cb54d` |

Both are human Chrome (not bots). SQLite is not on this path.

Same visit as the 13:47 500: MoonGamers `banner.png` (TraceId
`378593b21132d253d054a792e41ef014`, 21.7s, HTTP 200) spent 12,017ms on
`Rounds WHERE ServerGuid AND IsActive LIMIT 1` (PR #21 leftover) then ~8.7s
on BFList tickets after `TryGetCachedServerByNameAsync` missed the empty
post-Recreate hot cache.

## Why it 500d

`FetchSingleServerSummaryAsync` cache-misses to
`https://api.bflist.io/v2/{game}/servers/{ip}:{port}`. Polly's 8s attempt
timeout fires twice, the circuit opens, and `BrokenCircuitException` is not
`HttpRequestException`, so `LiveServersController.GetServer` logs Error and
returns 500.

Last-good for the list was already in Redis (24h). The list path used it;
this path did not look.

## Fix

On a single-server cache miss, peek the hot then last-good list snapshot by
IP:port and return that. If the snapshot exists but does not list this
server, skip BFList (it would 404 anyway). Live fetch only when no snapshot
exists, and transport / Polly failures become a miss instead of a throw.

`TryGetCachedServerByNameAsync` peeks last-good too, so banner tickets after
a Recreate do not fall through to the same hang.
