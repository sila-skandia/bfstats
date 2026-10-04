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
  and game type and server, the uploader (with a link to their player page on
  bfstats.io beside the name, when the site has a player by it), views and age.
- **Filters** (2026-09-29): by server and by uploader, beside the order. Each
  one says All until a name is picked, then lights up with a clear button. Its
  list gives each name with how many recordings it would show beside the other
  filter, so no pair of choices comes up empty. A server or uploader named
  on a card narrows the feed the same way, and on a recording's page leads to
  all of theirs. The filter is in the address (`&server=`, `&uploader=`), so
  a narrowed feed can be linked and Back undoes a change. Not by mod, yet.
- **The cover plays the round; the title opens its page.** The page has the
  facts (level, game type, server, when and by whom it was recorded, length,
  players), Watch, Copy link (the short link, below, "Short links"), and for
  its uploader or an admin Rename and Delete (below, "Renaming and deleting").
- **A card's menu** (the dots beside its title), for its uploader or an admin:
  Rename and Delete.
- **Comments**, newest first or in round order. A time in one (`0:21`,
  `12:40`, `1:02:03`) is a link that opens the replay at that moment
  (`&t=21`); a time past the recording's end stays text.
- **Share a recording**: pick or drop a `replay_*.ndjson` (and its `ev_*.xml`
  server log). The browser reads it with the replay's own parser (level,
  game type, server, recorder, length), recognises the level by its flags for a
  file begun mid-round (and asks when the flags match none), gzips it with
  `CompressionStream` and uploads it with progress. Its title is offered as
  the level and the server (`Bocage on MoonGamers.com | Est. 2004`), to keep
  or write over. **Shared by** is the
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
- has More > Copy link at this moment, for anyone: the short link with `?t=`;
- for its uploader or an admin, F or More > Use this frame as the cover (for
  anyone else F says who can), and More > Rename and Delete;
- leads back to its page in the feed from the Escape menu.

A recording opened **from disk** gets a Share button on the bar: the frame F
picked, or else the frame on screen, is its cover, and once shared the page
carries on as the shared recording (its address, its comments) without
loading the round again.

## Short links

Built 2026-10-05. A shared recording's link is `play.bfstats.io/replay/<slug>`,
and `?t=<seconds>` opens it at a moment. Copy link on a recording's page
hands it out, and so does More > Copy link at this moment in the replay, at
the playhead. When a round plays merged, the moment is put on the first
recording's own clock: the link opens that recording alone, with the round's
switch a press away. The slug is the one the feed always had (ten characters
with no 0/o, 1/l or i), so a short link needs no table of its own, and one
retyped in capitals still opens.

