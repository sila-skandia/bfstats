# Seq Exceptions: stats collection MemoryCache dispose on Recreate

Webhook: `bfstats/Exceptions` at 2026-09-10 05:18:09Z.
Window 05:07:39Z–05:17:39Z.
TraceId `2b8a7ddd1683051b632aaa3b4ddda016`.

## What fired

`StatsCollectionBackgroundService` `LogError(ex)` plus an OpenTelemetry
`StatsCollection.Cycle` ERROR span:

`ObjectDisposedException: Cannot access a disposed object.
Object name: 'Microsoft.Extensions.Caching.Memory.MemoryCache'.`

at `BfListApiService.GetSnapshotAsync` line 188 (`memoryCache.TryGetValue`),
called from `FetchAllServersAsync` during collection cycle **#90**.

Pod `bf42-stats-86f74dd45c-792kl`. Same millisecond the other hosted
services logged a clean stop:

| Time (UTC) | Event |
| --- | --- |
| 05:15:18.239 | Community Detection Service stopped |
| 05:15:18.241 | Gamification / wrapped / weekly / daily stopped |
| 05:15:18.243 | Ranking stopped; `Stats collection service stopping` |
| 05:15:18.524 | Cycle #90 `LogError(ex)` on disposed MemoryCache |
| 05:15:56.059 | `bf42-stats-644cb8f99f-hmgml` Application started |

Liveservers on the dying pod was still 200 at 05:15:10 (7ms, last-good
memory hit). New pod was up 38s later. Not a user-facing outage.

## Why StopAsync did not save it

Collection is `IHostedService` + `Timer` + `async void`, not a
`BackgroundService`. `StopAsync` stopped the timer and returned
`Task.CompletedTask` without waiting for the in-flight cycle. The host
then disposed the singleton `IMemoryCache`. Cycle #90 was still inside
`GetSnapshotAsync`.

Ranking / aggregate / gamification already treat host cancellation as a
stop (PR #20). Collection did not, and the exception is
`ObjectDisposedException` rather than `OperationCanceledException`.

## Fix

1. Cancel a stop token and **wait** for the in-flight cycle in `StopAsync`
   so `IMemoryCache` is still alive for a normal finish.
2. If the host timeout wins and L1 is already gone, log Information
   without `ex` (same Seq-signal rule as SQLITE_BUSY retries). Unexpected
   dispose while the host is not stopping still `LogError(ex)`.
3. Treat a disposed `IMemoryCache` as a miss in `BfListApiService` so
   Redis / last-good can still serve a request that arrives during teardown.

Do not add a Serilog exclude for this.
