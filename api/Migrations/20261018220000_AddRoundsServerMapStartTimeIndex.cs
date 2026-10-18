using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Index for GET /stats/rounds?serverName=…&amp;mapName=… (and serverGuid+mapName).
    ///
    /// Seq Slow 21:59Z 10-18: HTTP 200 in 22.8s (TraceId 82a22d84c60fd187dd824dbae5d5b8c6).
    /// COUNT(*) WHERE ServerGuid = @g AND MapName = @m was 6ms; the StartTime DESC
    /// LIMIT 25 page then walked (ServerGuid, StartTime) and heap-filtered MapName
    /// in 22,751ms. Same server without mapName was 9ms two minutes earlier.
    /// No hourly overlap.
    ///
    /// Closed PR #46 indexed (ServerGuid, MapName) for the COUNT hop and never
    /// landed. This index adds StartTime so ORDER BY + LIMIT walks the matching
    /// slice instead of every round on that server.
    ///
    /// First start after migrate builds the index before the API serves traffic.
    /// </summary>
    public partial class AddRoundsServerMapStartTimeIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Rounds_ServerGuid_MapName_StartTime",
                table: "Rounds",
                columns: new[] { "ServerGuid", "MapName", "StartTime" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Rounds_ServerGuid_MapName_StartTime",
                table: "Rounds");
        }
    }
}
