using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddDecFormFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "PonyHeightHands",
                table: "SavedRiders",
                type: "numeric(4,1)",
                precision: 4,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "PonyHeightHands",
                table: "RiderEntries",
                type: "numeric(4,1)",
                precision: 4,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "TermsAcceptedAt",
                table: "DeclarationForms",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TermsAcceptedByUserId",
                table: "DeclarationForms",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TrainerName",
                table: "DeclarationForms",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PonyHeightHands",
                table: "SavedRiders");

            migrationBuilder.DropColumn(
                name: "PonyHeightHands",
                table: "RiderEntries");

            migrationBuilder.DropColumn(
                name: "TermsAcceptedAt",
                table: "DeclarationForms");

            migrationBuilder.DropColumn(
                name: "TermsAcceptedByUserId",
                table: "DeclarationForms");

            migrationBuilder.DropColumn(
                name: "TrainerName",
                table: "DeclarationForms");
        }
    }
}
