using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddAppSignIn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Client",
                table: "RefreshTokens",
                type: "TEXT",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Device",
                table: "RefreshTokens",
                type: "TEXT",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "FamilyId",
                table: "RefreshTokens",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "AppAuthorizationCodes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    CodeHash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    Client = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    Device = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    RedirectUri = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    CodeChallenge = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<string>(type: "TEXT", nullable: false),
                    ExpiresAt = table.Column<string>(type: "TEXT", nullable: false),
                    UsedAt = table.Column<string>(type: "TEXT", nullable: true),
                    FamilyId = table.Column<Guid>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AppAuthorizationCodes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AppAuthorizationCodes_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RefreshTokens_FamilyId",
                table: "RefreshTokens",
                column: "FamilyId");

            migrationBuilder.CreateIndex(
                name: "IX_AppAuthorizationCodes_CodeHash",
                table: "AppAuthorizationCodes",
                column: "CodeHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AppAuthorizationCodes_UserId",
                table: "AppAuthorizationCodes",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AppAuthorizationCodes");

            migrationBuilder.DropIndex(
                name: "IX_RefreshTokens_FamilyId",
                table: "RefreshTokens");

            migrationBuilder.DropColumn(
                name: "Client",
                table: "RefreshTokens");

            migrationBuilder.DropColumn(
                name: "Device",
                table: "RefreshTokens");

            migrationBuilder.DropColumn(
                name: "FamilyId",
                table: "RefreshTokens");
        }
    }
}
