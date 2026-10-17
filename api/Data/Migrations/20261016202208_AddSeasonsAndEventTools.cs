using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSeasonsAndEventTools : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Season",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: false),
                    Format = table.Column<int>(type: "integer", nullable: false),
                    AgeGroup = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    BestResultsToCount = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Season", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Season_AspNetUsers_OwnerUserId",
                        column: x => x.OwnerUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "TeamProfile",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    ClubId = table.Column<int>(type: "integer", nullable: false),
                    Suffix = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TeamProfile", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TeamProfile_AspNetUsers_OwnerUserId",
                        column: x => x.OwnerUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TeamProfile_Clubs_ClubId",
                        column: x => x.ClubId,
                        principalTable: "Clubs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SeasonPlacePoints",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SeasonId = table.Column<Guid>(type: "uuid", nullable: false),
                    Place = table.Column<int>(type: "integer", nullable: false),
                    Points = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SeasonPlacePoints", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SeasonPlacePoints_Season_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Season",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SeasonRound",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SeasonId = table.Column<Guid>(type: "uuid", nullable: false),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    CompetitionSectionId = table.Column<int>(type: "integer", nullable: false),
                    OrderIndex = table.Column<int>(type: "integer", nullable: false),
                    IsIncluded = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SeasonRound", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SeasonRound_CompetitionSections_CompetitionSectionId",
                        column: x => x.CompetitionSectionId,
                        principalTable: "CompetitionSections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SeasonRound_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SeasonRound_Season_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Season",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "EventTeamProfileLink",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TeamProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    TeamId = table.Column<int>(type: "integer", nullable: false),
                    LinkedByUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    LinkedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventTeamProfileLink", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EventTeamProfileLink_AspNetUsers_LinkedByUserId",
                        column: x => x.LinkedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_EventTeamProfileLink_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_EventTeamProfileLink_TeamProfile_TeamProfileId",
                        column: x => x.TeamProfileId,
                        principalTable: "TeamProfile",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_EventTeamProfileLink_Teams_TeamId",
                        column: x => x.TeamId,
                        principalTable: "Teams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SeasonRoundPublication",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SeasonRoundId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    SourceFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    PublishedByUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                    PublishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SeasonRoundPublication", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SeasonRoundPublication_AspNetUsers_PublishedByUserId",
                        column: x => x.PublishedByUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SeasonRoundPublication_SeasonRound_SeasonRoundId",
                        column: x => x.SeasonRoundId,
                        principalTable: "SeasonRound",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SeasonRoundResult",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SeasonRoundPublicationId = table.Column<Guid>(type: "uuid", nullable: false),
                    TeamProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    EventTeamId = table.Column<int>(type: "integer", nullable: false),
                    TeamName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ClubName = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    EventRank = table.Column<int>(type: "integer", nullable: false),
                    EventPoints = table.Column<int>(type: "integer", nullable: false),
                    SeasonPoints = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SeasonRoundResult", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SeasonRoundResult_SeasonRoundPublication_SeasonRoundPublica~",
                        column: x => x.SeasonRoundPublicationId,
                        principalTable: "SeasonRoundPublication",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SeasonRoundResult_TeamProfile_TeamProfileId",
                        column: x => x.TeamProfileId,
                        principalTable: "TeamProfile",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EventTeamProfileLink_CompetitionId_TeamProfileId",
                table: "EventTeamProfileLink",
                columns: new[] { "CompetitionId", "TeamProfileId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EventTeamProfileLink_LinkedByUserId",
                table: "EventTeamProfileLink",
                column: "LinkedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_EventTeamProfileLink_TeamId",
                table: "EventTeamProfileLink",
                column: "TeamId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EventTeamProfileLink_TeamProfileId",
                table: "EventTeamProfileLink",
                column: "TeamProfileId");

            migrationBuilder.CreateIndex(
                name: "IX_Season_OwnerUserId",
                table: "Season",
                column: "OwnerUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Season_Year_Format_AgeGroup",
                table: "Season",
                columns: new[] { "Year", "Format", "AgeGroup" });

            migrationBuilder.CreateIndex(
                name: "IX_SeasonPlacePoints_SeasonId_Place",
                table: "SeasonPlacePoints",
                columns: new[] { "SeasonId", "Place" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SeasonRound_CompetitionId",
                table: "SeasonRound",
                column: "CompetitionId");

            migrationBuilder.CreateIndex(
                name: "IX_SeasonRound_CompetitionSectionId",
                table: "SeasonRound",
                column: "CompetitionSectionId");

            migrationBuilder.CreateIndex(
                name: "IX_SeasonRound_SeasonId_CompetitionSectionId",
                table: "SeasonRound",
                columns: new[] { "SeasonId", "CompetitionSectionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SeasonRound_SeasonId_OrderIndex",
                table: "SeasonRound",
                columns: new[] { "SeasonId", "OrderIndex" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SeasonRoundPublication_PublishedByUserId",
                table: "SeasonRoundPublication",
                column: "PublishedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_SeasonRoundPublication_SeasonRoundId_Version",
                table: "SeasonRoundPublication",
                columns: new[] { "SeasonRoundId", "Version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SeasonRoundResult_SeasonRoundPublicationId_TeamProfileId",
                table: "SeasonRoundResult",
                columns: new[] { "SeasonRoundPublicationId", "TeamProfileId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SeasonRoundResult_TeamProfileId",
                table: "SeasonRoundResult",
                column: "TeamProfileId");

            migrationBuilder.CreateIndex(
                name: "IX_TeamProfile_ClubId",
                table: "TeamProfile",
                column: "ClubId");

            migrationBuilder.CreateIndex(
                name: "IX_TeamProfile_OwnerUserId",
                table: "TeamProfile",
                column: "OwnerUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EventTeamProfileLink");

            migrationBuilder.DropTable(
                name: "SeasonPlacePoints");

            migrationBuilder.DropTable(
                name: "SeasonRoundResult");

            migrationBuilder.DropTable(
                name: "SeasonRoundPublication");

            migrationBuilder.DropTable(
                name: "TeamProfile");

            migrationBuilder.DropTable(
                name: "SeasonRound");

            migrationBuilder.DropTable(
                name: "Season");
        }
    }
}
