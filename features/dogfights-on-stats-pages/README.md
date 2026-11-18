# Dogfights and media on the stats pages

Status: built (2026-11-18). E2E-covered with stubbed data; not yet looked at
on the live site with real recordings.

The project now produces three kinds of media from the shared recordings:
Shorts (features/replay-shorts), replays (features/replay-on-stats-pages) and
dogfight films (features/dogfight-recordings). The server and player pages
already showed Shorts and replays. This adds the dogfights there, in full, and
a light touch of all three on the landing page.

## Where the dogfights come from

There was no API for them. The `bfstats-dogfights` CronJob
(`dogfights/refresh.mjs`, `deploy/app/dogfights-cronjob.yaml`) runs
`tools/bf1942-models/extract_dogfights.mjs` over every public recording and
writes `index.json` (one row per fight) plus one file per fight to the assets
volume's `mesh/replays/dogfights/`. That folder is a relative symlink swapped
in one rename. nginx serves it at `play.bfstats.io/replays/dogfights/`, where
the dogfight school reads it.

The API pod mounts the same PVC (`bf42-stats-pvc-v2`) at `/mnt/data`, with
`ASSETS_STORAGE_PATH=/mnt/data/assets`. So `api/Dogfights` reads the index
straight off the volume, with no deploy change:

- `DogfightIndex` (singleton) holds the rows in memory (about 500 rows,
  330 KB). It looks at the file's time at most every `RefreshSeconds` (120)
  and reads it again only when the time has changed. An unreadable or missing
  file keeps the last list, or none.
- `Dogfights__IndexPath` overrides the path. `Dogfights__IndexUrl` reads over
  HTTP when there is no file; `api/Properties/launchSettings.json` sets it to
  the live index, so `dotnet run` on a laptop has real fights. E2E runs with
  `--no-launch-profile` and has neither, so its list is empty, and the specs
  stub the endpoint.
- `GET /stats/dogfights?server=&player=&kind=&page=&pageSize=` returns
  `PagedDogfightsDto`. A server is matched by the feed's server name and a
  player by either pilot. Both are matched in the site's form and the
  recording's form of the name (`PlayerNameDecoder.ToRecording` /
  `FromRecording`), as the recordings and Shorts endpoints do. Dogfights come
  first, then kills, then the newest. `dogfights` and `kills` count every
  match, whatever `kind` narrowed.

## Server and player pages

`MmDogfightsRow.vue` sits in the replays panel (`MmRecordingsPanel.vue`),
under the Shorts and above the rounds. The panel shows when any of the three
has something, and its header counts "N air fights". Six cards to a page.
All / Dogfights / Bounces narrows the list. Each card gives the whole fight:

- a cover of the level's art with two flight paths in the pilots' team
  colours (Axis `--mm-kill`, Allies `--mm-accent-soft`). The paths are a
  picture of the fight's shape, seeded by its id, not its data. The cover
  also carries the kind badge, a KILL tag and the length;
- the title, the kill's maker first ("A (BF109) downs B (Spitfire)", or "v");
- a pilot table: name (linked to the player page, `$pn`), plane, aimed
  rounds, hits and hit rate, with "+gunner" where the plane's gunners fired.
  The winner is bold;
- how it ended, in the school's words (`endingShort`, a port of
  `viewer/dogfight-lines.js` `endingWords().short`);
- level, mod, the closest the two came, the recording date. On a player's
  page there is also an outcome tag (Won, Shot down, Downed by a third,
  Survived, No kill) with their row highlighted, and the server linked;
- links to the dogfight school (`dogfight.html?fight=<id>`) and, where the
  fight's slice of the recording was kept (`clip`), the 3D replay
  (`map.html?...&replay=/replays/dogfights/<id>.ndjson&clip=1&school=<id>`),
  the same URL the school's own button builds.

On a phone each card stacks with a short cover, and the gunner note is
hidden.

## Landing page

Finding a server comes first, so this stays small. `GET /stats/server-media`
(`api/ServerMedia`) answers for every server in one request. For each server
with media it gives the counts and up to `perServer` (3) items, one of each
kind before two of any: newest Short, newest replay (a round several players
recorded is one card), best dogfight. It reads the newest 500 recordings and
500 Shorts through their indexes and keeps the answer for two minutes in
`IMemoryCache`. Server names come back in the site's form.

`MmServerMediaStrip.vue` is drawn at the end of a server's address line (ip,
country, map), not beside its name. A first version beside the name cut the
name off. The strip is a fanned stack of 32x18 frames that spreads apart on
hover, with a small kind glyph on each, then "+N" linking to the server page.
Each frame opens its Short, replay or fight on play.bfstats.io. The strip
shows three frames on a desktop and two on a phone, and it does not make a
row taller. A failed request leaves the strip out, and the list loads as
before. The media request goes out after the server list.

Pictures: a Short's poster, a replay's thumbnail, and otherwise (dogfights
and replays without one) the level's art from `/stats/assets/maps`.

## Tests

- `tests/api/Dogfights/DogfightServiceTests.cs`: server and pilot filters in
  both forms of a name, ordering, paging, the refresh interval, a broken
  index keeping the last list, the landing page's one-of-each pick, the site
  form of a recorded server name, and that a recording whose file is missing
  is left out.
- `ui/e2e/stats-page-dogfights.spec.ts`: a server page's cards in full, the
  kind filter, a player page's outcomes, paging, nothing to show, and one
  card to a row on a phone.
- `ui/e2e/landing.spec.ts` ("media beside a server") and
  `ui/e2e/responsive-mobile.spec.ts`: the strip's links, its "+N", that it
  fits inside the row, and that a failure leaves it out. On a phone it shows
  two frames and adds no page scroll. The helper, `e2e/helpers/serverMedia.ts`,
  gives the stubbed media to the first live server the list gets.
