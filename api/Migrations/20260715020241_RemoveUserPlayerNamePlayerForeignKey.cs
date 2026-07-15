using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class RemoveUserPlayerNamePlayerForeignKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_UserPlayerNames_Players_PlayerName",
                table: "UserPlayerNames");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddForeignKey(
                name: "FK_UserPlayerNames_Players_PlayerName",
                table: "UserPlayerNames",
                column: "PlayerName",
                principalTable: "Players",
                principalColumn: "Name",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
