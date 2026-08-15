# Production issues register

Short record of things that broke production, so we stop rediscovering them.

One entry per incident. Keep entries **brief** — symptom, cause, fix, and the one
sentence worth remembering. Deep detail belongs in `NODE_TUNING.md` or the commit.

Node context: single Hetzner host, 4 vCPU, 7741Mi, no swap; ~24GB SQLite database on a
network-attached volume. Most entries below trace back to one of those two facts.

| # | Date | Impact | Cause | Fixed by |
|---|---|---|---|---|
| 6 | 2026-08-16 | Site unresponsive | `Cache=Shared` in connection string | `b7feede` |
| 5 | 2026-08-16 | Misdiagnosis, outage continued | Blamed `busy_timeout`; real cause was #6 | `b7feede` |
| 4 | 2026-08-15 | Player pages 6.2s | No `sqlite_stat1` — `ANALYZE` never run | `ANALYZE`, out-of-band |
| 3 | 2026-08-13 | Node thrash, hard power-cycle | SQLite `cache_size` + `mmap_size` per connection | `a1c5cfb`, `48c552d` |
| 2 | — | API starved | fio benchmark run against a live volume | n/a — process |
| 1 | — | App locked out of its own DB | `sqlite3` as root over SSH created root-owned WAL/shm | n/a — process |

---

### 6. `Cache=Shared` serialized reads behind writers — 2026-08-16

Added in `7dbedac` labelled "coordinate in-process page cache sharing". It is not a cache
setting; it changes the **locking model**. Under shared cache, connections in one process
drop WAL snapshot isolation and take table-level read/write locks against each other, so an
HTTP read blocks for the full duration of any background write transaction on the same
table. The aggregate and ranking sweeps hold long write transactions over `PlayerSessions`,
`Rounds` and `PlayerMapStats`; reads queued behind them and the pool filled with waiters.

Measured, writer holding a transaction on the table being read: **0ms blocked without the
flag, 12,010ms with it** (12s writer).

**Remember:** never put `Cache=Shared` in the connection string. Fixed in `b7feede`.

### 5. The `busy_timeout` revert that fixed nothing — 2026-08-16

`1c468b0` correctly spotted long waits starving the pool and reverted `PRAGMA busy_timeout`
30s → 5s. It didn't work, for two reasons worth knowing independently:

- Shared-cache contention raises `SQLITE_LOCKED` (6 / extended 262
  `SQLITE_LOCKED_SHAREDCACHE`), which the busy handler **never sees** — only
  `sqlite3_unlock_notify` does, and Microsoft.Data.Sqlite doesn't use it.
- `Default Timeout=30` stayed in the connection string. That sets `CommandTimeout`, which
  bounds the driver's own BUSY/LOCKED retry loop and **defaults to 30s**, silently
  overriding any shorter PRAGMA.

**Remember:** `PRAGMA busy_timeout` alone does not bound a blocked command. Set
`Default Timeout` with it or the PRAGMA is decorative.

### 4. Query planner running blind — 2026-08-15

The database ran for years with no `sqlite_stat1`; `ANALYZE` had never been run, so the
planner picked indexes from hardcoded guesses. The player page's average-ping query walked
19,400 rows to average 19 — **6,018ms of a 6,240ms request**. Survivable on the old local
disk, not once every cache miss became a network round trip.

**Remember:** correct plans matter far more on the volume than they did on NVMe. See
`NODE_TUNING.md` §2. `SqliteStatisticsBackgroundService` now runs `PRAGMA optimize`.

### 3. SQLite pragmas took the node down — 2026-08-13

`cache_size = -262144` (256 MiB) plus `mmap_size = 1GiB` added to
`SqliteConnectionInterceptor` to speed up aggregate scans. Both are **per connection**, on a
pool of 10–30, in a then-unbounded container: memory-pressure thrash requiring a hard
power-cycle.

**Remember:** before raising any memory-sized setting, ask what multiplies it and do the
arithmetic against 7741Mi. Reverted in `a1c5cfb`; container limits added in `48c552d`.

### 2. Benchmarking a live volume starves the API

The volume has ~691 single-queue IOPS. An fio run saturates it. A migration check that
normally takes 2.7s took 3.5 minutes during one.

**Remember:** never benchmark the volume while the app is under load.

### 1. Root-owned WAL files lock the app out

The database files are owned by uid 1000. Running `sqlite3` as root over SSH creates
root-owned `-wal`/`-shm` files, locking the app out of its own database.

**Remember:** use the `sqlite-tools` sidecar, which runs as uid 1000.

---

## Patterns worth noticing

- **Four of six entries are a setting that reads as an optimisation and is actually a
  semantics change** (#6 locking model, #3 per-connection memory). Ask what a knob
  *changes*, not just what it speeds up.
- **The volume didn't create these problems, it removed the slack that hid them.** #4 and
  #6 were both survivable on local NVMe.
- **Two consecutive fixes treated the symptom** (#5 after #6). When a fix doesn't work,
  re-derive the cause instead of tuning the same knob further.

## Open / watch

- **WAL growth.** `wal_autocheckpoint` is 1000 pages (4MB); the WAL has been observed at
  **216MB** because checkpoints couldn't complete against constant writers. A clean pod
  shutdown brought it back to 76MB. Every reader consults the WAL index, so this is worth
  its own investigation if it climbs again. (`NODE_TUNING.md`)
- **Server search ~450ms.** `SearchServersAsync` does a `LIKE '%query%'` scan plus a
  `PlayerSessions` lookup per request. Healthy, but the slowest endpoint measured on
  2026-08-16. Its paging is also wrong (`TotalPages` hardcoded to 1, backfill has no
  `Skip`).
