using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEntryEmail : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ClientRequestId",
                table: "SectionSignups",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ConfirmationEmailAt",
                table: "SectionSignups",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ConfirmationEmailStatus",
                table: "SectionSignups",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "ContactEmail",
                table: "SectionSignups",
                type: "character varying(254)",
                maxLength: 254,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "EmailOptIns",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    ConsentedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    WordingVersion = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Source = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    UnsubscribeTokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    UnsubscribedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailOptIns", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SectionSignups_CompetitionSectionId_UserId_ClientRequestId",
                table: "SectionSignups",
                columns: new[] { "CompetitionSectionId", "UserId", "ClientRequestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EmailOptIns_Email",
                table: "EmailOptIns",
                column: "Email");

            migrationBuilder.CreateIndex(
                name: "IX_EmailOptIns_UnsubscribeTokenHash",
                table: "EmailOptIns",
                column: "UnsubscribeTokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EmailOptIns");

            migrationBuilder.DropIndex(
                name: "IX_SectionSignups_CompetitionSectionId_UserId_ClientRequestId",
                table: "SectionSignups");

            migrationBuilder.DropColumn(
                name: "ClientRequestId",
                table: "SectionSignups");

            migrationBuilder.DropColumn(
                name: "ConfirmationEmailAt",
                table: "SectionSignups");

            migrationBuilder.DropColumn(
                name: "ConfirmationEmailStatus",
                table: "SectionSignups");

            migrationBuilder.DropColumn(
                name: "ContactEmail",
                table: "SectionSignups");
        }
    }
}
