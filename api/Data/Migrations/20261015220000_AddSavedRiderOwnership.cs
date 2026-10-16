using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations;

public partial class AddSavedRiderOwnership : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Legacy records have no provable owner; retain them for admin access.
        migrationBuilder.AddColumn<string>(
            name: "CreatedByUserId", table: "SavedRiders", type: "text", nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "CreatedByUserId", table: "SavedRiders");
    }
}
