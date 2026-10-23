using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Covering index for GET /stats/data-explorer/servers/{guid} top-5-per-map.
    /// Building it sorts PlayerMapStats; first start after migrate is slower.
    /// </summary>
    public partial class CoverPlayerMapStatsServerDetail : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerMapStats_ServerGuid_MapName",
                table: "PlayerMapStats");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerMapStats_ServerDetail_Covering",
                table: "PlayerMapStats",
                columns: new[] { "ServerGuid", "MapName", "PlayerName", "TotalScore", "TotalKills", "TotalDeaths" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerMapStats_ServerDetail_Covering",
                table: "PlayerMapStats");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerMapStats_ServerGuid_MapName",
                table: "PlayerMapStats",
                columns: new[] { "ServerGuid", "MapName" });
        }
    }
}
