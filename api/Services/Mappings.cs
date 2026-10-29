using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.DecForms;

namespace MountedGames.Api.Services;

public static class Mappings
{
    public static LiveStreamDto ToDto(this LiveStream s, int viewerCount) => new(
        s.Id, s.CompetitionId, s.ArenaName, s.AngleName, s.Status, s.Caption,
        s.AudioMuted, s.HasAudio, DateTime.SpecifyKind(s.StartedAt, DateTimeKind.Utc), viewerCount, s.Generation);

    public static ClubDto ToDto(this Club c) => new(c.Id, c.Name, c.Region, c.BibColour);

    public static CompetitionSummary ToSummary(this Competition c) => new(
        c.Id, c.Name, c.Location, c.StartDate, c.EndDate,
        c.IsActive, c.IsArchived,
        c.Sections?.Count ?? 0,
        c.Teams?.Count ?? 0,
        c.Sessions?.Count ?? 0,
        c.Sessions?.Count(s => s.Heats.Count > 0) ?? 0);

    public static CompetitionDetail ToDto(
        this Competition c,
        IReadOnlyList<CompetitionSectionDto> sections,
        IReadOnlyList<TeamDto> teams,
        IReadOnlyList<SessionDto> sessions,
        bool isDemo = false,
        PayoutsToDto? payoutsTo = null,
        bool includePaymentDetails = true,
        int? maxStables = null,
        int? maxHookups = null,
        int? stablesRemaining = null,
        int? hookupsRemaining = null) => new(
        c.Id, c.Name, c.Location, c.Description,
        c.Latitude, c.Longitude,
        c.What3Words, c.AppleMapsUrl,
        c.StartDate, c.EndDate,
        c.IsActive, c.IsArchived,
        sections, teams, sessions,
        c.StreamUrl, c.OrganiserName,
        includePaymentDetails ? c.PaymentDestination : null,
        c.SignupsLocked, c.Icon, c.CreatedByUserId,
        IsDemo: isDemo, TermsText: c.TermsText,
        PayoutsTo: payoutsTo, LaneHatbands: PlannedRaceList.Read(c.LaneHatbands),
        UseRefereeCards: DecFormConfig.For(c).UseRefereeCards,
        Postcode: c.Postcode, CompetitionNumber: c.CompetitionNumber, ContactEmail: c.ContactEmail,
        LorryWhat3Words: c.LorryWhat3Words, LorryLatitude: c.LorryLatitude,
        LorryLongitude: c.LorryLongitude, LorryDirectionsNote: c.LorryDirectionsNote,
        PaymentLinkUrl: includePaymentDetails ? CompetitionFields.ResolvePaymentLinkUrl(c.PaymentLinkUrl, c.PaymentDestination) : null,
        MaxStables: maxStables, MaxHookups: maxHookups,
        StablesRemaining: stablesRemaining, HookupsRemaining: hookupsRemaining);

    /// <param name="activeSignups">Paid and pending entries: the ones that count towards <c>MaxParticipants</c>.</param>
    public static CompetitionSectionDto ToDto(this CompetitionSection s, int activeSignups = 0) =>
        new(s.Id, s.CompetitionId, s.Format, s.AgeGroup, s.DisplayName,
            s.RunoffRaceName, s.UsesRaceFinals, s.PriceMinor, s.MaxParticipants, s.FinalistCount, activeSignups, s.TieBreakRule,
            s.HasFinal, s.CarryPointsIntoFinal, s.DoublePointsInFinal);

    public static SectionSignupDto ToDto(this SectionSignup s) => new(
        s.Id, s.CompetitionSectionId,
        s.Section?.DisplayName ?? string.Empty,
        s.FullName, s.PonyClubName, s.ContactInfo,
        s.AmountMinor, s.Status, s.PaidAt, s.TeamId, s.CreatedAt,
        s.UseInitialOnly,
        s.TermsAccepted,
        s.TermsAcceptedAt is { } at ? DateTime.SpecifyKind(at, DateTimeKind.Utc) : null,
        s.TermsWordingVersion,
        s.ContactEmail, s.ConfirmationEmailStatus, s.ConfirmationEmailAt,
        s.TeamName, s.IsWholeTeam);

    public static MySignupDto ToMyDto(this SectionSignup s, Team? team = null) => new(
        s.Id,
        s.Section?.CompetitionId ?? 0,
        s.Section?.Competition?.Name ?? string.Empty,
        s.Section?.Competition?.StartDate ?? default,
        s.CompetitionSectionId,
        s.Section?.DisplayName ?? string.Empty,
        s.FullName, s.PonyClubName, s.ContactInfo,
        s.AmountMinor, s.Status, s.PaidAt,
        s.TeamId, team?.DisplayName,
        s.CreatedAt);

