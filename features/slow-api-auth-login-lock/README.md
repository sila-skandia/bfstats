# Slow `POST /stats/auth/login` — LastLoggedIn write vs hourly writer

Seq signals `bfstats/Exceptions` and `bfstats/Slow as fuck (>= 10 seconds)` at 02:09 UTC 2026-11-10.

## Traces

Chrome (`is_bot=false`). Host `bfstats.io`. Pod `bf42-stats-5fbf6f568c-xgb55` (Application started **2026-11-09T22:50:42Z**). Discord OAuth, existing user.

| Time (UTC) | TraceId | HTTP | Elapsed |
|---|---|---|---|
| 02:05:09–02:05:10 | (same user, before hourly) | 200 | **539ms** |
| 02:06:19–02:07:21 | `44677d2fa78ebecb75356db0148986da` | **500** | **62,265ms** |
| 02:06:33–02:06:33 | `83d69d9f976a9c2511e9d033ec9ba19c` | 401 | 173ms (`invalid_grant` — Discord code already spent by the hanging request) |

| span | cost |
|---|---|
| Discord token exchange | ~500ms |
| `SELECT Users WHERE Email` | 1ms |
| `UPDATE Users SET LastLoggedIn` | **61,750ms** then `SQLITE_BUSY` (Error 5, CommandTimeout 60) |

Holder: hourly incremental. `Aggregate calculation: 75830 records (monthly=7926, server=1697, map=63145, team=3062) for 2026-11 in 138236ms` at 02:08:18. Collection cycle #381 hit SQLITE_BUSY at 02:07:14 and retried 1/3 (known ignore). Same-trace retry fetched bflist 02:07:44. Subsequent Fetched 02:08:43 / 02:09:43 / 02:10:43. Gami Processed **02:04:29 3** then **02:11:04 41**. Ranking last **01:57:38 10262 / 84 of 832**. Live lastUpdated **02:10:43**, 86 servers. Cheap `GET /stats/shorts` **214ms** / 24 items.

Overlapping Slow hop, not this pager: Chrome `POST /stats/recordings` slug `64q2x93wxq` **9.2 MB / 41.2s** TraceId `c254373ca044552d6eb3ece85ceed51d` HTTP 201 on play.bfstats.io. Quota SUM at start (0ms), INSERT after the body 18ms, no SQLITE_BUSY. Known recordings body-wait ignore — do not change `ReceiveAsync`.

## Cause

SQLite allows one writer. `Users.LastLoggedIn` lives in `playertracker.db` with the stats tables. A user-facing `SaveChanges` on that file waits behind the hourly DELETE+INSERT. `CommandTimeout(60)` plus the driver's BUSY retry loop parks the request for a minute, then 500s. Discord has already consumed the authorization code, so a retry of the same callback is `invalid_grant`.

WAL already lets the SELECT through. No index helps an UPDATE that is only waiting for the writer.

This is the same lock as leftover **PR #80** (app refresh `RefreshTokens` INSERT) and leftover **PR #78** (GameProfiles PATCH). Do not re-implement those. Cookie `POST /stats/auth/refresh` stays on **#80**.

## Change

Login writes set `CommandTimeout` for that write only — the process-wide 60s stays. `LastLoggedIn` / `IsActive` on an existing user waits 1s then is skipped on `SQLITE_BUSY` so a sign-in can still issue tokens if the refresh INSERT can land. A refresh-token INSERT (or a new-user INSERT) waits 5s (busy_timeout) and becomes HTTP 503 `{ message: "The stats database is busy updating; try again in a minute" }` instead of an unhandled 500. Hop log: `Login write last-login: {ElapsedMs}ms` / `Login write last-login locked after {ElapsedMs}ms; continuing` / `Login write refresh: {ElapsedMs}ms` / `Login write refresh locked after {ElapsedMs}ms`.

Do not lower the global EF `CommandTimeout(60)`. Do not reschedule the hourly / Recreate-extra incremental. Do not move `Users` to a second SQLite file in this change. Do not re-implement **PR #80** or **PR #78**.

**Do not re-implement.** Do not live-probe `POST /stats/auth/login` until a request emits `Login write last-login:` / `Login write refresh:` or `locked after`. A still >=10s login after that hop is live is a new bug.
