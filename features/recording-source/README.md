# Recording source: server or player

The owner's ask: in the replay menus, separate the client recordings from the
server recordings, with a visual indicator of which is which. Both are the same
ndjson format, but a server recording covers the whole battlefield and is the
more valuable of the two.

## How a recording says which it is

The first line of every recording is its header, and the header's `plus` names
the recorder:

| `plus` | Recorder | Covers |
|---|---|---|
| `server-replay-recorder/3` | the server-side recorder (features/server-replay-recorder) | every player, the whole battlefield |
| `2.0` (a bf42plus build) | bf42plus in a player's game (features/round-replay-capture) | what one client saw |

Checked against the live feed on 2026-11-02: `8t224pppqe` heads
`{"k":"h","v":5,"plus":"server-replay-recorder/3",...}`, `ku8gdc58b6` heads
`{"k":"h","v":5,"plus":"2.0",...}`. `serverLogUrl` is no hint: either kind can
come with a server log or without. The rule is the prefix
`server-replay-recorder` (case-insensitive) is the server; anything else, or no
`plus`, is a client. The viewer already reads it the same way
(`replay-recording.js`, `serverFile`).

## Decision

- **Persisted, not derived per request.** `Recordings.Source` is an INTEGER
  (`RecordingSource`: 0 Unknown, 1 Client, 2 Server), set at upload from the
  header the inspector already parses (`RecordingInspector.Scan.Header`).
  Reading a file per list request is out: the files are up to 50 MB gzipped and
  the node is memory-tight (CLAUDE.md, deploy/PRODUCTION_ISSUES.md).
- **Backfill reads the header only.** Migration `AddRecordingSource` adds the
  column (default 0) and an index `(Source, FileMissing, RoundId)`; it cannot
  read files. `RecordingFileReconciler`, 30 s after start-up and every 6 h,
  calls `BackfillSourcesAsync`: every row still Unknown and on disk has the
  first line of its `.ndjson.gz` read (at most 4 KB unpacked,
  `RecordingInspector.ReadSourceAsync`), and is updated in one statement per
  source. A file that cannot be read stays Unknown and is tried next pass. On
  prod that is 30 rows, a few KB each.
- **API.** `source` on `RecordingSummaryDto`, `RecordingRoundMemberDto` and
  `RecordingDetailDto`: `"server"`, `"client"`, or null while Unknown.
  `GET /stats/recordings?source=server|client` (`player` is an alias of
  `client`; anything else narrows nothing) and the same on `/filters`. A narrowed
  list goes through `NarrowedPageAsync` like the server and uploader filters,
  found by the new index (`RecordingQueryPlanTests` holds it to no table scan),
  paged server-side. A round card is kept whole when any of its recordings
  matches, so `source=server` shows every round the server recorded, with the
  players' recordings of it listed under it.
- **The round's lead is unchanged.** It stays the longest recording; the badge
  for a round card lights SERVER when any of its recordings is the server's.

## Where the indicator appears

- **play.bfstats.io REPLAY tab** (`viewer/play/recordings-feed.js`): a badge in
  the cover's top-left beside the mod: SERVER is a lit gold plate with a radar
  sweep icon (the sweep animates, stopped under reduced motion), and the card's
  cover gets a gold edge; PLAYER is a quiet dark plate with the user icon. The
  bar has an All / Server / Player segmented control, written to the address as
  `&source=` like the other filters. A round card's list of recordings tags each
  one; a recording's page has a Recorder fact, and its round list tags each member.
- **bfstats.io server and player pages** (`MmRecordingsPanel.vue`): the same
  SERVER / PLAYER tag on the thumbnail in the V4 olive, an olive edge on a
  server card, and an All / Server / Player `mm-subtabs` group that narrows
  every tab; "In the replay feed" carries the source.

Not done: the round report's recordings (`StatsRoundRecordingDto`,
`MmRoundReplay.vue`) and the in-replay switcher (`replay-social.js`) do not
show the source yet.

## Verification

- `tests/api/Recordings/RecordingSourceTests.cs`: header rule, upload,
  list/filters by source, a mixed round shown whole, the backfill (including an
  unreadable file staying Unknown).
- `RecordingQueryPlanTests.A_list_narrowed_by_source_reads_no_whole_table`.
- `tools/bf1942-models/tests/test_recordings_api.py`: `?source=` in the feed's
  address and the API query, `cardHasServer`.
- `ui/e2e/stats-page-replays.spec.ts`: "marks server and player recordings and
  narrows to either".

## Deploying

The API migration runs at start-up as usual; the backfill fills the existing
rows within a minute. The play front end (`viewer/play`) is published with the
viewer code. Until the API is deployed the feed's badges simply do not appear
(`source` is absent) and the source control returns the unfiltered feed.
