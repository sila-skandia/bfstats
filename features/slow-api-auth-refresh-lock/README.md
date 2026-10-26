# Slow `POST /stats/auth/app/refresh` — refresh-token write vs hourly writer

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 05:48 UTC 2026-10-26.

## Trace

Two sidecar refreshes from the same `node` client, `is_bot=false`. Host `bfstats.io`. Pod `bf42-stats-5b4679cb75-g7qks` (Application started 2026-10-25T12:03:27Z).

| Time (UTC) | Path | HTTP | Elapsed | TraceId |
|---|---|---|---|---|
| 05:45:19–05:46:20 | `POST /stats/auth/app/refresh` | 499 | **61,783ms** | `e0124e457844bef36ad2099453103641` |
| 05:46:06–05:46:40 | `POST /stats/auth/app/refresh` | 200 | **33,330ms** | `aa9f5adcbbc8967639a538a1a88b1f08` |

| span | 499 | 200 |
|---|---|---|
| `SELECT RefreshTokens WHERE TokenHash LIMIT 1` | 4ms | 0ms |
| `SELECT Users WHERE Id LIMIT 1` | 0ms | 0ms |
| `INSERT INTO RefreshTokens` | **61,751ms** then `SQLITE_BUSY` (Error 5, CommandTimeout 60) | **33,308ms** |
| `UPDATE RefreshTokens SET ReplacedByTokenHash, RevokedAt` | never reached | 1ms |

The first client hung up (499) at the same moment the command timed out. The INSERT is a one-row PK write; it is not a scan. The second request is the sidecar retry.

Holder: hourly incremental. `Aggregate calculation: 107696 records (monthly=5546, server=354, map=98517, team=3279) for 2026-10 in 130529ms` at 05:47:07. Started ~05:44:54. Collection cycle #2074 hit SQLITE_BUSY at 05:46:04 and retried 1/3; gamification sat 61,751ms then skipped (known ignore). Next collection OK #2077 at 05:48:00, 79 servers / 3133ms.

Exceptions also fired for the unhandled Kestrel ApplicationError + EF SaveChangesFailed on the 499, plus the collection/gami busy (known ignore).

## Cause

SQLite allows one writer. RefreshTokens lives in `playertracker.db` with the 24GB stats tables. A user-facing `SaveChanges` on that file waits behind the hourly DELETE+INSERT. `CommandTimeout(60)` plus the driver's BUSY retry loop parks the request for a minute, then fails. The Slow signal fires at 10s.

WAL already lets the SELECT through. No index helps an INSERT that is only waiting for the writer.

Same class as the GameProfiles sidecar PATCH (features/slow-api-game-profile-sidecar-lock, PR #78).

## Change

RefreshToken writes (create, rotate, revoke) set `CommandTimeout` to 5s for that `SaveChanges` only — the process-wide 60s stays. `SQLITE_BUSY` becomes `RefreshTokenWriteLockedException` → `AppSignInOutcome.Busy` → HTTP 503 `{ error: "temporarily_unavailable", message: "The stats database is busy updating; try again in a minute" }` instead of an unhandled 499. Cookie login / refresh / register map the same exception to 503. The sidecar treats 401 as signed out and should retry a 503.

Do not lower the global EF `CommandTimeout(60)`. Do not reschedule the hourly incremental. Do not move RefreshTokens to a second SQLite file in this change.

**Do not re-implement.** Do not live-probe `POST /stats/auth/app/refresh` (or cookie `/stats/auth/refresh`) until a request emits `Refresh token write {Action}: {ElapsedMs}ms` or `Refresh token write {Action} locked after {ElapsedMs}ms`. A still >=10s refresh after that hop is live is a new bug.
