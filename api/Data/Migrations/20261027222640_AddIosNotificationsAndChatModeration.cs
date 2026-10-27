using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddIosNotificationsAndChatModeration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ChatReports",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    MessageId = table.Column<int>(type: "integer", nullable: false),
                    ReporterUserId = table.Column<string>(type: "text", nullable: false),
                    Reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ResolvedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChatReports", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ChatReports_AspNetUsers_ReporterUserId",
                        column: x => x.ReporterUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ChatReports_ChatMessages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "ChatMessages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ChatUserBlocks",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "text", nullable: false),
                    BlockedUserId = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChatUserBlocks", x => new { x.UserId, x.BlockedUserId });
                    table.ForeignKey(
                        name: "FK_ChatUserBlocks_AspNetUsers_BlockedUserId",
                        column: x => x.BlockedUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ChatUserBlocks_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ScheduledNotifications",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ReminderKey = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    DueAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TimetableVersion = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScheduledNotifications", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ScheduledNotifications_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NotificationDeliveries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ScheduledNotificationId = table.Column<int>(type: "integer", nullable: false),
                    PushSubscriptionId = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    TimetableVersion = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    RecoveredLeases = table.Column<int>(type: "integer", nullable: false),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ClaimedUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClaimToken = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    LastError = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    AcceptedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NotificationDeliveries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_NotificationDeliveries_PushSubscriptions_PushSubscriptionId",
                        column: x => x.PushSubscriptionId,
                        principalTable: "PushSubscriptions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NotificationDeliveries_ScheduledNotifications_ScheduledNoti~",
                        column: x => x.ScheduledNotificationId,
                        principalTable: "ScheduledNotifications",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ChatReports_MessageId_ReporterUserId",
                table: "ChatReports",
                columns: new[] { "MessageId", "ReporterUserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChatReports_ReporterUserId",
                table: "ChatReports",
                column: "ReporterUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ChatUserBlocks_BlockedUserId",
                table: "ChatUserBlocks",
                column: "BlockedUserId");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationDeliveries_PushSubscriptionId",
                table: "NotificationDeliveries",
                column: "PushSubscriptionId");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationDeliveries_ScheduledNotificationId_PushSubscrip~",
                table: "NotificationDeliveries",
                columns: new[] { "ScheduledNotificationId", "PushSubscriptionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NotificationDeliveries_Status_NextAttemptAt_ClaimedUntil",
                table: "NotificationDeliveries",
                columns: new[] { "Status", "NextAttemptAt", "ClaimedUntil" });

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledNotifications_CompetitionId",
                table: "ScheduledNotifications",
                column: "CompetitionId");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledNotifications_ExpiresAt",
                table: "ScheduledNotifications",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledNotifications_ReminderKey",
                table: "ScheduledNotifications",
                column: "ReminderKey",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ChatReports");

            migrationBuilder.DropTable(
                name: "ChatUserBlocks");

            migrationBuilder.DropTable(
                name: "NotificationDeliveries");

            migrationBuilder.DropTable(
                name: "ScheduledNotifications");
        }
    }
}
