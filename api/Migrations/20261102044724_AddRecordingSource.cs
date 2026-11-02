using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddRecordingSource : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Source",
                table: "Recordings",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_Recordings_Source_FileMissing_RoundId",
                table: "Recordings",
                columns: new[] { "Source", "FileMissing", "RoundId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Recordings_Source_FileMissing_RoundId",
                table: "Recordings");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "Recordings");
        }
    }
}
