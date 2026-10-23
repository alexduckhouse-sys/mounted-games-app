using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddNextStepsBatch : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "RefereeNote",
                table: "Results",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Status",
                table: "Results",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "TieBreakRule",
                table: "CompetitionSections",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "EnablePassportCheck",
                table: "Competitions",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "FinalsTieOrders",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    TeamId = table.Column<int>(type: "integer", nullable: false),
                    Points = table.Column<int>(type: "integer", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    SetAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SetByUserId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinalsTieOrders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FinalsTieOrders_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_FinalsTieOrders_Teams_TeamId",
                        column: x => x.TeamId,
                        principalTable: "Teams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PassportChecks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    TeamId = table.Column<int>(type: "integer", nullable: false),
                    PonyName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    PonyKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CheckedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CheckedByUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    CheckedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PassportChecks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PassportChecks_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PassportChecks_Teams_TeamId",
                        column: x => x.TeamId,
                        principalTable: "Teams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SpecialAwards",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    CompetitionSectionId = table.Column<int>(type: "integer", nullable: true),
                    Title = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Recipient = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Note = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    OrderIndex = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SpecialAwards", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SpecialAwards_CompetitionSections_CompetitionSectionId",
                        column: x => x.CompetitionSectionId,
                        principalTable: "CompetitionSections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SpecialAwards_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TackCheckSections",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    CompetitionSectionId = table.Column<int>(type: "integer", nullable: false),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    Mode = table.Column<int>(type: "integer", nullable: false),
                    MaxPoints = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TackCheckSections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TackCheckSections_CompetitionSections_CompetitionSectionId",
                        column: x => x.CompetitionSectionId,
                        principalTable: "CompetitionSections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_TackCheckSections_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TackCheckSectors",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TackCheckSectionId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    OrderIndex = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TackCheckSectors", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TackCheckSectors_TackCheckSections_TackCheckSectionId",
                        column: x => x.TackCheckSectionId,
                        principalTable: "TackCheckSections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TackCheckMarks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TackCheckSectorId = table.Column<int>(type: "integer", nullable: false),
                    TeamId = table.Column<int>(type: "integer", nullable: false),
                    Passed = table.Column<bool>(type: "boolean", nullable: true),
                    Points = table.Column<int>(type: "integer", nullable: true),
                    RecordedByUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    RecordedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TackCheckMarks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TackCheckMarks_TackCheckSectors_TackCheckSectorId",
                        column: x => x.TackCheckSectorId,
                        principalTable: "TackCheckSectors",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_TackCheckMarks_Teams_TeamId",
                        column: x => x.TeamId,
                        principalTable: "Teams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FinalsTieOrders_CompetitionId",
                table: "FinalsTieOrders",
                column: "CompetitionId");

            migrationBuilder.CreateIndex(
                name: "IX_FinalsTieOrders_TeamId",
                table: "FinalsTieOrders",
                column: "TeamId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PassportChecks_CompetitionId",
                table: "PassportChecks",
                column: "CompetitionId");

            migrationBuilder.CreateIndex(
                name: "IX_PassportChecks_TeamId_PonyKey",
                table: "PassportChecks",
                columns: new[] { "TeamId", "PonyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SpecialAwards_CompetitionId",
                table: "SpecialAwards",
                column: "CompetitionId");

            migrationBuilder.CreateIndex(
                name: "IX_SpecialAwards_CompetitionSectionId",
                table: "SpecialAwards",
                column: "CompetitionSectionId");

            migrationBuilder.CreateIndex(
                name: "IX_TackCheckMarks_TackCheckSectorId_TeamId",
                table: "TackCheckMarks",
                columns: new[] { "TackCheckSectorId", "TeamId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TackCheckMarks_TeamId",
                table: "TackCheckMarks",
                column: "TeamId");

            migrationBuilder.CreateIndex(
                name: "IX_TackCheckSections_CompetitionId",
                table: "TackCheckSections",
                column: "CompetitionId");

            migrationBuilder.CreateIndex(
                name: "IX_TackCheckSections_CompetitionSectionId",
                table: "TackCheckSections",
                column: "CompetitionSectionId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TackCheckSectors_TackCheckSectionId",
                table: "TackCheckSectors",
                column: "TackCheckSectionId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FinalsTieOrders");

            migrationBuilder.DropTable(
                name: "PassportChecks");

            migrationBuilder.DropTable(
                name: "SpecialAwards");

            migrationBuilder.DropTable(
                name: "TackCheckMarks");

            migrationBuilder.DropTable(
                name: "TackCheckSectors");

            migrationBuilder.DropTable(
                name: "TackCheckSections");

            migrationBuilder.DropColumn(
                name: "RefereeNote",
                table: "Results");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "Results");

            migrationBuilder.DropColumn(
                name: "TieBreakRule",
                table: "CompetitionSections");

            migrationBuilder.DropColumn(
                name: "EnablePassportCheck",
                table: "Competitions");
        }
    }
}
