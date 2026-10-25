using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEquineVaccineCertification : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PonyOwnerFullName",
                table: "SavedRiders",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PonyPassportNumber",
                table: "SavedRiders",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "PonyPassportNumber",
                table: "RiderEntries",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(60)",
                oldMaxLength: 60,
                oldNullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PonyOwnerFullName",
                table: "RiderEntries",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FluValidUntil",
                table: "PassportChecks",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InspectorRole",
                table: "PassportChecks",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastFluVaccineDate",
                table: "PassportChecks",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastTetanusDate",
                table: "PassportChecks",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OfficialNotes",
                table: "PassportChecks",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OwnerFullName",
                table: "PassportChecks",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PassportCode",
                table: "PassportChecks",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TetanusValidUntil",
                table: "PassportChecks",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CertifiedHorses",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PassportCode = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    HorseName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    HorseKey = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    OwnerFullName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    OwnerKey = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    LastFluVaccineDate = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    FluValidUntil = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    LastTetanusDate = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    TetanusValidUntil = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    InspectorRole = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    InspectedByUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    InspectedByName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    InspectedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    OfficialNotes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CertifiedHorses", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CertifiedHorses_HorseKey_OwnerKey",
                table: "CertifiedHorses",
                columns: new[] { "HorseKey", "OwnerKey" });

            migrationBuilder.CreateIndex(
                name: "IX_CertifiedHorses_PassportCode",
                table: "CertifiedHorses",
                column: "PassportCode");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CertifiedHorses");

            migrationBuilder.DropColumn(
                name: "PonyOwnerFullName",
                table: "SavedRiders");

            migrationBuilder.DropColumn(
                name: "PonyPassportNumber",
                table: "SavedRiders");

            migrationBuilder.DropColumn(
                name: "PonyOwnerFullName",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "FluValidUntil",
                table: "PassportChecks");

            migrationBuilder.DropColumn(
                name: "InspectorRole",
                table: "PassportChecks");

            migrationBuilder.DropColumn(
                name: "LastFluVaccineDate",
                table: "PassportChecks");

            migrationBuilder.DropColumn(
                name: "LastTetanusDate",
                table: "PassportChecks");

            migrationBuilder.DropColumn(
                name: "OfficialNotes",
                table: "PassportChecks");

            migrationBuilder.DropColumn(
                name: "OwnerFullName",
                table: "PassportChecks");

            migrationBuilder.DropColumn(
                name: "PassportCode",
                table: "PassportChecks");

            migrationBuilder.DropColumn(
                name: "TetanusValidUntil",
                table: "PassportChecks");

            migrationBuilder.AlterColumn<string>(
                name: "PonyPassportNumber",
                table: "RiderEntries",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(80)",
                oldMaxLength: 80,
                oldNullable: true);
        }
    }
}
