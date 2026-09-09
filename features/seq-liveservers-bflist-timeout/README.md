# Seq: liveservers waits 30s on BFList before using last-known-good

Webhook: `bfstats/Exceptions` at 2026-09-08 13:02:40Z (Slow signal also fired 12s later).

## What fired

Hot cache miss on `GET /stats/liveservers/bf1942/servers`. Polly retried
`https://api.bflist.io/v2/bf1942/servers?perPage=100` against an 8s attempt /
30s total timeout. `TimeoutRejectedException` matches `@Exception is not null`.

| TraceId | HTTP | Elapsed | What happened |
| --- | --- | --- | --- |
| `f6c2309d8aeb707d5d40cf061350d31b` | 200 | 30,015ms | Live fetch timed out; last-good was already in memory |
| `dcefcae903b1a611b9fbb35daf79bece` | 200 | 18,666ms | Waited on the per-game fetch lock, then open circuit |

SQLite geo lookup after fallback was 0–1ms. Not a volume / ranking issue.
Site recovered: liveservers 200 in 0.28s.

## Why it waited

`FetchAllServersWithMetaAsync` only read last-known-good *after* the live
fetch failed. Concurrent landing-page requests share one upstream call via
`SemaphoreSlim`, so they wait the full 30s too. Last-good exists specifically
so the homepage stays up during a BFList outage; blocking on that outage first
defeats it.

The collector (`FetchAllServersAsync`) still fetches live and does not fall
back — session tracking must not ingest a stale snapshot.

## Fix

On the read path, if the hot key misses, return last-good immediately. Live
fetch only when no snapshot exists at all.

Last-good younger than 90s (same grace as `LiveServersController.StaleDataThreshold`)
is returned as a live hit. Older copies set `IsFallback` so the landing page
disables Cloudflare cache.
