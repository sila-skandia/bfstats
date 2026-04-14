using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddPlayerComments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PlayerComments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    PlayerName = table.Column<string>(type: "TEXT", nullable: false),
                    Content = table.Column<string>(type: "TEXT", nullable: false),
                    AuthorUserId = table.Column<int>(type: "INTEGER", nullable: false),
                    AuthorPlayerName = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<string>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlayerComments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PlayerComments_Users_AuthorUserId",
                        column: x => x.AuthorUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerComments_AuthorUserId",
                table: "PlayerComments",
                column: "AuthorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerComments_CreatedAt",
                table: "PlayerComments",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerComments_PlayerName",
                table: "PlayerComments",
                column: "PlayerName");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PlayerComments");
        }
    }
}
