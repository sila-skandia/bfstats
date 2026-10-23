using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Covering indexes for the arcade server roster behind GET /stats/arcade/higher-lower/next.
    ///
    /// Seq Slow 2026-10-19T17:11:19Z, TraceId dc73819959307108b2e018bbc59dacaa: a Chrome
    /// visitor asked for the next higher-lower matchup on 42ba49-61f1d04-183a4bc-49bf3d2
    /// (cold IMemoryCache for that server) and the request took 11,077ms HTTP 200. Not
    /// writer overlap — hourly had finished 16:52. The hops:
    ///
    ///   ServerPlayerRankings GROUP BY PlayerName LIMIT 150     350ms
    ///   PlayerServerStats  IN (150) GROUP BY PlayerName      3,015ms
    ///   PlayerMapStats     IN (150) GROUP BY PlayerName,Map  6,282ms
    ///   PlayerAchievements IN (150) MIN(AchievementName)     1,278ms
    ///
    /// The badge index from FixArcadeBadgeIndexForServerScope is already the right shape;
    /// the remaining cost is table fetches for columns no index carries.
    ///
    ///   IX_ServerPlayerRankings_ServerGuid_PlayerName_CareerCovering
    ///     Replaces IX_ServerPlayerRankings_ServerGuid_PlayerName_TotalScore. The arcade
    ///     roster now reads career kills/deaths/playtime from rankings instead of
    ///     re-aggregating PlayerServerStats. GetServerRankingsWithPing still only needs
    ///     TotalScore and stays covering — the extra columns are a suffix.
    ///
    ///   IX_PlayerMapStats_ArcadeRoster_Covering
    ///     LoadMapSnapshotsAsync is PlayerName IN (150) AND ServerGuid = ? GROUP BY
    ///     PlayerName, MapName with five SUMs. PK leads PlayerName then MapName then
    ///     ServerGuid, so each name walked every server and fetched the table for the
    ///     SUMs. PlayerName + ServerGuid first skips other servers; the SUM columns
    ///     make it index-only. Distinct from IX_PlayerMapStats_MapRanking_Covering
    ///     (MapName-leading, used by map rankings) and from the server-detail covering
    ///     index (ServerGuid, MapName, PlayerName).
    ///
    /// Building the PlayerMapStats index sorts the full table. Migrations run via
    /// Database.MigrateAsync() before the API serves traffic, so the rollout that picks
    /// this up will start slowly.
    /// </summary>
    public partial class CoverArcadeServerRosterQueries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ServerPlayerRankings_ServerGuid_PlayerName_TotalScore",
                table: "ServerPlayerRankings");

            migrationBuilder.CreateIndex(
                name: "IX_ServerPlayerRankings_ServerGuid_PlayerName_CareerCovering",
                table: "ServerPlayerRankings",
                columns: new[] { "ServerGuid", "PlayerName", "TotalScore", "TotalKills", "TotalDeaths", "TotalPlayTimeMinutes" });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerMapStats_ArcadeRoster_Covering",
                table: "PlayerMapStats",
                columns: new[] { "PlayerName", "ServerGuid", "MapName", "TotalKills", "TotalDeaths", "TotalScore", "TotalPlayTimeMinutes", "TotalRounds" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerMapStats_ArcadeRoster_Covering",
                table: "PlayerMapStats");

            migrationBuilder.DropIndex(
                name: "IX_ServerPlayerRankings_ServerGuid_PlayerName_CareerCovering",
                table: "ServerPlayerRankings");

            migrationBuilder.CreateIndex(
                name: "IX_ServerPlayerRankings_ServerGuid_PlayerName_TotalScore",
                table: "ServerPlayerRankings",
                columns: new[] { "ServerGuid", "PlayerName", "TotalScore" });
        }
    }
}
