using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBugListFixes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BibDescription",
                table: "Teams",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LaneRotationMode",
                table: "Sessions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "QualifiersPerHeat",
                table: "Sessions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsWholeTeam",
                table: "SectionSignups",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "TeamName",
                table: "SectionSignups",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsGuestRider",
                table: "RiderEntries",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsSitOut",
                table: "Results",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "RecipientUserId",
                table: "ChatMessages",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BibDescription",
                table: "Teams");

            migrationBuilder.DropColumn(
                name: "LaneRotationMode",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "QualifiersPerHeat",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "IsWholeTeam",
                table: "SectionSignups");

            migrationBuilder.DropColumn(
                name: "TeamName",
                table: "SectionSignups");

            migrationBuilder.DropColumn(
                name: "IsGuestRider",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "IsSitOut",
                table: "Results");

            migrationBuilder.DropColumn(
                name: "RecipientUserId",
                table: "ChatMessages");
        }
    }
}
