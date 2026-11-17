# Replay usage metrics, and where Seq keeps its data

The request (2026-11-17): add metrics to the replay system to see who is
watching and using it, in Seq; and keep Seq on the VM's own SSD, since k3s's
local-path provisioner is pointed at the network volume for SQLite and Neo4j
and cannot be changed.

## Status

Built and verified (2026-11-17). Part 2 needed no change: Seq already is on the
local SSD (below). Production picks up part 1 with the next API deploy; it adds
no migration, no setting and no endpoint.

## Part 1: the `ReplayUsage` event

The play front end (play.bfstats.io, `tools/bf1942-models/viewer`) is not the
SPA, so its visitors never reach `stats/telemetry/page-view` and the Seq
traffic dashboards (features/seq-dashboards) cannot see them. The API sees all
of them anyway: the replay page calls it to open a recording, comment, share,
and so on. So the events come from the API, at the controllers, with nothing
new for the page to send.

`api/Recordings/ReplayUsage.cs` writes one Serilog event per action:

```
ReplayUsage {ReplayAction} slug={ReplaySlug} viewer={ReplayViewerId} signedIn={ReplaySignedIn} surface={ReplaySurface} detail={ReplayDetail}
```

| `ReplayAction` | Written when | `ReplayDetail` |
| --- | --- | --- |
| `feed` | The REPLAY feed's first page is read (not each page scrolled) | sort word, plus `+server`, `+uploader`, `+player`, `+source` for filters that were on. Never the names typed |
| `link_open` | `replay.bfstats.io/<slug>` is opened (the short link page) | `edit` when the link carries a creator's edit |
| `view` | The replay page opens a recording (`POST .../views`) | |
| `comment` | A comment is posted | |
| `reaction` | A like or reaction is given (taking one back is not logged) | the reaction's kind |
| `upload` | A recording is shared | |
| `edit_share` | A creator shares an edit of a clip | |
| `short_link_open` | A Short's share link (`/replay/s/<slug>`) is opened | |
| `short_view` | A Short starts playing | |
| `short_share` | A signed-in creator shares a Short from the studio | `studio` |

What each property is for:

- `ReplayViewerId` is the same id for one visitor across every action, so
  `count(distinct(ReplayViewerId))` is the audience: `u:<account id>` when
  signed in, else a keyed hash of the address and browser.
- `ReplaySurface` is the host of the request's `Origin`, else its `Referer`
  (`play.bfstats.io`, `replay.bfstats.io`, `localhost` for someone's local
  viewer). Host only: a path or query can name a recording nobody shared.
- `ReplaySlug` is the recording's (or Short's) slug, which is public in its link.

### Decisions

- **What happened, not the deduplicated count.** `Recordings.ViewCount` counts a
  viewer once per `ViewWindowHours`. The event is written for every request, so
  Seq shows how often someone opens recordings; unique viewers come from
  `count(distinct(...))`, which is the same idea computed over any window.
- **Written at the controller, after the action worked.** A comment or an
  upload the service refused is not logged as use. A `view` of a recording that
  is not there is not logged.
- **No new constructor arguments.** The helper takes the logger factory and
  configuration from `HttpContext.RequestServices`, so no controller test and
  no DI registration changed. It never throws: a metric must not fail a
  request.
- **Crawlers are dropped** the same way the page-view beacon drops them (the
  `is_bot` tag `RequestTelemetryMiddleware` sets), so link unfurlers do not
  read as audience.
- **The viewer id has a key of its own** (`replay-usage|<secret>`), not the one
  `RecordingViews` stores. The stored keys cannot be matched to Seq's, and Seq
  cannot be matched to a visitor's address: neither the address nor the browser
  string is in any property. Signed-in ids are the account id, as they already
  are in the recordings tables.
- **Not logged:** the NDJSON/XML/JPG file reads (the view already says someone
  opened the recording, and a feed card's thumbnail would count a visitor 20
  times per page), and comment/recording reads.

### Dashboard

The queries, with the Seq setup, are in
[seq-dashboards](../seq-dashboards/README.md), "Dashboard: Replay". They were
run against a throwaway Seq 2025.2 (see "Checked").

### Checked

- `tests/api/Recordings/ReplayUsageTests.cs` (11 tests): the event's fields; one
  id for one visitor across actions and a different one for another; `u:<id>`
  when signed in; the id is not the stored view key, and no address or browser
  string is in the event; a bot is not counted; the surface is a host, never a
  path; a missing request or logger factory does not throw; the real
  controller's `View` and `List` log what they should and nothing for a missing
  recording or the feed's second page; a filtered feed names the filters, not
  the values.
- Every dashboard query was run against Seq 2025.2 in Docker with 400 seeded
  `ReplayUsage` events in the same shape. Each returned rows (actions by type,
  unique viewers per day, signed-in versus anonymous audience, most-watched
  recordings, surfaces, the busiest viewers, creator actions per day).
- `tests/api` Recordings and Shorts controller tests pass (88).

## Part 2: Seq on the VM's SSD

**Already the case, and live.** Checked read-only against production on
2026-11-17:

| | |
| --- | --- |
| Manifest | `deploy/app/seq-deployment.yaml`: `hostPath: /opt/seq`, `DirectoryOrCreate`, since the first commit |
| Live deployment | the same: `hostPath /opt/seq`, `Recreate` strategy, no PVC |
| Disk | `/opt/seq` is on `/dev/sda1`, the 76 GB local OS disk (`findmnt`), not `/dev/sdb`, the network Cloud Volume |
| Size | 776 MB after 96 days of this pod; `/` has 44 GB free of 75 GB |

So the shape the request describes (SQLite and Neo4j on the local-path PVCs
under `/mnt/bfstats-data`, which cannot move; everything disposable on the
local SSD by `hostPath`) is how the cluster is already laid out, and Seq, the
recordings (`deploy/app/recordings-storage.yaml`) and the search index
(`features/omnisearch-fts5`) are all on it. Nothing in the manifests changed.

What was missing was a record of it. `deploy/NODE_TUNING.md` now lists Seq
among what the root disk holds, with the budget below, and its data-volume row
says 300 GB (it said 80; `df` reads 295 GB).

### The root disk's budget

Three things share `/dev/sda1`, and none is backed up:

| | now | bound |
| --- | --- | --- |
| Seq `/opt/seq` | 776 MB | none of its own: Seq's retention policies (Settings, Retention) are the only cap |
| Recordings `/var/lib/bfstats/recordings` | 11 GB | 20 GiB quota, enforced by the API |
| The API's free-space floor | | max(8 GiB, 15%) free, refused uploads beyond it |

Seq has averaged about 8 MB a day (776 MB over 96 days, under whatever
retention it has), and the replay events add little: one small event per action. The thing to watch is that **Seq has no quota here**:
if its retention is ever set to keep everything, it eats the recordings' floor
before the kubelet's image GC (85%) does. Check:

```bash
ssh -i ~/.ssh/hetzner root@77.42.38.148 'du -sh /opt/seq /var/lib/bfstats/recordings; df -h /'
```

### Not done, and why

- **A PV/PVC for Seq (as the recordings have).** It would not add a bound, since
  a hostPath volume has none, and moving the pod to it means a restart and
  `kubectl apply` for nothing the pod does differently.
- **Pinning `datalust/seq:latest`.** The dashboards doc records behaviour that
  differs between 2025.x and 2026.1 (`IngestOtlpMetrics`), and `latest` has
  been fine for 96 days; pinning is a separate decision from this one.
