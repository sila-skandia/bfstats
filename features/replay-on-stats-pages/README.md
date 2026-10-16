# Replays on bfstats.io's server and player pages

The request (2026-10-17): bring the REPLAY feed's shared recordings
(features/replay-feed) into the stats site.

- A server's page lists the recent recordings made on that server.
- A player's page lists the recordings they shared, and the rounds they played
  in that someone recorded.

## Status

Built (2026-10-17). Not deployed.

## What a visitor sees

A **Replays** panel (`ui/src/components/v4/MmRecordingsPanel.vue`):

- **Server page**, Overview tab, under the activity heatmap: rounds recorded on
  the server.
- **Player page**, Overview tab, under trends and accolades: **Played in** (rounds
  the player is in) and **Shared** (rounds they uploaded), as two sub-tabs when
  both have recordings.

Six cards a page, paged on the server (`‹ 1 2 ›`, "Showing 1–6 of N"). A round
several players recorded is one card, as in the feed, with "N recordings" on it.
A card shows:

- a cover: the uploader's frame, or else the level's map art from
  `/stats/assets/maps/<mod>/<level>`
- the mod, the length and the level's name
- the title, game mode, player count, and on a player's page the server, linked
  to its page
- who shared it, linked to their player page, how long ago, and views

The **cover** opens the replay on play.bfstats.io (`map.html?mod&map&replay=…`,
one `replay` for each recording of a round, the card's own first, as the feed's
cover does). The **title** opens the recording's page in the feed
(`/play/?tab=replay&rec=<slug>`). **In the replay feed** opens the feed narrowed to
the server or the uploader. The feed has no player filter, so **Played in** has no
feed link.

The panel asks for nothing until it is near the viewport, and stays out of the
page while there is nothing to show. Most servers and players have no
recordings yet.

## How recordings are matched

A recording stores names as text, not keys: `ServerName`, `UploaderName` and
`PlayersJson`, the round's player names, bots included. `GET
/stats/recordings` takes a third filter:

| Query | Matches |
|---|---|
| `server=` | `ServerName` |
| `uploader=` | `UploaderName` |
| `player=` | a name in `PlayersJson`, as a whole name (`json_each`), case-sensitive like the site's player keys |

A filter combined with another narrows further. A round counts when any of its
recordings matches, and then all of its recordings show, as for the feed's own
filters.

**Name forms.** A recording writes each byte of a name as U+0000 to U+00FF.
BFList, and so bfstats.io, reads the same bytes as cp1252. The two differ only
for cp1252's symbols at 0x80 to 0x9F (`\u0099` against `™`). Each filter matches
the name as given and as `PlayerNameDecoder.ToRecording` writes it, so a page
can ask by its own name. In the browser, `serverNameFromRecording` turns a card's
server name into the site's form for the link to its page.

No table was added. The feed holds tens of recordings, and `json_each` over the
whole table is cheap. A table of round players becomes worth it if
recordings reach the thousands.

## Verification

- `tests/api/Recordings/RecordingServiceTests.cs`:
  `List_NarrowsToTheRoundsAPlayerPlayedIn` (whole names only, no prefix, no other
  case, combined with the uploader filter) and
  `List_FindsANameAsTheSiteHasItOrAsTheRecordingWroteIt`.
- `tests/api/Utils/PlayerNameDecoderTests.cs`: `ToRecording` round-trips
  `FromRecording`.
- `ui/e2e/stats-page-replays.spec.ts`, against a stubbed feed: server page
  cards and links; the player page's two sub-tabs and their queries; a round's
  merged watch link; paging; no panel without recordings; one card a row at
  390 px with no sideways scroll.
