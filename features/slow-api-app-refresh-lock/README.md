# Slow `POST /stats/auth/app/refresh` — token rotate vs hourly writer

Seq signals `bfstats/Exceptions` and `bfstats/Slow as fuck (>= 10 seconds)` at 05:47 UTC 2026-10-26.

## Traces

Sidecar (`User-Agent: node`, `is_bot=false`). Host `bfstats.io`. Pod `bf42-stats-5b4679cb75-g7qks`.

| Time (UTC) | TraceId | HTTP | Elapsed |
|---|---|---|---|
| 05:45:19–05:46:20 | `e0124e457844bef36ad2099453103641` | 499 | **61,783ms** |
| 05:46:06–05:46:40 | `aa9f5adcbbc8967639a538a1a88b1f08` | 200 | **33,330ms** |

| span | cost |
|---|---|
| `SELECT RefreshTokens WHERE TokenHash` | 4ms / 0ms |
| `SELECT Users WHERE Id` | 0ms |
| `INSERT INTO RefreshTokens` | **61,751ms** then `SQLITE_BUSY` (Error 5, CommandTimeout 60) / **33,308ms** then OK |

The first client hung up (499) at the same moment the command timed out. The INSERT is a one-row PK write; it is not a scan. The second call is the sidecar retrying after the first hung; it landed while the hourly was winding down.

Holder: hourly incremental. `Aggregate calculation: 107696 records (monthly=5546, server=354, map=98517, team=3279) for 2026-10 in 130529ms` at 05:47:07. Started ~05:44:56. Ranking last **05:24:15 10212 / 93 of 823**. Collection cycle #2074 hit SQLITE_BUSY at 05:46:04 and retried 1/3; gami sat 61,751ms then skipped (known ignore). Next Cycle OK **#2077 05:48:00 79 / 3133ms**. Live lastUpdated **05:48:58**, 79 servers. Homepage 200.

Same-window leftover: none. Last Slow page was **12:16Z 10-25** (**PR #78** GameProfiles PATCH). This is a new public write on the same lock.

## Cause

SQLite allows one writer. `RefreshTokens` lives in `playertracker.db` with the 24GB stats tables. A user-facing `SaveChanges` on that file waits behind the hourly DELETE+INSERT. `CommandTimeout(60)` plus the driver's BUSY retry loop parks the request for a minute, then fails. The Slow signal fires at 10s. The unhandled `DbUpdateException` also trips Exceptions.

WAL already lets the SELECT through. No index helps an INSERT that is only waiting for the writer. The sidecar keeps the sign-in on 5xx and retries; it does not treat this as signed out.

## Change

App sign-in writes (refresh, token exchange, authorize) and `RefreshTokenService` `SaveChanges` set `CommandTimeout` to 5s for that write only — the process-wide 60s stays. `SQLITE_BUSY` becomes `AppSignInOutcome.Busy` → HTTP 503 `{ error: "temporarily_unavailable", message: "The stats database is busy updating; try again in a minute" }` instead of an unhandled 499. Cookie `POST /stats/auth/refresh` maps the same lock to 503. Hop log: `App token write {Action}: {ElapsedMs}ms` / `App token write {Action} locked after {ElapsedMs}ms`.

Do not lower the global EF `CommandTimeout(60)`. Do not reschedule the hourly / Recreate-extra incremental. Do not move `RefreshTokens` to a second SQLite file in this change. Do not re-implement **PR #78**.

**Do not re-implement.** Do not live-probe `POST /stats/auth/app/refresh` until a request emits `App token write refresh: {ElapsedMs}ms` or `App token write refresh locked after {ElapsedMs}ms`. A still >=10s refresh after that hop is live is a new bug.
