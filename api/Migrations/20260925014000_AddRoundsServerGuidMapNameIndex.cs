using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <summary>
    /// Adds IX_Rounds_ServerGuid_MapName so the map-drill-in listing COUNT can
    /// stay on a B-tree range.
    ///
    /// GET /stats/rounds?serverGuid=…&amp;mapName=… compiles to
    ///
    ///   SELECT COUNT(*) FROM Rounds WHERE ServerGuid = @g AND MapName = @m
    ///
    /// after PR #36 switched MapName.Contains to equality. IX_Rounds_MapName
    /// looks selective (dozens of names) but popular maps are huge, so the
    /// planner walks every worldwide battleaxe/midway row and heap-fetches
    /// ServerGuid. Production 2026-09-25T01:38Z: 18,183ms and 18,335ms COUNT
    /// on SiMPLE battleaxe/midway; the LIMIT 5 page on
    /// IX_Rounds_ServerGuid_StartTime was 0–1ms.
    ///
    /// First start after migrate will spend time building the index on Rounds.
    /// Do not drop IX_Rounds_MapName; map-only callers still need it.
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
