using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFinalScoringOptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "CarryPointsIntoFinal",
                table: "CompetitionSections",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "DoublePointsInFinal",
                table: "CompetitionSections",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "HasFinal",
                table: "CompetitionSections",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            // Sections that already exist keep adding earlier points into the final, as they always did. New sections
            // default to scoring the final on its own.
            migrationBuilder.Sql("UPDATE \"CompetitionSections\" SET \"CarryPointsIntoFinal\" = TRUE;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CarryPointsIntoFinal",
                table: "CompetitionSections");

            migrationBuilder.DropColumn(
                name: "DoublePointsInFinal",
                table: "CompetitionSections");

            migrationBuilder.DropColumn(
                name: "HasFinal",
                table: "CompetitionSections");
        }
    }
}