HAProxy sends the play host's `/replay/` to the API (`deploy/app/ingress`).
The API answers with a page, not a redirect: Discord, Slack and the messengers
unfurl a link by reading the page it names, and behind a redirect they would
read map.html's tags, the same for every recording. The page
(`RecordingShortLink`) carries the title, a line like
`Wake · Conquest · 2:43 · MoonGamers.com · shared by skandia`, the cover (the
round's when the recording has none of its own), and a zero-second refresh to
the address Copy link handed out before
(`/map.html?mod=…&map=…&replay=/stats/recordings/<slug>.ndjson…`). A refresh
replaces the history entry, so Back from the replay goes to the page the link
was on. A link to no recording gets a 404 page that leads to the feed. The
title is escaped, and the page loads nothing (`default-src 'none'`).
`Recordings__PlayOrigin` (default `https://play.bfstats.io`) is the origin
the page's tags name.

A page served from this PC hands out the short link for the live feed's
recordings, which play.bfstats.io answers. For a recording on this PC's own
API it hands out the long link, since no host answers a short link for that.

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
`bfstats.io/auth/login?returnTo=<the page>`, picks Discord or a
username+password (the same combined sign-in page as the dashboard,
`ui/src/views/v4/AuthSignInV4.vue`), and comes back
(`ui/src/services/authReturn.ts`). Only
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
| `GET /` | the feed, a page of cards (a round of several recordings is one, below, "Rounds"), each with `canManage` for the one asking (and each of a round's recordings likewise): `sort=recent` (by id; the ExtendedIso `CreatedAt` strings do not sort) or `views`, `page`, `pageSize` (max 48), `server` and `uploader` (exact names, trimmed), and the space used (everyone's, filtered or not). `totalCount` counts cards, `recordingCount` the recordings on them. |
| `GET /filters` | the servers and uploaders to narrow the feed to, each with how many cards it would show, `server` and `uploader` as for the feed: each list is counted within the other filter and not its own. The busiest 100 of each, by name. |
| `GET /{slug}` | one recording, with `canManage` for its uploader or an admin. It and the feed's cards carry `uploaderPlayer`: the uploader as bfstats.io has a player page for them (a recorded name's bytes read as cp1252, as BFList reads them), or null; the page links to `bfstats.io/v4/players/<it>` beside the name |
| `GET /{slug}.ndjson`, `.xml`, `.jpg` | the recording, its server log and its cover. The first two are stored gzipped and sent as they are (`Content-Encoding: gzip`): the browser unpacks them and the API spends no CPU compressing. The cover's link is versioned, so it keeps a year. |
| `POST /` | share one: multipart `meta` (JSON; `authorName` optional, the recording's player by default), `recording`, `serverlog`, `thumbnail` |
| `PATCH`, `DELETE /{slug}` | rename, remove (uploader or admin) |
| `PUT /{slug}/thumbnail` | the cover, re-encoded by ImageSharp as a JPEG no wider than 640 px, so what is served is an image this code made |
| `POST /{slug}/views` | a view (202) |
| `GET`, `POST /{slug}/comments`, `DELETE /{slug}/comments/{id}` | comments; `sort=time` is round order. Deleting is for the author, the recording's uploader or an admin. |
| `GET /me` | the names the signed-in visitor posts as |
| `POST`, `DELETE /{slug}/round` | an admin puts the recording in another's round (`{"with": "<its slug or any link to it>", "confirm": false}`), or takes it out of its own for good; the recording's page after (below, "Rounds"). Two recordings whose files fall short of what detection needs are a 409 with `evidence` until `confirm` is true. |

A round's card and a recording's page carry `round`: every recording of its
round still in the feed, itself among them, in the order they began in the
round, each with `roundOffsetSeconds` (where its `t = 0` falls on the clock of
the one that began first), `link` (`self`, `detected`, `linked` by an admin,
or null when tied through another), that link's `matchedKeys` and
`playerShare`, and `weakLink` for an admin's link they fall short on; null
while it is the only one. A round's card is its lead's summary with
`roundCard` (below); the page adds `canEditRound` for an admin and
`roundWeak`.

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
- *An upload costs what its size says.* The whole pipeline streams (each part
  to disk as it arrives, then read back 64 KB at a time), so what bounds an
  upload's memory is what it holds of one line, 1 MB (the longest real line is
  44 KB), and what bounds its CPU is how far it unpacks: every byte is read,
  hashed, parsed and gzipped again, 11 to 19 ms a megabyte. So a gzipped
  upload unpacks to no more than 32 times its size for a recording, 64 for a
  server log (real ones gzip four to eight, and up to thirty, to one), past
  64 MB, and a recording to 512 MB at most (over five hours of play). A 3 MB
  gzip bomb that unpacked to the old 1 GiB cost 11.4 s of CPU (2026-09-29);
  it is now refused at 95 MB, after 1.4 s.
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
  animated PNG could ask for gigabytes), at most 2048 px a side (16 MB
  decoded; the dialogs send 640x360), with its metadata dropped, and written
  out afresh.

**Every stored file is served inert**: `X-Content-Type-Options: nosniff` and
`Content-Security-Policy: default-src 'none'; sandbox` on the `.ndjson`,
`.xml` and `.jpg`. The replay reads them with `fetch`, which neither touches;
a browser sent to one directly gets a page with no script, no loads and no
origin, whatever got past the checks above.

| Limit | |
|---|---|
| All recordings | 20 GiB, gzipped, covers and server logs included (`Recordings__QuotaBytes`) |
| The disk | never below max(8 GiB, 15%) free (`MinFreeBytes`, `MinFreeFraction`): it is the node's root disk, where the kubelet garbage-collects images at 85% and evicts pods at 90% |
| One recording | 95 MB gzipped (Cloudflare refuses a request body over 100 MB), 512 MB unpacked and past 64 MB no more than 32 times its gzipped size, 1 MB a line |
| One server log | 20 MB gzipped, 256 MB unpacked and past 64 MB no more than 64 times its gzipped size, 64 KB without markup |
| A cover | 1 MB in, 16 to 2048 px a side, JPEG, PNG or WebP, one frame |
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

## Renaming and deleting

Built 2026-09-29, when the owner found no way to change a recording after
sharing it. The API had `PATCH` and `DELETE /{slug}` for its uploader or an
admin from the start, and a recording's page drew Rename and Delete for them,
but only when the page was read signed in, and it never was the first time:

