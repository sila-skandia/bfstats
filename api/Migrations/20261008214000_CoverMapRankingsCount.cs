using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Rebuild IX_PlayerMapStats_MapRanking_Covering so map-rankings COUNT/HAVING
    /// stays on the B-tree.
    ///
    /// GET /stats/data-explorer/maps/{map}/rankings groups PlayerMapStats by player
    /// with HAVING SUM(TotalRounds) &gt;= minRounds, then reads score/kills/deaths/
    /// playtime for the page. The previous covering index ended at TotalScore, so
    /// each matching player-month was a random table fetch. On the Hetzner network
    /// volume that is ~1.4ms each: market garden days=365 COUNT was 21,304ms
    /// (TraceId dd028fd4b14126b3987a36c6df69ff91), days=60 COUNT 4,792ms on the
    /// same Firefox session.
    ///
    /// Column order is unchanged (MapName, ServerGuid, PlayerName, Year, Month,
    /// then measures). Adding TotalKills, TotalDeaths, TotalRounds and
    /// TotalPlayTimeMinutes makes COUNT and the ranking SELECT index-only.
    ///
    /// Building the index sorts PlayerMapStats (~1.5M rows) and writes on the
    /// order of 100MB. Migrations run via Database.MigrateAsync() before the API
    /// serves traffic, so the first start after this rollout will be slow.
    /// </summary>
    public partial class CoverMapRankingsCount : Migration
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
                columns: new[] { "MapName", "ServerGuid", "PlayerName", "Year", "Month", "TotalScore" });
        }
    }
}
