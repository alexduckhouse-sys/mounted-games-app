using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEntriesDigest : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EntriesDigestRuns",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RunDate = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    ClaimedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Manual = table.Column<bool>(type: "boolean", nullable: false),
                    Competitions = table.Column<int>(type: "integer", nullable: false),
                    Total = table.Column<int>(type: "integer", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EntriesDigestRuns", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "EntriesDigestCompetitions",
                columns: table => new
                {
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    RunId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EntriesDigestCompetitions", x => x.CompetitionId);
                    table.ForeignKey(
                        name: "FK_EntriesDigestCompetitions_EntriesDigestRuns_RunId",
                        column: x => x.RunId,
                        principalTable: "EntriesDigestRuns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "EntriesDigestRecipients",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RunId = table.Column<int>(type: "integer", nullable: false),
                    OptInId = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    ClaimedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClaimToken = table.Column<Guid>(type: "uuid", nullable: true),
                    Attempts = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EntriesDigestRecipients", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EntriesDigestRecipients_EntriesDigestRuns_RunId",
                        column: x => x.RunId,
                        principalTable: "EntriesDigestRuns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EntriesDigestCompetitions_RunId",
                table: "EntriesDigestCompetitions",
                column: "RunId");

            migrationBuilder.CreateIndex(
                name: "IX_EntriesDigestRecipients_RunId_OptInId",
                table: "EntriesDigestRecipients",
                columns: new[] { "RunId", "OptInId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EntriesDigestRecipients_RunId_Status",
                table: "EntriesDigestRecipients",
                columns: new[] { "RunId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_EntriesDigestRuns_RunDate",
                table: "EntriesDigestRuns",
                column: "RunDate",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EntriesDigestCompetitions");

            migrationBuilder.DropTable(
                name: "EntriesDigestRecipients");

            migrationBuilder.DropTable(
                name: "EntriesDigestRuns");
        }
    }
}
