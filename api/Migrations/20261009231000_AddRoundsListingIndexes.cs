using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Indexes for the global sessions listing (GET /stats/rounds?minParticipants=1).
    ///
    /// Seq Slow 23:05Z 10-09: HTTP 200 in 62.9s (TraceId f829903231de54d2f8a8ac45d8db0e8d).
    /// COUNT(*) WHERE ParticipantCount >= 1 walked Rounds in 51,316ms; the StartTime DESC
    /// LIMIT 25 page then sorted the same set in 11,587ms. No hourly overlap.
    ///
    /// There is no global IX_Rounds_StartTime — only (ServerGuid, StartTime) — and
    /// ParticipantCount is in no index, so both hops table-scan on the Hetzner volume.
    ///
    /// First start after migrate builds both indexes before the API serves traffic.
    /// </summary>
    public partial class AddRoundsListingIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Rounds_ParticipantCount",
                table: "Rounds",
                column: "ParticipantCount");

            migrationBuilder.CreateIndex(
                name: "IX_Rounds_StartTime",
                table: "Rounds",
                column: "StartTime");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Rounds_ParticipantCount",
                table: "Rounds");

            migrationBuilder.DropIndex(
                name: "IX_Rounds_StartTime",
                table: "Rounds");
        }
    }
}
