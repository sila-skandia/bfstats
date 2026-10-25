# Game-profile writes fail fast when SQLite is locked

Webhook: `bfstats/Exceptions` and `bfstats/Slow as fuck (>= 10 seconds)` at
2026-10-25 12:16 UTC.

## What paged

Authenticated Chrome Linux (`is_bot=false`) `PATCH
/stats/account/game-profiles/skandia` (`SetSidecarName`) started 12:14:04Z
on pod `bf42-stats-5b4679cb75-g7qks`. The SELECT of the row took 2ms.
The `UPDATE GameProfiles SET SidecarName` then retried `SQLITE_BUSY` until
EF `CommandTimeout(60)` and failed at 12:15:06Z after **61,757ms**. Kestrel
logged an unhandled `DbUpdateException`. The tab hung up: HTTP **499** in
**61,817ms**. TraceId `b85a61a83f7abd1b2141df4b998fccff`.

The holder is the Recreate-extra incremental after Application started
**12:03:27Z** (10-minute first-run wait): `Aggregate calculation: 108237
records … in 122882ms` at 12:15:30Z. Collection cycle #21 hit the same
lock (`GetOrCreateServerAsync`, attempt 1/3) and retried. Gamification
sat-then-committed 29 achievements in 15s. No `skipped after 3 retries`.
No HTTP 5xx. Live lastUpdated recovered 12:18:58Z.

Collection / gami `SQLITE_BUSY` during Recreate extra is the usual ignore.
The new bug is the **public write** waiting the full 60s command timeout
and then 499ing.

## Why 61s

`PRAGMA busy_timeout = 5000` and the connection string `Default Timeout=5`
are the fail-fast pair. `UseSqlite(..., sqliteOptions.CommandTimeout(60))`
overrides that for every EF command, so Microsoft.Data.Sqlite's own
BUSY/LOCKED retry loop runs until 60s. Heavy reads need that 60s. A
one-row account write does not.

## Fix

Game-profile PUT / PATCH / activate / delete set `CommandTimeout` to 5s
for `SaveChanges` only, catch `SQLITE_BUSY` / `SQLITE_LOCKED` without
attaching `ex` (so a handled lock does not add a second Kestrel
ApplicationError), and return **503** `{ message: "The database is busy;
try again" }`. Unique-index races stay 409 and also no longer log `ex`.

The dashboard panel already surfaces the server message on the sidecar
field. Do not live-probe the PATCH (it is authenticated). Do not lower
the process-wide `CommandTimeout(60)`. Do not change Recreate extra's
10-minute first-run wait.

Live once a request emits `Game profile write {Outcome} in {ElapsedMs}ms`
or `Game profile write for user {UserId} hit a database lock ({Lock}) in
{ElapsedMs}ms`.

EF `SaveChangesFailed` EventId 10000 still attaches `@Exception` before
the app catch — the same pager as collection — so an overlap can still
trip `bfstats/Exceptions`. It will no longer trip Slow or 499 the tab.
