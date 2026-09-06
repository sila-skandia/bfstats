using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Corrects IX_PlayerAchievements_PlayerName_AchievementName from
    /// AddArcadeTriviaCoveringIndexes, which was the wrong shape for the code path that
    /// actually runs.
    ///
    /// That index was derived from a trace of the *global* trivia pool build. But the arcade
    /// UI gates on picking a server, so nearly every real request goes through
    /// ArcadeService.LoadRosterForServerAsync, whose badge lookup carries an extra predicate:
    ///
    ///   WHERE PlayerName IN (…) AND (ServerGuid = @guid OR ServerGuid = '')
    ///
    /// ServerGuid was not in the index, so it could not be tested from it. Worse than merely
    /// falling back to a row fetch, the planner abandoned the index altogether and drove the
    /// query off the single-column IX_PlayerAchievements_ServerGuid instead — walking every
    /// achievement ever earned on that server. This is the same low-cardinality-driver trap
    /// documented on the WrappedService NemesisLosses query: a status/enum-like column with a
    /// plain index looks selective to the planner and is not.
    ///
    /// Production trace 2026-09-06T03:56Z, GET /stats/arcade/higher-lower/next: the command
    /// reported 5ms and the reader took 8.57s to drain — 76% of an 11.2s request.
    ///
    /// Measured on a 600k-row copy at production cardinality with ANALYZE run:
    ///
    ///   | index                                  | server-scoped | global |
    ///   |----------------------------------------|---------------|--------|
    ///   | none                                   | 45.7ms        | 16.8ms |
    ///   | (PlayerName, AchievementName)          | 47.5ms IGNORED| 1.2ms  |
    ///   | (PlayerName, ServerGuid, AchievementName) | 0.4ms      | 1.3ms  |
    ///
    /// The three-column index covers both shapes, so it replaces rather than joins the old
    /// one: the global callers seek PlayerName alone and scan a covering range, and the
    /// server-scoped caller gets two seeks per player (the server's guid and '').
    /// </summary>
    public partial class FixArcadeBadgeIndexForServerScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerAchievements_PlayerName_AchievementName",
                table: "PlayerAchievements");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerAchievements_PlayerName_ServerGuid_AchievementName",
                table: "PlayerAchievements",
                columns: new[] { "PlayerName", "ServerGuid", "AchievementName" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerAchievements_PlayerName_ServerGuid_AchievementName",
                table: "PlayerAchievements");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerAchievements_PlayerName_AchievementName",
                table: "PlayerAchievements",
                columns: new[] { "PlayerName", "AchievementName" });
        }
    }
}
