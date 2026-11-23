# Slow `GET /stats/rounds` — global mapName StartTime page

Seq signal `bfstats/Slow as fuck (>= 10 seconds)`.

## Trace

`GET /stats/rounds?pageSize=2&mapName=bocage`

TraceId `a2b22a3914585e960c07279cd3091965` at 2026-11-10 03:28:37–55Z. HTTP 200,
**18,477ms**. curl, `is_bot=false`. Host `bfstats.io`. Pod
`bf42-stats-5fbf6f568c-xgb55` (Application started 2026-11-09T22:50:42Z).

| span | cost | SQL |
|---|---|---|
| COUNT | 43ms | `SELECT COUNT(*) FROM Rounds WHERE MapName = @m` |
| page | **18,407ms** | same filter + `ORDER BY StartTime DESC LIMIT 2` + Servers join |
| recordings IN-list | 0ms | `Recordings` for the two round ids |

No hop log `Rounds listing minParticipants`. Collection #540 at 03:28:15 was
86 / 3049ms. Hourly finished 03:10:06 (76283 / 108509ms). Ranking last 02:58:38.
No writer overlap.

## Cause

PR #36 already filters `MapName` with equality, so `IX_Rounds_MapName` serves
COUNT (43ms). The page still has to sort every row for that map. Production
`sqlite_stat1` for `IX_Rounds_MapName` is `1345060 24` — about 56k rows per
name. On the Hetzner volume that sort is 18s.

Leftover **PR #71** indexes `(ServerGuid, MapName, StartTime)` for the
server-map drill-in. This request has no server. Open **PR #88** adds global
`IX_Rounds_StartTime`; SQLite still prefers MapName equality and filesorts, so
that index does not cover this plan. Do not fold either into this change.

## Change

- `IX_Rounds_MapName_StartTime` so `WHERE MapName = @m ORDER BY StartTime LIMIT n`
  walks the map's slice in order.
- Count before applying ORDER BY.
- Information hop: `Rounds listing minParticipants {MinParticipants} serverGuid {ServerGuid} map {MapName}: {TotalCount} rows in {ElapsedMs}ms (count {CountMs}ms, page {PageMs}ms)`.

Do not drop `IX_Rounds_MapName`. No pragma change. First start after migrate
builds the index.

Do not live-probe `GET /stats/rounds?...&mapName=` until a request emits that
hop. After it is live, a still >=10s page whose new log shows `page` still
>=10s is a new bug — do not re-add this index. A slow page with no new log is
the old image.

## Not this alert

Sibling Slow 03:29Z, TraceId `5b501377dd3e7068d0192892573869ce`:
`GET /stats/rounds?pageSize=1&gameType=conquest&minParticipants=20&minDuration=10`
HTTP 200, **43.3s**. COUNT 26,600ms, page 16,672ms. That is the leftover on
**PR #88** (`IX_Rounds_ParticipantCount` / `IX_Rounds_StartTime`). Do not add
a GameType or DurationMinutes index here.
