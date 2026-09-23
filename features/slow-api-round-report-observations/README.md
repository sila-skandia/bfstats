# Slow `GET /stats/rounds/{id}/report` — unbounded leftover observations

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 22:44 UTC 2026-09-10.

## Trace

`GET /stats/rounds/dc6659fb35e806ac8a9a/report`

| field | value |
|---|---|
| TraceId | `b2269089b78638317b836aba08bf2e7f` |
| started | 22:41:38Z |
| finished | 22:44:13Z |
| elapsed | **155,201ms** |
| status | **499** (client cancelled) |
| pod | `bf42-stats-59d8cc875f-929vj` |
| UA | Chrome 108 (crawler-shaped; sibling report IDs in the same second finished in 8–100ms) |

Only one EF command completed: the round header + `PlayerSessions` join on `RoundId` (**9ms**). There is no `CommandExecuted` for the observation load — the client hung up while that query was still running. CommandTimeout is 60s; SQLite did not surface an abort before the 499.

Other `/report` calls in the surrounding 15 minutes are **8–320ms**.

## Cause

This is the June 2026 zombie round (`*NEW* SiMPLE | Tanks a lot!`, left `IsActive` from 2025-09-03). `features/round-report-resilience` capped the in-memory snapshot loop at 360 minutes and honours cancellation, and ops closed the row to `EndTime = StartTime + 60min`. Closing the round does not reassign sessions: months of later `PlayerSessions` still carry that `RoundId`.

`GetRoundReport` then did `SessionId IN (every leftover id)` with no timestamp predicate against `PlayerObservations` (~101M rows). The snapshot cap ran only after that load, so it never got a chance. `ORDER BY Timestamp` on that IN-list is a volume scan; sibling real rounds stay on `IX_PlayerObservations_SessionId_Timestamp` and return in tens of milliseconds.

## Change

Join observations through `PlayerSessions.RoundId` and keep both the session set and `Timestamp` inside `[StartTime, CapSnapshotEnd]`. Leftover months drop out of the plan; a normal 20–60 minute round is unchanged. Log row count and elapsed so the next hang is visible in Seq.

No new index and no pragma change.

Do not live-probe `/stats/rounds/dc6659fb35e806ac8a9a/report` until this is the running image. After it is live, a still >=10s report whose SQL has no `Timestamp` upper bound (or still `IN`s every leftover session) is a new bug — do not re-add the unbounded load.
