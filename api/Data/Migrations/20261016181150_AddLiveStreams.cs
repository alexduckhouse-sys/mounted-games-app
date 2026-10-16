using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLiveStreams : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "LiveStreams",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    ArenaName = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    AngleName = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Caption = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    AudioMuted = table.Column<bool>(type: "boolean", nullable: false),
                    HasAudio = table.Column<bool>(type: "boolean", nullable: false),
                    Simulcast = table.Column<bool>(type: "boolean", nullable: false),
                    StartedByUserId = table.Column<string>(type: "text", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastHeartbeatAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EndedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SfuSessionId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Generation = table.Column<int>(type: "integer", nullable: false),
                    PendingSfuSessionId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    PendingAttempt = table.Column<int>(type: "integer", nullable: true),
                    PendingHasAudio = table.Column<bool>(type: "boolean", nullable: false),
                    PendingSimulcast = table.Column<bool>(type: "boolean", nullable: false),
                    PendingSince = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    TakeOverStreamId = table.Column<int>(type: "integer", nullable: true),
                    SfuTrackMids = table.Column<string>(type: "text", nullable: false),
                    PendingTrackMids = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LiveStreams", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LiveStreams_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LiveStreams_CompetitionId_Status",
                table: "LiveStreams",
                columns: new[] { "CompetitionId", "Status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LiveStreams");
        }
    }
}
