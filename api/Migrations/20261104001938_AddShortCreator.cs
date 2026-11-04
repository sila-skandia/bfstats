using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddShortCreator : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CreatorName",
                table: "ReplayShorts",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CreatorUserId",
                table: "ReplayShorts",
                type: "INTEGER",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CreatorName",
                table: "ReplayShorts");

            migrationBuilder.DropColumn(
                name: "CreatorUserId",
                table: "ReplayShorts");
        }
    }
}
