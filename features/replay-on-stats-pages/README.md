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

A recording stores names as text, not keys: `ServerName`, `UploaderName`, and its
round's players (bots included) in `PlayersJson` and, one row each, in
`RecordingPlayers(RecordingId, PlayerName)`. `GET /stats/recordings` takes a third
filter:

| Query | Matches | Index |
|---|---|---|
| `server=` | `ServerName` | `IX_Recordings_ServerName_FileMissing_RoundId` |
| `uploader=` | `UploaderName` | `IX_Recordings_UploaderName_FileMissing_RoundId` |
| `player=` | a whole name in the round, case-sensitive like the site's player keys | `IX_RecordingPlayers_PlayerName` |

A filter combined with another narrows further. A round counts when any of its
recordings matches, and then all of its recordings show, as for the feed's own
filters.

**Name forms.** A recording writes each byte of a name as U+0000 to U+00FF.
BFList, and so bfstats.io, reads the same bytes as cp1252. The two differ only
for cp1252's symbols at 0x80 to 0x9F (`\u0099` against `™`). `RecordingPlayers`
keeps the recording's form; a player is looked up by
`PlayerNameDecoder.ToRecording(name)`, which gives it from either form. A server
or an uploader is asked by both forms (an uploader may be a linked name, in the
site's form). In the browser, `serverNameFromRecording` turns a card's server
name into the site's form for the link to its page.

## Scale

The first cut matched players with `json_each` over every recording's list
(2026-10-17). That reads every row on every page view, so it was replaced the
same day:

- **`RecordingPlayers`** is written with the recording on upload and goes with it
  on delete (cascade). Migration `AddRecordingPlayers` back-fills the recordings
  shared before it from their `PlayersJson`, once, at start-up
  (`AddRecordingPlayers.BackfillSql`). No script or admin step.
- **Cards by key, not by `COALESCE`.** A card's key is `RoundId ?? Id`. Matching
  recordings on that expression reads every row. Every recording of a round
  carries the round's lowest id as `RoundId`, the lowest included, so the
  recordings on a card are `Id IN keys OR RoundId IN keys`, two index lookups.
  This also fixed the main feed, which fetched every page's rows with a full scan.
- **The storage total** (a sum over every recording) is kept a minute in memory,
  and cleared by an upload, a delete or a new cover.

`RecordingQueryPlanTests` plans every statement a server, uploader or player list
sends, and fails on any scan of a table.

Measured on 100,000 recordings with 40 players each (4 M `RecordingPlayers` rows,
20,000 players, `ANALYZE`d), file-backed SQLite on this PC:

| Query | Time |
|---|---|
| Player page, Played in (one page of 6, the count of 200) | 19 ms |
| Player page, Shared | 6 ms |
| Server page | 8 ms |
| The old `json_each` lookup alone | 655 ms |
| The whole feed, newest | 153 ms |
| The whole feed, most viewed | 308 ms |
| The feed's filter choices | 91 ms |

The whole feed and its filter choices still group every recording into cards on
each request. That cost grows with the table, and is play.bfstats.io's feed, not
these pages.

## Verification

- `tests/api/Recordings/RecordingQueryPlanTests.cs`: no table scan on a narrowed
  list, by server, uploader, player, and uploader with player.
- `tests/api/Recordings/RecordingServiceTests.cs`:
  `Upload_KeepsTheRoundsPlayersAndDeleteTakesThemAway`,
  `Migration_BackfillsThePlayersOfRecordingsSharedBefore` (bad JSON, empty and
  repeated names, the site's form of a symbol name),
  `List_NarrowsToTheRoundsAPlayerPlayedIn` (whole names only, no prefix, no other
  case, combined with the uploader filter) and
  `List_FindsANameAsTheSiteHasItOrAsTheRecordingWroteIt`.
- `tests/api/Utils/PlayerNameDecoderTests.cs`: `ToRecording` round-trips
  `FromRecording`.
- `ui/e2e/stats-page-replays.spec.ts`, against a stubbed feed: server page
  cards and links; the player page's two sub-tabs and their queries; a round's
  merged watch link; paging; no panel without recordings; one card a row at
  390 px with no sideways scroll.
