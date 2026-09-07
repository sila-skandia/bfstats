using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Extends IX_PlayerMapStats_MapRanking_Covering so GET
    /// /stats/data-explorer/maps/{map}/rankings can COUNT and GROUP BY without
    /// visiting the table.
    ///
    /// Taken from a production trace (2026-09-07T08:03Z, TraceId
    /// 812b686b6cf5dbe3aad2e0ccbf300311) of that endpoint on market garden with
    /// days=60 and a single serverGuid. The HTTP request was 9.2s:
    ///
    ///   COUNT(*) of players with HAVING SUM(TotalRounds) &gt;= 3   7,261ms
    ///   paginated ranking SELECT with the same HAVING             1,939ms
    ///
    /// The previous covering index ended at TotalScore. The COUNT (and the
    /// ranking SELECT) also read TotalRounds, TotalKills, TotalDeaths, and
    /// TotalPlayTimeMinutes, so each matching player-month row was still a
    /// random table fetch. On the network-attached volume that is ~1.4ms each.
    ///
    /// Column order is unchanged (MapName, ServerGuid, PlayerName, Year, Month
    /// still lead) so the original /stats/data-explorer/players/{name}/maps
    /// ranking CTE keeps its GROUP BY shape. The extra columns make both
    /// queries covering.
    ///
    /// Cost of the migration itself: drop and rebuild the covering index,
    /// sorting ~1.5M rows. Migrations run via Database.MigrateAsync() before
    /// the API serves traffic, so the rollout that picks this up will start
    /// slowly.
    /// </summary>
    public partial class CoverPlayerMapStatsMapRankingsTotals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerMapStats_MapRanking_Covering",
                table: "PlayerMapStats");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerMapStats_MapRanking_Covering",
                table: "PlayerMapStats",
                columns: new[]
                {
                    "MapName",
                    "ServerGuid",
                    "PlayerName",
                    "Year",
                    "Month",
                    "TotalScore",
                    "TotalKills",
                    "TotalDeaths",
                    "TotalRounds",
                    "TotalPlayTimeMinutes"
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerMapStats_MapRanking_Covering",
                table: "PlayerMapStats");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerMapStats_MapRanking_Covering",
                table: "PlayerMapStats",
                columns: new[]
                {
                    "MapName",
                    "ServerGuid",
                    "PlayerName",
                    "Year",
                    "Month",
                    "TotalScore"
                });
        }
    }
}
