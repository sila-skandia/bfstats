# Node tuning — bfstats Hetzner host

Host-level settings that are **not** captured by any Kubernetes manifest. If the node is
rebuilt, nothing in `deploy/app/` restores these — work through this file.

Node: `root@77.42.38.148` (key: `~/.ssh/hetzner`)
Hardware: arm64, 4 vCPU, 7.6GiB RAM, no swap, Debian 13 / k3s

| device | role |
|---|---|
| `/dev/sda` | 76GB OS disk (local) |
| `/dev/sdb` | 80GB Hetzner Cloud Volume, ext4, mounted `/mnt/bfstats-data` — holds SQLite + Neo4j |

---

## Why any of this exists

Before the volume migration the SQLite database lived on the OS disk. It now lives on a
Hetzner Cloud Volume, which is **network-attached block storage**. Measured with fio on
`playertracker.db`, `direct=1`:

| pattern | IOPS | throughput | latency |
|---|---|---|---|
| random 4K, queue depth 1 | 691 | 2.7 MB/s | **1.38ms** |
| random 4K, queue depth 16 | 7,068 | 27.6 MB/s | ~2.2ms |
| random 16K, queue depth 1 | 750 | 11.7 MB/s | ~1.33ms |
| sequential 128K, qd 1 | 682 | 85.3 MB/s | ~1.47ms |
| sequential 1M, qd 1 | 205 | 205 MB/s | ~4.9ms |

Two facts drive every decision below:

1. **Latency is flat (~1.3–1.4ms) from 4K to 128K.** You pay per round trip, not per
   byte. Bigger reads are nearly free; more reads are expensive.
2. **Queue depth is worth 10×** (691 → 7,068 IOPS), but SQLite executing one query is
   strictly sequential — read a page, wait, decide. **A single query cannot exceed ~691
   reads/sec.** Readahead is the only way to give one query that parallelism.

The database is ~24GB against 7.6GiB of RAM, so the page cache holds roughly 18% of it.
Misses are common and each one is a network round trip.

---

## Applied

### 1. Readahead on the data volume: 128KB → 512KB

**File:** `/etc/udev/rules.d/60-bfstats-volume-readahead.rules`

```
ACTION=="add|change", SUBSYSTEM=="block", ENV{ID_SERIAL}=="0HC_Volume_106624631", ATTR{queue/read_ahead_kb}="512"
```

Scoped by serial so it cannot affect the OS disk and survives `sdX` renaming.

Measured with fio, **buffered** sequential reads (`direct=1` bypasses readahead, so it
cannot measure this) on cold regions of the database file:

| read_ahead_kb | throughput |
|---|---|
| 128 (default) | 196 MiB/s |
| **512** | **303 MiB/s** |
| 1024 | 315 MiB/s |
| 2048 | 314 MiB/s |

512 is the knee. Going higher gains ~4% and wastes more page cache, which is the scarce
resource here.

**This helps sequential scans only** — aggregate jobs, ranking sweeps, `ANALYZE`, large
`GROUP BY`s. Player pages are point lookups and are unchanged by it. The trade-off is
that speculative reads which turn out to be random evict useful cached pages.

Verify:

```bash
ssh -i ~/.ssh/hetzner root@77.42.38.148 'cat /sys/block/sdb/queue/read_ahead_kb'
```

Revert (live, no reboot):

```bash
ssh -i ~/.ssh/hetzner root@77.42.38.148 'rm /etc/udev/rules.d/60-bfstats-volume-readahead.rules && echo 128 > /sys/block/sdb/queue/read_ahead_kb'
```

### 2. SQLite query planner statistics (database, not host — recorded here because it is applied out-of-band)

The database ran for years with **no `sqlite_stat1` table** — `ANALYZE` had never been
run, so the planner chose indexes from hardcoded guesses. It chose badly: the player
page's average-ping query drove off `IX_PlayerSessions_ServerGuid_StartTime_MapName`,
walking 19,400 rows to average the 19 belonging to the player. **6,018ms of a 6,240ms
request.** After `ANALYZE` it uses `IX_PlayerSessions_PlayerName_ServerGuid_SessionId`
and the same query runs in **4–7ms**.

