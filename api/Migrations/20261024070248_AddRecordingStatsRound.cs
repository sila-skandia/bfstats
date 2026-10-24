using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddRecordingStatsRound : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "StatsRoundCheckVersion",
                table: "Recordings",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "StatsRoundCheckedAt",
                table: "Recordings",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StatsRoundId",
                table: "Recordings",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "StatsRoundMatchedPlayers",
                table: "Recordings",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "StatsRoundZoneMinutes",
                table: "Recordings",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Recordings_StatsRoundId",
                table: "Recordings",
                column: "StatsRoundId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Recordings_StatsRoundId",
                table: "Recordings");

            migrationBuilder.DropColumn(
                name: "StatsRoundCheckVersion",
                table: "Recordings");

            migrationBuilder.DropColumn(
                name: "StatsRoundCheckedAt",
                table: "Recordings");

            migrationBuilder.DropColumn(
                name: "StatsRoundId",
                table: "Recordings");

            migrationBuilder.DropColumn(
                name: "StatsRoundMatchedPlayers",
                table: "Recordings");

            migrationBuilder.DropColumn(
                name: "StatsRoundZoneMinutes",
                table: "Recordings");
        }
    }
}
