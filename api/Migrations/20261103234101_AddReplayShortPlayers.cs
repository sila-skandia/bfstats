using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddReplayShortPlayers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReplayShortPlayers",
                columns: table => new
                {
                    Id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    ShortId = table.Column<int>(type: "INTEGER", nullable: false),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    Role = table.Column<string>(type: "TEXT", maxLength: 8, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReplayShortPlayers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReplayShortPlayers_ReplayShorts_ShortId",
                        column: x => x.ShortId,
                        principalTable: "ReplayShorts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReplayShortPlayers_Name_ShortId",
                table: "ReplayShortPlayers",
                columns: new[] { "Name", "ShortId" });

            migrationBuilder.CreateIndex(
                name: "IX_ReplayShortPlayers_ShortId",
                table: "ReplayShortPlayers",
                column: "ShortId");

            // The Shorts already up: each one's killer and victim. A compilation's other
            // victims arrive with its next filming.
            migrationBuilder.Sql(
                "INSERT INTO ReplayShortPlayers (ShortId, Name, Role) " +
                "SELECT Id, Killer, 'killer' FROM ReplayShorts WHERE Killer <> ''");
            migrationBuilder.Sql(
                "INSERT INTO ReplayShortPlayers (ShortId, Name, Role) " +
                "SELECT Id, Victim, 'victim' FROM ReplayShorts WHERE Victim <> ''");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReplayShortPlayers");
        }
    }
}
