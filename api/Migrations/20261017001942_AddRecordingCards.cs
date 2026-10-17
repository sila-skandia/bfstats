using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    /// <summary>The whole feed's cards and counts (features/replay-feed, "Scale"), kept by
    /// triggers on Recordings, and filled once from the recordings shared before them.</summary>
    public partial class AddRecordingCards : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RecordingCardNames",
                columns: table => new
                {
                    CardKey = table.Column<int>(type: "INTEGER", nullable: false),
                    Kind = table.Column<int>(type: "INTEGER", nullable: false),
                    Name = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingCardNames", x => new { x.CardKey, x.Kind, x.Name });
                });

            migrationBuilder.CreateTable(
                name: "RecordingCards",
                columns: table => new
                {
                    CardKey = table.Column<int>(type: "INTEGER", nullable: false),
                    NewestId = table.Column<int>(type: "INTEGER", nullable: false),
                    Views = table.Column<int>(type: "INTEGER", nullable: false),
                    Recordings = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingCards", x => x.CardKey);
                });

            migrationBuilder.CreateTable(
                name: "RecordingTallies",
                columns: table => new
                {
                    Kind = table.Column<int>(type: "INTEGER", nullable: false),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    Count = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecordingTallies", x => new { x.Kind, x.Name });
                });

            migrationBuilder.CreateIndex(
                name: "IX_RecordingCards_NewestId",
                table: "RecordingCards",
                column: "NewestId");

            migrationBuilder.CreateIndex(
                name: "IX_RecordingCards_Views_NewestId",
                table: "RecordingCards",
                columns: new[] { "Views", "NewestId" });

            migrationBuilder.CreateIndex(
                name: "IX_RecordingTallies_Kind_Count_Name",
                table: "RecordingTallies",
                columns: new[] { "Kind", "Count", "Name" },
                descending: new[] { false, true, false });

            migrationBuilder.Sql(api.Recordings.RecordingCards.TriggersSql);
            migrationBuilder.Sql(api.Recordings.RecordingCards.BackfillSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var trigger in api.Recordings.RecordingCards.RecordingTriggers)
            {
                migrationBuilder.Sql($"DROP TRIGGER IF EXISTS {trigger};");
            }

            migrationBuilder.DropTable(
                name: "RecordingCardNames");

            migrationBuilder.DropTable(
                name: "RecordingCards");

            migrationBuilder.DropTable(
                name: "RecordingTallies");
        }
    }
}
