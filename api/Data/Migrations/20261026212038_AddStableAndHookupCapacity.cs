using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddStableAndHookupCapacity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "HookupsCount",
                table: "SignupExtras",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "MaxHookups",
                table: "CompetitionEntrySettings",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MaxStables",
                table: "CompetitionEntrySettings",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "HookupsCount",
                table: "SignupExtras");

            migrationBuilder.DropColumn(
                name: "MaxHookups",
                table: "CompetitionEntrySettings");

            migrationBuilder.DropColumn(
                name: "MaxStables",
                table: "CompetitionEntrySettings");
        }
    }
}
