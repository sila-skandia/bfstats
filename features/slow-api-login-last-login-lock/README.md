# Slow `POST /stats/auth/login` — LastLoggedIn write vs hourly writer

Seq signals `bfstats/Slow as fuck (>= 10 seconds)` and `bfstats/Exceptions` at 02:09 UTC 2026-11-10.

## Traces

Chrome on Windows. Host `bfstats.io`. Pod `bf42-stats-5fbf6f568c-xgb55`.

| Time (UTC) | TraceId | HTTP | Elapsed |
|---|---|---|---|
| 02:06:19–02:07:21 | `44677d2fa78ebecb75356db0148986da` | **500** | **62,265ms** |
| 02:06:33 | `83d69d9f976a9c2511e9d033ec9ba19c` | 401 | Discord `invalid_grant` (retry of the spent code) |

| span | cost |
|---|---|
| Discord exchange | ~0.5s, **succeeded** |
| `SELECT Users WHERE Email` | **1ms** |
| `UPDATE Users SET LastLoggedIn` | **61,750ms** then `SQLITE_BUSY` (Error 5, CommandTimeout 60) |
| refresh-token INSERT | never reached |

The Discord authorization code is one-time. It was spent at 02:06:19. The client retried the same code 14s later (`invalid_grant`) while the first request was still sitting on the lock, then the first request returned 500. User 13.

Holder: hourly incremental. `Aggregate calculation: 75830 records … in 138236ms` at 02:08:18. Started ~02:05:59. Collection cycle #381 hit SQLITE_BUSY at 02:07:14 and retried 1/3 (known ignore). Ranking last **01:57:38 10262 / 84 of 832**. Gami **02:04:29 3** then **02:11:04 41** (no skip). Live lastUpdated **02:12:43**, 86 servers.

Same-window Slow sibling: Chrome `POST /stats/recordings` slug `64q2x93wxq` **9.2 MB / 41.2s** TraceId `c254373ca044552d6eb3ece85ceed51d` HTTP 201. First DbCommand is the quota SUM at +18ms (by design), INSERT after the body 18ms, no SQLITE_BUSY. Known body-wait ignore — do not change `ReceiveAsync`. CORS Information `Request origin https://play.bfstats.io does not have permission` on that POST is the known cookie-CORS note.

## Cause

SQLite allows one writer. `Users.LastLoggedIn` lives in `playertracker.db` with the stats tables. A user-facing `SaveChanges` on that file waits behind the hourly DELETE+INSERT. `CommandTimeout(60)` parks the request for a minute, then `Login error` 500. Discord has already consumed the code, so a retry of the same body cannot succeed.

WAL already lets the Email SELECT through. No index helps an UPDATE that is only waiting for the writer. LastLoggedIn is telemetry for the admin user list — it is not required to issue tokens.

## Change

`CreateOrUpdateUserAsync` and the password path set `CommandTimeout` to 2s for LastLoggedIn and 5s for a new-user INSERT or the refresh-token INSERT — the process-wide 60s stays. `SQLITE_BUSY` on LastLoggedIn is skipped (`Login write last-login locked after {ElapsedMs}ms`) and login continues. A required write maps the same lock to HTTP 503 `{ message: "The stats database is busy updating; try again in a minute" }` instead of an unhandled 500. Two sequential writes then stay under the 10s Slow page. Hop log: `Login write {Action}: {ElapsedMs}ms` / `Login write {Action} locked after {ElapsedMs}ms` (`last-login`, `create-user`, `refresh-token`).

Do not lower the global EF `CommandTimeout(60)`. Do not reschedule the hourly / Recreate-extra incremental. Do not re-implement **PR #80** (app refresh / cookie refresh / `RefreshTokenService` globally) or **PR #78** (GameProfiles PATCH). Do not add `https://play.bfstats.io` to `Cors__AllowedOrigins` from the sibling recordings POST.

**Do not re-implement.** Do not live-probe `POST /stats/auth/login` until a request emits `Login write last-login: {ElapsedMs}ms` or `Login write last-login locked after {ElapsedMs}ms`. A still >=10s login 500 after that hop is live is a new bug. A 503 in <=10s during hourly is this change working.
