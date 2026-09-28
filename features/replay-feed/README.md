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
  `CompressionStream` and uploads it with progress. **Shared by** is the
  player who recorded it, as the file names him; the account's linked names
  are offered beside it. The same round shared twice is refused with a link to
  the one already there.
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

Comments and shares need a bfstats.io account (Discord). A share goes up
under the name of the player who recorded it, read from the file (below), or
under one of the account's linked in-game names if the uploader picks one
instead; nothing has to be linked first. Comments go up under a linked name,
as comments on players, servers and tournaments already do, and an account
with none links one on the spot (`POST /stats/auth/player-names`, what the
dashboard does); so does a share when the file names nobody and the account
has nothing linked.

Who recorded a file is found the same way by the API
(`RecordingInspector`) and the dialogs (`replay-chapters.js`
`recorderName`): the player the roster marks `local` (a file begun
mid-round), else the pid of the recorder's own shots (v4's `local` rounds,
v3's trigger presses) under the name it had when he fired, or the name that
pid's chat goes out under (`skandia: gf`, for a file begun after the join by
a recorder that wrote no roster), else the round's only human. Of several
humans with nothing marking one, the file cannot say. All ten recordings on
this PC (v2 to v5, lab and public servers) name skandia. Linking a name is
the account's own say-so, and so is a file, so neither is more proof of who
someone is than the other; the account that shared a recording is kept either
way, for Rename, Delete and moderation.

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
| `POST /` | share one: multipart `meta` (JSON; `authorName` optional, the recording's player by default), `recording`, `serverlog`, `thumbnail` |
| `PATCH`, `DELETE /{slug}` | rename, remove (uploader or admin) |
| `PUT /{slug}/thumbnail` | the cover, re-encoded by ImageSharp as a JPEG no wider than 640 px, so what is served is an image this code made |
| `POST /{slug}/views` | a view (202) |
| `GET`, `POST /{slug}/comments`, `DELETE /{slug}/comments/{id}` | comments; `sort=time` is round order. Deleting is for the author, the recording's uploader or an admin. |
| `GET /me` | the names the signed-in visitor posts as |

**The upload** streams: MVC's form value providers are switched off for it
(`DisableFormValueModelBindingAttribute`; they read a whole multipart body
before the action runs), each part goes to `.incoming/` on the recordings
volume as it came (gzipped by the browser, or plain from one without
`CompressionStream`), and `RecordingInspector` reads it back in one pass and
writes what it read, gzipped afresh, beside it: the SHA-256 of the whole, the
length from every record's `t`, the level, game type, mod, server, players
and recording player from the records that say them. What the file says wins
over what the browser sent; the browser's reading fills in what the file does
not say. Then, one upload at a time, the quota and the disk are weighed, the
files are renamed into place, and the row is written.

**What is checked** (2026-09-29; `tests/api/Recordings/RecordingInspectorTests.cs`
has a case for each):

- *A recording is one.* Its first line is the recorder's header
  (`{"k":"h",...}`) and every line after it is a whole JSON object with its
  kind in `k`, read to its end, nothing after it. Only the last line may be
  broken (a crash cuts it short; it is skipped, as the viewer skips it); a bad
  line with records after it is refused by number. A header with nothing after
  it is refused as empty. Every real recording on this PC has every line whole.
- *A gzip upload is whole.* .NET's `GZipStream` hands back what it has of a
  stream cut short, without an error: half a file would have been taken for a
  shorter round. zlib checks a stream's trailer (CRC-32 and length) when it
  reaches it, and a whole stream ends in it, so the last four bytes must be
  the length unpacked; that refuses a cut stream, bytes after its end, and
  more than one member.
- *What is kept is what was read.* The stored file is the inspector's own
  gzip of the bytes it read, never the bytes as sent, so nothing that rode
  along after a gzip stream's end is ever served (about 20 ms a megabyte
  unpacked; 0.25 s for a ten-minute round).
- *What a file says of itself is held to what the feed stores.* A level, mod
  and game type must be a name the viewer can look up (`[a-z0-9_-]`, or it is
  not taken); a player or recorder is cut to 32 characters with control
  characters and bidi overrides out (a clan tag's cp1252 bytes, which the
  recorder writes as U+0080 to U+009F, stay); a server to 64; a record's time
  past a day is not the length. Before this a file could name a level in
  16 MB, or 128 players at 7 MB each: measured, a 0.88 MB gzip of repeated
  letters held 1.8 GB once read and 5.6 GB with the players serialised for
  its row, past the API's 3 GiB limit twice over, where the same file now
  holds 8 MB.
- *A server log is BF1942's.* Read with `XmlReader`: rooted at `bf:log`,
  every element in the `http://www.dice.se/xmlns/bf/` namespace, attributes
  plain, no DTD, no processing instruction but the declaration, no run of
  64 KB without markup (which bounds what the reader holds of one text). A
  log is usually unterminated (the server appends while the round runs), so
  one that is well-formed as far as it goes, read to its end, is one. Before
  this, anything starting with `<` was taken, and served from bfstats.io as
  `text/xml`: an XHTML `<script>` in an XML page runs as it would in HTML, with
  the site's cookies, and `POST /stats/auth/refresh` would have handed it the
  viewer's session.
