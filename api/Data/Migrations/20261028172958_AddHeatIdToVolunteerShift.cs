using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddHeatIdToVolunteerShift : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "HeatId",
                table: "VolunteerShift",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerShift_HeatId",
                table: "VolunteerShift",
                column: "HeatId");

            migrationBuilder.AddForeignKey(
                name: "FK_VolunteerShift_Heats_HeatId",
                table: "VolunteerShift",
                column: "HeatId",
                principalTable: "Heats",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_VolunteerShift_Heats_HeatId",
                table: "VolunteerShift");

            migrationBuilder.DropIndex(
                name: "IX_VolunteerShift_HeatId",
                table: "VolunteerShift");

            migrationBuilder.DropColumn(
                name: "HeatId",
                table: "VolunteerShift");
        }
    }
}
