# Slow `GET /stats/rounds` — global minParticipants COUNT + StartTime page

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 23:06 UTC 2026-10-09.

## Trace

`GET /stats/rounds?page=1&pageSize=25&sortBy=startTime&sortOrder=desc&includeTopPlayers=true&onlySpecifiedPlayers=false&minParticipants=1`

TraceId `f829903231de54d2f8a8ac45d8db0e8d`. HTTP 200, **62,937ms**. Firefox Android,
not a bot. Host `bfstats.io`. Pod `bf42-stats-58994ccf96-cgc74` (started 06:03:28Z).
Request started 23:04:47Z.

| span | cost | SQL |
|---|---|---|
| COUNT | **51,316ms** | `SELECT COUNT(*) FROM Rounds WHERE ParticipantCount >= @p` |
| page | **11,587ms** | same filter + `ORDER BY StartTime DESC LIMIT 25` + Servers join |
| top players | 1ms | `PlayerSessions` for the 25 round ids |

No hourly / ranking overlap. Collection cycles #2030 / #2040 were ~4s. The same
URL is the UI default for the global Sessions list (`MmSessionsPage` sets
`minParticipants=1` so empty housekeeping rounds do not dominate).

Earlier pages of this shape: 09-07 05:33Z **14.5s**, 09-27 03:41Z **65.9s**.
Branch `cursor/api-performance-and-exceptions-8cc6` had these indexes and was
never deployed after `main` was rewritten.

## Cause

`Rounds` has `(ServerGuid, StartTime)` and `MapName` / `IsActive` indexes, but
nothing on `ParticipantCount` or global `StartTime`. `minParticipants=1` with
no server or map is a range over almost the whole table, then a sort of that
set for the first page. On the Hetzner volume a `Rounds` scan is tens of
seconds.

Player-scoped listings of the same route stay in 2–3s because they constrain
through `PlayerSessions`.

## Change

- `IX_Rounds_ParticipantCount` so COUNT stays on a B-tree.
- `IX_Rounds_StartTime` so `ORDER BY StartTime DESC LIMIT 25` walks recent
  rows instead of sorting the filtered set.
- Count before applying ORDER BY.
- Information hop: `Rounds listing minParticipants {MinParticipants} serverGuid {ServerGuid} map {MapName}: {TotalCount} rows in {ElapsedMs}ms (count {CountMs}ms, page {PageMs}ms)`.

No pragma change. First start after migrate builds both indexes.

Do not live-probe `GET /stats/rounds?minParticipants=1` until a request emits
that hop. After it is live, a still >=10s page whose new log shows `count`
or `page` still >=10s is a new bug — do not re-add these indexes. A slow page
with no new log is the old image.
