# Slow `GET /stats/rounds` — global minParticipants COUNT + StartTime page

Seq signal `bfstats/Slow as fuck (>= 10 seconds)`.

## Latest — 03:17Z 2026-11-10

`GET /stats/rounds?pageSize=1&sortBy=StartTime&sortOrder=asc`

TraceId `135a8ee0da03692eb538722910cca0d8`. HTTP 200, **62,770ms**. Browser
`Other`, not a bot. Host `bfstats.io`. Pod `bf42-stats-5fbf6f568c-xgb55`
(Application started 2026-11-09T22:50:42Z). Request started 03:15:55Z.

| span | cost | SQL |
|---|---|---|
| COUNT | 801ms | `SELECT COUNT(*) FROM Rounds` |
| page | **61,951ms** | `ORDER BY StartTime LIMIT 1 OFFSET 0` + Servers join |
| recordings IN-list | 0ms | `Recordings` for the one round id |

No hop log `Rounds listing minParticipants` — previous PR #66 never landed
(closed draft, e2e:failed, 2299 commits). Unfiltered COUNT is cheap. The slow
hop is still sorting `Rounds` without `IX_Rounds_StartTime`.

No writer overlap. Last hourly **03:10:06** 76283 / 108509ms. Collection
#520 at 03:18:16 86 / 3347ms ran after the request.

## Original — 23:05Z 2026-10-09

`GET /stats/rounds?page=1&pageSize=25&sortBy=startTime&sortOrder=desc&includeTopPlayers=true&onlySpecifiedPlayers=false&minParticipants=1`

TraceId `f829903231de54d2f8a8ac45d8db0e8d`. HTTP 200, **62,937ms**. Firefox
Android, not a bot. Host `bfstats.io`.

| span | cost | SQL |
|---|---|---|
| COUNT | **51,316ms** | `SELECT COUNT(*) FROM Rounds WHERE ParticipantCount >= @p` |
| page | **11,587ms** | same filter + `ORDER BY StartTime DESC LIMIT 25` + Servers join |
| top players | 1ms | `PlayerSessions` for the 25 round ids |

The same URL is the UI default for the global Sessions list (`MmSessionsPage`
sets `minParticipants=1` so empty housekeeping rounds do not dominate).

Earlier pages of this shape: 09-07 05:33Z **14.5s**, 09-27 03:41Z **65.9s**,
10-10 13:22Z **102.9s**, 10-13 16:55Z **61.0s** (`?pageSize=2`), 10-19 15:49Z
**33.9s** (`?page=1&pageSize=3`), 10-21 22:59Z **60.3s** (empty query), 10-24
14:06Z **61.8s**.

Branch `cursor/api-performance-and-exceptions-8cc6` had these indexes and was
never deployed after `main` was rewritten. PR #66 was a clean re-implementation
that closed unmerged.

## Cause

`Rounds` has `(ServerGuid, StartTime)` and `MapName` / `IsActive` indexes, but
nothing on `ParticipantCount` or global `StartTime`. An unfiltered
`ORDER BY StartTime LIMIT 1` (this page) and a `minParticipants=1` listing
(the UI default) both table-scan on the Hetzner volume.

Player-scoped listings of the same route stay in 2–3s because they constrain
through `PlayerSessions`. `serverGuid=` listing is fine (~0.19s).

## Change

- `IX_Rounds_ParticipantCount` so COUNT stays on a B-tree.
- `IX_Rounds_StartTime` so `ORDER BY StartTime LIMIT n` walks the index
  instead of sorting the table.
- Count before applying ORDER BY.
- Information hop: `Rounds listing minParticipants {MinParticipants} serverGuid {ServerGuid} map {MapName}: {TotalCount} rows in {ElapsedMs}ms (count {CountMs}ms, page {PageMs}ms)`.

No pragma change. First start after migrate builds both indexes.

Do not live-probe `GET /stats/rounds` (with or without `minParticipants=1`)
until a request emits that hop. After it is live, a still >=10s page whose
new log shows `count` or `page` still >=10s is a new bug — do not re-add
these indexes. A slow page with no new log is the old image.