Applied 2026-08-15 via the `sqlite-tools` sidecar, per table:

```bash
kubectl exec -n bf42-stats deploy/bf42-stats -c sqlite-tools -- sh -c \
  'cd /mnt/data && sqlite3 playertracker.db "PRAGMA busy_timeout=120000;" "PRAGMA analysis_limit=400;" "ANALYZE PlayerSessions;"'
```

Tables analysed: `PlayerSessions`, `PlayerMapStats`, `ServerPlayerRankings`, `Rounds`.
`PlayerObservations` is deliberately **skipped** — 101M rows, none of the slow endpoints
depend on its statistics, and it carries most of the index bulk.

**`ANALYZE` is a long writer on this volume, not a quick maintenance command.** Measured
wall time, ~99% I/O wait:

| table | wall | user CPU |
|---|---|---|
| Rounds | 27.8s | 0.13s |
| PlayerMapStats | 104.9s | 0.61s |
| PlayerSessions | 155.6s | 1.00s |

`PRAGMA analysis_limit=400` bounds the sampling and is **per-connection** — it must be
set in the same invocation as the `ANALYZE`. Without it, analysing means reading every
index in full.

It holds the write lock for its duration, so run it in a quiet window. Statistics go
stale as data grows; re-run periodically or wire up `PRAGMA optimize`.

Rollback (planner falls back to heuristics):

```bash
kubectl exec -n bf42-stats deploy/bf42-stats -c sqlite-tools -- sh -c \
  'cd /mnt/data && sqlite3 playertracker.db "DELETE FROM sqlite_stat1;"'
```

---

## Considered and not applied

### `page_size` 4K → 16K — the largest remaining lever

Because latency is flat to 128K, a 16K page costs the same round trip as a 4K page and
returns 4× the data: **750 IOPS × 16K = 11.7 MB/s versus 691 × 4K = 2.7 MB/s**. It also
shortens B-trees, so point lookups descend fewer levels — it helps reads of both kinds.

Not done because it requires `VACUUM` of a 24GB database with the DB quiet: hours, and
~24GB of scratch space (the volume has ~49GB free, so space is fine). Use
`DISABLE_BACKGROUND_PROCESSING` for the window.

### `discard` mount option → `fstrim.timer`

`/mnt/bfstats-data` mounts `rw,relatime,discard`. Inline discard issues a TRIM on the
delete path; on network storage that is extra round trips. The conventional alternative
is a weekly `fstrim.timer`. Small win, needs a remount.

### WAL checkpointing

`wal_autocheckpoint` is 1000 pages (4MB) but the WAL was observed at **216MB** — 47×
over target — because checkpoints could not complete while writers were constantly
contending. Every reader consults that WAL index. A clean pod shutdown checkpointed it
back to 76MB. Watch whether it climbs again; if it does, it is a separate problem from
readahead and worth its own investigation.

### Raising container memory limits to buy page cache

Not available. Memory limits across `deploy/app/` already total **6,976Mi of 7,741Mi
allocatable**, leaving 765Mi — already under the ~1.5Gi headroom invariant in
`CLAUDE.md`. There is nothing to give.

---

## Gotchas learned the hard way

- **Do not benchmark the volume while the app is under load.** It has ~691 single-queue
  IOPS; an fio run saturates it and starves the API. A migration check that normally
  takes 2.7s took 3.5 minutes during one.
- **Never run `sqlite3` against the database as root over SSH.** The files are owned by
  uid 1000; root can create root-owned `-wal`/`-shm` files and lock the app out of its
  own database. Use the `sqlite-tools` sidecar, which runs as uid 1000.
- **Reads are unaffected by write-lock problems.** In WAL mode the site keeps serving
  normally while every writer fails, so "the site is up" is not evidence the database is
  healthy. Check that the WAL mtime is advancing.
