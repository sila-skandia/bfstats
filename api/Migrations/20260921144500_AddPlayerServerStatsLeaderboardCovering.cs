using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Covering index for GET /stats/leaderboard when populatedOnly / include / exclude
    /// force a PlayerServerStats weekly scan.
    ///
    /// The UI defaults populatedOnly on. A year lookback then aggregates every weekly
    /// row for the high-occupancy cluster, GROUP BY PlayerName, then COUNT + page.
    /// IX_PlayerServerStats_ServerGuid_Year_Week found those rows, but TotalKills /
    /// TotalDeaths / TotalScore / TotalPlayTimeMinutes / TotalRounds lived only on the
    /// heap. Each SUM was a random row fetch. On the Hetzner network-attached volume
    /// that is ~1.38ms each, which is how
    /// /stats/leaderboard?days=365&amp;populatedOnly=true&amp;minRounds=25 crossed 10s
    /// (Seq Slow 2026-09-21 14:20Z, TraceId e7e7efe73be23754251077745dfe1c76) and
    /// repeatedly 1.4–10s for the same URL over the preceding two days.
    ///
    /// IX_PlayerServerStats_LeaderboardCovering carries PlayerName and the SUM columns
    /// after (ServerGuid, Year, Week), so the GROUP BY is index-only. It is a strict
    /// superset of the dropped prefix index.
    ///
    /// Building the index sorts the weekly table. Migrations run via
    /// Database.MigrateAsync() before the API serves traffic, so the rollout that picks
    /// this up will start slowly.
    /// </summary>
    public partial class AddPlayerServerStatsLeaderboardCovering : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerServerStats_ServerGuid_Year_Week",
                table: "PlayerServerStats");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerServerStats_LeaderboardCovering",
                table: "PlayerServerStats",
                columns: new[]
                {
                    "ServerGuid",
                    "Year",
                    "Week",
                    "PlayerName",
                    "TotalKills",
                    "TotalDeaths",
                    "TotalScore",
                    "TotalPlayTimeMinutes",
                    "TotalRounds"
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerServerStats_LeaderboardCovering",
                table: "PlayerServerStats");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerServerStats_ServerGuid_Year_Week",
                table: "PlayerServerStats",
                columns: new[] { "ServerGuid", "Year", "Week" });
        }
    }
}
