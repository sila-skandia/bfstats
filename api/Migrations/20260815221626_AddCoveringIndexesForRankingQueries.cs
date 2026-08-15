using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Index changes for the move to the Hetzner network-attached volume.
    ///
    /// The volume did not make these queries worse, it made existing waste visible. A read
    /// that misses page cache used to cost an NVMe fetch and now costs a network round
    /// trip, and an 18GB database on a 7741Mi node cannot keep its working set cached. Any
    /// query doing a random row fetch per candidate row is now paying full latency for
    /// each one, so the fix is to keep those queries off the table entirely.
    ///
    /// Both new indexes are covering — every column the query reads is in the index, so
    /// SQLite never visits the row.
    ///
    ///   IX_ServerPlayerRankings_ServerGuid_PlayerName_TotalScore
    ///     PlayerStatsService.GetServerRankingsWithPing re-aggregates a whole server's
    ///     ranking history (SUM(TotalScore) GROUP BY PlayerName) once per server the player
    ///     has played on, twice per server. The existing unique index stops before
    ///     TotalScore, so every entry needed a row fetch — 27,056 on the busiest server.
    ///
    ///   IX_PlayerMapStats_MapRanking_Covering
    ///     The map-rankings query behind /stats/data-explorer/players/{name}/maps ranks
    ///     every player on every map the requested player has touched (607,689 of 1.46M
    ///     rows for a typical player) to report that one player's rank. The row count is
    ///     inherent to ranking and cannot be indexed away; the row fetches can. Column
    ///     order also matches the GROUP BY, which drops the temp-B-tree sort. Measured
    ///     warm on a copy of production, so the I/O saving is not represented:
    ///     1.029s/0.25s system before, 0.434s/0.02s system after.
    ///
    /// The dropped index is a strict prefix of IX_PlayerObservations_SessionId_Timestamp,
    /// which serves every lookup it did. On 101M rows it was 1.26GB and an extra B-tree
    /// write per observation insert, for nothing.
    ///
    /// Note: building IX_PlayerMapStats_MapRanking_Covering sorts 1.46M rows and writes
    /// ~100MB. Migrations run via Database.MigrateAsync() before the API serves traffic,
    /// so expect a slower first start on the rollout that picks this up.
    ///
    /// The other half of this work is statistics rather than indexes — the database had no
    /// sqlite_stat1 at all. See SqliteStatisticsBackgroundService.
    /// </summary>
    public partial class AddCoveringIndexesForRankingQueries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PlayerObservations_SessionId",
                table: "PlayerObservations");

            migrationBuilder.CreateIndex(
                name: "IX_ServerPlayerRankings_ServerGuid_PlayerName_TotalScore",
                table: "ServerPlayerRankings",
                columns: new[] { "ServerGuid", "PlayerName", "TotalScore" });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerMapStats_MapRanking_Covering",
                table: "PlayerMapStats",
                columns: new[] { "MapName", "ServerGuid", "PlayerName", "Year", "Month", "TotalScore" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ServerPlayerRankings_ServerGuid_PlayerName_TotalScore",
                table: "ServerPlayerRankings");

            migrationBuilder.DropIndex(
                name: "IX_PlayerMapStats_MapRanking_Covering",
                table: "PlayerMapStats");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerObservations_SessionId",
                table: "PlayerObservations",
                column: "SessionId");
        }
    }
}
