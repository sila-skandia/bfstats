# Slow `PATCH /stats/account/game-profiles/{name}` — sidecar name vs hourly writer

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 12:16 UTC 2026-10-25.

## Trace

`PATCH /stats/account/game-profiles/skandia` HTTP 499 **61,817ms**. TraceId `b85a61a83f7abd1b2141df4b998fccff`. Chrome Linux, `is_bot=false`. Host `bfstats.io`. Pod `bf42-stats-5b4679cb75-g7qks` (Application started 12:03:27Z).

| span | cost |
|---|---|
| `SELECT GameProfiles WHERE UserId AND NormalizedName LIMIT 1` | 2ms |
| `UPDATE GameProfiles SET SidecarName WHERE Id` | **61,757ms** then `SQLITE_BUSY` (Error 5, CommandTimeout 60) |

The client hung up (499) at the same moment the command timed out. The UPDATE is a one-row PK write; it is not a scan.

Holder: Recreate-extra incremental after the 12:03 deploy. `Aggregate calculation: 108237 records … in 122882ms` at 12:15:30 (TraceId `98e7fd8bd4984d4b9b8828141bb4123e`). `PlayerMapStats` held the writer from 12:13:37 to 12:15:11. Collection cycle #21 hit SQLITE_BUSY at 12:14:41 and retried 1/3 (known ignore).

Same-window leftover **#67** (Slow did not page): bot `GET …/players/Alfred/network-graph?depth=2` 43.3s at 12:13:35, TraceId `d3490d3a6c9c022fd3ae57d401849a10`.

## Cause

SQLite allows one writer. GameProfiles lives in `playertracker.db` with the 24GB stats tables. A user-facing `SaveChanges` on that file waits behind the hourly DELETE+INSERT. `CommandTimeout(60)` plus the driver's BUSY retry loop parks the request for a minute, then fails. The Slow signal fires at 10s.

WAL already lets the SELECT through. No index helps an UPDATE that is only waiting for the writer.

## Change

GameProfiles writes (PATCH sidecar, PUT upsert, activate, delete) set `CommandTimeout` to 5s for that `SaveChanges` only — the process-wide 60s stays. `SQLITE_BUSY` becomes `GameProfileOutcome.Busy` → HTTP 503 `{ message: "The stats database is busy updating; try again in a minute" }` instead of an unhandled 499. The site and tray already surface `body.message`.

Do not lower the global EF `CommandTimeout(60)`. Do not reschedule the Recreate-extra / hourly incremental. Do not move GameProfiles to a second SQLite file in this change.

**Do not re-implement.** Do not live-probe `PATCH /stats/account/game-profiles/{name}` until a request emits `Game profile write sidecar {Name}: {ElapsedMs}ms` or `Game profile write sidecar {Name} locked after {ElapsedMs}ms`. A still >=10s PATCH after that hop is live is a new bug.
