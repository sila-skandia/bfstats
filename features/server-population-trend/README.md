# Server population trend

Hourly occupancy charts on the landing page (network) and server details
(one host), sourced from `ServerOnlineCounts`.

## Why this is cheap

`ServerOnlineCounts` is already one row per server per hour, keyed by
`(ServerGuid, HourTimestamp)` and retained for 180 days. A month is 720
rows for one server. The network series joins that table to
`Servers.IsOnline` so dead hosts stay out of the sum.

Landing does **not** fetch this on first paint. The drawer loads
`GET /stats/v2/game-trends/player-trend?game=bf1942` when the player
clicks **View trend**. Overlaying a specific server fires
`GET /stats/v2/game-trends/player-trend/server/{guid}` for that guid
only. Range (7d / 30d / typical weekday), peak/avg/ghost, and weekday
slicing are client-side cuts of the 60-day hourly payload.

Server details keeps the chart collapsed. Expanding it is the fetch.

## UI

- Landing: overlay slide-out (`min(calc(100vw - 72px), 1280px)`), dimmed
  landing still visible behind it. Leaderboard-style server picker
  (search, flags, live-only toggle, mobile sheet). Empty picker = live
  network total.
- Server details: `# PLAYER TREND` section bar, collapsed by default.
  Peak · 30d in the KPI strip also opens it.

## API

| Endpoint | What it reads |
|---|---|
| `GET /stats/v2/game-trends/player-trend?game=bf1942` | Live servers only, hourly sum |
| `GET /stats/v2/game-trends/player-trend/server/{guid}` | PK range for one server |

Cached 15 minutes. Lookback capped at 60 days so 7d/30d and the previous
period ghost do not need a second round trip.
