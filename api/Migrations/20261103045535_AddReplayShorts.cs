using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddReplayShorts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReplayShorts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Slug = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    RecordingSlug = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    KillTime = table.Column<double>(type: "REAL", nullable: false),
                    VictimPid = table.Column<int>(type: "INTEGER", nullable: false),
                    Key = table.Column<string>(type: "TEXT", nullable: false),
                    Kind = table.Column<string>(type: "TEXT", nullable: false),
                    Title = table.Column<string>(type: "TEXT", nullable: false),
                    Killer = table.Column<string>(type: "TEXT", nullable: false),
                    Victim = table.Column<string>(type: "TEXT", nullable: false),
                    Weapon = table.Column<string>(type: "TEXT", nullable: false),
                    KillerVehicle = table.Column<string>(type: "TEXT", nullable: true),
                    VictimVehicle = table.Column<string>(type: "TEXT", nullable: true),
                    Distance = table.Column<double>(type: "REAL", nullable: false),
                    LengthSeconds = table.Column<double>(type: "REAL", nullable: false),
                    Level = table.Column<string>(type: "TEXT", nullable: false),
                    Mod = table.Column<string>(type: "TEXT", nullable: false),
                    VideoBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    PosterBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAtMs = table.Column<long>(type: "INTEGER", nullable: false),
                    Views = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReplayShorts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ReplayShortViews",
                columns: table => new
                {
                    Id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    ShortId = table.Column<int>(type: "INTEGER", nullable: false),
                    ViewerKey = table.Column<string>(type: "TEXT", nullable: false),
                    LastCountedAt = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReplayShortViews", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReplayShortViews_ReplayShorts_ShortId",
                        column: x => x.ShortId,
                        principalTable: "ReplayShorts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReplayShorts_CreatedAtMs",
                table: "ReplayShorts",
                column: "CreatedAtMs");

            migrationBuilder.CreateIndex(
                name: "IX_ReplayShorts_Key",
                table: "ReplayShorts",
                column: "Key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReplayShorts_RecordingSlug",
                table: "ReplayShorts",
                column: "RecordingSlug");

            migrationBuilder.CreateIndex(
                name: "IX_ReplayShorts_Slug",
                table: "ReplayShorts",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReplayShorts_Views_CreatedAtMs",
                table: "ReplayShorts",
                columns: new[] { "Views", "CreatedAtMs" });

            migrationBuilder.CreateIndex(
                name: "IX_ReplayShortViews_ShortId_ViewerKey",
                table: "ReplayShortViews",
                columns: new[] { "ShortId", "ViewerKey" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReplayShortViews");

            migrationBuilder.DropTable(
                name: "ReplayShorts");
        }
    }
}
