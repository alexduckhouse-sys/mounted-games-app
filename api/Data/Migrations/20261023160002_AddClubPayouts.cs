using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddClubPayouts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ClubPayoutAccounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ClubId = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    BusinessType = table.Column<int>(type: "integer", nullable: true),
                    Region = table.Column<int>(type: "integer", nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    LegalName = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    TradingName = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    AddressLine1 = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    AddressLine2 = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    City = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Postcode = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: true),
                    ContactEmail = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ContactPhone = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    RegistrationNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    VatNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    PersonFullName = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    PersonDateOfBirth = table.Column<DateOnly>(type: "date", nullable: true),
                    StatementDescriptor = table.Column<string>(type: "character varying(22)", maxLength: 22, nullable: true),
                    Schedule = table.Column<int>(type: "integer", nullable: false),
                    BankAccountHolder = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    BankName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    SortCode = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    AccountLast4 = table.Column<string>(type: "character varying(4)", maxLength: 4, nullable: true),
                    IbanCountry = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: true),
                    IbanLast4 = table.Column<string>(type: "character varying(4)", maxLength: 4, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedByUserId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClubPayoutAccounts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ClubPayoutAccounts_Clubs_ClubId",
                        column: x => x.ClubId,
                        principalTable: "Clubs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ClubPayoutAccounts_ClubId",
                table: "ClubPayoutAccounts",
                column: "ClubId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ClubPayoutAccounts");
        }
    }
}
