using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddUserSignedUpVia : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SignedUpVia",
                table: "Users",
                type: "TEXT",
                maxLength: 16,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_SignedUpVia",
                table: "Users",
                column: "SignedUpVia");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Users_SignedUpVia",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "SignedUpVia",
                table: "Users");
        }
    }
}