**The race.** The feed asks for the cards and a recording's page alongside
its own sign-in, not after it, so the list comes up at once for a visitor who
is signed in nowhere. A visitor signed in on bfstats.io holds no token on
play.bfstats.io until `POST /stats/auth/refresh` answers, so their first read
went out as nobody: `canManage` false, and signing in redrew only the
comments. Reproduced against main with the refresh held back 1.5 s (a
recording's page, signed in as the admin, still showed only Watch and Copy
link five seconds on). Now the feed notes whom it read the cards and the page
as (`listAs`, `detailAs`), and once the sign-in lands, or on a sign-in or out,
reads again whatever it read as someone else: quietly, the cards staying up
until theirs come (`syncViewer`). Signing out drops every Rename, Delete and
Remove at once, with nothing to read again. The replay page never had this:
it waits for the sign-in before asking.

**Who.** The account that shared a recording (`Recordings.UploaderUserId`,
kept for every upload since the feed began, whatever name it went up under),
or an admin. Not the player who recorded it: anyone can link any in-game name
to an account, so a name is no proof of whose a recording is. A file shared
by someone else is theirs to delete, or an admin's.

**Where.**

- *A card's menu*: the dots beside its title, on the cards the viewer may
  change. Rename opens a box with the title (Save waits for a change; Enter
  saves); Delete asks first (`Delete "<title>"?`, whose it is and its length,
  "Its comments go with it. There is no undo.", Keep it focused). A deleted
  card goes at once and the cards are read again: a round it was one of may
  part.
- *A recording's page*: Rename (the title becomes a box in place; Enter
  saves, Escape leaves it) and Delete (the same question), as full buttons.
- *The replay*: More > Rename and Delete, under Use this frame as the cover,
  for the first recording when several play merged, as the cover is. Deleted,
  the page goes back to the feed. While one of its dialogs is up the keys are
  the dialog's: a title with an F or a T in it sets no cover and opens no
  comments.

**The API.** Each card and each recording of a round says `canManage` for the
one asking, as a recording's page always did (`RecordingService.Manages`, the
same rule the writes check); nothing about the account is exposed.

## Rounds

Built 2026-09-29. Players who record the same round share it separately; the
feed finds the uploads of one round by itself, shows them as one card, and
plays them merged (features/round-replay-merge).

### What a visitor sees

- **A round is one card** (2026-09-29, second pass; before it, each upload
  was a card of its own and a round of two showed as two near-identical
  cards). Its cover is the top of a deck: the round's other recordings are
  plates behind it, peeking over its top edge (one for two recordings, two
  for more), lifting a little under the pointer, with `N recordings` on the
  cover. The cover **plays the round merged**. Under the title and the lines a
  card always has, the round's recordings: who shared each, who recorded it
  where that is someone else, its length, and **Alone**, which plays it on its
  own; the name opens that recording's page. A card lists three; `and N more`
  opens the lead's page, which lists all.
- A recording on its own is a card as before.
- The header counts cards and, once a round makes them fewer than the
  recordings, both: `3 rounds · 5 recordings` (a recording on its own is a
  round recorded once). With no round of several it is the number alone.
- A recording's page leads with **Watch merged** (and Watch this one), and
  lists the round: when each recording began in it (`+1:00`), its title (a
  link to its page), who shared it and who recorded it, its length, and "put
  here by an admin" for an admin's link. Each upload keeps its own page,
  uploader, title, cover, comments, Rename and Delete; a round's card menu
  lists each of its recordings the viewer may change, by whose it is and its
  length (`skandia's recording · 8:56`), with Rename and Delete under each.
- **Watch merged** is `map.html?...&replay=<this one>&replay=<the next>...`:
  one `replay` per recording, the lead first (its clock and its recording
  player lead: from a card, the round's lead; from a recording's page or
  alone in the replay, that recording), then the others in round order, and
  the first's server log. The page fetches every one and merges them with
  `mergeRecordings` before the level loads (`replay.js` `openMerged`); the
  status line says "merged from N recordings". A link with one `replay` plays
  as before. A set the merge cannot line up, or whose alignment its guard
  finds incredible (two rounds: features/round-replay-merge, "The guard"),
  plays the first alone and says why: `Not merged. These look like different
  rounds: of the 551 kills and scores both recorded, 1 lines up, and the
  server's clock puts them 35:47 apart. Playing the first recording alone.`
- **In the replay, the switch.** A recording of a round, merged or alone, has
  a button on the bar beside Comments: the deck, `MERGED 2` or `ALONE 2` (the
  label folds away on a narrow bar, the count stays). Its menu, in the bar's
  own look: Merged (`Watch merged` when one plays alone), then each recording
  alone by who shared it, who recorded it and its length, the one playing
  marked ON. Picking one opens it at the moment on screen, moved onto its
  clock (`recordings-api.js` `roundMoment`: through the merged header's
  `merged[i]` when merged, else the links' `roundOffsetSeconds`; a moment
  before a recording began is its start, one past its end its end, and one
  whose place nothing measured starts at 0). A merge the guard refused marks
  the button with a warning dot, and its Merged is greyed out with the
  reason. The page reloads for the switch, the level from the browser's cache.
