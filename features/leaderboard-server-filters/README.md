# Leaderboard server filters

Global leaderboard stats can be sliced by **include one server**, **exclude many**, or **populated servers only**.

## Why

Empty and bot-heavy BF1942 servers inflate K/D and score. Occupancy is bimodal: a handful of servers have a regular player count; the rest sit at 0–3 average concurrent players.

## Queries

1. **Occupancy** — `ServerOnlineCounts` grouped by server over the lookback (capped at 90 days). Average concurrent players per server, then split the live cluster from the empty/bot tail (largest gap whose lower side is ≤ 3 avg; otherwise keep every server above 3).
2. **Player stats** — `PlayerMapStats` aggregated as before. Exclude / populated-only drop those servers *before* aggregation, so a player who farms bots on an empty box only keeps stats from remaining servers.

## API

`GET /stats/leaderboard`

| Param | Default | Meaning |
| --- | --- | --- |
| `server` | — | Include a single server (name or GUID). Wins over exclude / populated-only. |
| `exclude` | — | Comma-separated names or GUIDs. Stats from those servers are omitted. |
| `populatedOnly` | `false` | Keep the high-occupancy cluster. No-op when occupancy telemetry is missing. |

The UI defaults `populatedOnly` to **on**. Each server in the payload includes `avgPlayers` and `isPopulated`.
