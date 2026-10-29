using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEventDayTools : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ProgrammeRevision",
                table: "Races",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "FulfilmentFromDate",
                table: "EventOrderLine",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FulfilmentKindSnapshot",
                table: "EventOrderLine",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "FulfilmentReviewedAt",
                table: "EventOrderLine",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FulfilmentReviewedByUserId",
                table: "EventOrderLine",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "FulfilmentRevision",
                table: "EventOrderLine",
                type: "bigint",
                nullable: false,
                defaultValue: 1L);

            migrationBuilder.AddColumn<string>(
                name: "FulfilmentUntilDate",
                table: "EventOrderLine",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FulfilmentFromDate",
                table: "CatalogueItem",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FulfilmentKind",
                table: "CatalogueItem",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "FulfilmentUntilDate",
                table: "CatalogueItem",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "AppleChangeClock",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Value = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AppleChangeClock", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ArrivalBookings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    OwnerUserId = table.Column<string>(type: "text", nullable: false),
                    SignupId = table.Column<int>(type: "integer", nullable: true),
                    Reference = table.Column<string>(type: "text", nullable: false),
                    VehicleRegistration = table.Column<string>(type: "text", nullable: false),
                    LegacyReconciledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LegacyAllocationSnapshot = table.Column<string>(type: "text", nullable: true),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ArrivalBookings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ArrivalBookings_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BroadcastCues",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CommandId = table.Column<Guid>(type: "uuid", nullable: false),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    Arena = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    SectionId = table.Column<int>(type: "integer", nullable: true),
                    Kind = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    StartsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PayloadJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BroadcastCues", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BroadcastCues_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BroadcastOutputs",
                columns: table => new
                {
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    Arena = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Hidden = table.Column<bool>(type: "boolean", nullable: false),
                    SponsorOffset = table.Column<long>(type: "bigint", nullable: false),
                    DiscardBefore = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BroadcastOutputs", x => new { x.CompetitionId, x.Arena });
                    table.ForeignKey(
                        name: "FK_BroadcastOutputs_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BroadcastSnapshots",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    Arena = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    SectionKey = table.Column<int>(type: "integer", nullable: false),
                    ObservedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PayloadJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BroadcastSnapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BroadcastSnapshots_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NativeInstallations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CapabilityHash = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NativeInstallations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "VaccinationHorses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    CreatedByUserId = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaccinationHorses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VaccinationHorses_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaccinationPolicyVersions",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Organisation = table.Column<string>(type: "text", nullable: false),
                    Edition = table.Column<string>(type: "text", nullable: false),
                    SourceUrl = table.Column<string>(type: "text", nullable: true),
                    EffectiveFrom = table.Column<DateOnly>(type: "date", nullable: true),
                    EffectiveUntil = table.Column<DateOnly>(type: "date", nullable: true),
                    VerifiedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    Automatic = table.Column<bool>(type: "boolean", nullable: false),
                    RulesJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaccinationPolicyVersions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "WindAcknowledgements",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    Arena = table.Column<string>(type: "text", nullable: false),
                    StartsAt = table.Column<long>(type: "bigint", nullable: false),
                    EndsAt = table.Column<long>(type: "bigint", nullable: false),
                    PeakMph = table.Column<double>(type: "double precision", nullable: false),
                    Severity = table.Column<int>(type: "integer", nullable: false),
                    AcknowledgedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WindAcknowledgements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WindAcknowledgements_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WindRaceDecisions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    SessionId = table.Column<int>(type: "integer", nullable: false),
                    RequestId = table.Column<string>(type: "text", nullable: false),
                    Fingerprint = table.Column<string>(type: "text", nullable: false),
                    ProfileId = table.Column<string>(type: "text", nullable: false),
                    BeforeJson = table.Column<string>(type: "text", nullable: false),
                    AfterJson = table.Column<string>(type: "text", nullable: false),
                    Authority = table.Column<string>(type: "text", nullable: false),
                    Decision = table.Column<string>(type: "text", nullable: false),
                    ActorUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PublishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WindRaceDecisions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WindRaceDecisions_AspNetUsers_ActorUserId",
                        column: x => x.ActorUserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_WindRaceDecisions_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WindRulesSelections",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    SectionId = table.Column<int>(type: "integer", nullable: false),
                    ProfileId = table.Column<string>(type: "text", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    EventLevel = table.Column<string>(type: "text", nullable: false),
                    PublishedSpare = table.Column<string>(type: "text", nullable: false),
                    PermittedRacesJson = table.Column<string>(type: "text", nullable: false),
                    VenueNotes = table.Column<string>(type: "text", nullable: false),
                    ReviewMph = table.Column<double>(type: "double precision", nullable: false),
                    OfficialReviewMph = table.Column<double>(type: "double precision", nullable: false),
                    VenueLimitMph = table.Column<double>(type: "double precision", nullable: true),
                    AdoptionConfirmed = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WindRulesSelections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WindRulesSelections_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ArrivalBookingSources",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ArrivalBookingId = table.Column<Guid>(type: "uuid", nullable: false),
                    EventOrderLineId = table.Column<int>(type: "integer", nullable: false),
                    Quantity = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ArrivalBookingSources", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ArrivalBookingSources_ArrivalBookings_ArrivalBookingId",
                        column: x => x.ArrivalBookingId,
                        principalTable: "ArrivalBookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ArrivalBookingSources_EventOrderLine_EventOrderLineId",
                        column: x => x.EventOrderLineId,
                        principalTable: "EventOrderLine",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "WalletPasses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ArrivalBookingId = table.Column<Guid>(type: "uuid", nullable: false),
                    Serial = table.Column<string>(type: "text", nullable: false),
                    ProtectedAuthenticationToken = table.Column<string>(type: "text", nullable: false),
                    AuthenticationTokenHash = table.Column<string>(type: "text", nullable: false),
                    ContentHash = table.Column<string>(type: "text", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    ChangeCursor = table.Column<long>(type: "bigint", nullable: false),
                    ChangedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastCheckedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WalletPasses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WalletPasses_ArrivalBookings_ArrivalBookingId",
                        column: x => x.ArrivalBookingId,
                        principalTable: "ArrivalBookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "LiveActivityRegistrations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InstallationId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActivityId = table.Column<string>(type: "text", nullable: false),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    TeamId = table.Column<int>(type: "integer", nullable: false),
                    ProtectedPushToken = table.Column<string>(type: "text", nullable: false),
                    Sandbox = table.Column<bool>(type: "boolean", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EndRequested = table.Column<bool>(type: "boolean", nullable: false),
                    Ended = table.Column<bool>(type: "boolean", nullable: false),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    LastTimestamp = table.Column<long>(type: "bigint", nullable: false),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LeaseToken = table.Column<string>(type: "text", nullable: true),
                    LeaseUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Attempts = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LiveActivityRegistrations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LiveActivityRegistrations_NativeInstallations_InstallationId",
                        column: x => x.InstallationId,
                        principalTable: "NativeInstallations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_LiveActivityRegistrations_Teams_TeamId",
                        column: x => x.TeamId,
                        principalTable: "Teams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaccinationDeclarationHorses",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    DeclarationFormId = table.Column<int>(type: "integer", nullable: false),
                    RiderEntryId = table.Column<int>(type: "integer", nullable: false),
                    HorseId = table.Column<Guid>(type: "uuid", nullable: false),
                    PonyNameSnapshot = table.Column<string>(type: "text", nullable: false),
                    PassportSnapshot = table.Column<string>(type: "text", nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaccinationDeclarationHorses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VaccinationDeclarationHorses_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_VaccinationDeclarationHorses_VaccinationHorses_HorseId",
                        column: x => x.HorseId,
                        principalTable: "VaccinationHorses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "EventVaccinationSettings",
                columns: table => new
                {
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    PolicyVersionId = table.Column<string>(type: "character varying(80)", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    ReferenceDateBasis = table.Column<string>(type: "text", nullable: false),
                    VenueRulesJson = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedByUserId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventVaccinationSettings", x => x.CompetitionId);
                    table.ForeignKey(
                        name: "FK_EventVaccinationSettings_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_EventVaccinationSettings_VaccinationPolicyVersions_PolicyVe~",
                        column: x => x.PolicyVersionId,
                        principalTable: "VaccinationPolicyVersions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ArrivalAllocations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ArrivalBookingSourceId = table.Column<int>(type: "integer", nullable: false),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    Resource = table.Column<string>(type: "text", nullable: false),
                    Night = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ArrivalAllocations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ArrivalAllocations_ArrivalBookingSources_ArrivalBookingSour~",
                        column: x => x.ArrivalBookingSourceId,
                        principalTable: "ArrivalBookingSources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WalletDeviceRegistrations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    WalletPassId = table.Column<Guid>(type: "uuid", nullable: false),
                    DeviceHash = table.Column<string>(type: "text", nullable: false),
                    ProtectedPushToken = table.Column<string>(type: "text", nullable: false),
                    PendingCursor = table.Column<long>(type: "bigint", nullable: false),
                    DeliveredCursor = table.Column<long>(type: "bigint", nullable: false),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LeaseToken = table.Column<string>(type: "text", nullable: true),
                    LeaseUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Attempts = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WalletDeviceRegistrations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WalletDeviceRegistrations_WalletPasses_WalletPassId",
                        column: x => x.WalletPassId,
                        principalTable: "WalletPasses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaccinationEvidence",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    DeclarationHorseId = table.Column<int>(type: "integer", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    Source = table.Column<string>(type: "text", nullable: false),
                    DatesJson = table.Column<string>(type: "text", nullable: false),
                    CompleteHistory = table.Column<bool>(type: "boolean", nullable: false),
                    ArrivalOn = table.Column<DateOnly>(type: "date", nullable: true),
                    LastOtherVaccinationOn = table.Column<DateOnly>(type: "date", nullable: true),
                    ExceptionReview = table.Column<bool>(type: "boolean", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    RecordedByUserId = table.Column<string>(type: "text", nullable: true),
                    RecordedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaccinationEvidence", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VaccinationEvidence_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_VaccinationEvidence_VaccinationDeclarationHorses_Declaratio~",
                        column: x => x.DeclarationHorseId,
                        principalTable: "VaccinationDeclarationHorses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VaccinationInspections",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    DeclarationHorseId = table.Column<int>(type: "integer", nullable: false),
                    LinkRevision = table.Column<int>(type: "integer", nullable: false),
                    EvidenceId = table.Column<long>(type: "bigint", nullable: false),
                    EvidenceRevision = table.Column<int>(type: "integer", nullable: false),
                    SettingsRevision = table.Column<int>(type: "integer", nullable: false),
                    PolicyVersionId = table.Column<string>(type: "text", nullable: false),
                    EventStartOn = table.Column<DateOnly>(type: "date", nullable: false),
                    Decision = table.Column<string>(type: "text", nullable: false),
                    Reason = table.Column<string>(type: "text", nullable: false),
                    EvaluationJson = table.Column<string>(type: "text", nullable: false),
                    InspectedByUserId = table.Column<string>(type: "text", nullable: true),
                    InspectedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VaccinationInspections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VaccinationInspections_Competitions_CompetitionId",
                        column: x => x.CompetitionId,
                        principalTable: "Competitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_VaccinationInspections_VaccinationDeclarationHorses_Declara~",
                        column: x => x.DeclarationHorseId,
                        principalTable: "VaccinationDeclarationHorses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_VaccinationInspections_VaccinationEvidence_EvidenceId",
                        column: x => x.EvidenceId,
                        principalTable: "VaccinationEvidence",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "AppleChangeClock",
                columns: new[] { "Id", "Value" },
                values: new object[] { 1, 0L });

            migrationBuilder.InsertData(
                table: "VaccinationPolicyVersions",
                columns: new[] { "Id", "Automatic", "Edition", "EffectiveFrom", "EffectiveUntil", "Organisation", "RulesJson", "SourceUrl", "VerifiedOn" },
                values: new object[,]
                {
                    { "eguk-unverified-v1", false, "Source required", null, null, "EGUK", "{\"Mandatory\":[\"Official review is needed until the current policy has been verified.\"],\"Recommended\":[]}", null, null },
                    { "fei-2026-unverified-v1", false, "2026 — source required", null, null, "FEI", "{\"Mandatory\":[\"Official review is needed until the current policy has been verified.\"],\"Recommended\":[]}", null, null },
                    { "manual-v1", false, "Source required", null, null, "Local / other", "{\"Mandatory\":[\"Official review is needed until the current policy has been verified.\"],\"Recommended\":[]}", null, null },
                    { "mgagb-unverified-v1", false, "Source required", null, null, "MGAGB", "{\"Mandatory\":[\"Official review is needed until the current policy has been verified.\"],\"Recommended\":[]}", null, null },
                    { "pc-2026-01-v1", true, "January 2026", new DateOnly(2026, 1, 1), new DateOnly(2026, 12, 31), "Pony Club", "{\"Mandatory\":[\"V2: 21\\u201360 days after V1. V3: 120\\u2013180 days after V2.\",\"Courses before 2024: V2 at 21\\u201392 days; V3 no later than seven calendar months after V2. Ambiguous cohort dates need official review.\",\"Later boosters: no more than 12 calendar months apart. A broken course needs a restart.\",\"Do not attend on the injection date or the six following days. Day 7 is allowed.\",\"Bring the passport with the vet\\u0027s signed and stamped record. Documented October\\u2013December 2022 vaccine-shortage exceptions (up to 15 months, then a booster within nine months) need official review.\"],\"Recommended\":[\"A booster within six calendar months plus 21 days before arrival is recommended.\"]}", "https://resources.pcuk.org/wp-content/uploads/2024/08/The-Pony-Club-Equine-Influenza-VACCINATION-RULE.pdf", new DateOnly(2026, 10, 29) },
                    { "struk-unverified-v1", false, "Source required", null, null, "STRUK", "{\"Mandatory\":[\"Official review is needed until the current policy has been verified.\"],\"Recommended\":[]}", null, null }
                });

            migrationBuilder.CreateIndex(
                name: "IX_ArrivalAllocations_ArrivalBookingSourceId",
                table: "ArrivalAllocations",
                column: "ArrivalBookingSourceId");

            migrationBuilder.CreateIndex(
                name: "IX_ArrivalAllocations_CompetitionId_Kind_Resource_Night",
                table: "ArrivalAllocations",
                columns: new[] { "CompetitionId", "Kind", "Resource", "Night" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ArrivalBookings_CompetitionId",
                table: "ArrivalBookings",
                column: "CompetitionId");

            migrationBuilder.CreateIndex(
                name: "IX_ArrivalBookings_Reference",
                table: "ArrivalBookings",
                column: "Reference",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ArrivalBookings_SignupId",
                table: "ArrivalBookings",
                column: "SignupId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ArrivalBookingSources_ArrivalBookingId_EventOrderLineId",
                table: "ArrivalBookingSources",
                columns: new[] { "ArrivalBookingId", "EventOrderLineId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ArrivalBookingSources_EventOrderLineId",
                table: "ArrivalBookingSources",
                column: "EventOrderLineId");

            migrationBuilder.CreateIndex(
                name: "IX_BroadcastCues_CommandId",
                table: "BroadcastCues",
                column: "CommandId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BroadcastCues_CompetitionId_Arena_StartsAt",
                table: "BroadcastCues",
                columns: new[] { "CompetitionId", "Arena", "StartsAt" });

            migrationBuilder.CreateIndex(
                name: "IX_BroadcastSnapshots_CompetitionId_Arena_SectionKey_ObservedAt",
                table: "BroadcastSnapshots",
                columns: new[] { "CompetitionId", "Arena", "SectionKey", "ObservedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_EventVaccinationSettings_PolicyVersionId",
                table: "EventVaccinationSettings",
                column: "PolicyVersionId");

            migrationBuilder.CreateIndex(
                name: "IX_LiveActivityRegistrations_InstallationId_ActivityId",
                table: "LiveActivityRegistrations",
                columns: new[] { "InstallationId", "ActivityId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LiveActivityRegistrations_TeamId",
                table: "LiveActivityRegistrations",
                column: "TeamId");

            migrationBuilder.CreateIndex(
                name: "IX_VaccinationDeclarationHorses_CompetitionId",
                table: "VaccinationDeclarationHorses",
                column: "CompetitionId");

            migrationBuilder.CreateIndex(
                name: "IX_VaccinationDeclarationHorses_DeclarationFormId",
                table: "VaccinationDeclarationHorses",
                column: "DeclarationFormId");

            migrationBuilder.CreateIndex(
                name: "IX_VaccinationDeclarationHorses_HorseId",
                table: "VaccinationDeclarationHorses",
                column: "HorseId");

            migrationBuilder.CreateIndex(
                name: "IX_VaccinationDeclarationHorses_RiderEntryId",
                table: "VaccinationDeclarationHorses",
                column: "RiderEntryId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_VaccinationEvidence_CompetitionId",
                table: "VaccinationEvidence",
                column: "CompetitionId");

            migrationBuilder.CreateIndex(
                name: "IX_VaccinationEvidence_DeclarationHorseId_Revision",
                table: "VaccinationEvidence",
                columns: new[] { "DeclarationHorseId", "Revision" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_VaccinationHorses_CompetitionId",
                table: "VaccinationHorses",
                column: "CompetitionId");

            migrationBuilder.CreateIndex(
                name: "IX_VaccinationInspections_CompetitionId",
                table: "VaccinationInspections",
                column: "CompetitionId");

            migrationBuilder.CreateIndex(
                name: "IX_VaccinationInspections_DeclarationHorseId_LinkRevision",
                table: "VaccinationInspections",
                columns: new[] { "DeclarationHorseId", "LinkRevision" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_VaccinationInspections_EvidenceId",
                table: "VaccinationInspections",
                column: "EvidenceId");

            migrationBuilder.CreateIndex(
                name: "IX_WalletDeviceRegistrations_WalletPassId_DeviceHash",
                table: "WalletDeviceRegistrations",
                columns: new[] { "WalletPassId", "DeviceHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WalletPasses_ArrivalBookingId",
                table: "WalletPasses",
                column: "ArrivalBookingId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WalletPasses_Serial",
                table: "WalletPasses",
                column: "Serial",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WindAcknowledgements_CompetitionId_EndsAt",
                table: "WindAcknowledgements",
                columns: new[] { "CompetitionId", "EndsAt" });

            migrationBuilder.CreateIndex(
                name: "IX_WindRaceDecisions_ActorUserId",
                table: "WindRaceDecisions",
                column: "ActorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_WindRaceDecisions_CompetitionId_RequestId",
                table: "WindRaceDecisions",
                columns: new[] { "CompetitionId", "RequestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WindRulesSelections_CompetitionId_SectionId",
                table: "WindRulesSelections",
                columns: new[] { "CompetitionId", "SectionId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AppleChangeClock");

            migrationBuilder.DropTable(
                name: "ArrivalAllocations");

            migrationBuilder.DropTable(
                name: "BroadcastCues");

            migrationBuilder.DropTable(
                name: "BroadcastOutputs");

            migrationBuilder.DropTable(
                name: "BroadcastSnapshots");

            migrationBuilder.DropTable(
                name: "EventVaccinationSettings");

            migrationBuilder.DropTable(
                name: "LiveActivityRegistrations");

            migrationBuilder.DropTable(
                name: "VaccinationInspections");

            migrationBuilder.DropTable(
                name: "WalletDeviceRegistrations");

            migrationBuilder.DropTable(
                name: "WindAcknowledgements");

            migrationBuilder.DropTable(
                name: "WindRaceDecisions");

            migrationBuilder.DropTable(
                name: "WindRulesSelections");

            migrationBuilder.DropTable(
                name: "ArrivalBookingSources");

            migrationBuilder.DropTable(
                name: "VaccinationPolicyVersions");

            migrationBuilder.DropTable(
                name: "NativeInstallations");

            migrationBuilder.DropTable(
                name: "VaccinationEvidence");

            migrationBuilder.DropTable(
                name: "WalletPasses");

            migrationBuilder.DropTable(
                name: "VaccinationDeclarationHorses");

            migrationBuilder.DropTable(
                name: "ArrivalBookings");

            migrationBuilder.DropTable(
                name: "VaccinationHorses");

            migrationBuilder.DropColumn(
                name: "ProgrammeRevision",
                table: "Races");

            migrationBuilder.DropColumn(
                name: "FulfilmentFromDate",
                table: "EventOrderLine");

            migrationBuilder.DropColumn(
                name: "FulfilmentKindSnapshot",
                table: "EventOrderLine");

            migrationBuilder.DropColumn(
                name: "FulfilmentReviewedAt",
                table: "EventOrderLine");

            migrationBuilder.DropColumn(
                name: "FulfilmentReviewedByUserId",
                table: "EventOrderLine");

            migrationBuilder.DropColumn(
                name: "FulfilmentRevision",
                table: "EventOrderLine");

            migrationBuilder.DropColumn(
                name: "FulfilmentUntilDate",
                table: "EventOrderLine");

            migrationBuilder.DropColumn(
                name: "FulfilmentFromDate",
                table: "CatalogueItem");

            migrationBuilder.DropColumn(
                name: "FulfilmentKind",
                table: "CatalogueItem");

            migrationBuilder.DropColumn(
                name: "FulfilmentUntilDate",
                table: "CatalogueItem");
        }
    }
}
