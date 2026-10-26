using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddStablingPassAndPaymentLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ArrivalNotes",
                table: "SignupExtras",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HookupAssignment",
                table: "SignupExtras",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StableAssignment",
                table: "SignupExtras",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VehicleRegistration",
                table: "SignupExtras",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PaymentLinkUrl",
                table: "Competitions",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ArrivalNotes",
                table: "SignupExtras");

            migrationBuilder.DropColumn(
                name: "HookupAssignment",
                table: "SignupExtras");

            migrationBuilder.DropColumn(
                name: "StableAssignment",
                table: "SignupExtras");

            migrationBuilder.DropColumn(
                name: "VehicleRegistration",
                table: "SignupExtras");

            migrationBuilder.DropColumn(
                name: "PaymentLinkUrl",
                table: "Competitions");
        }
    }
}
