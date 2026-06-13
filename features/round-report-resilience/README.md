# Round report resilience

Hardening after the June 2026 zombie-loop incident: requests to
`/stats/rounds/{id}/report` for a corrupt round pinned three CPU cores for
hours and indirectly blanked live player counts site-wide.

## Incident summary (2026-06-11)

- Round `dc6659fb35e806ac8a9a` (*NEW* SiMPLE | Tanks a lot!) had been left
  `IsActive = 1` with no `EndTime` since 2025-09-03 — an orphan from a
  server-GUID merge that predated the merge service's close-active-rounds step.
- `GetRoundReport` built leaderboard snapshots in a `while` loop, one iteration
  per minute from `StartTime` to `EndTime ?? now` — 405,000 iterations for this
  round — and each iteration re-filtered, re-grouped, and re-sorted the entire
  observation list (O(minutes × observations)).
- The loop took no cancellation token, so when browsers gave up, the work kept
  running. Repeated user retries through the day accumulated nine immortal
  loops ≈ 3 saturated cores (load avg 9.5 on a 4-core box).
- Knock-on: thread-pool/CPU saturation stretched stats-collection cycles from
  <1s to 15–53s. Any cycle > 30s skips the next tick (overlap guard), pushing
  `PlayerSessions.LastSeenTime` past the live-servers endpoint's 60-second
  freshness window — every server displayed **0 players** until a cycle
  caught up.
- Diagnosed with: Seq request/duration queries, thread-level `top -H`,
  `perf` per-DSO profile (73% in JIT'd managed code, 2% SQLite), and
  `dotnet-stack` managed stack dumps (same thread IDs inside
  `RoundsService.GetRoundReport` across snapshots minutes apart). Captured as
  reusable runbooks in home-server-mgr (`dotnet-hot-threads`,
  `dotnet-cpu-profile`, `bfstats-db-health`, `bfstats-stale-rounds`,
  `bfstats-close-stale-rounds`).
- Immediate remediation: closed the stale round via sqlite3
  (`IsActive = 0, EndTime = StartTime + 60min`), restarted the api pod.

## Code changes

- [x] **Single-pass snapshot builder** — `RoundsService.BuildLeaderboardSnapshots`
  walks the (timestamp-ordered) observations once, maintaining a per-player
  latest-observation dictionary and emitting a snapshot per minute boundary.
  O(observations + minutes), allocation-light. Extracted as `internal static`
  for direct unit testing.
- [x] **Hard timeline cap** — `RoundsService.MaxSnapshotMinutes = 360` (6 h).
  No data state can make the snapshot loop unbounded; a capped round logs a
  warning so corrupt data stays visible.
- [x] **Cancellation** — `GetRoundReport` takes a `CancellationToken`, passed
  to both EF queries and checked every loop iteration;
  `RoundsController.GetRoundReport` binds `HttpContext.RequestAborted` and
  returns quietly on cancellation. Abandoned requests now stop instead of
  grinding to completion for nobody.
- [x] **Merge closes orphans with bounded durations** — `ServerMergeService`
  already set `IsActive = 0` on dupes' active rounds, but stamped
  `EndTime = now`, which on an ancient orphan still left a months-"long" round.
  Now: rounds started within 24 h close at merge time; older ones get
  `EndTime = StartTime + 60min`.
- [x] Unit tests: `tests/api/Servers/RoundReportSnapshotsTests.cs` (ranking,
  dropout window, cap, cancellation, empty input).

## Follow-ups (not done here)

- [ ] Wire a `stale-rounds-watchdog` job in home-server-mgr:
  `bfstats-stale-rounds` (check, exits 1) → `bfstats-close-stale-rounds`
  (remediate) + ntfy alert.
- [ ] `ServerPlayerRankingsRecalculationService` uses non-sargable
  `strftime('%Y', StartTime)` predicates — forces a full per-server session
  scan hourly. Bursty (cycle completes in <10 min) so deprioritized, but a
  range predicate on `StartTime` would let the existing
  `(ServerGuid, StartTime, …)` index serve it.
- [ ] Live-servers 60s freshness window has zero headroom over the 30s
  collection cadence + skip-on-overlap; consider counting on `IsActive` alone
  (5-min session timeout matches the server-online window) so a single slow
  cycle can't blank player counts.
