# Slow API: server banner `Rounds` lookup

Seq signal `bfstats/Slow as fuck` (>= 10s) fired at 12:41 UTC on 2026-09-06.

## What paged

| Time (UTC) | Path | Elapsed | TraceId |
|---|---|---|---|
| 12:41:47 | `GET /stats/servers/*NEW* SiMPLE \| BF1942/banner.png?style=reticle&w=960` | **11.9s** | `184b28429835293d2ba7cae94b2d449c` |
| 06:50:48 | `GET /stats/servers/*NEW* SiMPLE \| RtR+SW/banner.png?style=reticle&w=960` | **11.9s** | `5dfce8e0f8f7e4ad9281675fc77595ef` |

Both traces are the same shape: `Servers` lookup **0ms**, then

```sql
SELECT "r"."MapName", "r"."GameType"
FROM "Rounds" AS "r"
WHERE "r"."ServerGuid" = @server_Guid AND "r"."IsActive"
LIMIT 1
```

**10.9s / 11.6s**. BFList ticket fetch after that is ~40ms. HTTP 200, ~30KB PNG.

The 12:41 request overlapped `StatsCollection.Cycle` (finished 12:41:49). Other SQLite reads in the same second were 0–4ms, so this is not a whole-database stall. The banner was the only caller touching `Rounds` while the 30s collector writes that table on the 691-IOPS volume.

`IX_Rounds_ServerGuid_IsActive` is already deployed (`20260814093000`). The default tickets path never paints `GameMode` (tickets take that slot). Map is already on `Servers`.

## Fix

Stop reading `Rounds` on the banner path.

- Map: live BFList `MapName`, else `Servers.CurrentMap`, else `Servers.MapName`
- Game mode: BFList `GameType` / `GameMode` (only when tickets are requested, which already hits BFList)
- Tickets: unchanged, same BFList snapshot

`tickets=false` still skips BFList (existing contract) and omits game mode.

## Not this alert

`network-graph?depth=2` leftover (Phoenix 17.5s at 12:21) is the unmerged clique rewrite on `cursor/api-performance-and-exceptions-dea5`. `/stats/rounds?serverName=` (61s at 09:32) is the unmerged `ServerGuid` rewrite on `023c` / `7852`.
