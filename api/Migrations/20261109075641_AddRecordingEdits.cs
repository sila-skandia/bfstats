using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddRecordingEdits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RecordingEdits",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Code = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
                    RecordingId = table.Column<int>(type: "INTEGER", nullable: false),
                    AuthorUserId = table.Column<int>(type: "INTEGER", nullable: false),
                    AuthorName = table.Column<string>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    Payload = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingEdits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RecordingEdits_Recordings_RecordingId",
                        column: x => x.RecordingId,
                        principalTable: "Recordings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RecordingEdits_Users_AuthorUserId",
                        column: x => x.AuthorUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RecordingEdits_AuthorUserId",
                table: "RecordingEdits",
                column: "AuthorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_RecordingEdits_Code",
                table: "RecordingEdits",
                column: "Code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RecordingEdits_RecordingId",
                table: "RecordingEdits",
                column: "RecordingId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RecordingEdits");
        }
    }
}
