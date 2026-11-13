# Production issues register

Short record of things that broke production, so we stop rediscovering them.

One entry per incident. Keep entries **brief** — symptom, cause, fix, and the one
sentence worth remembering. Deep detail belongs in `NODE_TUNING.md` or the commit.

Node context: single Hetzner host, 4 vCPU, 7741Mi, no swap; ~24GB SQLite database on a
network-attached volume. Most entries below trace back to one of those two facts.

| # | Date | Impact | Cause | Fixed by |
|---|---|---|---|---|
| 9 | 2026-11-13 | White terrain on re-baked levels, about 3 h | Levels published before their textures; nginx sent the 404 with a year-long `immutable` header, so Cloudflare kept it | `acd9943e9` |
| 8 | 2026-11-08 | Levels and models at ~43 KB/s for hours | `cloudflared` tunnel degraded after 10 days up; `.glb`/`.json` not edge-cached, so every one crossed it | `rollout restart deployment/cloudflared` |
| 7 | 2026-09-28 | play.bfstats.io pages did not start, 9.5 min | HAProxy `is_netcode` was `path_beg /netcode`, which took the viewer's `/netcode.js` | ACL narrowed, this commit |
| 6 | 2026-08-16 | Site unresponsive | `Cache=Shared` in connection string | `b7feede` |
| 5 | 2026-08-16 | Misdiagnosis, outage continued | Blamed `busy_timeout`; real cause was #6 | `b7feede` |
| 4 | 2026-08-15 | Player pages 6.2s | No `sqlite_stat1` — `ANALYZE` never run | `ANALYZE`, out-of-band |
| 3 | 2026-08-13 | Node thrash, hard power-cycle | SQLite `cache_size` + `mmap_size` per connection | `a1c5cfb`, `48c552d` |
| 2 | — | API starved | fio benchmark run against a live volume | n/a — process |
| 1 | — | App locked out of its own DB | `sqlite3` as root over SSH created root-owned WAL/shm | n/a — process |

---

### 9. Levels went live before their textures — 2026-11-13

**Symptom.** Re-baked levels drew white ground on play.bfstats.io (Liberation of
Caen, El Alamein, Wake and the other levels re-baked that day).

**Cause.** A re-bake published 300-odd `scene.glb` files from 13:26 without the
texture store they name. Pages asked for those textures in the gap, and nginx
answered the 404 with the textures' `Cache-Control: public, max-age=31536000,
immutable` (`add_header ... always`), so Cloudflare kept 3,852 of them 404 after
the store went up: the origin answered 200 to every one with a fresh query.

**Fix.** The texture stores were published (textures first, then checked: every
texture a live glb names answers 200 at the origin). `viewer/texture-url.js` asks
for a content-addressed texture as `?r=<epoch>`, a cache key the edge never held;
`mesh/nginx.conf` sends `/textures/` and `/glbs/` their immutable header on success
only, so a 404 is never kept again (`acd9943e9`).

**Remember.** Publish a referrer only after everything it names answers 200, and
never send a long cache header on a 404.

### 8. The tunnel slowed every level to a crawl — 2026-11-08

For a few hours, map and model files on play.bfstats.io crawled: FHSWEurope's
Tulagi Island took 68 s to load on a warm browser cache, Tulagi's 12 MB
`scene.glb` arrived at ~43 KB/s and was cut off after 229 s, and the 103 MB
FHSWEurope `_shared/collision-meshes.json` (24.5 MB gzipped) took 193 s. Small
API calls through the same tunnel stayed fast, and textures were fine.

Where the time was, leg by leg:
- **nginx was not it.** From inside the mesh pod the same `scene.glb` took
  0.1 s; HAProxy logged `Tr` 0-4 ms for every mesh request.
- **The tunnel was.** HAProxy ended the stalled transfer `cD` (its 50 s
  `timeout client`: cloudflared stopped reading), and cloudflared logged
  `unexpected EOF` for it. Every cloudflared error in the 3 h before was on one
  connection (`connIndex=2`, edge 198.41.192.37). cloudflared had been up 10
  days; its CPU was idle.
- **Why it hurt so much:** `.glb`, `.json` and `.ndjson` are still `DYNAMIC` at
  Cloudflare (no Cache Rule for play/mesh, `features/asset-batch-downloads`
  "Still open" 1), so every level file crosses the tunnel on every load, while
  `/textures/` is `HIT` and was unaffected.

`kubectl rollout restart deployment/cloudflared -n cloudflared` fixed it at
once: the same `scene.glb` in 3.4 s, Tulagi's whole load in 28 s.

Seen alongside, not the cause: the mesh pod (`cpu: 200m`) was CPU-throttled in
45% of periods, mostly gzipping `collision-meshes.json` per request (6 s of its
quota each), which has no `.gz`/`.br` beside it.

**Remember:** when the site's level files crawl but the API is fast, time a
file from inside the mesh pod first; if nginx is fast there, read the
cloudflared log and restart the tunnel. The lasting fix is the edge Cache Rule
for play.bfstats.io and mesh.bfstats.io, so level files stop crossing the
tunnel at all.

### 7. The netcode route took the viewer's own modules — 2026-09-28

Applying `deploy/app/ingress/deployment.yaml` for the REPLAY feed (the play
host's `/stats` to the API, features/replay-feed) also applied a line the repo
had carried unapplied: `use_backend mesh_frontend if host_play_bfstats
!is_netcode`, with `acl is_netcode path_beg /netcode`. `path_beg` matches
`/netcode.js` and `/netcode-*.js`, modules both `play/index.html` and
`map.html` import, so on play.bfstats.io they went to the disabled netcode
backend and answered 503: the front end stuck on "Loading…" and no level page
started, from 19:53:25Z to 20:02:57Z. mesh.bfstats.io and bfstats.io were
unaffected. The pages themselves answered 200, which is what the post-apply
check looked at.

The ACL is now `path /netcode` or `path_beg /netcode/`.

**Remember:** a `path_beg` ACL on a host that serves static files matches file
names too; end the prefix with `/` or match the exact path. After an ingress
change, load a page in a browser (or fetch its modules), not just its HTML.

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

**Remember:** use the `sqlite-tools` container, which runs as uid 1000.

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

- **Level files are not edge-cached** (#8). `.glb`, `.json` and `.ndjson` on
  play.bfstats.io and mesh.bfstats.io are `cf-cache-status: DYNAMIC`, so every
  one crosses the tunnel to the single node. A zone Cache Rule matching those
  two hosts, eligible for cache with edge TTL from the origin's
  `Cache-Control`, takes them off it. Dashboard work, outstanding.

- **WAL growth.** `wal_autocheckpoint` is 1000 pages (4MB); the WAL has been observed at
  **216MB** because checkpoints couldn't complete against constant writers. A clean pod
  shutdown brought it back to 76MB. Every reader consults the WAL index, so this is worth
  its own investigation if it climbs again. (`NODE_TUNING.md`)
- **Server search ~450ms.** `SearchServersAsync` does a `LIKE '%query%'` scan plus a
  `PlayerSessions` lookup per request. Healthy, but the slowest endpoint measured on
  2026-08-16. Its paging is also wrong (`TotalPages` hardcoded to 1, backfill has no
  `Skip`).
