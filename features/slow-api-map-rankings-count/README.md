# Slow `GET /stats/data-explorer/maps/{map}/rankings` — COUNT table fetches

Seq signal `bfstats/Slow as fuck (>= 10 seconds)` at 21:29 UTC 2026-10-08.

## Trace

`GET /stats/data-explorer/maps/market garden/rankings?game=bf1942&page=1&pageSize=15&days=365&sortBy=score&minRounds=3`

| field | value |
|---|---|
| TraceId | `dd028fd4b14126b3987a36c6df69ff91` |
| started | 21:28:27Z |
| finished | 21:28:49Z |
| elapsed | **21,755ms** |
| status | 200 |
| pod | `bf42-stats-58994ccf96-vbf8g` |
| UA | Firefox 157, Windows, not a bot |

Same session 5s earlier, `days=60` on the same map: **5,420ms** (COUNT 4,792ms, rankings 580ms), TraceId `4daab24d5a4eb4d5e0aa034a81520863`. No hourly/ranking writer overlap. Collection cycles ~4s as usual.

| hop | elapsed |
|---|---|
| `Servers` catalog | 0ms |
| `PlayerMapStats` COUNT + HAVING SUM(TotalRounds) | **21,304ms** |
| paginated ranking SELECT | 441ms |

The 21s then 441ms is cold then warm on the network volume: both statements read the same columns, so the second hits pages the COUNT already fetched.

Closed unmerged PR #19 (`61d4`, 2026-09-07) diagnosed the same COUNT on this route (then 7.3s with a single `serverGuid` and `days=60`). This page is the unfiltered year-long case of that leftover. Do not reopen #19.

## Cause

`IX_PlayerMapStats_MapRanking_Covering` is `(MapName, ServerGuid, PlayerName, Year, Month, TotalScore)`. COUNT/HAVING and the ranking SELECT also read `TotalRounds`, `TotalKills`, `TotalDeaths`, `TotalPlayTimeMinutes`, so SQLite visits the table row for every matching player-month. On the Hetzner volume that is ~1.4ms each.

The unfiltered query also built a 700-parameter `ServerGuid IN (...)` of every game server **plus** the global `ServerGuid=""` sentinel. Global rows are the per-server numbers summed again, so score/kills/rounds were doubled and `UniqueServers` was off by one.

## Change

- Rebuild the covering index with the four measure columns COUNT and the page SELECT actually read.
- Scope unfiltered rankings with `ServerGuid IN (SELECT Guid FROM Servers WHERE Game = ?)` — game isolation without the parameter list, and without the global sentinel. A `serverGuid` query is a single equality.
- `ROW_NUMBER()` is already the absolute rank (window before LIMIT); stop adding `offset` again (page 2 showed #5 for the third player).
- Information hop log: `Map rankings {MapName} game {Game} days {Days} minRounds {MinRounds} serverGuid {ServerGuid}: {TotalCount} players in {ElapsedMs}ms (count {CountMs}ms, rankings {RankingsMs}ms)`.

No pragma change, no connection-pool setting. First start after migrate builds the index.

Do not live-probe `/stats/data-explorer/maps/market garden/rankings` on production until this is the running image. After it is live, a still >=10s page whose new log shows `count` still >=10s is a new bug — do not re-add this index. A slow page with no new log is the old image.
