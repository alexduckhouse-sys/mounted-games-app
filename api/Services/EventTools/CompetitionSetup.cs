using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.DecForms;

namespace MountedGames.Api.Services.EventTools;

/// <summary>
/// A competition's set-up and nothing else: sections, scoring settings, race lists, the timetable plan, hatbands, the dec
/// form setup and payment details. It holds no teams, heats, results, entries or payments, and no personal data. Duplicating
/// an event and saving a "starting point" both go through it, so they can never drift apart.
/// </summary>
public sealed record CompetitionSetup(
    string Icon, string? Location, double? Latitude, double? Longitude, string? Description,
    string? What3Words, string? AppleMapsUrl, string? TermsText, string? DecFormConfigJson,
    string? LaneHatbands, bool EnablePassportCheck, string? PaymentDestination,
    IReadOnlyList<CompetitionSetup.SectionSetup> Sections,
    IReadOnlyList<CompetitionSetup.SessionSetup> Sessions)
{
    public sealed record SectionSetup(
        SectionFormat Format, string AgeGroup, string DisplayName, string? RunoffRaceName, TieBreakRule TieBreakRule,
        int? FinalistCount, bool UsesRaceFinals, int PriceMinor, int? MaxParticipants,
        bool HasFinal = true, bool CarryPointsIntoFinal = true, bool DoublePointsInFinal = false);
    // The three final switches default as an older section behaved, so a starting point saved before they existed still reads right.

    /// <summary>A timetable block. <c>StartOffsetMinutes</c> is its start relative to the competition's start, so the plan moves with the new dates.</summary>
    public sealed record SessionSetup(
        int? SectionIndex, string Name, string? ArenaName, double? StartOffsetMinutes, int OrderIndex, string? Notes,
        bool IsBreak, int? DurationMinutes, SessionKind Kind, string? Location, int? LanesPerHeat, int? MinutesPerHeat,
        bool RaceOrderAlternating, LaneRotationMode LaneRotationMode, int? QualifiersPerHeat, string? PlannedRaces,
        IReadOnlyList<FinalHeatSetup>? FinalHeats = null);

    /// <summary>
    /// An empty lettered final ("A Final") of a finals session: its label, order, timing and race names, with no teams. Kept so
    /// "Populate from standings" still has heats to fill in the new event.
    /// </summary>
    public sealed record FinalHeatSetup(
        string Label, int OrderIndex, int? DurationMinutes, double? StartOffsetMinutes, IReadOnlyList<FinalRaceSetup> Races);

    public sealed record FinalRaceSetup(string Name, int OrderIndex);

    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public string ToJson() => JsonSerializer.Serialize(this, Json);

    public static CompetitionSetup? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            // A record read from JSON can come back with its lists missing; that is not a usable set-up.
            return JsonSerializer.Deserialize<CompetitionSetup>(json, Json) is { Sections: not null, Sessions: not null } setup ? setup : null;
        }
        catch (JsonException) { return null; }
    }

    /// <summary>Reads the set-up from a competition. Needs sections, and sessions with their heats and races, loaded.</summary>
    public static CompetitionSetup From(Competition source)
    {
        var sections = source.Sections.OrderBy(s => s.Id).ToList();
        var sessions = source.Sessions.OrderBy(s => s.OrderIndex).ThenBy(s => s.Id).Select(s =>
        {
            var index = s.CompetitionSectionId is { } sectionId ? sections.FindIndex(x => x.Id == sectionId) : -1;
            return new SessionSetup(
                index >= 0 ? index : null, s.Name, s.ArenaName,
                s.ScheduledStart.HasValue ? (s.ScheduledStart.Value - source.StartDate).TotalMinutes : null,
                s.OrderIndex, CleanNotes(s.Notes), s.IsBreak, s.DurationMinutes, s.Kind, s.Location, s.LanesPerHeat,
                s.MinutesPerHeat, s.RaceOrderAlternating, s.LaneRotationMode, s.QualifiersPerHeat, RaceList(s),
                FinalHeatsOf(s, source.StartDate));
        }).ToList();
        return new CompetitionSetup(
            source.Icon, source.Location, source.Latitude, source.Longitude, source.Description, source.What3Words,
            source.AppleMapsUrl, source.TermsText, source.DecFormConfigJson, source.LaneHatbands, source.EnablePassportCheck,
            source.PaymentDestination,
            sections.Select(s => new SectionSetup(s.Format, s.AgeGroup, s.DisplayName, s.RunoffRaceName, s.TieBreakRule,
                s.FinalistCount, s.UsesRaceFinals, s.PriceMinor, s.MaxParticipants,
                s.HasFinal, s.CarryPointsIntoFinal, s.DoublePointsInFinal)).ToList(),
            sessions);
    }

    static List<FinalHeatSetup>? FinalHeatsOf(Session session, DateTime eventStart)
    {
        var heats = session.Heats.Where(SectionScoringLabel).OrderBy(h => h.OrderIndex).ThenBy(h => h.Id)
            .Select(h => new FinalHeatSetup(h.Label ?? "", h.OrderIndex, h.DurationMinutes,
                h.ScheduledStart.HasValue ? (h.ScheduledStart.Value - eventStart).TotalMinutes : null,
                h.Races.OrderBy(r => r.OrderIndex).ThenBy(r => r.Id).Select(r => new FinalRaceSetup(r.Name, r.OrderIndex)).ToList()))
            .ToList();
        return heats.Count == 0 ? null : heats;
    }

    static bool SectionScoringLabel(Heat heat) => heat.RaceRoundStage == RaceRoundStage.None && FinalsTiers.ParseLabel(heat.Label) is not null;

    /// <summary>The races a session runs: the list chosen for it, or, for an older session, the races of its first heat.</summary>
    static string? RaceList(Session session)
    {
        if (!string.IsNullOrWhiteSpace(session.PlannedRaces)) return session.PlannedRaces;
        if (session.Kind != SessionKind.Race) return null;
        var first = session.Heats.OrderBy(h => h.OrderIndex).ThenBy(h => h.Id).FirstOrDefault(h => h.Races.Count > 0);
        return first is null ? null : PlannedRaceList.Write(first.Races.OrderBy(r => r.OrderIndex).Select(r => r.Name));
    }

    // [paused:…] and [shift:…] describe a live arena, not the plan.
    static string? CleanNotes(string? notes)
    {
        if (string.IsNullOrWhiteSpace(notes)) return null;
        var cleaned = Regex.Replace(notes, @"\s*\[(paused|shift):[^\]]*\]\s*", " ").Trim();
        return cleaned.Length == 0 ? null : cleaned;
    }
}

