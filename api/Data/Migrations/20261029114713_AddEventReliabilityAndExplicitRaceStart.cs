using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEventReliabilityAndExplicitRaceStart : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "StartIsExplicit",
                table: "Races",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "HeatCall",
                columns: table => new
                {
                    HeatId = table.Column<int>(type: "integer", nullable: false),
                    CalledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HeatCall", x => x.HeatId);
                    table.ForeignKey(
                        name: "FK_HeatCall_Heats_HeatId",
                        column: x => x.HeatId,
                        principalTable: "Heats",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SubstitutionRequest",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    DeclarationFormId = table.Column<int>(type: "integer", nullable: false),
                    RequestedByUserId = table.Column<string>(type: "text", nullable: false),
                    OutRiderEntryId = table.Column<int>(type: "integer", nullable: false),
                    InRiderEntryId = table.Column<int>(type: "integer", nullable: false),
                    ReplacementRiderName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ReplacementHorseName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    DeclarationFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    RequestedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DecidedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DecidedByUserId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SubstitutionRequest", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SubstitutionRequest_DeclarationForms_DeclarationFormId",
                        column: x => x.DeclarationFormId,
                        principalTable: "DeclarationForms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SubstitutionRequest_CompetitionId_Status",
                table: "SubstitutionRequest",
                columns: new[] { "CompetitionId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_SubstitutionRequest_DeclarationFormId",
                table: "SubstitutionRequest",
                column: "DeclarationFormId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "HeatCall");

            migrationBuilder.DropTable(
                name: "SubstitutionRequest");

            migrationBuilder.DropColumn(
                name: "StartIsExplicit",
                table: "Races");
        }
    }
}
