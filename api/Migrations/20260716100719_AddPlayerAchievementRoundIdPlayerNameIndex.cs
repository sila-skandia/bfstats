using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddPlayerAchievementRoundIdPlayerNameIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_PlayerAchievements_RoundId_PlayerName",
                table: "PlayerAchievements",
                columns: new[] { "RoundId", "PlayerName" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerAchievements_RoundId_PlayerName",
                table: "PlayerAchievements");
        }
    }
}
