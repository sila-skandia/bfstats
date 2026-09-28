# The REPLAY tab as a feed of shared recordings

The request (2026-09-28): turn the play front end's REPLAY tab into a social
feed of recordings, newest first or most viewed, which means counting views;
YouTube-style comments ("0:21 get rekt"); uploads by players; 20 GB for all
recordings, on the node's root disk through a PV (the local-path provisioner
already serves /mnt).

Before this, REPLAY opened a file picker, and sharing a round meant the owner
putting it in FileBrowser (features/gameplay-recordings).

## Status

Built (2026-09-28), verified locally end to end. Production needs the
rollout steps below, in order.

## What a visitor sees

**REPLAY** (`play/index.html?tab=replay`). The menu's background and tab
strip, with the feed in the frame where a page of the menu sits. The game has
no such screen, and titles and comments are free text the menu's bitmap faces
cannot draw, so the feed is DOM in the replay chrome's look (dark plates, a
khaki heading strip, olive-edged buttons), as the Open recording panel already
was. On a phone held upright the menu draws at the top and the feed takes the
rest of the screen.

- **Cards**, newest or most viewed first, 24 a page with Show more (paged on
  the server). A card's cover is a frame of the replay when the uploader set
  one, else the level's loading screen with the level's name, as the game
  shows a level before it loads. The mod's badge, the length, the title, level
  and game type and server, the uploader, views and age.
- **The cover plays the round; the title opens its page.** The page has the
  facts (level, game type, server, when and by whom it was recorded, length,
  players), Watch, Copy link, and for its uploader or an admin Rename and
  Delete.
- **Comments**, newest first or in round order. A time in one (`0:21`,
  `12:40`, `1:02:03`) is a link that opens the replay at that moment
  (`&t=21`); a time past the recording's end stays text.
- **Share a recording**: pick or drop a `replay_*.ndjson` (and its `ev_*.xml`
  server log). The browser reads it with the replay's own parser (level,
  game type, server, recorder, length), recognises the level by its flags for a
  file begun mid-round (and asks when the flags match none), gzips it with
  `CompressionStream` and uploads it with progress. The same round shared
  twice is refused with a link to the one already there.
- **Watch a file** keeps the old behaviour: play one from disk without
  sharing it. A file dropped anywhere on the page still does that too.

**In the replay** (`map.html?replay=/stats/recordings/<slug>.ndjson`), a
shared recording:

- counts a view once the round has loaded;
- starts at `&t=`;
- has a Comments button on the bar (T, as T opens the chat in the game), a
  panel beside the round with each time a place to jump to, the comment
  nearest before the playhead lit, and a box that starts with the moment on
  screen (`4:12 `); Enter posts;
- marks each timed comment on the timeline; a click jumps there;
- brings each timed comment up as the round passes its moment, while the
  panel is shut;
- for its uploader or an admin, F or More > Use this frame as the cover (F
  is fullscreen for everyone else);
- leads back to its page in the feed from the Escape menu.

A recording opened **from disk** gets a Share button on the bar: the frame F
picked, or else the frame on screen, is its cover, and once shared the page
carries on as the shared recording (its address, its comments) without
loading the round again.

## Signing in

Comments and shares need a bfstats.io account (Discord) and go up under one
of the account's linked in-game names, as comments on players, servers and
tournaments already do. An account with none links one on the spot
(`POST /stats/auth/player-names`, what the dashboard does).

play.bfstats.io signs in through bfstats.io's own session: the refresh cookie
is `rt; Domain=bfstats.io; Path=/stats`, so once HAProxy sends the play host's
`/stats` to the API (the one-line change below), a visitor signed in on
bfstats.io is signed in here, and the page fetches its own access token with
`POST /stats/auth/refresh`. It does that only when it holds none: two refreshes
racing on one cookie trip the refresh token's reuse detection and revoke the
whole session, bfstats.io's included. A visitor who is not signed in goes to
`bfstats.io/auth/discord/start?returnTo=<the page>`, through Discord, and back
(`ui/src/views/DiscordStart.vue`, `ui/src/services/authReturn.ts`). Only
bfstats.io's own hosts are taken as a place to go back to, and a return
address older than 15 minutes is dropped, so an abandoned sign-in cannot
hijack a later one.