- *A cover is one frame of pixels.* Decoded as JPEG, PNG or WebP only (what a
  canvas writes), one frame deep (ImageSharp decodes every frame of an
  animated image by default, each the size of the canvas: a megabyte of
  animated PNG could ask for gigabytes), with its metadata dropped, and
  written out afresh.

**Every stored file is served inert**: `X-Content-Type-Options: nosniff` and
`Content-Security-Policy: default-src 'none'; sandbox` on the `.ndjson`,
`.xml` and `.jpg`. The replay reads them with `fetch`, which neither touches;
a browser sent to one directly gets a page with no script, no loads and no
origin, whatever got past the checks above.

| Limit | |
|---|---|
| All recordings | 20 GiB, gzipped, covers and server logs included (`Recordings__QuotaBytes`) |
| The disk | never below max(8 GiB, 15%) free (`MinFreeBytes`, `MinFreeFraction`): it is the node's root disk, where the kubelet garbage-collects images at 85% and evicts pods at 90% |
| One recording | 95 MB gzipped (Cloudflare refuses a request body over 100 MB), 1 GiB unpacked, 16 MB a line |
| One server log | 20 MB gzipped, 256 MB unpacked, 64 KB without markup |
| A cover | 1 MB in, 16 to 4096 px a side, JPEG, PNG or WebP, one frame |
| Names in a file | a player 32 characters, a server 64; a level, mod or game type `[a-z0-9_-]{1,64}` |
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
  Jwt__Issuer=http://localhost:9222 Jwt__Audience=http://localhost:5273 \
  Recordings__Path=/tmp/feed-recordings dotnet run --no-launch-profile --urls http://localhost:9222
```

Without `Jwt__Issuer` and `Jwt__Audience` the dev sign-in hands out a token the
API itself refuses (IDX10208), and every share and comment is a 401.

(`./scripts/bootstrap-worktree.sh` makes the `.e2e/` key and secret.) Then
`localhost:5273/play/index.html?tab=replay`: Sign in (dev) is the seeded
admin. With no API on :9222 the page reads the live feed, read-only;
`?api=<origin>` points it anywhere for the tab.

## Verification

- `tests/api/Recordings/`: the inspector (a real bf42plus layout and the
  repository's two real recordings, a half line, a bad line with records after
  it, an empty one, mods, a recording begun mid-round, not-a-recording, plain
  and gzip, a stream cut short, bytes after its end, what the file says of
  itself held to size, the recording player five ways, a real lab server log
  and markup that is not the game's, a bomb), covers (one frame of an animated
  PNG, no GIF, BMP or TIFF, no metadata kept), the files served inert, the
  upload end to end against SQLite and a temp directory (gzipped and plain,
  what is kept, the browser's reading filling in, duplicates, a missing file
  put back, the recording's player by default, a linked name instead, no name
  to be had, size, quota and disk refusals), the feed's order and
  paging, comments' times, counts and who may delete them, rename and delete,
  covers, views once a window, the file check, and account export and erasure.
- `tools/bf1942-models/tests/test_recordings_api.py`: which `?replay=` is a
  shared recording and on which API, the times in a comment, readable queries,
  the watch links, and the recording player the dialogs offer, found as the
  API finds him.
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
- The upload's checks and the name a share goes up under (2026-09-29),
  against this branch's API and main's side by side on this PC:
  - main took half a gzip stream of a 536 s Bocage round as a 271 s
    recording, and a server log carrying an XHTML `<script>`, which it then
    served as `text/xml`: opened in the browser, the script ran on the API's
    origin. This branch refused both ("not whole", "not a BF1942 event
    log"), and the same log planted on its disk opened inert ("Blocked script
    execution ... the document's frame is sandboxed").
  - the inspector over every recording (ten, v2 to v5) and server log
    (fourteen) on this PC: all taken, every recording's player skandia,
    re-gzipped in 1 to 250 ms.
  - in headless Chromium (Vulkan), signed in as the dev admin with nothing
    linked: the feed's dialog offered Shared by skandia alone and the share
    went up as skandia; with Rut linked it offered skandia first, then Rut,
    and picking Rut shared a Kursk round as Rut, recorded by skandia. Share
    on the replay's bar, for a Bocage round watched from disk, offered
    skandia and shared it, cover and all.

## Later

- The recordings FileBrowser published to `mesh/replays/` (two so far) are not
  in the feed; share them through it to bring them in.
- A report button and an admin view of what was shared, when the feed needs
  moderating.
- Covers for recordings shared from the feed's dialog come from the replay
  (F, or More > Use this frame as the cover); the dialog cannot render the level.
