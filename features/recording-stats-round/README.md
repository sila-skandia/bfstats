# A shared recording's bfstats.io round

The request (2026-10-24): when a recording is uploaded, match it to the round on
the stats site it was recorded in, so the stats site can show that the round was
recorded:

- on the round's report, with the replay to watch;
- on the Sessions pages of a player and a server, marking the round recorded.

## Status

Built (2026-10-24). Not deployed.

## What a visitor sees

**Round report** (`MmRoundReportV2.vue`). A round someone recorded gets a
**Replay** panel under the armies band (`round-report/MmRoundReplay.vue`):

- a large cover (the uploader's frame, else the level's art) that opens the replay
  on play.bfstats.io, merged when several players recorded the round;
- who shared it, when, and the views;
- **Watch from 12:34**: the replay opened at the moment the report's playback is
  on. The button follows the scrubber;
- **Comments & details**: the recording's page in the feed.

Each battle-feed line the recording saw gets a small play button that opens the
replay at that line's moment. A round no one recorded has no panel and no buttons.

**Sessions** (`MmSessionsPage.vue`, the server's and the player's Sessions pages).
A recorded round carries a **Replay** chip, with a count when several players
recorded it. The chip opens the replay; the rest of the row still opens the report.
It shows on the desktop table and on the phone cards.

**Replays panel** (`MmRecordingsPanel.vue`, the server and player Overview tabs).
A card whose recording was matched links to the round's report, **Round stats**.

## How a recording is matched

`StatsRoundMatcher` (pure) and `RecordingStatsRoundService` (the queries).

A recording names its server and level, its players, and when it began on the
recording PC's clock. That time has no zone (`RecordedLocal`,
`2026-10-24T16:14:56`). bfstats.io keeps each server's rounds in UTC with the
players BFList showed in each.

1. **Server.** `GameServers` by the recording's server name, in both name forms
   (`PlayerNameDecoder`, as features/replay-on-stats-pages does).
2. **Candidates.** That server's rounds, read through `(ServerGuid, StartTime)`,
   that began within reach of any zone: from 14 h before the header (UTC+14) less a
   6 h round, to 12 h after it (UTC-12), and never after the upload. The level must
   match, compared as letters and digits only (`battle_of_britain` is
   `battle of britain`).
3. **Fit.** A zone, in quarter hours from UTC-12 to UTC+14, puts the recording
   inside a round when it begins no earlier than the round and ends by the round's
   end and by the upload, each with 5 minutes of slack. bfstats.io sees a round
   change on its next BFList poll, and a PC clock can drift. A round still running
   ends at the upload. A round no zone fits is out.
4. **Players.** Of the rounds that fit, the one with the most of the recording's
   players (`PlayerSessions(RoundId, PlayerName)`) wins. It must hold at least 40%
   of the smaller list. No other round may come within 60% of its count; if one
   does, the call is too close and the recording stays unmatched.
5. **Zone.** The zone that fits the winning round. A recording begun mid-round
   can fit several quarter hours. Then the zone the uploader's other matched
   recordings name most decides, and with no such zone it stays unknown.

A known zone gives the recording's start in UTC (`RecordedAt` on the round's
recordings). The report converts a moment to the replay's `t` (seconds since the
recording began), and only for the one recording that saw that moment. That
recording plays alone, so the moment is exact. A merged replay plays on the
earliest recording's clock, which is not the clock this conversion uses.

### Why it holds

The rules were prototyped in Python first, against every recording on the live feed (26, 2026-10-24),
read through the public API:

| | |
|---|---|
| Matched | 26 of 26 |
| Players shared by the round it matched | 72% to 100% of the smaller list |
| Players shared by the next best candidate | at most 24% |
| Zones found | UTC+2 (CEST), UTC+10 (AEST), UTC-4 (EDT) |
| More than one zone fits (recordings begun mid-round) | 8 |

The same level comes round on the same server several times a day, often with
the same regulars. So player overlap alone does not decide: the round must also
fit in time under some zone. Two recordings of the Bocage round of 2026-09-28,
from PCs on UTC-4 and UTC+10, both land on it.

### When it runs

- **On upload**, after the feed's own round detection (`RecordingUploadService`).
  A failure costs the upload nothing.
- **In the background**, in `RecordingRoundBackfill`'s six-hourly pass, after the
  feed's rounds:
  - recordings never looked at under the current `StatsRoundMatcher.Version`;
    raising it looks again at all of them;
  - unmatched recordings shared in the last 2 days, at most once an hour, in
    case their round's stats came in late.

### What is kept

On `Recordings` (migration `AddRecordingStatsRound`):

| Column | |
|---|---|
| `StatsRoundId` | `Rounds.RoundId`, or null; indexed |
| `StatsRoundZoneMinutes` | the PC's UTC offset, or null |
| `StatsRoundMatchedPlayers` | the evidence |
| `StatsRoundCheckVersion` | the matcher version that last looked; 0 never |
| `StatsRoundCheckedAt` | when |

The feed's card triggers fire only on their own columns, so none of these
writes moves the feed.

## API

| | |
|---|---|
| `GET /stats/rounds/{roundId}/recordings` | the round's recordings, the longest first (`StatsRoundRecordingDto`, with `recordedAt` and `group`) |
| `GET /stats/rounds` | each round carries `recordings` (`RoundRecordingDto`), or null; one lookup per page through `IX_Recordings_StatsRoundId` |
| `GET /stats/recordings`, `/stats/recordings/{slug}` | each recording carries `statsRoundId` |

`group` is the feed's round the recording is in (features/replay-feed,
"Rounds"). The replay merges only one group: the longest recording's. A
recording the feed has not grouped with it gets its own link.

## Verification

- `tests/api/Recordings/StatsRoundMatcherTests.cs`: live cases (Battleaxe at
  UTC+10; a round still running; Bocage begun mid-round, settled by the
  uploader's zones), a close call, too small a share, a round too short, a fit
  only after the upload, a header with no start, the window.
- `tests/api/Recordings/RecordingStatsRoundTests.cs`: an upload finds its round
  and zone; one shared before its round's stats is matched by the background
  pass inside the retry window and not after it; a new matcher version looks
  again; the report's list, with `recordedAt`; the round list marks the round.
- `tests/api/Recordings/RecordingQueryPlanTests.cs`,
  `A_rounds_recordings_read_no_whole_table`.
- `ui/e2e/round-report-replay.spec.ts`: the panel, the merged watch link, the
  moment button and the battle-feed links with their `t`; no panel without a
  recording; no moments without a known start; the Sessions chip on desktop and
  at 390 px.

## Open

- An admin cannot yet set or clear a recording's round by hand. A wrong match
  would be fixed by deleting the recording, or by a new matcher version.
- A server renamed since the round was played is found under its current name
  only (`GameServers.Name`).
- The player page's compact recent-rounds strip
  (`MmPlayerRecentRoundsCompact.vue`) reads the player stats endpoint, not
  `/stats/rounds`, and does not mark recorded rounds yet.