A page served from this PC talks to the API running here (`dotnet run`, :9222)
when one answers, with its dev sign-in, else reads the live feed from
bfstats.io, read-only (the feed's reads are CORS-open for that). `?api=local`,
`?api=live` or `?api=<origin>` says which, for the tab.

## The API

`api/Recordings/`, under `stats/recordings`:

| | |
|---|---|
| `GET /` | the feed: `sort=recent` (by id; the ExtendedIso `CreatedAt` strings do not sort) or `views`, `page`, `pageSize` (max 48), and the space used |
| `GET /{slug}` | one recording, with `canManage` for its uploader or an admin |
| `GET /{slug}.ndjson`, `.xml`, `.jpg` | the recording, its server log and its cover. The first two are stored gzipped and sent as they are (`Content-Encoding: gzip`): the browser unpacks them and the API spends no CPU compressing. The cover's link is versioned, so it keeps a year. |
| `POST /` | share one: multipart `meta` (JSON), `recording`, `serverlog`, `thumbnail` |
| `PATCH`, `DELETE /{slug}` | rename, remove (uploader or admin) |
| `PUT /{slug}/thumbnail` | the cover, re-encoded by ImageSharp as a JPEG no wider than 640 px, so what is served is an image this code made |
| `POST /{slug}/views` | a view (202) |
| `GET`, `POST /{slug}/comments`, `DELETE /{slug}/comments/{id}` | comments; `sort=time` is round order. Deleting is for the author, the recording's uploader or an admin. |
| `GET /me` | the names the signed-in visitor posts as |

**The upload** streams: MVC's form value providers are switched off for it
(`DisableFormValueModelBindingAttribute`; they read a whole multipart body
before the action runs), each part goes to `.incoming/` on the recordings
volume (gzipped on the way if the browser could not), and
`RecordingInspector` reads it back in one pass: the bf42plus header on the
first line (the check the viewer makes of a dropped file), the level, game
type, mod, server, players and recorder from the few records that say them,
the length from every record's `t`, and SHA-256 of the whole. What the file
says wins over what the browser sent; the browser's reading fills in what the
file does not say. Then, one upload at a time, the quota and the disk are
weighed, the files are renamed into place, and the row is written.

| Limit | |
|---|---|
| All recordings | 20 GiB, gzipped, covers and server logs included (`Recordings__QuotaBytes`) |
| The disk | never below max(8 GiB, 15%) free (`MinFreeBytes`, `MinFreeFraction`): it is the node's root disk, where the kubelet garbage-collects images at 85% and evicts pods at 90% |
| One recording | 95 MB gzipped (Cloudflare refuses a request body over 100 MB), 1 GiB unpacked, 16 MB a line |
| One server log | 20 MB gzipped, 256 MB unpacked |
| A cover | 1 MB in, 16 to 4096 px a side |
| Titles, comments | 100 and 1000 characters, plain text: control characters and bidi overrides removed, never rendered as HTML |
| Rate | per address (Cloudflare's `CF-Connecting-IP`): 10 uploads an hour, 20 comments or covers in 10 minutes, 60 views a minute |

A recording is in the feed only while its file is on disk: the root disk is
not backed up, so `RecordingFileReconciler` looks every six hours (and at
start-up) and marks a recording whose file has gone as missing. Sharing the
same file again puts it back under its old link, views and comments intact.

**Views** are written in batches, a few seconds apart (`RecordingViewCounter`),
not one UPDATE per request: the aggregate sweeps hold long write transactions
on this database and a request waiting one out would hold a pooled connection
(deploy/PRODUCTION_ISSUES.md). A viewer counts once in six hours: a signed-in
user by id, anyone else by a keyed hash of address and browser, so no address
is kept. A batch the database will not take is retried and then dropped.

**Account data**: an account's export lists its shared recordings and its
comments on recordings; erasing it removes both (the recordings with everyone's
comments on them, and their files).

## Storage

`deploy/app/recordings-storage.yaml`: a 20Gi hostPath PV at
`/var/lib/bfstats/recordings` on the node's root disk, and its claim, bound
statically (`storageClassName: ""`, so the default local-path class on /mnt
does not provision one instead), reclaim Retain. The API mounts it at
`/mnt/recordings`; an init container hands the directory to uid 1000, since
the kubelet makes a hostPath directory root-owned and fsGroup does not reach
one. Recordings are served by the API, not the mesh nginx: one pod owns the
volume, and a recording is a few MB gzipped.

## Rollout

Every step touches production; each one is confirmed before it runs.

1. **Room on the root disk.** `ssh -i ~/.ssh/hetzner root@77.42.38.148 df -h /`
   (or `kubectl get --raw /api/v1/nodes/<node>/proxy/stats/summary`). The
   quota is 20 GiB and the API keeps max(8 GiB, 15%) free on top.
2. **The volume.** `kubectl --context hetzner apply -f deploy/app/recordings-storage.yaml`;
   `kubectl -n bf42-stats get pvc bfstats-recordings` shows Bound.
3. **HAProxy.** `kubectl --context hetzner apply -f deploy/app/ingress/deployment.yaml`
   then `kubectl --context hetzner -n haproxy rollout restart deployment/haproxy`
   (a few seconds without any bfstats site). Until this, play.bfstats.io's
   `/stats` is the mesh nginx's 404 and the feed says it cannot be reached.
4. **The API deployment** (mount, init container, `Recordings__Path`): Jenkins'
   API stage only restarts the pod, so `kubectl --context hetzner diff -f deploy/app/deployment.yaml`
   first, then apply. The pod restarts once (`strategy: Recreate`).
5. **Push.** Jenkins builds the API (the migration runs at start-up), the UI
   (the sign-in route) and the mesh image (the feed and the replay's comments).
6. **Check**: `play.bfstats.io/play/index.html?tab=replay` lists; share a
   recording; watch it; comment; its view counts.

## Trying it locally

The viewer (`python3 -m http.server 5273 --directory tools/bf1942-models/viewer`)
finds an API on :9222 by itself. Run one with a throwaway database and its dev
sign-in:

```bash
cd api && ASPNETCORE_ENVIRONMENT=Development E2E_SEED=true DB_PATH=/tmp/feed.db \
  Jwt__PrivateKey="$(base64 -w0 ../.e2e/jwt-e2e.pem)" RefreshToken__Secret="$(cat ../.e2e/refresh-secret)" \
  Recordings__Path=/tmp/feed-recordings dotnet run --no-launch-profile --urls http://localhost:9222
```

(`./scripts/bootstrap-worktree.sh` makes the `.e2e/` key and secret.) Then
`localhost:5273/play/index.html?tab=replay`: Sign in (dev) is the seeded
admin. With no API on :9222 the page reads the live feed, read-only;
`?api=<origin>` points it anywhere for the tab.

## Verification

- `tests/api/Recordings/`: the inspector (a real bf42plus layout, a half
  line, mods, a recording begun mid-round, not-a-recording, not gzip, a
  bomb), the upload end to end against SQLite and a temp directory (gzipped and
  plain, the browser's reading filling in, duplicates, a missing file put back,
  names not linked, size, quota and disk refusals), the feed's order and
  paging, comments' times, counts and who may delete them, rename and delete,
  covers, views once a window, the file check, and account export and erasure.
- `tools/bf1942-models/tests/test_recordings_api.py`: which `?replay=` is a
  shared recording and on which API, the times in a comment, readable queries,
  the watch links.
- `ui/e2e/replay-feed-signin.spec.ts`: a bfstats.io return address is kept, a
  foreign one and a stale one are not, and the callback goes back.
- By hand against the worktree's API and viewer (2026-09-28), the real Midway
  recording (6.5 MB, stored as 1.5 MB): shared through the feed's dialog and
  with curl, served back byte for byte gzipped; the duplicate refused with its
  link; comments with working time links; the feed at 1280 and on a 375 px
  phone. In headless Chromium (Vulkan): `&t=21` started the round at 0:21, the
  view counted once (and not again for the same viewer), T opened the panel
  with `0:23 ` in the box and Enter posted in round order, the timeline gained
  its mark, the round brought the 0:21 and 0:23 comments up as it passed them,
  the cover set from the frame on screen (640x360 JPEG), and a recording opened
  from disk shared from the bar with its cover, the page carrying on as the
  shared one.

## Later

- The recordings FileBrowser published to `mesh/replays/` (two so far) are not
  in the feed; share them through it to bring them in.
- A report button and an admin view of what was shared, when the feed needs
  moderating.
- Covers for recordings shared from the feed's dialog come from the replay
  (F, or More > Use this frame as the cover); the dialog cannot render the level.