/// <summary>Builds and applies <see cref="CompetitionSetup"/>.</summary>
public sealed class CompetitionSetupService(AppDbContext db)
{
    public async Task<CompetitionSetup> ReadAsync(int competitionId, CancellationToken ct)
    {
        var source = await db.Competitions.AsNoTracking().AsSplitQuery()
            .Include(x => x.Sections)
            .Include(x => x.Sessions).ThenInclude(x => x.Heats).ThenInclude(x => x.Races)
            .SingleOrDefaultAsync(x => x.Id == competitionId, ct)
            ?? throw new EventToolsException("Competition not found.", 404);
        return CompetitionSetup.From(source);
    }

    /// <summary>Checks the name and dates every way of starting a competition from a set-up shares.</summary>
    public static void Validate(string? name, DateTime startDate, DateTime? endDate)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 200)
            throw new EventToolsException("Competition name is required and must be at most 200 characters.", 400);
        if (endDate.HasValue && endDate.Value < startDate)
            throw new EventToolsException("End date cannot be before start date.", 400);
    }

    /// <summary>Creates a new competition, owned by <paramref name="creatorUserId"/>, from a set-up. Returns the competition and its counts.</summary>
    public async Task<(Competition Competition, int Sections, int Sessions)> CreateAsync(
        CompetitionSetup setup, string name, DateTime startDate, DateTime? endDate, string creatorUserId, CancellationToken ct)
    {
        Validate(name, startDate, endDate);
        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            var creatorClubId = await db.Users.AsNoTracking().Where(u => u.Id == creatorUserId)
                .Select(u => u.ClubId).FirstOrDefaultAsync(ct);
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            var clone = new Competition
            {
                Name = name.Trim(),
                Icon = setup.Icon,
                Location = setup.Location,
                Latitude = setup.Latitude,
                Longitude = setup.Longitude,
                StartDate = startDate,
                EndDate = endDate,
                IsActive = true,
                IsArchived = false,
                Description = setup.Description,
                What3Words = setup.What3Words,
                AppleMapsUrl = setup.AppleMapsUrl,
                TermsText = setup.TermsText,
                DecFormConfigJson = PinPayoutClub(setup.DecFormConfigJson, creatorClubId),
                LaneHatbands = setup.LaneHatbands,
                EnablePassportCheck = setup.EnablePassportCheck,
                PaymentDestination = setup.PaymentDestination,
                CreatedByUserId = creatorUserId,
            };
            db.Competitions.Add(clone);
            await db.SaveChangesAsync(ct);

            var sections = new List<CompetitionSection>();
            foreach (var s in setup.Sections)
            {
                var section = new CompetitionSection
                {
                    CompetitionId = clone.Id, Format = s.Format, AgeGroup = s.AgeGroup, DisplayName = s.DisplayName,
                    RunoffRaceName = s.RunoffRaceName, TieBreakRule = s.TieBreakRule, FinalistCount = s.FinalistCount,
                    UsesRaceFinals = s.UsesRaceFinals, PriceMinor = s.PriceMinor, MaxParticipants = s.MaxParticipants,
                    HasFinal = s.HasFinal, CarryPointsIntoFinal = s.CarryPointsIntoFinal, DoublePointsInFinal = s.DoublePointsInFinal,
                };
                sections.Add(section);
                db.CompetitionSections.Add(section);
            }
            await db.SaveChangesAsync(ct);

            foreach (var s in setup.Sessions)
            {
                var session = new Session
                {
                    CompetitionId = clone.Id,
                    CompetitionSectionId = s.SectionIndex is { } i && i >= 0 && i < sections.Count ? sections[i].Id : null,
                    Name = s.Name, ArenaName = s.ArenaName,
                    ScheduledStart = s.StartOffsetMinutes.HasValue ? startDate.AddMinutes(s.StartOffsetMinutes.Value) : null,
                    Status = SessionStatus.Upcoming, OrderIndex = s.OrderIndex, Notes = s.Notes, IsBreak = s.IsBreak,
                    DurationMinutes = s.DurationMinutes, Kind = s.Kind, Location = s.Location, LanesPerHeat = s.LanesPerHeat,
                    MinutesPerHeat = s.MinutesPerHeat, RaceOrderAlternating = s.RaceOrderAlternating,
                    LaneRotationMode = s.LaneRotationMode, QualifiersPerHeat = s.QualifiersPerHeat, PlannedRaces = s.PlannedRaces,
                };
                foreach (var h in s.FinalHeats ?? [])
                {
                    var heat = new Heat
                    {
                        Label = h.Label, OrderIndex = h.OrderIndex, DurationMinutes = h.DurationMinutes,
                        ScheduledStart = h.StartOffsetMinutes.HasValue ? startDate.AddMinutes(h.StartOffsetMinutes.Value) : null,
                    };
                    foreach (var r in h.Races) heat.Races.Add(new Race { Name = r.Name, OrderIndex = r.OrderIndex });
                    session.Heats.Add(heat);
                }
                db.Sessions.Add(session);
            }
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return (clone, sections.Count, setup.Sessions.Count);
        });
    }

    // The payout club is pinned to whoever creates the competition, as for a new one: no club means none, never the source event's.
    static string? PinPayoutClub(string? json, int? creatorClubId)
    {
        if (DecFormConfig.Parse(json) is not { } config) return json;
        return (config with { PayoutClubId = creatorClubId }).ToJson();
    }
}
