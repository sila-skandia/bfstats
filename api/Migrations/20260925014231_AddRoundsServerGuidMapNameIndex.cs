using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Serves GET /stats/rounds?serverGuid=&amp;mapName= COUNT(*). Equality on MapName
    /// (PR #36) still walks every round for that server via (ServerGuid, StartTime).
    /// On the Hetzner volume that is 2-18s for a busy server (Seq 2026-09-25T01:38Z,
    /// traces 599f139f34af306e0e6e0170ad41e5a6 / f2afa8211a6625d4eef66557bbdf6d7c).
    /// This pair lets COUNT stay on the B-tree without touching the heap.
    /// First start after migrate builds the index on Rounds.
    /// </summary>
    public partial class AddRoundsServerGuidMapNameIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Rounds_ServerGuid_MapName",
                table: "Rounds",
                columns: new[] { "ServerGuid", "MapName" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Rounds_ServerGuid_MapName",
                table: "Rounds");
        }
    }
}
