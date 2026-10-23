using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddWithdrawalsAndSwaps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "EntryStatus",
                table: "Teams",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "DrawChange",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    SectionId = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    RequestId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Fingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ActorUserId = table.Column<string>(type: "text", nullable: true),
                    ResultJson = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DrawChange", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RiderSwapEvent",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    DeclarationFormId = table.Column<int>(type: "integer", nullable: false),
                    TeamId = table.Column<int>(type: "integer", nullable: false),
                    OutRiderEntryId = table.Column<int>(type: "integer", nullable: false),
                    InRiderEntryId = table.Column<int>(type: "integer", nullable: false),
                    BeforeJson = table.Column<string>(type: "text", nullable: false),
                    AfterJson = table.Column<string>(type: "text", nullable: false),
                    ActorUserId = table.Column<string>(type: "text", nullable: true),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    OverrodeLock = table.Column<bool>(type: "boolean", nullable: false),
                    RequestId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RiderSwapEvent", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RiderSwapEvent_DeclarationForms_DeclarationFormId",
                        column: x => x.DeclarationFormId,
                        principalTable: "DeclarationForms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TeamStatusEvent",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    TeamId = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    ActorUserId = table.Column<string>(type: "text", nullable: true),
                    RemovedEntriesJson = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TeamStatusEvent", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TeamStatusEvent_Teams_TeamId",
                        column: x => x.TeamId,
                        principalTable: "Teams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DrawChange_CompetitionId_RequestId",
                table: "DrawChange",
                columns: new[] { "CompetitionId", "RequestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DrawChange_CompetitionId_SectionId",
                table: "DrawChange",
                columns: new[] { "CompetitionId", "SectionId" });

            migrationBuilder.CreateIndex(
                name: "IX_RiderSwapEvent_CompetitionId",
                table: "RiderSwapEvent",
                column: "CompetitionId");

            migrationBuilder.CreateIndex(
                name: "IX_RiderSwapEvent_DeclarationFormId_RequestId",
                table: "RiderSwapEvent",
                columns: new[] { "DeclarationFormId", "RequestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TeamStatusEvent_CompetitionId",
                table: "TeamStatusEvent",
                column: "CompetitionId");

            migrationBuilder.CreateIndex(
                name: "IX_TeamStatusEvent_TeamId_Id",
                table: "TeamStatusEvent",
                columns: new[] { "TeamId", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DrawChange");

            migrationBuilder.DropTable(
                name: "RiderSwapEvent");

            migrationBuilder.DropTable(
                name: "TeamStatusEvent");

            migrationBuilder.DropColumn(
                name: "EntryStatus",
                table: "Teams");
        }
    }
}
