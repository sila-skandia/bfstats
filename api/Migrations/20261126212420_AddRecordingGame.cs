using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    /// <summary>Every recording's game (features/bfv-through-bfstats): every recording shared so far
    /// is BF1942's, and the feed's cards and counts become each game's own, so bfv.bfstats.io and
    /// replay.bfstats.io never show each other's. The triggers are dropped first (the tallies'
    /// key changes, which SQLite does by rebuilding the table), made again with the game, and the
    /// cards and counts rebuilt from the recordings.</summary>
    public partial class AddRecordingGame : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            DropTriggers(migrationBuilder);

            // The counts are made again from the recordings below, so their table is made afresh
            // with its new key: SQLite cannot change a key in place, and EF would rebuild the table
            // after the triggers and the backfill had run against the old one.
            migrationBuilder.DropTable(name: "RecordingTallies");
            CreateTallies(migrationBuilder, withGame: true);

            migrationBuilder.DropIndex(
                name: "IX_RecordingCards_NewestId",
                table: "RecordingCards");

            migrationBuilder.DropIndex(
                name: "IX_RecordingCards_Views_NewestId",
                table: "RecordingCards");

            migrationBuilder.AddColumn<string>(
                name: "Game",
                table: "Recordings",
                type: "TEXT",
                maxLength: 16,
                nullable: false,
                defaultValue: "bf1942");

            migrationBuilder.AddColumn<string>(
                name: "Game",
                table: "RecordingCards",
                type: "TEXT",
                maxLength: 16,
                nullable: false,
                defaultValue: "bf1942");

            migrationBuilder.AddColumn<string>(
                name: "Game",
                table: "RecordingCardNames",
                type: "TEXT",
                maxLength: 16,
                nullable: false,
                defaultValue: "bf1942");

            migrationBuilder.CreateIndex(
                name: "IX_Recordings_Game_FileMissing_Id",
                table: "Recordings",
                columns: new[] { "Game", "FileMissing", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_RecordingCards_Game_NewestId",
                table: "RecordingCards",
                columns: new[] { "Game", "NewestId" });

            migrationBuilder.CreateIndex(
                name: "IX_RecordingCards_Game_Views_NewestId",
                table: "RecordingCards",
                columns: new[] { "Game", "Views", "NewestId" });

            migrationBuilder.Sql(RecordingCardsV2.TriggersSql);
            migrationBuilder.Sql(RecordingCardsV2.BackfillSql);
        }

        /// <summary>The counts' table, with each game's own (the new key) or as it was.</summary>
        private static void CreateTallies(MigrationBuilder migrationBuilder, bool withGame)
        {
            if (withGame)
            {
                migrationBuilder.CreateTable(
                    name: "RecordingTallies",
                    columns: table => new
                    {
                        Game = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
                        Kind = table.Column<int>(type: "INTEGER", nullable: false),
                        Name = table.Column<string>(type: "TEXT", nullable: false),
                        Count = table.Column<int>(type: "INTEGER", nullable: false),
                    },
                    constraints: table => table.PrimaryKey("PK_RecordingTallies", x => new { x.Game, x.Kind, x.Name }));
                migrationBuilder.CreateIndex(
                    name: "IX_RecordingTallies_Game_Kind_Count_Name",
                    table: "RecordingTallies",
                    columns: new[] { "Game", "Kind", "Count", "Name" },
                    descending: new[] { false, false, true, false });
            }
            else
            {
                migrationBuilder.CreateTable(
                    name: "RecordingTallies",
                    columns: table => new
                    {
                        Kind = table.Column<int>(type: "INTEGER", nullable: false),
                        Name = table.Column<string>(type: "TEXT", nullable: false),
                        Count = table.Column<int>(type: "INTEGER", nullable: false),
                    },
                    constraints: table => table.PrimaryKey("PK_RecordingTallies", x => new { x.Kind, x.Name }));
                migrationBuilder.CreateIndex(
                    name: "IX_RecordingTallies_Kind_Count_Name",
                    table: "RecordingTallies",
                    columns: new[] { "Kind", "Count", "Name" },
                    descending: new[] { false, true, false });
            }
        }

        private static void DropTriggers(MigrationBuilder migrationBuilder)
        {
            foreach (var trigger in RecordingCardsV1.RecordingTriggers.Concat(RecordingCardsV1.CardTriggers).Concat(RecordingCardsV1.NameTriggers))
            {
                migrationBuilder.Sql($"DROP TRIGGER IF EXISTS {trigger};");
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            DropTriggers(migrationBuilder);

            migrationBuilder.DropTable(name: "RecordingTallies");
            CreateTallies(migrationBuilder, withGame: false);

            migrationBuilder.DropIndex(
                name: "IX_Recordings_Game_FileMissing_Id",
                table: "Recordings");

            migrationBuilder.DropIndex(
                name: "IX_RecordingCards_Game_NewestId",
                table: "RecordingCards");

            migrationBuilder.DropIndex(
                name: "IX_RecordingCards_Game_Views_NewestId",
                table: "RecordingCards");

            migrationBuilder.DropColumn(
                name: "Game",
                table: "Recordings");

            migrationBuilder.DropColumn(
                name: "Game",
                table: "RecordingCards");

            migrationBuilder.DropColumn(
                name: "Game",
                table: "RecordingCardNames");

            migrationBuilder.CreateIndex(
                name: "IX_RecordingCards_NewestId",
                table: "RecordingCards",
                column: "NewestId");

            migrationBuilder.CreateIndex(
                name: "IX_RecordingCards_Views_NewestId",
                table: "RecordingCards",
                columns: new[] { "Views", "NewestId" });

            migrationBuilder.Sql(RecordingCardsV1.TriggersSql);
            migrationBuilder.Sql(RecordingCardsV1.BackfillSql);
        }
    }
}
