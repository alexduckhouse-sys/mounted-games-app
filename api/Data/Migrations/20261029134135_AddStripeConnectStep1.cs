using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddStripeConnectStep1 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "ManualBacsReady",
                table: "ClubPayoutAccounts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql("""UPDATE "ClubPayoutAccounts" SET "ManualBacsReady" = TRUE WHERE "Status" = 2;""");

            migrationBuilder.AddColumn<string>(
                name: "StripeAccountId",
                table: "ClubPayoutAccounts",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "StripeChargesEnabled",
                table: "ClubPayoutAccounts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "StripeConnectedAt",
                table: "ClubPayoutAccounts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "StripeDetailsSubmitted",
                table: "ClubPayoutAccounts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "StripePayoutsEnabled",
                table: "ClubPayoutAccounts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "StripeWebhookEvents",
                columns: table => new
                {
                    EventId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    AccountId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    EventType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ProcessedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StripeWebhookEvents", x => x.EventId);
                });

            migrationBuilder.CreateTable(
                name: "UserPayoutAccounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: "text", nullable: false),
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
                    StripeAccountId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    StripeChargesEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    StripePayoutsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    StripeDetailsSubmitted = table.Column<bool>(type: "boolean", nullable: false),
                    StripeConnectedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ManualBacsReady = table.Column<bool>(type: "boolean", nullable: false),
                    AnnualTackShopSalesCount = table.Column<int>(type: "integer", nullable: false),
                    AnnualTackShopSalesMinor = table.Column<long>(type: "bigint", nullable: false),
                    TaxIdVerified = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedByUserId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserPayoutAccounts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserPayoutAccounts_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ClubPayoutAccounts_StripeAccountId",
                table: "ClubPayoutAccounts",
                column: "StripeAccountId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserPayoutAccounts_StripeAccountId",
                table: "UserPayoutAccounts",
                column: "StripeAccountId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserPayoutAccounts_UserId",
                table: "UserPayoutAccounts",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StripeWebhookEvents");

            migrationBuilder.DropTable(
                name: "UserPayoutAccounts");

            migrationBuilder.DropIndex(
                name: "IX_ClubPayoutAccounts_StripeAccountId",
                table: "ClubPayoutAccounts");

            migrationBuilder.DropColumn(
                name: "ManualBacsReady",
                table: "ClubPayoutAccounts");

            migrationBuilder.DropColumn(
                name: "StripeAccountId",
                table: "ClubPayoutAccounts");

            migrationBuilder.DropColumn(
                name: "StripeChargesEnabled",
                table: "ClubPayoutAccounts");

            migrationBuilder.DropColumn(
                name: "StripeConnectedAt",
                table: "ClubPayoutAccounts");

            migrationBuilder.DropColumn(
                name: "StripeDetailsSubmitted",
                table: "ClubPayoutAccounts");

            migrationBuilder.DropColumn(
                name: "StripePayoutsEnabled",
                table: "ClubPayoutAccounts");
        }
    }
}
