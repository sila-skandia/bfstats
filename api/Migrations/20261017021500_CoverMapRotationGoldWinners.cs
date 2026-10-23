using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Covering index for map-rotation gold winners on PlayerAchievements.
    ///
    /// GET /stats/data-explorer/servers/{guid}/map-rotation groups gold
    /// round_placement rows by (MapName, PlayerName) after a MapName IN-list.
    /// IX_PlayerAchievements_AchievementType_ServerGuid_PlayerName_AchievedAt
    /// can seek type+server but does not carry MapName or Tier, so each gold
    /// row was a random table fetch. On the Hetzner volume that is ~1.4ms
    /// each: MoonGamers pageSize=50 (36 maps) was 13,324ms
    /// (TraceId 2ce9e8cb063ff5c6661ff3fdfc481f37) after the same URL finished
    /// in 322ms on a warm cache.
    ///
    /// Partial on gold placements only so other achievement inserts skip it.
    /// The query uses those same literals so the planner can take the filter.
    /// First start after migrate builds the index.
    /// </summary>
    public partial class CoverMapRotationGoldWinners : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_PlayerAchievements_MapGoldWinners_Covering",
                table: "PlayerAchievements",
                columns: new[] { "ServerGuid", "MapName", "PlayerName" },
                filter: "AchievementType = 'round_placement' AND Tier = 'gold'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerAchievements_MapGoldWinners_Covering",
                table: "PlayerAchievements");
        }
    }
}
