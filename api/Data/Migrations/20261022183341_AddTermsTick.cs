using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddTermsTick : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "TermsAccepted",
                table: "SectionSignups",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "TermsAcceptedAt",
                table: "SectionSignups",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TermsAcceptedByName",
                table: "SectionSignups",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TermsAcceptedByUserId",
                table: "SectionSignups",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TermsWordingVersion",
                table: "SectionSignups",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TermsText",
                table: "Competitions",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TermsAccepted",
                table: "SectionSignups");

            migrationBuilder.DropColumn(
                name: "TermsAcceptedAt",
                table: "SectionSignups");

            migrationBuilder.DropColumn(
                name: "TermsAcceptedByName",
                table: "SectionSignups");

            migrationBuilder.DropColumn(
                name: "TermsAcceptedByUserId",
                table: "SectionSignups");

            migrationBuilder.DropColumn(
                name: "TermsWordingVersion",
                table: "SectionSignups");

            migrationBuilder.DropColumn(
                name: "TermsText",
                table: "Competitions");
        }
    }
}
