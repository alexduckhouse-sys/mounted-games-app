using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class FreezeEntriesDigestCompetitionText : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "EndDate",
                table: "EntriesDigestCompetitions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "EntriesCloseAt",
                table: "EntriesDigestCompetitions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Latitude",
                table: "EntriesDigestCompetitions",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Location",
                table: "EntriesDigestCompetitions",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Longitude",
                table: "EntriesDigestCompetitions",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Name",
                table: "EntriesDigestCompetitions",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "StartDate",
                table: "EntriesDigestCompetitions",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            // A run claimed before this migration has no frozen text yet: copy what the competitions say now, so it still sends.
            migrationBuilder.Sql("""
                UPDATE "EntriesDigestCompetitions" AS d
                SET "Name" = LEFT(c."Name", 200), "Location" = LEFT(c."Location", 500), "StartDate" = c."StartDate",
                    "EndDate" = c."EndDate", "Latitude" = c."Latitude", "Longitude" = c."Longitude"
                FROM "Competitions" AS c
                WHERE c."Id" = d."CompetitionId" AND d."Name" = '';
                """);

            migrationBuilder.CreateIndex(
                name: "IX_SectionSignups_ContactEmail",
                table: "SectionSignups",
                column: "ContactEmail");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SectionSignups_ContactEmail",
                table: "SectionSignups");

            migrationBuilder.DropColumn(
                name: "EndDate",
                table: "EntriesDigestCompetitions");

            migrationBuilder.DropColumn(
                name: "EntriesCloseAt",
                table: "EntriesDigestCompetitions");

            migrationBuilder.DropColumn(
                name: "Latitude",
                table: "EntriesDigestCompetitions");

            migrationBuilder.DropColumn(
                name: "Location",
                table: "EntriesDigestCompetitions");

            migrationBuilder.DropColumn(
                name: "Longitude",
                table: "EntriesDigestCompetitions");

            migrationBuilder.DropColumn(
                name: "Name",
                table: "EntriesDigestCompetitions");

            migrationBuilder.DropColumn(
                name: "StartDate",
                table: "EntriesDigestCompetitions");
        }
    }
}