- **Share a recording** takes several `replay_*.ndjson` files at once: each is
  read, listed and shared as its own recording, under the player who recorded
  it, with a title box of its own (the level and the server until another is
  written; left empty, the API titles it the same way). A server log goes up only with a recording shared on
  its own, since it belongs to one. After a share, a removal, or an admin's
  link or take-out the feed asks the API for its cards again: a recording can
  join a round already there.

### The card, decided

The API groups (`RecordingService.ListAsync`), before it pages, so a page, the
counts and the order are the cards': a card is known by its round's id
(`Recordings.RoundId`, the round's lowest id), or the recording's own while it
is in none, and grouping by that is one `GROUP BY COALESCE(RoundId, Id)`. A
round whose other recordings have all left the feed (their files gone) is a
plain card.

| | a round's card |
|---|---|
| which recording it is | the lead: the longest (it covers the most of the round, so the merged clock and the player followed first are its), the first shared of equals |
| title, level, server, mod | the lead's |
| cover | a recording's own cover, the lead's first, else the first in round order that has one; else the level's loading screen |
| length | the merged span: from the first to begin to the last to end, where the links measured where each began; a recording whose place nothing measured (an admin's link with nothing to measure it by) counts its own length |
| uploaders | everyone who shared one, in round order, each narrowing the feed to theirs |
| views | the most-watched recording's: a merged watch counts a view on every recording of it, so a sum would count it once for each |
| comments | all of theirs |
| time | when its newest recording was shared |
| under **Newest** | by its newest recording: a second recording shared today brings yesterday's round back to the top |
| under **Most viewed** | by its views as above, then by its newest |
| under a filter | shown when one of its recordings would be shown on its own (the filter as a whole: that server and that uploader), and then whole; each filter choice counts the cards it would show, so a round counts once under each name one of its recordings has |

`roundCard` carries the round's own fields (`recordings`, `durationSeconds`,
`uploaders`, `viewCount`, `commentCount`, `createdAt`, `thumbnailUrl`, `weak`);
the summary's own fields stay the lead's, so a page cached from before still
reads a card as the lead's recording.

### Comments on a merged round

Comments stay on each recording, stamped in that recording's own clock, so a
recording's page, its `sort=time` order and its `&t=` links are unchanged. The
merged replay (`replay-social.js`) shows every recording's comments together,
each moved onto the merged clock with the merged header's `merged[i]`
(`t_round = offset + (1 + drift) t`), a time in its text said in round time
(to the nearest second) and marked on the timeline there, with "on
<uploader>'s" after its author. A comment written in the merged replay goes on
the recording whose stretch holds the first time it names, the first
recording's when it does or when it names none, its times rewritten into that
recording's clock (`recordings-api.js` `commentTarget`). Measured in the page:
`8:40 the last stand`, written at 8:40 of the merged Bocage pair, went on the
second side's recording as `7:40` (it began 60 s in); `1:00 the opening
push` went on the first's as `1:00`.

Mapping comments rather than keeping them per recording in the merged view
keeps one list in round order, where a merged replay's viewer reads them, at
no cost to a recording's own page. Each recording of a merged round counts a
view (of a merge refused, only the first, which plays alone); the cover (F)
and the Escape menu's way back to the feed are the first recording's.

### Detection

**The fingerprint** (`RoundFingerprintBuilder`, fed by `RecordingInspector` as
the upload streams, one extra JSON parse for the few records it reads): what
the server sends every client of a round, and only once play has begun, each
with the time the recording has it (its own clock, to the millisecond):

| key | what |
|---|---|
| kill | a kill or team kill (`score` 3, 6): the killer's name, the victim's, the weapon's template id |
| join, leave | `createPlayer` and `destroyPlayer`, by name |
| chat | a chat-box line to everyone, by its text: not a team line (`name [side]: text`, whatever the mod calls its sides), not the server's own (no pid, no side: adverts that come round every round on a timer). A line with no pid but a side counts: the recording player's own line can reach his chat box that way before the server relays it (his team line in the Bocage round did), and it says what everyone else reads. |
| object | `createObject` during play: net id and template id |

Names are the pid's at that moment: a public server hands a leaver's pid to
the next to join. The join's database (everything before `dbComplete`), what
a file begun mid-round holds of it (`ago`) and its roster name the players and
are never keys: the level's own objects take the same net ids every time it
loads (the Shokaku was 534 in two Wake lab rounds), so ids made at the join
would match any two rounds of one map. `destroyObject` is left out: it comes
in bursts of related ids, and 11 of them lined up at one offset between a
Bocage and a Tobruk round. A recorder starts a new file at every join
(bf42plus `replay.cpp`, 0x1A), so one file is one level load.

A fingerprint keeps at most 2048 keys of each kind (players', objects'); past
that a kind is sampled by hash, the same keys in every file, and two
fingerprints compare over the smaller sample. Stored as eight bytes a key
(hash, milliseconds): the 21-minute public Bocage round is 1694 keys (538
player), 13.5 KB. Building it costs 6 to 11 ms of the 190 to 460 ms the
inspector takes over that 22.9 MB file.

**Candidates** (`RecordingRoundService`): the recordings of the same level,
game type and mod on the same server (or naming none), whose headers' local
starts are within 26 hours plus the longer one's length of each other (each is
its PC's clock with no zone, and the world's zones span 26 hours), through the
index on `(Level, Mod, GameMode, ServerName, RecordedLocal)`. Only their
fingerprints are read, from the database; no recording file is read to
compare.

**The match** (`RoundMatcher`), the way the merge lines files up: every pair
of copies of a key either file has at most 4 of proposes an offset between
the two clocks; the one second of offsets holding the most keys wins, its
median the offset. At it, copies are paired one to one within a second. Two
recordings are one round when, over the stretch both cover,

- at least 8 keys pair (`RoundMinMatches`),
- at least 3 of them player keys (`RoundMinPlayerKeys`),
- and those are at least half the player keys either recording has there
  (`RoundMinPlayerShare`, of the fewer).

Object keys vote and are counted but never decide: two rounds of one map begun
from the same moment make their first objects under the same ids at the same
times. The first 15 s of play of one Wake lab round grafted onto the other's
(the node prototype) put 60 object keys at one offset, 0.61 of the pair's
keys, and no player key; two made-up rounds sharing one object stream put over
100 there (`RoundFingerprintTests`). Neither is one round. Kills, joins and
chat are play, and do not repeat from round to round at one offset.

The link records the offset (`t_first = t_second + offset`, the lower id's
clock), the keys and player keys paired, and both shares.

**Measured** (`tests/api/Recordings/`, and every recording on this PC):

| pair | offset | keys | player keys | player share | one round |
|---|---|---|---|---|---|
| the public Bocage round split by side (B begun 60 s in, clock 40 ppm fast, events 30 ms off) | 59.998 s | 581 | 171 | 1.0 | yes |
| the same round, B only 30 s long (300 to 330 s) | 300.006 s | 30 | 13 | 1.0 | yes |
| B 15 s long (100 to 115 s) | 100.011 s | 14 | 3 | 1.0 | yes |
| B 10 s long (100 to 110 s, 300 to 310 s) | | 4, 9 | 2, 2 | 1.0 | no (too few) |
| the Wake lab round, 30 s of it (40 to 70 s) | 40.018 s | 10 | 4 | 1.0 | yes |
| the two Wake co-op lab rounds (`replay_20260927-001120`, `-075756`) | | 0 | 0 | | no |
| Bocage 2026-09-28 against Bocage 2026-09-29, same server and mode | | 0 | 0 | | no |
| the next day's Bocage round in two files of one player (rejoined, no moment shared) | 5.925 s | 1 | 1 | 0.25 | no |
| every other pair of the seven recordings on this PC | | 0 or 1 | 0 or 1 | | no |

So the thresholds sit far from both sides: a pair of one round shares all of
its player keys over their overlap, different rounds share none or one. The
minimums set the shortest overlap found: 15 s of a busy public round, half a
minute of a lab round with bots. (The short rows are the node prototype of
this rule, over `tests/replay_split.mjs` splits of the recordings on this PC.)

### Grouping

A round is every recording its links reach (`RecordingRoundLinks`), so one
recording that shares a stretch with each of two others puts all three in one
round even when those two share none. `Recordings.RoundId` is the round's
lowest id, null while a recording is alone; it is worked out again from the
links whenever they change, and on a recording's removal (the delete, an
account's erasure, which take its links with them). A recording whose file has
gone stays in its round and leaves the feed's list of it until it is back.

**Admin link and take-out** (a recording's page, or the API above). Put in a
round names another recording by its id or any link to it (its page, its
watch link, its file). The two fingerprints are compared first
(`RecordingRoundService.Evidence`): a pair detection would call one round is
linked at once; one it would not is refused with what the files say, in a
line and in numbers, for the admin to read before saying yes:

> 1 shared event: these look like different rounds.
> 1 shared event · 0 of them the players' own · 0% of the players' events where
> both recorded · 8:43 recorded by both
> One round needs 8 shared events, 3 of them the players' own, and 50% of the
> players' events where both recorded.
> [Link anyway] [Leave them apart]

(the first real pair, kqqaqxdwtr and nj2dyh58te, below). The other lines:
`No shared event: nothing in their files says they are one round.` (two
rounds with nothing in common, or two stretches of one round that share no
moment, a player who rejoined: the files cannot tell which), `12 shared
events, 2 of them the players' own: ...`, `40 shared events, but 20% of the
players' events where both recorded: ...`, `Recorded on different levels or
game types: these cannot be one round.`, `Not compared yet: ...` (a
fingerprint still to be read). In the API: a 409 with `evidence` until the
request says `"confirm": true`. Linked, the pair carries what was measured.

Take out separates the recording from every recording of its round: those
pairs are marked separated, and detection never links them again. Linking a
separated pair again replaces the separation.

**A weak link, marked.** A round whose recordings are one only through an
admin's link they fall short on (measured below the thresholds, so the link
kept no offset, or not measured at all) is marked where admins look: a
pulsing `WEAK LINK` chip on its card in the feed (for an admin only), beside
This round on its recordings' pages, and on the recording the weak link ties
in, with its shared events. `roundWeak` on the page and `weak` on the card
say it: the round's recordings in the feed are not all reached from one
another through links detection found or would have. Its merged replay is
still asked for, and the merge's guard is the second check: the first real
pair's plays its lead alone with the reason.

**The background pass** (`RecordingRoundBackfill`), a minute after start-up
and every six hours: the recordings shared before fingerprints existed (or
under an older version, `RecordingFingerprint.CurrentVersion`) have theirs
read from their files, one at a time, streamed as an upload is; every
recording not yet compared under the current settings is compared; every
round is checked against its links. An upload finds its own round at once;
this catches the recordings already shared, an upload whose own attempt
failed, and a change of settings. Measured on this PC's API: three recordings
with their fingerprints and links cleared were read and grouped again within
a minute of the restart.

### Settings

`Recordings__RoundRareKey` (4), `RoundWindowSeconds` (1), `RoundPairSeconds`
(1), `RoundMinMatches` (8), `RoundMinPlayerKeys` (3), `RoundMinPlayerShare`
(0.5), `RoundCandidateHours` (26). A change to any of them compares every
recording again at the next background pass, from the database alone.

### For the owner: verifying with a pair now

1. Record the round on two clients, one on each side (round-replay-merge,
   "For the players").
2. Share both, from the feed's Share a recording: pick the two files at once.
3. The page that opens (the last one shared) lists both under This round, and
   the feed shows them as one card, a deck of two. If they do not, the files
   have too little in common where they overlap (a file begun late, a v2 or
   v3 recorder writing raw events): on one's page, under This round, paste the
   other's link and Put in its round. The line that comes back says what the
   files share; `these look like different rounds` means they are.
4. Watch merged, and read the merge report and the guard's lines in the
   browser console (round-replay-merge, "What the first real pair must
   confirm").

### For the players

Nothing new: record with bf42++ (`recordReplays = on`), share the file. A
round two or more players shared is found and offered merged by itself.
Recording from the join and staying to the end gives the most in common.

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

**Rounds** (2026-09-29) need nothing beyond the push. The migration
(`AddRecordingRounds`) runs at start-up: a nullable `RoundId` column and two
indexes on `Recordings` (the round's, and the candidates'
`Level, Mod, GameMode, ServerName, RecordedLocal`), both over a table of a few
dozen rows, and two new tables (`RecordingFingerprints`,
`RecordingRoundLinks`). A minute later the background pass reads the
fingerprint of every recording already shared from its file, one at a time
(0.2 to 0.5 s each for a 10 to 23 MB round), and groups them; the API's log
says `Recording rounds: N fingerprints read from their files`.

**A round as one card, the switch, the evidence and the guard** (2026-09-29,
second pass) need nothing beyond the push either: no migration, the card is
grouped from `RoundId` and the weak mark read off the links' kept evidence.
The API and the mesh image go out together; for the minutes between, a page
from before on the new API shows a round as its lead's card with the old
`2 recordings of this round` line, and a new page on the old API shows every
recording as a plain card. The admin link of the first real pair
(kqqaqxdwtr, nj2dyh58te) already made in production stays a link, now marked
weak for the admins, and its merged replay plays nj2dyh58te alone with the
reason; Take out of this round on either page parts them for good.

**Short links** (2026-10-05): push, then HAProxy (step 3's apply and restart)
for the play host's `/replay/` route. Before the restart a short link is the
mesh nginx's 404; the API's route is harmless without it.

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
API itself refuses (IDX10208), and every share and comment is a 401. On a disk
more than 85% full, uploads are refused as they would be on the node: add
`Recordings__MinFreeBytes=0 Recordings__MinFreeFraction=0`.

(`./scripts/bootstrap-worktree.sh` makes the `.e2e/` key and secret.) Then
`localhost:5273/play/index.html?tab=replay`: Sign in (dev) is the seeded
admin. With no API on :9222 the page reads the live feed, read-only;
`?api=<origin>` points it anywhere for the tab.

## Verification

Renaming and deleting (2026-09-29):

- `tests/api/Recordings/`: the feed's `canManage` for nobody, the uploader,
  another user, an admin and an account with no name linked; a round's card
  and a recording's page, each recording's own (the lead Rut's, skandia's
  first in round order).
- `tools/bf1942-models/tests/test_recordings_api.py`: which recordings a card
  offers to change (a round's, whether or not its lead is one), and the title
  a share offers (none while the level is unknown).
- By hand against this worktree's API (:9391, its own database and Redis db)
  and viewer (:5391), headless Chromium (Vulkan), four cut Bocage recordings
  from `tests/fixtures/`:
  - the dev admin shared two at once, one titled in its box and one left
    empty (the API's `Bocage on MoonGamers.com | Est. 2004`); renamed one from
    its card's menu (Save off until a change, Enter saved); asked to delete the
    other, Escape kept it, Delete took it; shared the 35 s slice of the first
    on its own with a title, and the API put the two in one round; the round's
    card menu listed `skandia's recording · 8:56` and `· 0:35`, each with
    Rename and Delete; at 375 px the menu and the rename box kept to the
    screen.
  - the race, main against this branch, the page same-origin as on
    play.bfstats.io with its `/stats` sent on to the worktree's API and the
    refresh held back 1.5 s: main's recording page, signed in as the admin,
    showed Watch merged, Watch this one and Copy link five seconds on; this
    branch's added Rename, Delete and the round tools, and its feed a menu on
    the card.
  - a second account (pois, no admin): no menu on the admin's cards and no
    Rename or Delete on their pages; shared one as pois, renamed it on its
    page, deleted it from its card; signing out took every menu at once.
  - the replay of the slice: More listed the cover, Rename and Delete;
    `Fast Tanks at the ford` typed into the rename box set no cover and opened
    no comments, and Enter renamed it (the tab's title too); Escape kept it
    from Delete, and Delete went back to the feed, where the round was a
    plain card again.

A round as one card, the switch, the evidence (2026-09-29, second pass):

- `tests/api/Recordings/RecordingFeedRoundTests.cs`: two made-up Wake rounds
  of two recordings each and two recordings on their own, one card a round,
  newest first (a round by its newest: the second recording shared after a
  single brings its round ahead of it) and most viewed (a round by its
  most-watched recording), paged by card (no round split across pages,
  `totalCount` 4 cards of `recordingCount` 6); a round's card whole (the lead
  the longer, the merged span 400 s over recordings of 200 s and 250 s, both
  uploaders in round order, the most views, all the comments, the newest
  share's time, the other recording's cover and then the lead's own first);
  a round with one recording left in the feed a plain card; a filter by the
  uploader of one recording of a round shows it whole, and the choices count
  cards.
- `tests/api/Recordings/RecordingRoundServiceTests.cs`: an admin's link of
  two recordings sharing one chat line asked first (409, `1 shared event:
  these look like different rounds.` or as many as chance adds), confirmed,
  and marked weak on the page, the member and the card, with no offset kept;
  the split Bocage pair taken out and linked back by an admin with no asking,
  not weak, its offset measured; the rejoined player's two stretches (`No
  shared event: ...`) asked, then linked on the admin's word; each line of
  the evidence.
- `tools/bf1942-models/tests/test_recordings_api.py`: the header's count, a
  card that is a round, and the switch's moment from merged, from a
  recording alone, past a recording's end and from a recording whose place
  nothing measured.
- By hand against this worktree's API (:9391, its own database, Redis db and
  no background jobs) and viewer (:5391), headless Chromium (Vulkan), signed
  in as the dev admin: the Kursk round of 2026-09-27 split by side
  (`tests/replay_split.mjs`) and a Wake lab round shared together from the
  feed's dialog, then the first real pair: the Kursk pair one deck, the Wake
  round a plain card, `4 rounds · 5 recordings`. On kqqaqxdwtr's page, Put in
  nj2dyh58te's round came back with `1 shared event: these look like different
  rounds.` and 8:43 recorded by both; Link anyway made one card of them,
  `WEAK LINK` on it and on the page, `3 rounds · 5 recordings`. A third file of
  the Kursk round (another player's, from 50 s) joined its deck, two plates
  now. The Kursk card played merged from 3 recordings (the guard: 53 of 53
  kills and scores, 44 of 44); the switch went to Bonk alone at merged 1:10,
  his own 0:40, and Watch merged from his 0:40 came back to 1:10 with him
  leading. The Bocage card's merge was refused and nj2dyh58te played alone,
  the toast and the switch saying why. Screenshots at 1280 and 375.

Rounds (2026-09-29):

- `tests/api/Recordings/RoundFingerprintTests.cs`: what a fingerprint holds (the
  join's database and held records never keys but names, names at the time
  through a pid handed on, lines to everyone only, the sampling); the split
  Bocage pair one round at its offset both ways; the two Wake lab rounds and
  both halves of the split against the next day's Bocage round not; two
  made-up rounds with one object stream not; a pid handed on; short overlaps.
  Real recordings cut to the lines a fingerprint reads, in
  `Fixtures/rounds/` (154 KB, made by `make_round_fixtures.mjs`).
- `tests/api/Recordings/RecordingRoundServiceTests.cs`: shared through the
  upload, the split pair grouped with its offset on the page and the cards;
  another round of the map not; another server, map or game type never
  compared; three recordings chained; the one that joined two removed, and an
  account erased, leaving the other two apart; a file gone; the backfill; an
  admin's take-out holding against detection, and an admin's link; a recording
  named by any link to it.
- `tools/bf1942-models/tests/test_recordings_api.py`: the watch-merged link,
  a round's comments moved onto the merged clock, and where one written there
  goes.
- By hand against this worktree's API and viewer (2026-09-29), headless
  Chromium: the whole Bocage round split by side and the next day's Bocage
  round shared together from the feed's dialog; the pair grouped, the third
  not; the pair watched merged from a card (3130 events matched, offset
  59.9992 s, as the merge measured it); two comments written in the merged
  replay each went on the recording holding their moment; an admin took one
  out and put it back; the feed and the page at 1280 and on a 375 px phone;
  the API restarted with the rounds cleared and grouped them again.

The feed and the upload (2026-09-28):

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
  The filters: a server, an uploader or both, trimmed, the space still
  everyone's; each list's counts within the other filter, by name ignoring
  case, a recording naming no server and one whose file is gone left out.
- `tools/bf1942-models/tests/test_recordings_api.py`: which `?replay=` is a
  shared recording and on which API, the times in a comment, readable queries,
  the watch links, the recording player the dialogs offer, found as the
  API finds him, and the filters' queries and addresses.
- The filters by hand (2026-09-29), twelve synthetic rounds on four servers
  by four uploaders against the worktree's API: a server picked narrowed the
  cards and the uploaders' counts, both together, Back undid one, the clear
  button, a name on a card and on a page, a server nobody recorded on (No
  recordings match, still clearable), leaving the tab, two changes in a row
  (the last one wins), a real click and ArrowDown on the select; at 1280 and
  on a 375 px phone, where both filters keep one row.
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

Short links (2026-10-05):

- `tests/api/Recordings/RecordingsControllerTests.cs`: the page's refresh
  target, preview tags and escaped title, the round's cover standing in, the
  404 page (and no lookup for a malformed slug), `?t=` read as whole seconds.
  `test_recordings_api.py`: which short link a page hands out, on the play
  host, for the live feed from this PC, and none for a local API.
- HAProxy 3.2 on this PC with the ConfigMap's config and stub backends: the
  play host's `/replay/<slug>` went to the API, while `/replay.js`,
  `/replay-social.js`, `/replays/…`, `/` and `/netcode/rooms` went where they
  went before, as did `/replay/<slug>` on the mesh host and on bfstats.io.
- Against a throwaway API with a recording shared through it, behind a stand-in
  for the play host (the viewer, with `/stats` and `/replay/` sent on), in
  headless Chromium (Vulkan): a link followed from another page landed on
  `map.html?…&t=95` with the round at 1:35, and Back went to the page the link
  was on. More > Copy link at this moment, at 2:00.6, copied `…/replay/<slug>?t=120`
  and flashed "Link copied at 2:00". The feed's Copy link copied
  `…/replay/<slug>`. Capitals and a trailing slash opened the recording, and an
  unknown slug got the 404 page.

## Later

- The recordings FileBrowser published to `mesh/replays/` (two so far) are not
  in the feed; share them through it to bring them in.
- A report button and an admin view of what was shared, when the feed needs
  moderating.
- Covers for recordings shared from the feed's dialog come from the replay
  (F, or More > Use this frame as the cover); the dialog cannot render the level.
- The replay's switch reloads the page (the level from the browser's cache).
  Switching in place would reuse the level: `replay.js` `open` already takes
  a player down and builds another, but the comments' chrome, the view count
  and the page's address would have to follow it.
- A round has no title of its own: its card is its lead's. One an uploader
  sets for the round would need a place to keep it.