    public static ShopPostDto ToDto(this ShopPost p) => new(
        p.Id, p.AuthorName, p.PonyClubName, p.AuthorUserId,
        p.Title, p.Body, p.PriceMinor, p.ContactInfo, p.ImageBase64,
        p.CreatedAt, p.IsDeleted,
        p.Comments?.Count ?? 0, p.Reports?.Count ?? 0);

    public static ShopCommentDto ToDto(this ShopComment c) => new(
        c.Id, c.PostId, c.AuthorUserId, c.AuthorName,
        c.Body, c.IsPrivate, c.ToUserId, c.CreatedAt);

    public static TeamDto ToDto(this Team t) => new(
        t.Id, t.CompetitionId, t.CompetitionSectionId,
        t.Section?.DisplayName ?? string.Empty,
        t.ClubId, t.Club?.Name ?? string.Empty,
        t.Suffix, t.DisplayName, t.BibColour,
        t.TrainerUserId, t.Trainer?.FullName,
        t.IsHorsConcours,
        IsWithdrawn: t.EntryStatus != TeamEntryStatus.Active,
        BibDescription: ResultStatuses.PublicBibDescription(t.BibDescription),
        RefereeCard: ResultStatuses.TeamCardOf(t),
        Flag: ResultStatuses.TeamFlagOf(t.BibDescription));

    /// <summary>
    /// Same as ToDto but populates the viewer-specific Relationship and
    /// SupporterJoinKey fields used by the my-teams endpoint.
    /// </summary>
    public static TeamDto ToDtoFor(this Team t, string? viewerUserId, bool viewerManagesClub = false)
    {
        var isTrainer = viewerUserId != null && t.TrainerUserId == viewerUserId;
        var isSupporter = viewerUserId != null
            && t.Supporters?.Any(s => s.UserId == viewerUserId && s.Status == TeamSupporterStatus.Accepted) == true;
        return new TeamDto(
            t.Id, t.CompetitionId, t.CompetitionSectionId,
            t.Section?.DisplayName ?? string.Empty,
            t.ClubId, t.Club?.Name ?? string.Empty,
            t.Suffix, t.DisplayName, t.BibColour,
            t.TrainerUserId, t.Trainer?.FullName,
            t.IsHorsConcours,
            Relationship: isTrainer ? "trainer" : viewerManagesClub ? "manager" : isSupporter ? "supporter" : null,
            SupporterJoinKey: isTrainer || viewerManagesClub ? t.SupporterJoinKey : null,
            IsWithdrawn: t.EntryStatus != TeamEntryStatus.Active,
            BibDescription: ResultStatuses.PublicBibDescription(t.BibDescription),
            RefereeCard: ResultStatuses.TeamCardOf(t),
            Flag: ResultStatuses.TeamFlagOf(t.BibDescription));
    }

    public static TeamSupporterDto ToDto(this TeamSupporter s) => new(
        s.Id, s.TeamId,
        s.Team?.DisplayName ?? string.Empty,
        s.UserId,
        s.User?.FullName ?? s.User?.Email ?? "—",
        s.User?.Email,
        s.Status, s.CreatedAt);

    public static HeatEntryDto ToDto(this HeatEntry he) => new(
        he.Id, he.TeamId,
        he.Team?.DisplayName ?? string.Empty,
        string.IsNullOrWhiteSpace(he.BibColourOverride) ? he.Team?.BibColour : he.BibColourOverride,
        he.LaneIndex,
        ResultStatuses.TeamCardOf(he.Team),
        ResultStatuses.TeamFlagOf(he.Team?.BibDescription),
        ResultStatuses.PublicBibDescription(he.Team?.BibDescription),
        he.BibColourOverride);

    public static ResultDto ToDto(this Result r) => new(
        r.Id, r.TeamId,
        r.Team?.DisplayName ?? string.Empty,
        r.Placing, r.Eliminated, r.Points, r.IsSitOut, ResultStatuses.Of(r),
        ResultStatuses.RefereeCardOf(r.RefereeNote),
        ScoringService.IsUnderReview(r.RefereeNote));

    public static RaceDto ToDto(this Race r) => new(
        r.Id, r.HeatId, r.Name, r.OrderIndex, r.IsComplete,
        r.StartedAt, r.FinishedAt,
        r.Results.OrderBy(x => x.Placing ?? int.MaxValue).Select(x => x.ToDto()).ToList(),
        r.HasOpenProtest, r.ProgrammeRevision);

    public static HeatDto ToDto(this Heat h) => new(
        h.Id, h.SessionId, h.Label, h.OrderIndex,
        h.DurationMinutes, h.ScheduledStart, h.StartedAt, h.FinishedAt,
        h.RaceRoundId, h.RaceRoundStage,
        h.Entries.OrderBy(e => e.LaneIndex).Select(e => e.ToDto()).ToList(),
        h.Races.OrderBy(r => r.OrderIndex).Select(r => r.ToDto()).ToList(),
        h.Races.Any(r => r.HasOpenProtest));

