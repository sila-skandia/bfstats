using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace api.Migrations
{
    /// <inheritdoc />
    public partial class AddNeo4jSyncWatermarks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "SyncedToNeo4jAt",
                table: "Rounds",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "SyncedToNeo4jAt",
                table: "PlayerSessions",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Rounds_IsActive_SyncedToNeo4jAt_StartTime",
                table: "Rounds",
                columns: new[] { "IsActive", "SyncedToNeo4jAt", "StartTime" });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerSessions_IsActive_SyncedToNeo4jAt_LastSeenTime",
                table: "PlayerSessions",
                columns: new[] { "IsActive", "SyncedToNeo4jAt", "LastSeenTime" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Rounds_IsActive_SyncedToNeo4jAt_StartTime",
                table: "Rounds");

            migrationBuilder.DropIndex(
                name: "IX_PlayerSessions_IsActive_SyncedToNeo4jAt_LastSeenTime",
                table: "PlayerSessions");

            migrationBuilder.DropColumn(
                name: "SyncedToNeo4jAt",
                table: "Rounds");

            migrationBuilder.DropColumn(
                name: "SyncedToNeo4jAt",
                table: "PlayerSessions");
        }
    }
}
