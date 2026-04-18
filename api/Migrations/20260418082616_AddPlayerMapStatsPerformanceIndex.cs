using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddPlayerMapStatsPerformanceIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_PlayerMapStats_PlayerName_ServerGuid_Year_Month",
                table: "PlayerMapStats",
                columns: new[] { "PlayerName", "ServerGuid", "Year", "Month" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerMapStats_PlayerName_ServerGuid_Year_Month",
                table: "PlayerMapStats");
        }
    }
}
