# Seq `bfstats/Exceptions` — ranking shutdown cancellation

## 2026-09-07 10:02 UTC page

Webhook: `Level=Error`, `Message=Alert condition triggered by bfstats/Exceptions`.

Newest `@Exception is not null`:

- 10:02:32 UTC, TraceId `09b1e143bcf38468975e589da4532505`
- `RankingCalculationService` `Error calculating rankings`
- `TaskCanceledException: A task was canceled.` at
  `CalculateRankingsForAllServers` line 114 (`Task.Delay(50, stoppingToken)`)
- Cycle had run 20,345ms and finished 11 servers before the host stopped

Same host stopped other jobs cleanly at the same millisecond
(`Community Detection Service stopped`, `WeeklyCleanupJob stopped`,
`DailyAggregateRefreshJob stopped`, `Stats collection service stopping`).
Those jobs already catch `OperationCanceledException` when
`stoppingToken.IsCancellationRequested`. Ranking did not, so shutdown
became a Seq Error span (`RankingCalculation.Cycle` status Error).

Live site after the bounce: homepage 200, liveservers 200, `lastUpdated`
10:04:35, 93 BF1942 servers. Not a user-facing outage and not SQLITE_BUSY.

## Why the host stopped

ReplicaSet churn around the page:

| Time (UTC) | Pod |
| --- | --- |
| 09:59:12 | `bf42-stats-6b4d7c9b65-86wk7` started (ranking's 3-minute delay → first cycle ~10:02:12) |
| 10:02:32 | 86wk7 shutting down; ranking `LogError(ex)` |
| 10:03:07 | `bf42-stats-845c9c67d5-2sttn` started (new pod template hash) |
| 10:04:24 | `bf42-stats-6b4d7c9b65-4788t` started (previous hash again) |

A rolling restart cancelled the in-flight ranking cycle. Previous
identical page: 2026-09-05 01:47:45 UTC, same `TaskCanceledException`.

## Fix

Treat host cancellation as a stop, not a ranking failure — same pattern as
`WeeklyCleanupJob` / `DailyAggregateRefreshBackgroundService` /
`CommunityDetectionService`:

- `RankingCalculationService` (the pager)
- `AggregateCalculationService` (same `Task.Delay(..., stoppingToken)` hole)
- `GamificationBackgroundService` (same outer `catch (Exception ex)` hole)

Per-server ranking errors still `LogError(ex)`. Shutdown cancellation
rethrows from the inner loop and breaks the outer cycle without attaching
`@Exception`.
