# Slow `GET /stats/liveservers/bf1942/servers`

Seq signal `bfstats/Slow as fuck (>= 10 seconds)`.

## Trace

Alert window 13:01:22Z–13:02:22Z on 2026-09-08. DetectedAt 13:02:52Z. Two origin hits, both Chrome, not bots, both HTTP 200:

| Time (UTC) | Elapsed | TraceId | What it waited on |
|---|---|---|---|
| 13:01:47–13:02:17 | **30,015ms** | `f6c2309d8aeb707d5d40cf061350d31b` | BFList hang, Polly 3x 8s attempt + 30s total timeout |
| 13:02:07–13:02:26 | **18,666ms** | `dcefcae903b1a611b9fbb35daf79bece` | per-game fetch lock, then circuit open |

`raw_servers:bf1942` missed in both Redis and memory. After the live poll failed, last-known-good was a **memory hit** (`raw_servers:bf1942:last_good`) and the Guid geo query was 0–1ms. The snapshot was already in process memory for the whole wait.

Concurrent `StatsCollection.Cycle` #255/#256 hit the same `api.bflist.io/v2/bf1942/servers` hang, opened the Polly circuit, and paged `bfstats/Exceptions`. Transient upstream; not a site bug.

## Cause

`FetchAllServersWithMetaAsync` already had last-known-good fallback, but it ran the live fetch first. On a hot-cache miss that means:

1. Take the per-game `SemaphoreSlim` shared with the stats collector.
2. Wait out `AddStandardResilienceHandler` (`AttemptTimeout` 8s, 3 retries, `TotalRequestTimeout` 30s).
3. Only then read last-good.

The landing page is supposed to degrade to "last known status, clearly stale". It did — after 30 seconds.

This is not a SQLite/volume problem. Cloudflare `s-maxage=30` had already expired, so both visitors paid origin latency.

## Change

On the read path, if the 30s hot key is empty and last-good exists, return it immediately (`IsFallback = true`) and do not call BFList. A live fetch still runs when there is no snapshot at all (cold start). `FetchAllServersAsync` (collector) is unchanged and still must not ingest a stale snapshot.

No pragma change, no new index, no memory-sized setting.
