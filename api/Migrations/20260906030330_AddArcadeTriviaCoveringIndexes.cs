using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Covering indexes for the arcade trivia pool build.
    ///
    /// Taken from a production trace of GET /stats/arcade/trivia/quiz that took 29.2s. The
    /// pattern is the one AddCoveringIndexesForRankingQueries described: a query whose access
    /// path is fine but which reads a column no index carries, so it pays one random row fetch
    /// per candidate row — and on the network-attached volume each of those is a ~1.38ms round
    /// trip rather than an NVMe read.
    ///
    ///   IX_PlayerAchievements_PlayerName_AchievementName
    ///     ArcadeService.LoadSignatureBadgesAsync wants one badge per roster player.
    ///     AchievementName is in no index, so SQLite visited the table row for every
    ///     achievement the 150 roster players had ever earned — ~8,700 fetches. The command
    ///     reported 3ms and the reader then took 12.04s to drain, 41% of the request, to
    ///     produce 150 strings. Index-only now, and the MIN() per player is a single seek.
    ///
    ///   IX_PlayerAchievements_AchievementType_PlayerName_AchievementId
    ///     The four leader tallies in AddPlayerAchievementTriviaQuestionsAsync, all
    ///     "AchievementType = ? AND PlayerName IN (150) GROUP BY PlayerName", cost 6.8s
    ///     between them (2081/2011/1375/1322ms). The existing
    ///     IX_PlayerAchievements_AchievementType_ServerGuid_PlayerName_AchievedAt cannot serve
    ///     them: ServerGuid is at position 2 and unconstrained, which puts PlayerName out of
    ///     reach for seeking, so the planner walked every row of the type instead. Leading
    ///     (AchievementType, PlayerName) turns each roster name into a seek, and carrying
    ///     AchievementId lets the round_placement_1 variant filter and all three COUNT(*)
    ///     aggregates finish without touching the table.
    ///
    ///   IX_PlayerServerStats_PlayerName_ServerGuid_TotalRounds
    ///     The roster's "most played server per player" rollup. The primary key already
    ///     orders by (PlayerName, ServerGuid) so the GROUP BY was free, but TotalRounds came
    ///     from the table: 5ms to execute, 2.13s to read.
    ///
    /// Cost of the migration itself: three index builds, each sorting the full table.
    /// Migrations run via Database.MigrateAsync() before the API serves traffic, so the
    /// rollout that picks this up will start slowly.
    ///
    /// The other half of this work is not indexable — the pool build aggregates the whole of
    /// PlayerStatsMonthly and PlayerMapStats, and nothing indexes away a full GROUP BY. That
    /// is handled by keeping the build off the request path entirely; see
    /// ArcadeTriviaPoolCache and ArcadeTriviaWarmupBackgroundService.
    /// </summary>
    public partial class AddArcadeTriviaCoveringIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_PlayerServerStats_PlayerName_ServerGuid_TotalRounds",
                table: "PlayerServerStats",
                columns: new[] { "PlayerName", "ServerGuid", "TotalRounds" });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerAchievements_AchievementType_PlayerName_AchievementId",
                table: "PlayerAchievements",
                columns: new[] { "AchievementType", "PlayerName", "AchievementId" });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerAchievements_PlayerName_AchievementName",
                table: "PlayerAchievements",
                columns: new[] { "PlayerName", "AchievementName" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerServerStats_PlayerName_ServerGuid_TotalRounds",
                table: "PlayerServerStats");

            migrationBuilder.DropIndex(
                name: "IX_PlayerAchievements_AchievementType_PlayerName_AchievementId",
                table: "PlayerAchievements");

            migrationBuilder.DropIndex(
                name: "IX_PlayerAchievements_PlayerName_AchievementName",
                table: "PlayerAchievements");
        }
    }
}
