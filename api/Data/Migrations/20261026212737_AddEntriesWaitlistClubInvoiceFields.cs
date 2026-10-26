using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEntriesWaitlistClubInvoiceFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ArrivalWindow",
                table: "SignupExtras",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DispositionNote",
                table: "SignupExtras",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DispositionUpdatedAt",
                table: "SignupExtras",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FeeDisposition",
                table: "SignupExtras",
                type: "text",
                nullable: false,
                defaultValue: "None");

            migrationBuilder.AddColumn<string>(
                name: "LastReminderSentAt",
                table: "SignupExtras",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RefundedAmountMinor",
                table: "SignupExtras",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VehicleRegistration",
                table: "SignupExtras",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WaitlistOfferExpiresAt",
                table: "SignupExtras",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WaitlistOfferedAt",
                table: "SignupExtras",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ArrivalWindow",
                table: "SignupExtras");

            migrationBuilder.DropColumn(
                name: "DispositionNote",
                table: "SignupExtras");

            migrationBuilder.DropColumn(
                name: "DispositionUpdatedAt",
                table: "SignupExtras");

            migrationBuilder.DropColumn(
                name: "FeeDisposition",
                table: "SignupExtras");

            migrationBuilder.DropColumn(
                name: "LastReminderSentAt",
                table: "SignupExtras");

            migrationBuilder.DropColumn(
                name: "RefundedAmountMinor",
                table: "SignupExtras");

            migrationBuilder.DropColumn(
                name: "VehicleRegistration",
                table: "SignupExtras");

            migrationBuilder.DropColumn(
                name: "WaitlistOfferExpiresAt",
                table: "SignupExtras");

            migrationBuilder.DropColumn(
                name: "WaitlistOfferedAt",
                table: "SignupExtras");
        }
    }
}
