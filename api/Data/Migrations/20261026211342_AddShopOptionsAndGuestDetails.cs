using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddShopOptionsAndGuestDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CatalogueItemOptionId",
                table: "EventOrderLine",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OptionLabel",
                table: "EventOrderLine",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ReservedOptionStockQuantity",
                table: "EventOrderLine",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "CatalogueItemOption",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CatalogueItemId = table.Column<int>(type: "integer", nullable: false),
                    Label = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    StockQuantity = table.Column<int>(type: "integer", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false, defaultValue: 1L)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogueItemOption", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CatalogueItemOption_CatalogueItem_CatalogueItemId",
                        column: x => x.CatalogueItemId,
                        principalTable: "CatalogueItem",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SignupGuestDetails",
                columns: table => new
                {
                    SignupId = table.Column<int>(type: "integer", nullable: false),
                    RiderName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    RiderDateOfBirth = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    PonyName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    GuardianName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    GuardianPhone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    EmergencyContactName = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    EmergencyContactPhone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SignupGuestDetails", x => x.SignupId);
                    table.ForeignKey(
                        name: "FK_SignupGuestDetails_Signup",
                        column: x => x.SignupId,
                        principalTable: "SectionSignups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CatalogueItemOption_CatalogueItemId_SortOrder",
                table: "CatalogueItemOption",
                columns: new[] { "CatalogueItemId", "SortOrder" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CatalogueItemOption");

            migrationBuilder.DropTable(
                name: "SignupGuestDetails");

            migrationBuilder.DropColumn(
                name: "CatalogueItemOptionId",
                table: "EventOrderLine");

            migrationBuilder.DropColumn(
                name: "OptionLabel",
                table: "EventOrderLine");

            migrationBuilder.DropColumn(
                name: "ReservedOptionStockQuantity",
                table: "EventOrderLine");
        }
    }
}
