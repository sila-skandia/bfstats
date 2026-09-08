# Slow single-server liveservers + banner tickets during BFList hang

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 13:49 UTC on 2026-09-08.

PR #30 already serves last-good for `GET /stats/liveservers/{game}/servers` before
touching BFList. The single-server poll and banner tickets still waited on Polly.

## What paged

Same MoonGamers visit, DetectedOverRange 13:46:24–13:48:24Z. Not bots.

| Time (UTC) | Path | Elapsed | Status |
|---|---|---|---|
| 13:47:22 | `GET /stats/liveservers/bf1942/51.81.48.224/14567` | **18.8s** | **500** |
| 13:47:24 | `GET /stats/servers/MoonGamers.com \| Est. 2004/banner.png` | **21.7s** | 200 |

Three minutes earlier, same shape on SiMPLE (`37.187.92.162:14567`): liveservers
**18.9s** 500, banner **27.6s** 200.

BFList `api.bflist.io` hung on TLS (`SocketException 125` / Polly 8s attempt timeout).
Circuit opened after two timeouts. New ReplicaSet `bf42-stats-5d749cb54d` (PR #30) was
already running; the list endpoint served last-good in tens of milliseconds.

## Banner (TraceId `378593b21132d253d054a792e41ef014`)

| span | cost |
|---|---|
| `Servers` by name | 2ms |
| `SELECT MapName, GameType FROM Rounds WHERE ServerGuid AND IsActive LIMIT 1` | **12,017ms** |
| `TryGetCachedServerByName` hot `raw_servers:bf1942` | miss |
| BFList `GET .../servers/51.81.48.224:14567` | **~8.7s** (1× 8s timeout, then circuit open) |

Tickets are best-effort (`LogWarning`, PNG still 200). The 12s `Rounds` LIMIT 1 is the
leftover on **PR #21** / `cursor/api-performance-and-exceptions-b691`. Do not re-implement
that here.

## Liveservers single-server (TraceId `2dcb72c9e8d1fc1fc2ab36dd2622985c`)

`FetchSingleServerSummaryAsync` 8s cache miss → `FetchSingleServerAsync` → Polly 8s +
retry 8s + circuit open. `LiveServersController.GetServer` caught `BrokenCircuitException`
as unexpected and returned **500**. `HttpRequestException` was the only swallowed
upstream failure; Polly is not that type.

## Change

1. `TryGetCachedServerByNameAsync` and `FetchSingleServerSummaryAsync` read the hot
   snapshot, then last-good, and return a match without calling BFList.
2. `FetchSingleServerAsync` treats any upstream exception (Polly timeout / open circuit)
   as "not listed" so an unknown IP degrades to null / 404 instead of a 500.

No new index and no pragma change. Collector path (`FetchAllServersAsync`) is unchanged.