    public static SessionDto ToDto(this Session s) => new(
        s.Id, s.CompetitionId, s.CompetitionSectionId, s.Section?.DisplayName,
        s.Name, s.ArenaName, s.ScheduledStart, s.StartedAt, s.FinishedAt,
        s.Status, s.OrderIndex, s.Notes,
        s.IsBreak, s.DurationMinutes,
        s.Kind, s.Location,
        s.StreamUrl, s.LanesPerHeat,
        s.MinutesPerHeat, s.RaceOrderAlternating,
        s.Heats.OrderBy(h => h.OrderIndex).Select(h => h.ToDto()).ToList(),
        s.LaneRotationMode, s.QualifiersPerHeat, PlannedRaceList.Read(s.PlannedRaces),
        PlannedFinalRaceLists.Read(s.PlannedFinalRaces),
        s.ProvisionalUntil, s.OfficialConfirmedAt);

    public static RiderEntryDto ToDto(this RiderEntry r) => new(
        r.Id, r.SavedRiderId, r.FullName, r.DateOfBirth, r.HorseName, r.BibColour,
        r.IsCaptain, r.IsReserve, r.OrderIndex, r.UseInitialOnly, r.IsGuestRider, r.PonyHeightHands,
        r.BirthYear, r.AgeGroup, r.WeightKg, r.PonyPassportNumber, r.PonyAge, r.MembershipNumber,
        r.EmergencyContactName, r.EmergencyContactPhone, r.MedicalNotes,
        DecFormRules.ReadCustomValues(r.CustomValuesJson), DecFormRules.ReadFlags(r.FlagsJson),
        r.PonyOwnerFullName);

    /// <summary>
    /// The rider as a public viewer sees them: the surname shortened when the rider asked for that, and the
    /// date of birth and saved-rider link left out. Staff and the owning trainer get <see cref="ToDto(RiderEntry)"/>.
    /// </summary>
    public static RiderEntryDto ToPublicDto(this RiderEntry r) => r.ToDto() with
    {
        FullName = RiderNames.Display(r.FullName, r.UseInitialOnly, viewerSeesFullNames: false),
        DateOfBirth = null, SavedRiderId = null,
        // Every adaptive dec form field is personal data about a child: none of it goes on a public page.
        BirthYear = null, AgeGroup = null, WeightKg = null, PonyPassportNumber = null, PonyOwnerFullName = null, PonyAge = null,
        MembershipNumber = null, EmergencyContactName = null, EmergencyContactPhone = null, MedicalNotes = null,
        CustomValues = null, Flags = null,
    };

    /// <param name="includePrivate">The viewer submitted the form, trains the team or runs the competition: contact details and full rider records.</param>
    public static DeclarationFormDto ToDto(this DeclarationForm d, bool includePrivate = false, string? entryTeamName = null) => new(
        d.Id, d.TeamId,
        d.Team?.DisplayName ?? string.Empty,
        d.Team?.CompetitionId ?? 0,
        d.Team?.Competition?.Name ?? string.Empty,
        includePrivate ? d.SubmittedByUserId : null, d.SubmittedBy?.FullName,
        includePrivate ? d.SubmittedBy?.PhoneNumber : null,
        d.SubmittedAt, includePrivate ? d.Notes : null, d.IsLocked,
        d.Riders.OrderBy(r => r.OrderIndex).Select(r => includePrivate ? r.ToDto() : r.ToPublicDto()).ToList(),
        ResultStatuses.PublicBibDescription(d.Team?.BibDescription),
        includePrivate ? d.TrainerName : null,
        includePrivate ? d.TermsAcceptedAt : null,
        entryTeamName,
        includePrivate ? d.Riders.Count(r => !string.IsNullOrEmpty(r.FlagsJson) && r.FlagsJson != "[]") : 0,
        includePrivate ? d.TrainerPhone : null);

    public static SavedRiderDto ToDto(this SavedRider r) =>
        new(r.Id, r.ClubId, r.FullName, r.DateOfBirth, r.HorseName, r.Notes, r.UseInitialOnly, r.PonyHeightHands, r.PonyPassportNumber, r.PonyOwnerFullName);

    public static ChatMessageDto ToDto(this ChatMessage m) => new(
        m.Id, m.CompetitionId, m.UserId, m.AuthorName, m.Body, m.Type, m.Tag, m.CreatedAt, m.AdminOnly, m.RecipientUserId);

    public static TrainerNoteDto ToDto(this TrainerNote n) =>
        new(n.Id, n.UserId, n.Title, n.Body, n.CreatedAt, n.UpdatedAt);
}
