using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddRecordingsFeed : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Recordings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Slug = table.Column<string>(type: "TEXT", nullable: false),
                    Title = table.Column<string>(type: "TEXT", nullable: false),
                    UploaderUserId = table.Column<int>(type: "INTEGER", nullable: false),
                    UploaderName = table.Column<string>(type: "TEXT", nullable: false),
                    Level = table.Column<string>(type: "TEXT", nullable: false),
                    Mod = table.Column<string>(type: "TEXT", nullable: false),
                    GameMode = table.Column<string>(type: "TEXT", nullable: false),
                    ServerName = table.Column<string>(type: "TEXT", nullable: false),
                    RecordedBy = table.Column<string>(type: "TEXT", nullable: false),
                    RecordedLocal = table.Column<string>(type: "TEXT", nullable: false),
                    DurationSeconds = table.Column<double>(type: "REAL", nullable: false),
                    PlayerCount = table.Column<int>(type: "INTEGER", nullable: false),
                    PlayersJson = table.Column<string>(type: "TEXT", nullable: false),
                    FormatVersion = table.Column<int>(type: "INTEGER", nullable: false),
                    RecordingBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    RecordingRawBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    ServerLogBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    ThumbnailBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    ContentHash = table.Column<string>(type: "TEXT", nullable: false),
                    ViewCount = table.Column<int>(type: "INTEGER", nullable: false),
                    CommentCount = table.Column<int>(type: "INTEGER", nullable: false),
                    FileMissing = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<string>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Recordings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Recordings_Users_UploaderUserId",
                        column: x => x.UploaderUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RecordingComments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    RecordingId = table.Column<int>(type: "INTEGER", nullable: false),
                    AuthorUserId = table.Column<int>(type: "INTEGER", nullable: false),
                    AuthorName = table.Column<string>(type: "TEXT", nullable: false),
                    Content = table.Column<string>(type: "TEXT", nullable: false),
                    AtSeconds = table.Column<double>(type: "REAL", nullable: true),
                    CreatedAt = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingComments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RecordingComments_Recordings_RecordingId",
                        column: x => x.RecordingId,
                        principalTable: "Recordings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RecordingComments_Users_AuthorUserId",
                        column: x => x.AuthorUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RecordingViews",
                columns: table => new
                {
                    Id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    RecordingId = table.Column<int>(type: "INTEGER", nullable: false),
                    ViewerKey = table.Column<string>(type: "TEXT", nullable: false),
                    LastCountedAt = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingViews", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RecordingViews_Recordings_RecordingId",
                        column: x => x.RecordingId,
                        principalTable: "Recordings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RecordingComments_AuthorUserId",
                table: "RecordingComments",
                column: "AuthorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_RecordingComments_RecordingId_Id",
                table: "RecordingComments",
                columns: new[] { "RecordingId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Recordings_ContentHash",
                table: "Recordings",
                column: "ContentHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Recordings_FileMissing_Id",
                table: "Recordings",
                columns: new[] { "FileMissing", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Recordings_FileMissing_ViewCount_Id",
                table: "Recordings",
                columns: new[] { "FileMissing", "ViewCount", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Recordings_Slug",
                table: "Recordings",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Recordings_UploaderUserId",
                table: "Recordings",
                column: "UploaderUserId");

            migrationBuilder.CreateIndex(
                name: "IX_RecordingViews_RecordingId_ViewerKey",
                table: "RecordingViews",
                columns: new[] { "RecordingId", "ViewerKey" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RecordingComments");

            migrationBuilder.DropTable(
                name: "RecordingViews");

            migrationBuilder.DropTable(
                name: "Recordings");
        }
    }
}
