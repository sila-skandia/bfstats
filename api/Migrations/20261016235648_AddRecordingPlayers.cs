using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddRecordingPlayers : Migration
    {
        /// <summary>The recordings already shared: their round's players, from the list each
        /// kept, as the recording wrote them. An upload writes its own from here on.</summary>
        internal const string BackfillSql = """
            INSERT OR IGNORE INTO RecordingPlayers (RecordingId, PlayerName)
            SELECT r.Id, p.value
            FROM Recordings AS r, json_each(r.PlayersJson) AS p
            WHERE json_valid(r.PlayersJson) AND p.type = 'text' AND p.value <> '';
            """;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RecordingPlayers",
                columns: table => new
                {
                    RecordingId = table.Column<int>(type: "INTEGER", nullable: false),
                    PlayerName = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingPlayers", x => new { x.RecordingId, x.PlayerName });
                    table.ForeignKey(
                        name: "FK_RecordingPlayers_Recordings_RecordingId",
                        column: x => x.RecordingId,
                        principalTable: "Recordings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Recordings_FileMissing_RoundId_ViewCount",
                table: "Recordings",
                columns: new[] { "FileMissing", "RoundId", "ViewCount" });

            migrationBuilder.CreateIndex(
                name: "IX_Recordings_ServerName_FileMissing_RoundId",
                table: "Recordings",
                columns: new[] { "ServerName", "FileMissing", "RoundId" });

            migrationBuilder.CreateIndex(
                name: "IX_Recordings_UploaderName_FileMissing_RoundId",
                table: "Recordings",
                columns: new[] { "UploaderName", "FileMissing", "RoundId" });

            migrationBuilder.CreateIndex(
                name: "IX_RecordingPlayers_PlayerName",
                table: "RecordingPlayers",
                column: "PlayerName");

            migrationBuilder.Sql(BackfillSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RecordingPlayers");

            migrationBuilder.DropIndex(
                name: "IX_Recordings_FileMissing_RoundId_ViewCount",
                table: "Recordings");

            migrationBuilder.DropIndex(
                name: "IX_Recordings_ServerName_FileMissing_RoundId",
                table: "Recordings");

            migrationBuilder.DropIndex(
                name: "IX_Recordings_UploaderName_FileMissing_RoundId",
                table: "Recordings");
        }
    }
}
