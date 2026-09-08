# Slow `GET /stats/liveservers/bf1942/servers` — BFList timeout on the request path

Seq signal `bfstats/Slow as fuck (>= 10 seconds)`.

## Trace

Two landing-page polls from the same visitor, HTTP 200, while `api.bflist.io` was timing out.

| Time (UTC) | Elapsed | TraceId | What happened |
|---|---|---|---|
| 09-08 13:01:47–13:02:17 | **30,015ms** | `f6c2309d8aeb707d5d40cf061350d31b` | Hot cache miss, Polly 8s attempt x3 then 30s total timeout, then last-known-good |
| 09-08 13:02:07–13:02:26 | **18,666ms** | `dcefcae903b1a611b9fbb35daf79bece` | Hot cache miss, waited on the per-game fetch lock, circuit open, last-known-good |

SQLite Guid lookup after fallback: 0–1ms. Not a volume / index issue.

Same window, not this page: stats-collection cycles #256–#260 `LogError` with `BrokenCircuitException` (Exceptions signal at 13:02). Transient upstream; collector must not ingest last-good. The 12:03 `network-graph?depth=2` 16.8s is the leftover on `cursor/api-performance-and-exceptions-5e18`.

## Cause

`FetchAllServersWithMetaAsync` already had a last-known-good snapshot (`raw_servers:{game}:last_good`, 24h). It only consulted it **after** `FetchAndCacheServersAsync` failed.

That fetch takes a static per-game `SemaphoreSlim` shared with the stats collector, then waits on the BFList HttpClient's standard resilience handler:

- attempt timeout 8s, 3 retries, total 30s
- circuit breaker 15s break

So a landing-page request on a 30s hot-cache miss paid the full Polly budget, and a second request queued behind the same lock (held by the first request and/or the collector's own 8s attempts). Last-good was in memory the whole time.

## Change

On a hot-cache miss, the read path returns last-good immediately and does not take the fetch lock.

- Last-good younger than 90s (matches `LiveServersController.StaleDataThreshold`) is returned as-is — a just-expired hot hit, no stale banner.
- Older last-good is returned as `IsFallback = true` so Cloudflare does not edge-cache it.
- No last-good anywhere: still wait on a live fetch (cold start).
- `FetchAllServersAsync` (collector) is unchanged — it never reads last-good.

The collector remains the live refresher. No new index, pragma, or memory limit.
