using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

public static class Mappings
{
    public static ClubDto ToDto(this Club c) => new(c.Id, c.Name, c.Region, c.BibColour);

    public static CompetitionSummary ToSummary(this Competition c) => new(
        c.Id, c.Name, c.Location, c.StartDate, c.EndDate,
        c.IsActive, c.IsArchived,
        c.Sections?.Count ?? 0,
        c.Teams?.Count ?? 0,
        c.Sessions?.Count ?? 0);

    public static CompetitionSectionDto ToDto(this CompetitionSection s) =>
        new(s.Id, s.CompetitionId, s.Format, s.AgeGroup, s.DisplayName,
            s.RunoffRaceName, s.UsesRaceFinals, s.PriceMinor);

    public static SectionSignupDto ToDto(this SectionSignup s) => new(
        s.Id, s.CompetitionSectionId,
        s.Section?.DisplayName ?? string.Empty,
        s.FullName, s.PonyClubName, s.ContactInfo,
        s.AmountMinor, s.Status, s.PaidAt, s.TeamId, s.CreatedAt);

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
        t.IsHorsConcours);

    /// <summary>
    /// Same as ToDto but populates the viewer-specific Relationship and
    /// SupporterJoinKey fields used by the my-teams endpoint.
    /// </summary>
    public static TeamDto ToDtoFor(this Team t, string? viewerUserId)
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
            Relationship: isTrainer ? "trainer" : isSupporter ? "supporter" : null,
            SupporterJoinKey: isTrainer ? t.SupporterJoinKey : null);
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
        he.Team?.BibColour,
        he.LaneIndex);

    public static ResultDto ToDto(this Result r) => new(
        r.Id, r.TeamId,
        r.Team?.DisplayName ?? string.Empty,
        r.Placing, r.Eliminated, r.Points);

    public static RaceDto ToDto(this Race r) => new(
        r.Id, r.HeatId, r.Name, r.OrderIndex, r.IsComplete,
        r.StartedAt, r.FinishedAt,
        r.Results.OrderBy(x => x.Placing ?? int.MaxValue).Select(x => x.ToDto()).ToList());

    public static HeatDto ToDto(this Heat h) => new(
        h.Id, h.SessionId, h.Label, h.OrderIndex,
        h.DurationMinutes, h.ScheduledStart, h.StartedAt, h.FinishedAt,
        h.RaceRoundId, h.RaceRoundStage,
        h.Entries.OrderBy(e => e.LaneIndex).Select(e => e.ToDto()).ToList(),
        h.Races.OrderBy(r => r.OrderIndex).Select(r => r.ToDto()).ToList());

    public static SessionDto ToDto(this Session s) => new(
        s.Id, s.CompetitionId, s.CompetitionSectionId, s.Section?.DisplayName,
        s.Name, s.ArenaName, s.ScheduledStart, s.StartedAt, s.FinishedAt,
        s.Status, s.OrderIndex, s.Notes,
        s.IsBreak, s.DurationMinutes,
        s.Kind, s.Location,
        s.StreamUrl, s.LanesPerHeat,
        s.MinutesPerHeat, s.RaceOrderAlternating,
        s.Heats.OrderBy(h => h.OrderIndex).Select(h => h.ToDto()).ToList());

    public static RiderEntryDto ToDto(this RiderEntry r) => new(
        r.Id, r.SavedRiderId, r.FullName, r.DateOfBirth, r.HorseName, r.BibColour,
        r.IsCaptain, r.IsReserve, r.OrderIndex);

    public static DeclarationFormDto ToDto(this DeclarationForm d) => new(
        d.Id, d.TeamId,
        d.Team?.DisplayName ?? string.Empty,
        d.Team?.CompetitionId ?? 0,
        d.Team?.Competition?.Name ?? string.Empty,
        d.SubmittedByUserId, d.SubmittedBy?.FullName, d.SubmittedBy?.PhoneNumber,
        d.SubmittedAt, d.Notes, d.IsLocked,
        d.Riders.OrderBy(r => r.OrderIndex).Select(r => r.ToDto()).ToList());

    public static SavedRiderDto ToDto(this SavedRider r) =>
        new(r.Id, r.ClubId, r.FullName, r.DateOfBirth, r.HorseName, r.Notes);

    public static ChatMessageDto ToDto(this ChatMessage m) => new(
        m.Id, m.CompetitionId, m.UserId, m.AuthorName, m.Body, m.Type, m.Tag, m.CreatedAt);

    public static TrainerNoteDto ToDto(this TrainerNote n) =>
        new(n.Id, n.UserId, n.Title, n.Body, n.CreatedAt, n.UpdatedAt);

    public static StewardCallDto ToDto(this StewardCall c) => new(
        c.Id, c.RaceId,
        c.Race?.HeatId ?? 0,
        c.Race?.Heat?.Session?.CompetitionId ?? 0,
        c.TeamId,
        c.Team?.DisplayName ?? string.Empty,
        c.Team?.BibColour,
        c.LaneIndex, c.ReporterName, c.CreatedAt);
}
