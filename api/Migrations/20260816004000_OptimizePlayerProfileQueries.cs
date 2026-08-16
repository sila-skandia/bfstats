using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Index additions to optimize Player Profile performance on Hetzner network volume.
    ///
    /// 1. IX_PlayerSessions_PlayerName_LastSeenTime:
    ///    Optimizes recent sessions lookup (PlayerSessions.Where(ps => ps.PlayerName == playerName).OrderByDescending(s => s.LastSeenTime).Take(10))
    ///    so SQLite can do an immediate backward index scan rather than fetching and sorting all historical sessions in memory.
    ///
    /// 2. IX_ServerPlayerRankings_PlayerName_ServerGuid_TotalScore:
    ///    Covering index for player-first ranking queries. Eliminates full table scan on ServerPlayerRankings when
    ///    querying a player's server rankings.
    /// </summary>
    public partial class OptimizePlayerProfileQueries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_PlayerSessions_PlayerName_LastSeenTime",
                table: "PlayerSessions",
                columns: new[] { "PlayerName", "LastSeenTime" });

            migrationBuilder.CreateIndex(
                name: "IX_ServerPlayerRankings_PlayerName_ServerGuid_TotalScore",
                table: "ServerPlayerRankings",
                columns: new[] { "PlayerName", "ServerGuid", "TotalScore" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerSessions_PlayerName_LastSeenTime",
                table: "PlayerSessions");

            migrationBuilder.DropIndex(
                name: "IX_ServerPlayerRankings_PlayerName_ServerGuid_TotalScore",
                table: "ServerPlayerRankings");
        }
    }
}
