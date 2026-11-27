using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    /// <summary>A recording's description and who finds it (features/bfv-through-bfstats,
    /// "Access"): every recording so far is listed. The feed's triggers are made again so that an
    /// unlisted recording is on no card and in no count, and the cards are rebuilt.</summary>
    public partial class AddRecordingAccess : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Description",
                table: "Recordings",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "Visibility",
                table: "Recordings",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            DropTriggers(migrationBuilder);
            migrationBuilder.Sql(RecordingCardsV3.TriggersSql);
            migrationBuilder.Sql(RecordingCardsV3.BackfillSql);
        }

        private static void DropTriggers(MigrationBuilder migrationBuilder)
        {
            foreach (var trigger in RecordingCardsV3.RecordingTriggers.Concat(RecordingCardsV3.CardTriggers).Concat(RecordingCardsV3.NameTriggers))
            {
                migrationBuilder.Sql($"DROP TRIGGER IF EXISTS {trigger};");
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            DropTriggers(migrationBuilder);
            migrationBuilder.Sql(RecordingCardsV2.TriggersSql);

            migrationBuilder.DropColumn(
                name: "Description",
                table: "Recordings");

            migrationBuilder.DropColumn(
                name: "Visibility",
                table: "Recordings");
        }
    }
}
