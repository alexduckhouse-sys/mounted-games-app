using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddStreamOverlays : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "StreamOverlays",
                columns: table => new
                {
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    BannerText = table.Column<string>(type: "character varying(140)", maxLength: 140, nullable: true),
                    BannerStyle = table.Column<int>(type: "integer", nullable: false),
                    BannerArenas = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    StripMode = table.Column<int>(type: "integer", nullable: false),
                    ScoreCardMode = table.Column<int>(type: "integer", nullable: false),
                    ScoreCardDelaySeconds = table.Column<int>(type: "integer", nullable: false),
                    ScoreCardSeconds = table.Column<int>(type: "integer", nullable: false),
                    LookJson = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedByUserId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StreamOverlays", x => x.CompetitionId);
                    table.ForeignKey(
                        name: "FK_StreamOverlays_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StreamOverlays");
        }
    }
}
