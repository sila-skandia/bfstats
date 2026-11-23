# Slow `POST /stats/auth/login` — LastLoggedIn vs hourly writer

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 02:07 UTC 2026-11-10.

## Trace

Chrome on `bfstats.io`. Pod `bf42-stats-5fbf6f568c-xgb55`. TraceId `44677d2fa78ebecb75356db0148986da`.

| span | cost |
|---|---|
| Discord token exchange | ~0.5s, success |
| `SELECT Users WHERE Email` | 1ms |
| `UPDATE Users SET LastLoggedIn` | **61,750ms** then `SQLITE_BUSY` (Error 5, CommandTimeout 60) |
| HTTP | **500 / 62,265ms** |

The OAuth code was already spent. A second attempt 14s later was Discord `invalid_grant`.

Holder: hourly incremental. `Aggregate calculation: 75830 records … in 138236ms` at 02:08:18. Collection cycle #381 hit SQLITE_BUSY 1/3 at 02:07:14 (known ignore).

## Cause

SQLite allows one writer. `Users.LastLoggedIn` lives in `playertracker.db` with the stats tables. A successful Discord (or password) sign-in then waits behind the hourly DELETE+INSERT. `CommandTimeout(60)` parks the request for a minute, then `AuthController` maps the `DbUpdateException` to HTTP 500. The Slow signal fires at 10s. The Discord code cannot be reused.

WAL already lets the SELECT through. No index helps a one-row UPDATE that is only waiting for the writer. LastLoggedIn is not required to issue the session.

## Change

Existing-user `LastLoggedIn` / `IsActive` writes set `CommandTimeout` to 2s and skip on `SQLITE_BUSY` so login can continue. Refresh-token INSERT (required for the cookie) sets `CommandTimeout` to 5s and maps the lock to HTTP 503 `{ message: "The stats database is busy updating; try again in a minute" }` instead of a 62s 500. New-user INSERT uses the same 5s / 503 path. The process-wide 60s stays.

Hop logs: `Skipping last-login write for user {UserId} after {ElapsedMs}ms; database is locked` / `Login token write locked after {ElapsedMs}ms`.

Do not lower the global EF `CommandTimeout(60)`. Do not reschedule the hourly. Do not re-implement **PR #80** (app `/stats/auth/app/refresh` rotate). Do not live-probe `POST /stats/auth/login`.
