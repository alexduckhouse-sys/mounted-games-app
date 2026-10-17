using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEventCommerce : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CatalogueItem",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SellerUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    PriceMinor = table.Column<int>(type: "integer", nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false, defaultValue: "GBP"),
                    StockQuantity = table.Column<int>(type: "integer", nullable: true),
                    Category = table.Column<int>(type: "integer", nullable: false),
                    ImageUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false, defaultValue: 1L),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CatalogueItem", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CatalogueItem_AspNetUsers_SellerUserId",
                        column: x => x.SellerUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "EventCommerceSettings",
                columns: table => new
                {
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    IsDemo = table.Column<bool>(type: "boolean", nullable: false),
                    UpdatedByUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventCommerceSettings", x => x.CompetitionId);
                    table.ForeignKey(
                        name: "FK_EventCommerceSettings_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "EventOrder",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    BuyerUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    RequestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    TotalMinor = table.Column<int>(type: "integer", nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false, defaultValue: "GBP"),
                    IsTestOrder = table.Column<bool>(type: "boolean", nullable: false),
                    HasStockReservation = table.Column<bool>(type: "boolean", nullable: false),
                    PaidAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CancelledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RefundedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventOrder", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EventOrder_AspNetUsers_BuyerUserId",
                        column: x => x.BuyerUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_EventOrder_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CompetitionListing",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    CatalogueItemId = table.Column<int>(type: "integer", nullable: false),
                    SellerUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    ReviewNote = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    ReviewedByUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    ReviewedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompetitionListing", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CompetitionListing_CatalogueItem_CatalogueItemId",
                        column: x => x.CatalogueItemId,
                        principalTable: "CatalogueItem",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CompetitionListing_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "EventOrderLine",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    EventOrderId = table.Column<int>(type: "integer", nullable: false),
                    CompetitionListingId = table.Column<int>(type: "integer", nullable: false),
                    CatalogueItemId = table.Column<int>(type: "integer", nullable: false),
                    SellerUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    TitleSnapshot = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    UnitPriceMinorSnapshot = table.Column<int>(type: "integer", nullable: false),
                    Quantity = table.Column<int>(type: "integer", nullable: false),
                    ReservedStockQuantity = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    LineTotalMinor = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventOrderLine", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EventOrderLine_EventOrder_EventOrderId",
                        column: x => x.EventOrderId,
                        principalTable: "EventOrder",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TestPaymentRecord",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    Target = table.Column<int>(type: "integer", nullable: false),
                    TargetId = table.Column<int>(type: "integer", nullable: false),
                    EventOrderId = table.Column<int>(type: "integer", nullable: true),
                    OwnerUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Operation = table.Column<int>(type: "integer", nullable: false),
                    RequestedOutcome = table.Column<int>(type: "integer", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    AmountMinor = table.Column<int>(type: "integer", nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false, defaultValue: "GBP"),
                    IsTest = table.Column<bool>(type: "boolean", nullable: false),
                    Provider = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false, defaultValue: "fake"),
                    ReceiptReference = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ReceiptLabel = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    RelatedPaymentId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TestPaymentRecord", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TestPaymentRecord_EventOrder_EventOrderId",
                        column: x => x.EventOrderId,
                        principalTable: "EventOrder",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CatalogueItem_SellerUserId_IsActive",
                table: "CatalogueItem",
                columns: new[] { "SellerUserId", "IsActive" });

            migrationBuilder.CreateIndex(
                name: "IX_CompetitionListing_CatalogueItemId",
                table: "CompetitionListing",
                column: "CatalogueItemId");

            migrationBuilder.CreateIndex(
                name: "IX_CompetitionListing_CompetitionId_CatalogueItemId",
                table: "CompetitionListing",
                columns: new[] { "CompetitionId", "CatalogueItemId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CompetitionListing_SellerUserId_Status",
                table: "CompetitionListing",
                columns: new[] { "SellerUserId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_EventOrder_BuyerUserId_IdempotencyKey",
                table: "EventOrder",
                columns: new[] { "BuyerUserId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EventOrder_CompetitionId_CreatedAt",
                table: "EventOrder",
                columns: new[] { "CompetitionId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_EventOrderLine_EventOrderId",
                table: "EventOrderLine",
                column: "EventOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_EventOrderLine_SellerUserId_EventOrderId",
                table: "EventOrderLine",
                columns: new[] { "SellerUserId", "EventOrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_TestPaymentRecord_CompetitionId_Target_TargetId",
                table: "TestPaymentRecord",
                columns: new[] { "CompetitionId", "Target", "TargetId" });

            migrationBuilder.CreateIndex(
                name: "IX_TestPaymentRecord_EventOrderId",
                table: "TestPaymentRecord",
                column: "EventOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_TestPaymentRecord_OwnerUserId_IdempotencyKey",
                table: "TestPaymentRecord",
                columns: new[] { "OwnerUserId", "IdempotencyKey" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CompetitionListing");

            migrationBuilder.DropTable(
                name: "EventCommerceSettings");

            migrationBuilder.DropTable(
                name: "EventOrderLine");

            migrationBuilder.DropTable(
                name: "TestPaymentRecord");

            migrationBuilder.DropTable(
                name: "CatalogueItem");

            migrationBuilder.DropTable(
                name: "EventOrder");
        }
    }
}
