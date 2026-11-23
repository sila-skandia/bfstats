using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Composite index for the global map filter on GET /stats/rounds.
    ///
    /// Seq Slow 03:29Z 11-10: pageSize=2&amp;mapName=bocage, HTTP 200 in 18.5s
    /// (TraceId a2b22a3914585e960c07279cd3091965). COUNT(*) WHERE MapName = @m
    /// was 43ms on IX_Rounds_MapName; the ORDER BY StartTime DESC LIMIT 2 page
    /// then sorted every bocage row in 18,407ms.
    ///
    /// PR #36 equality is live (no instr). Leftover PR #71 is server+map
    /// (ServerGuid, MapName, StartTime) and does not cover a map filter with
    /// no server. PR #88 is global StartTime / ParticipantCount and does not
    /// cover this plan — SQLite still prefers MapName equality and filesorts.
    ///
    /// First start after migrate builds the index before the API serves traffic.
    /// </summary>
    public partial class AddRoundsMapNameStartTimeIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Rounds_MapName_StartTime",
                table: "Rounds",
                columns: new[] { "MapName", "StartTime" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Rounds_MapName_StartTime",
                table: "Rounds");
        }
    }
}
