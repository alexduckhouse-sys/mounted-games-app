using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAdaptiveDecForms : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AgeGroup",
                table: "RiderEntries",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "BirthYear",
                table: "RiderEntries",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CustomValuesJson",
                table: "RiderEntries",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EmergencyContactName",
                table: "RiderEntries",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EmergencyContactPhone",
                table: "RiderEntries",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FlagsJson",
                table: "RiderEntries",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MedicalNotes",
                table: "RiderEntries",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MembershipNumber",
                table: "RiderEntries",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PonyAge",
                table: "RiderEntries",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PonyPassportNumber",
                table: "RiderEntries",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "WeightKg",
                table: "RiderEntries",
                type: "numeric(5,1)",
                precision: 5,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TrainerPhone",
                table: "DeclarationForms",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DecFormConfigJson",
                table: "Competitions",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AgeGroup",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "BirthYear",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "CustomValuesJson",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "EmergencyContactName",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "EmergencyContactPhone",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "FlagsJson",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "MedicalNotes",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "MembershipNumber",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "PonyAge",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "PonyPassportNumber",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "WeightKg",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "TrainerPhone",
                table: "DeclarationForms");

            migrationBuilder.DropColumn(
                name: "DecFormConfigJson",
                table: "Competitions");
        }
    }
}
