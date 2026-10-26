# Slow `POST /stats/auth/app/refresh` — refresh-token write vs hourly writer

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 05:46 UTC 2026-10-26.

## Trace

Two `POST /stats/auth/app/refresh` from a node client, `is_bot=false`, host `bfstats.io`, pod `bf42-stats-5b4679cb75-g7qks` (Application started 12:03:27Z 10-25).

| request | status | cost | TraceId |
|---|---|---|---|
| first, started 05:45:19 | 499 | **61,783ms** | `e0124e457844bef36ad2099453103641` |
| retry, started 05:46:06 | 200 | **33,330ms** | `aa9f5adcbbc8967639a538a1a88b1f08` |

First request:

| span | cost |
|---|---|
| `SELECT RefreshTokens WHERE TokenHash LIMIT 1` | 4ms |
| `SELECT Users WHERE Id LIMIT 1` | 0ms |
| `INSERT INTO RefreshTokens` | **61,751ms** then `SQLITE_BUSY` (Error 5, CommandTimeout 60) |

The client hung up (499) at the same moment the command timed out. Kestrel logged an unhandled `DbUpdateException`. The INSERT is a one-row PK write; it is not a scan.

Retry: same SELECTs at 0ms, INSERT **33,308ms** then committed, revoke UPDATE 1ms, HTTP 200.

Holder: hourly incremental. `Aggregate calculation: 107696 records (monthly=5546, server=354, map=98517, team=3279) for 2026-10 in 130529ms` at 05:47:07. Collection cycle #2074 hit SQLITE_BUSY at 05:46:04 and retried 1/3. Gamification failed-then-skip at 05:46:15 after 61,751ms (known ignore).

## Cause

SQLite allows one writer. `RefreshTokens` lives in `playertracker.db` with the 24GB stats tables. A user-facing `SaveChanges` on that file waits behind the hourly DELETE+INSERT. `CommandTimeout(60)` plus the driver's BUSY retry loop parks the request for a minute, then fails. The Slow signal fires at 10s. Same class as `features/slow-api-game-profile-sidecar-lock` (PR #78, GameProfiles sidecar PATCH).

WAL already lets the SELECT through. No index helps an INSERT that is only waiting for the writer.

## Change

Refresh-token writes (create, rotate, revoke) set `CommandTimeout` to 5s for that `SaveChanges` only — the process-wide 60s stays. App sign-in `authorize` / `token` / `refresh` map `SQLITE_BUSY` to `AppSignInOutcome.Busy` → HTTP 503 `{ error: "temporarily_unavailable", message: "The stats database is busy updating; try again in a minute" }` instead of an unhandled 499. Cookie `POST /stats/auth/refresh` maps the same lock to 503. Hop logs: `App sign-in write {Action}: {ElapsedMs}ms` / `locked after {ElapsedMs}ms`, and `Cookie refresh: {ElapsedMs}ms` / `locked after {ElapsedMs}ms`.

Do not lower the global EF `CommandTimeout(60)`. Do not reschedule the hourly incremental. Do not move RefreshTokens to a second SQLite file in this change. Do not re-implement PR #78.

**Do not re-implement.** Do not live-probe `POST /stats/auth/app/refresh` or `POST /stats/auth/refresh` until a request emits `App sign-in write refresh: {ElapsedMs}ms` or `App sign-in write refresh locked after {ElapsedMs}ms`. A still >=10s refresh after that hop is live is a new bug.
