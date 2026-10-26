using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddDetailsAndShopFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Detail",
                table: "EventOrderLine",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompetitionNumber",
                table: "Competitions",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContactEmail",
                table: "Competitions",
                type: "character varying(254)",
                maxLength: 254,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Postcode",
                table: "Competitions",
                type: "character varying(12)",
                maxLength: 12,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DetailHint",
                table: "CatalogueItem",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DetailPrompt",
                table: "CatalogueItem",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Detail",
                table: "EventOrderLine");

            migrationBuilder.DropColumn(
                name: "CompetitionNumber",
                table: "Competitions");

            migrationBuilder.DropColumn(
                name: "ContactEmail",
                table: "Competitions");

            migrationBuilder.DropColumn(
                name: "Postcode",
                table: "Competitions");

            migrationBuilder.DropColumn(
                name: "DetailHint",
                table: "CatalogueItem");

            migrationBuilder.DropColumn(
                name: "DetailPrompt",
                table: "CatalogueItem");
        }
    }
}
