using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRiderPrivacy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "NoFilming",
                table: "SectionSignups",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "UseInitialOnly",
                table: "SectionSignups",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "NoFilming",
                table: "SavedRiders",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "UseInitialOnly",
                table: "SavedRiders",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "NoFilming",
                table: "RiderEntries",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "UseInitialOnly",
                table: "RiderEntries",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "NoFilming",
                table: "SectionSignups");

            migrationBuilder.DropColumn(
                name: "UseInitialOnly",
                table: "SectionSignups");

            migrationBuilder.DropColumn(
                name: "NoFilming",
                table: "SavedRiders");

            migrationBuilder.DropColumn(
                name: "UseInitialOnly",
                table: "SavedRiders");

            migrationBuilder.DropColumn(
                name: "NoFilming",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "UseInitialOnly",
                table: "RiderEntries");
        }
    }
}
