using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCompetitionIsIndoor : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsIndoor",
                table: "Competitions",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsIndoor",
                table: "Competitions");
        }
    }
}
