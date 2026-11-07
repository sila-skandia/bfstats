# Slow arcade server roster (higher-lower)

Seq Slow 2026-10-19T17:12Z. `GET /stats/arcade/higher-lower/next?serverGuid=42ba49-61f1d04-183a4bc-49bf3d2` HTTP 200 **11,077ms**. TraceId `dc73819959307108b2e018bbc59dacaa`. Chrome, `is_bot=false`. Host `bfstats.io`. Pod `bf42-stats-689c8c7b96-pznhc` (started 13:36:57Z).

This was a cold `IMemoryCache` for that server (`Arcade:Roster:{guid}:_`, 6h TTL). The same visitor's next call six seconds later (`orbitPlayer=Lurk`) was **2,453ms** — baseline roster hit, orbit extras plus Neo4j. Not writer overlap: hourly finished 16:52:39 (90571 / 85008ms). Collection around 17:11 was idle.

No hop log on the running image.

| hop | elapsed |
|---|---|
| `Servers` guid lookup | 0ms |
| `ServerPlayerRankings` GROUP BY PlayerName LIMIT 150 | 350ms |
| `PlayerServerStats` PlayerName IN (150) GROUP BY PlayerName | **3,015ms** |
| `PlayerMapStats` PlayerName IN (150) GROUP BY PlayerName, MapName | **6,282ms** |
| `PlayerAchievements` PlayerName IN (150) MIN(AchievementName) | 1,278ms |
| `Servers` guid lookup | 0ms |

The 2026-09-06 11.2s page of this same path was 76% the badge drain; `IX_PlayerAchievements_PlayerName_ServerGuid_AchievementName` is live. Badges here are 1.3s. The new cost is table fetches on the other two IN-lists.

## Cause

`LoadRosterForServerAsync` seeds 150 names from `ServerPlayerRankings` (covering `TotalScore` only), then re-aggregates `PlayerServerStats` for career kills/deaths/playtime, then `LoadMapSnapshotsAsync` for shared-map matchups. Rankings already store those career columns. `PlayerServerStats` is weekly, so the IN-list walks every week and fetches the table for columns `IX_PlayerServerStats_PlayerName_ServerGuid_TotalRounds` does not carry.

`PlayerMapStats` PK is `(PlayerName, MapName, ServerGuid, Year, Month)`. The snapshot query filters `PlayerName IN (150) AND ServerGuid = ?` and sums five columns no index carries, so each of the 150 names walks that player's rows on every server and pays a random table fetch per row. On the network volume that is the 6.3s.

Distinct from leftover **#69** (server-detail top-5, `ServerGuid, MapName` leading) and leftover **#70** (map-rotation gold winners on `PlayerAchievements`).

## Fix

- Read career totals from `ServerPlayerRankings` in one GROUP BY. Fall back to latest-week `PlayerServerStats` only when rankings are empty (unit tests).
- Replace `IX_ServerPlayerRankings_ServerGuid_PlayerName_TotalScore` with `IX_ServerPlayerRankings_ServerGuid_PlayerName_CareerCovering (ServerGuid, PlayerName, TotalScore, TotalKills, TotalDeaths, TotalPlayTimeMinutes)`. Prefix still covers `GetServerRankingsWithPing`.
- Add `IX_PlayerMapStats_ArcadeRoster_Covering (PlayerName, ServerGuid, MapName, TotalKills, TotalDeaths, TotalScore, TotalPlayTimeMinutes, TotalRounds)`.
- Single-flight the roster cache fill so concurrent cold hits share one build.
- Hop log `Arcade roster {ServerGuid}: {PlayerCount} players in {ElapsedMs}ms (rankings {RankingsMs}ms, stats {StatsMs}ms, maps {MapsMs}ms, badges {BadgesMs}ms)`.

Migration `20261019172000_CoverArcadeServerRosterQueries` builds the PlayerMapStats index over the full table. `Database.MigrateAsync()` runs before the API serves traffic, so the rollout that picks this up starts slowly.

**Do not live-probe** `GET /stats/arcade/higher-lower/next?serverGuid=` until a request emits that hop log.

After it is live, a still >=10s page whose new log shows `maps` or `rankings` still >=10s is a new bug — do not re-add these indexes. A slow page with no new log is the old image. A slow page whose SQL still shows the PlayerServerStats IN-list on a server that has rankings is a new bug — do not put that query back.

The 6h roster cache stays. A cache hit is not this leftover.
