using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddWrappedPerformanceIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_PlayerStatsMonthly_Year_PlayerName_Covering",
                table: "PlayerStatsMonthly",
                columns: new[] { "Year", "PlayerName", "TotalScore", "TotalKills", "TotalRounds", "TotalDeaths", "TotalPlayTimeMinutes" });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerMapStats_PlayerName_Year_ServerGuid_MapName",
                table: "PlayerMapStats",
                columns: new[] { "PlayerName", "Year", "ServerGuid", "MapName" });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerAchievements_AchievementType_ServerGuid_PlayerName_AchievedAt",
                table: "PlayerAchievements",
                columns: new[] { "AchievementType", "ServerGuid", "PlayerName", "AchievedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerStatsMonthly_Year_PlayerName_Covering",
                table: "PlayerStatsMonthly");

            migrationBuilder.DropIndex(
                name: "IX_PlayerMapStats_PlayerName_Year_ServerGuid_MapName",
                table: "PlayerMapStats");

            migrationBuilder.DropIndex(
                name: "IX_PlayerAchievements_AchievementType_ServerGuid_PlayerName_AchievedAt",
                table: "PlayerAchievements");
        }
    }
}
