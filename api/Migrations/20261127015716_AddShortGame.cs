using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddShortGame : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Game",
                table: "ReplayShorts",
                type: "TEXT",
                maxLength: 16,
                nullable: false,
                defaultValue: "bf1942");

            migrationBuilder.CreateIndex(
                name: "IX_ReplayShorts_Game_CreatedAtMs",
                table: "ReplayShorts",
                columns: new[] { "Game", "CreatedAtMs" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ReplayShorts_Game_CreatedAtMs",
                table: "ReplayShorts");

            migrationBuilder.DropColumn(
                name: "Game",
                table: "ReplayShorts");
        }
    }
}
