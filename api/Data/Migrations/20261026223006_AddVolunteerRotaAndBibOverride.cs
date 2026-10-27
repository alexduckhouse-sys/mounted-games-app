using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddVolunteerRotaAndBibOverride : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BibColourOverride",
                table: "HeatEntries",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LorryDirectionsNote",
                table: "Competitions",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "LorryLatitude",
                table: "Competitions",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "LorryLongitude",
                table: "Competitions",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LorryWhat3Words",
                table: "Competitions",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "VolunteerShift",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    SessionId = table.Column<int>(type: "integer", nullable: true),
                    ArenaName = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    Role = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    StartTimeLabel = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    RequiredCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VolunteerShift", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VolunteerShift_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_VolunteerShift_Sessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "Sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "VolunteerClaim",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ShiftId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    VolunteerName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    ClubName = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    ContactPhone = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    ClaimedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VolunteerClaim", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VolunteerClaim_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_VolunteerClaim_VolunteerShift_ShiftId",
                        column: x => x.ShiftId,
                        principalTable: "VolunteerShift",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerClaim_ShiftId",
                table: "VolunteerClaim",
                column: "ShiftId");

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerClaim_ShiftId_UserId",
                table: "VolunteerClaim",
                columns: new[] { "ShiftId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerClaim_UserId",
                table: "VolunteerClaim",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerShift_CompetitionId",
                table: "VolunteerShift",
                column: "CompetitionId");

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerShift_SessionId",
                table: "VolunteerShift",
                column: "SessionId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "VolunteerClaim");

            migrationBuilder.DropTable(
                name: "VolunteerShift");

            migrationBuilder.DropColumn(
                name: "BibColourOverride",
                table: "HeatEntries");

            migrationBuilder.DropColumn(
                name: "LorryDirectionsNote",
                table: "Competitions");

            migrationBuilder.DropColumn(
                name: "LorryLatitude",
                table: "Competitions");

            migrationBuilder.DropColumn(
                name: "LorryLongitude",
                table: "Competitions");

            migrationBuilder.DropColumn(
                name: "LorryWhat3Words",
                table: "Competitions");
        }
    }
}
