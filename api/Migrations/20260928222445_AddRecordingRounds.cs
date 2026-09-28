using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddRecordingRounds : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "RoundId",
                table: "Recordings",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "RecordingFingerprints",
                columns: table => new
                {
                    RecordingId = table.Column<int>(type: "INTEGER", nullable: false),
                    Version = table.Column<int>(type: "INTEGER", nullable: false),
                    KeyCount = table.Column<int>(type: "INTEGER", nullable: false),
                    PlayerKeyCount = table.Column<int>(type: "INTEGER", nullable: false),
                    PlayerSample = table.Column<long>(type: "INTEGER", nullable: false),
                    ObjectSample = table.Column<long>(type: "INTEGER", nullable: false),
                    LiveFromSeconds = table.Column<double>(type: "REAL", nullable: false),
                    LiveToSeconds = table.Column<double>(type: "REAL", nullable: false),
                    Keys = table.Column<byte[]>(type: "BLOB", nullable: false),
                    RoundsChecked = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingFingerprints", x => x.RecordingId);
                    table.ForeignKey(
                        name: "FK_RecordingFingerprints_Recordings_RecordingId",
                        column: x => x.RecordingId,
                        principalTable: "Recordings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RecordingRoundLinks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    RecordingId = table.Column<int>(type: "INTEGER", nullable: false),
                    OtherRecordingId = table.Column<int>(type: "INTEGER", nullable: false),
                    Kind = table.Column<int>(type: "INTEGER", nullable: false),
                    OffsetSeconds = table.Column<double>(type: "REAL", nullable: true),
                    MatchedKeys = table.Column<int>(type: "INTEGER", nullable: true),
                    MatchedPlayerKeys = table.Column<int>(type: "INTEGER", nullable: true),
                    Share = table.Column<double>(type: "REAL", nullable: true),
                    PlayerShare = table.Column<double>(type: "REAL", nullable: true),
                    ByUserId = table.Column<int>(type: "INTEGER", nullable: true),
                    CreatedAt = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingRoundLinks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RecordingRoundLinks_Recordings_OtherRecordingId",
                        column: x => x.OtherRecordingId,
                        principalTable: "Recordings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RecordingRoundLinks_Recordings_RecordingId",
                        column: x => x.RecordingId,
                        principalTable: "Recordings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Recordings_Level_Mod_GameMode_ServerName_RecordedLocal",
                table: "Recordings",
                columns: new[] { "Level", "Mod", "GameMode", "ServerName", "RecordedLocal" });

            migrationBuilder.CreateIndex(
                name: "IX_Recordings_RoundId",
                table: "Recordings",
                column: "RoundId");

            migrationBuilder.CreateIndex(
                name: "IX_RecordingRoundLinks_OtherRecordingId",
                table: "RecordingRoundLinks",
                column: "OtherRecordingId");

            migrationBuilder.CreateIndex(
                name: "IX_RecordingRoundLinks_RecordingId_OtherRecordingId",
                table: "RecordingRoundLinks",
                columns: new[] { "RecordingId", "OtherRecordingId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RecordingFingerprints");

            migrationBuilder.DropTable(
                name: "RecordingRoundLinks");

            migrationBuilder.DropIndex(
                name: "IX_Recordings_Level_Mod_GameMode_ServerName_RecordedLocal",
                table: "Recordings");

            migrationBuilder.DropIndex(
                name: "IX_Recordings_RoundId",
                table: "Recordings");

            migrationBuilder.DropColumn(
                name: "RoundId",
                table: "Recordings");
        }
    }
}
