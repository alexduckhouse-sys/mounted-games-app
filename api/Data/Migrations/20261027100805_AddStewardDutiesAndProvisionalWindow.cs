using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddStewardDutiesAndProvisionalWindow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AssignedClubName",
                table: "VolunteerShift",
                type: "character varying(150)",
                maxLength: 150,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AssignedTeamId",
                table: "VolunteerShift",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AttendanceStatus",
                table: "VolunteerShift",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Assigned");

            migrationBuilder.AddColumn<DateTime>(
                name: "CheckedInAt",
                table: "VolunteerShift",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CheckedInByName",
                table: "VolunteerShift",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "CheckedInByStaffOverride",
                table: "VolunteerShift",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "CheckedInByUserId",
                table: "VolunteerShift",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DutyCategory",
                table: "VolunteerShift",
                type: "character varying(40)",
                maxLength: 40,
                nullable: false,
                defaultValue: "Custom");

            migrationBuilder.AddColumn<int>(
                name: "LaneNumber",
                table: "VolunteerShift",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "OfficialConfirmedAt",
                table: "Sessions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ProvisionalUntil",
                table: "Sessions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerShift_AssignedTeamId",
                table: "VolunteerShift",
                column: "AssignedTeamId");

            migrationBuilder.AddForeignKey(
                name: "FK_VolunteerShift_Teams_AssignedTeamId",
                table: "VolunteerShift",
                column: "AssignedTeamId",
                principalTable: "Teams",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_VolunteerShift_Teams_AssignedTeamId",
                table: "VolunteerShift");

            migrationBuilder.DropIndex(
                name: "IX_VolunteerShift_AssignedTeamId",
                table: "VolunteerShift");

            migrationBuilder.DropColumn(
                name: "AssignedClubName",
                table: "VolunteerShift");

            migrationBuilder.DropColumn(
                name: "AssignedTeamId",
                table: "VolunteerShift");

            migrationBuilder.DropColumn(
                name: "AttendanceStatus",
                table: "VolunteerShift");

            migrationBuilder.DropColumn(
                name: "CheckedInAt",
                table: "VolunteerShift");

            migrationBuilder.DropColumn(
                name: "CheckedInByName",
                table: "VolunteerShift");

            migrationBuilder.DropColumn(
                name: "CheckedInByStaffOverride",
                table: "VolunteerShift");

            migrationBuilder.DropColumn(
                name: "CheckedInByUserId",
                table: "VolunteerShift");

            migrationBuilder.DropColumn(
                name: "DutyCategory",
                table: "VolunteerShift");

            migrationBuilder.DropColumn(
                name: "LaneNumber",
                table: "VolunteerShift");

            migrationBuilder.DropColumn(
                name: "OfficialConfirmedAt",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "ProvisionalUntil",
                table: "Sessions");
        }
    }
}
