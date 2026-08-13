using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Restores 49 indexes that the migration history says were created but which
    /// are absent from the database. EF's SQLite provider rebuilds a table to implement
    /// DropColumn (create temp table, copy, drop, rename); several of those rebuilds did
    /// not recreate the table's indexes, so they were dropped silently.
    ///
    /// The model snapshot still declares every one of them, so `dotnet ef migrations add`
    /// produces an empty migration — EF believes they exist. Hence raw SQL here rather
    /// than migrationBuilder.CreateIndex.
    ///
    /// Measured impact: Rounds had no indexes at all, so the live-servers landing query
    /// (WHERE ServerGuid IN (...) AND IsActive) full-scanned ~707k rows — 451-524ms of
    /// the endpoint's ~500ms server time in production.
    ///
    /// IX_Rounds_ServerGuid is deliberately NON-unique here, unlike the original
    /// definition. Production currently holds a server with two active rounds, and
    /// LiveServersController explicitly tolerates that ("server merges can leave multiple
    /// IsActive rounds per ServerGuid until the next map change closes them"). A unique
    /// index would fail at startup, since migrations run via Database.Migrate().
    /// </summary>
    public partial class RestoreMissingIndexes : Migration
    {
        private static readonly string[] Up_ =
        [
                """CREATE INDEX IF NOT EXISTS "IX_PlayerSessions_PlayerName_ServerGuid_SessionId" ON "PlayerSessions" ("PlayerName", "ServerGuid", "SessionId");""",
                """CREATE UNIQUE INDEX IF NOT EXISTS "IX_RefreshTokens_TokenHash" ON "RefreshTokens" ("TokenHash");""",
                """CREATE INDEX IF NOT EXISTS "IX_RefreshTokens_UserId" ON "RefreshTokens" ("UserId");""",
                """CREATE INDEX IF NOT EXISTS "IX_Rounds_IsActive" ON "Rounds" ("IsActive");""",
                """CREATE INDEX IF NOT EXISTS "IX_Rounds_MapName" ON "Rounds" ("MapName");""",
                """CREATE INDEX IF NOT EXISTS "IX_Rounds_ServerGuid" ON "Rounds" ("ServerGuid") WHERE IsActive = 1;""",
                // Not part of the lost set — added here because the partial index above is
                // only reachable from a literal "IsActive = 1", and EF emits a bare boolean
                // for `r.IsActive`. This composite serves the query as written.
                // Measured on a copy of production Rounds (707k rows):
                //   no index                       SCAN,   72ms
                //   IX_Rounds_ServerGuid_StartTime SEARCH, 37ms  (fetches every round per server)
                //   IX_Rounds_ServerGuid_IsActive  SEARCH,  1.7ms
                """CREATE INDEX IF NOT EXISTS "IX_Rounds_ServerGuid_IsActive" ON "Rounds" ("ServerGuid", "IsActive");""",
                """CREATE INDEX IF NOT EXISTS "IX_Rounds_ServerGuid_EndTime" ON "Rounds" ("ServerGuid", "EndTime");""",
                """CREATE INDEX IF NOT EXISTS "IX_Rounds_ServerGuid_StartTime" ON "Rounds" ("ServerGuid", "StartTime");""",
                """CREATE INDEX IF NOT EXISTS "IX_ServerPlayerRankings_PlayerName" ON "ServerPlayerRankings" ("PlayerName");""",
                """CREATE UNIQUE INDEX IF NOT EXISTS "IX_ServerPlayerRankings_ServerGuid_PlayerName_Year_Month" ON "ServerPlayerRankings" ("ServerGuid", "PlayerName", "Year", "Month");""",
                """CREATE INDEX IF NOT EXISTS "IX_ServerPlayerRankings_ServerGuid_Rank" ON "ServerPlayerRankings" ("ServerGuid", "Rank");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentFiles_TournamentId" ON "TournamentFiles" ("TournamentId");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentImageIndices_FolderPath" ON "TournamentImageIndices" ("FolderPath");""",
                """CREATE UNIQUE INDEX IF NOT EXISTS "IX_TournamentImageIndices_FolderPath_FileName" ON "TournamentImageIndices" ("FolderPath", "FileName");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatchMaps_MatchId" ON "TournamentMatchMaps" ("MatchId");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatchMaps_MatchId_MapOrder" ON "TournamentMatchMaps" ("MatchId", "MapOrder");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatchMaps_TeamId" ON "TournamentMatchMaps" ("TeamId");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatchResults_MatchId" ON "TournamentMatchResults" ("MatchId");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatchResults_RoundId" ON "TournamentMatchResults" ("RoundId");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatchResults_Team1Id" ON "TournamentMatchResults" ("Team1Id");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatchResults_Team2Id" ON "TournamentMatchResults" ("Team2Id");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatchResults_TournamentId" ON "TournamentMatchResults" ("TournamentId");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatchResults_TournamentId_Week" ON "TournamentMatchResults" ("TournamentId", "Week");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatchResults_WinningTeamId" ON "TournamentMatchResults" ("WinningTeamId");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatches_CreatedAt" ON "TournamentMatches" ("CreatedAt");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatches_ScheduledDate" ON "TournamentMatches" ("ScheduledDate");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatches_ServerGuid" ON "TournamentMatches" ("ServerGuid");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatches_Team1Id" ON "TournamentMatches" ("Team1Id");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatches_Team2Id" ON "TournamentMatches" ("Team2Id");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentMatches_TournamentId" ON "TournamentMatches" ("TournamentId");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentTeamRankings_TeamId" ON "TournamentTeamRankings" ("TeamId");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentTeamRankings_TournamentId" ON "TournamentTeamRankings" ("TournamentId");""",
                """CREATE UNIQUE INDEX IF NOT EXISTS "IX_TournamentTeamRankings_TournamentId_TeamId_Week" ON "TournamentTeamRankings" ("TournamentId", "TeamId", "Week");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentTeamRankings_TournamentId_Week" ON "TournamentTeamRankings" ("TournamentId", "Week");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentWeekDates_TournamentId" ON "TournamentWeekDates" ("TournamentId");""",
                """CREATE INDEX IF NOT EXISTS "IX_TournamentWeekDates_TournamentId_Week" ON "TournamentWeekDates" ("TournamentId", "Week");""",
                """CREATE INDEX IF NOT EXISTS "IX_Tournaments_CreatedAt" ON "Tournaments" ("CreatedAt");""",
                """CREATE INDEX IF NOT EXISTS "IX_Tournaments_CreatedByUserEmail" ON "Tournaments" ("CreatedByUserEmail");""",
                """CREATE INDEX IF NOT EXISTS "IX_Tournaments_CreatedByUserId" ON "Tournaments" ("CreatedByUserId");""",
                """CREATE INDEX IF NOT EXISTS "IX_Tournaments_Game" ON "Tournaments" ("Game");""",
                """CREATE INDEX IF NOT EXISTS "IX_Tournaments_Organizer" ON "Tournaments" ("Organizer");""",
                """CREATE INDEX IF NOT EXISTS "IX_Tournaments_ServerGuid" ON "Tournaments" ("ServerGuid");""",
                """CREATE UNIQUE INDEX IF NOT EXISTS "IX_Tournaments_ThemeId" ON "Tournaments" ("ThemeId");""",
                """CREATE INDEX IF NOT EXISTS "IX_UserBuddies_BuddyPlayerName" ON "UserBuddies" ("BuddyPlayerName");""",
                """CREATE UNIQUE INDEX IF NOT EXISTS "IX_UserBuddies_UserId_BuddyPlayerName" ON "UserBuddies" ("UserId", "BuddyPlayerName");""",
                """CREATE INDEX IF NOT EXISTS "IX_UserFavoriteServers_ServerGuid" ON "UserFavoriteServers" ("ServerGuid");""",
                """CREATE UNIQUE INDEX IF NOT EXISTS "IX_UserFavoriteServers_UserId_ServerGuid" ON "UserFavoriteServers" ("UserId", "ServerGuid");""",
                """CREATE INDEX IF NOT EXISTS "IX_UserPlayerNames_PlayerName" ON "UserPlayerNames" ("PlayerName");""",
                """CREATE UNIQUE INDEX IF NOT EXISTS "IX_Users_Email" ON "Users" ("Email");""",
        ];

        private static readonly string[] Down_ =
        [
                """DROP INDEX IF EXISTS "IX_PlayerSessions_PlayerName_ServerGuid_SessionId";""",
                """DROP INDEX IF EXISTS "IX_RefreshTokens_TokenHash";""",
                """DROP INDEX IF EXISTS "IX_RefreshTokens_UserId";""",
                """DROP INDEX IF EXISTS "IX_Rounds_IsActive";""",
                """DROP INDEX IF EXISTS "IX_Rounds_MapName";""",
                """DROP INDEX IF EXISTS "IX_Rounds_ServerGuid";""",
                """DROP INDEX IF EXISTS "IX_Rounds_ServerGuid_IsActive";""",
                """DROP INDEX IF EXISTS "IX_Rounds_ServerGuid_EndTime";""",
                """DROP INDEX IF EXISTS "IX_Rounds_ServerGuid_StartTime";""",
                """DROP INDEX IF EXISTS "IX_ServerPlayerRankings_PlayerName";""",
                """DROP INDEX IF EXISTS "IX_ServerPlayerRankings_ServerGuid_PlayerName_Year_Month";""",
                """DROP INDEX IF EXISTS "IX_ServerPlayerRankings_ServerGuid_Rank";""",
                """DROP INDEX IF EXISTS "IX_TournamentFiles_TournamentId";""",
                """DROP INDEX IF EXISTS "IX_TournamentImageIndices_FolderPath";""",
                """DROP INDEX IF EXISTS "IX_TournamentImageIndices_FolderPath_FileName";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatchMaps_MatchId";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatchMaps_MatchId_MapOrder";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatchMaps_TeamId";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatchResults_MatchId";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatchResults_RoundId";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatchResults_Team1Id";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatchResults_Team2Id";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatchResults_TournamentId";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatchResults_TournamentId_Week";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatchResults_WinningTeamId";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatches_CreatedAt";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatches_ScheduledDate";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatches_ServerGuid";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatches_Team1Id";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatches_Team2Id";""",
                """DROP INDEX IF EXISTS "IX_TournamentMatches_TournamentId";""",
                """DROP INDEX IF EXISTS "IX_TournamentTeamRankings_TeamId";""",
                """DROP INDEX IF EXISTS "IX_TournamentTeamRankings_TournamentId";""",
                """DROP INDEX IF EXISTS "IX_TournamentTeamRankings_TournamentId_TeamId_Week";""",
                """DROP INDEX IF EXISTS "IX_TournamentTeamRankings_TournamentId_Week";""",
                """DROP INDEX IF EXISTS "IX_TournamentWeekDates_TournamentId";""",
                """DROP INDEX IF EXISTS "IX_TournamentWeekDates_TournamentId_Week";""",
                """DROP INDEX IF EXISTS "IX_Tournaments_CreatedAt";""",
                """DROP INDEX IF EXISTS "IX_Tournaments_CreatedByUserEmail";""",
                """DROP INDEX IF EXISTS "IX_Tournaments_CreatedByUserId";""",
                """DROP INDEX IF EXISTS "IX_Tournaments_Game";""",
                """DROP INDEX IF EXISTS "IX_Tournaments_Organizer";""",
                """DROP INDEX IF EXISTS "IX_Tournaments_ServerGuid";""",
                """DROP INDEX IF EXISTS "IX_Tournaments_ThemeId";""",
                """DROP INDEX IF EXISTS "IX_UserBuddies_BuddyPlayerName";""",
                """DROP INDEX IF EXISTS "IX_UserBuddies_UserId_BuddyPlayerName";""",
                """DROP INDEX IF EXISTS "IX_UserFavoriteServers_ServerGuid";""",
                """DROP INDEX IF EXISTS "IX_UserFavoriteServers_UserId_ServerGuid";""",
                """DROP INDEX IF EXISTS "IX_UserPlayerNames_PlayerName";""",
                """DROP INDEX IF EXISTS "IX_Users_Email";""",
        ];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            foreach (var sql in Up_) migrationBuilder.Sql(sql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var sql in Down_) migrationBuilder.Sql(sql);
        }
    }
}
