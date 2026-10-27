using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.EventTools;

/// <summary>
/// A real event read from a JSON file the organiser keeps outside the repo (riders are children, so their names
/// never go in source control). Times are local clock times on <see cref="Date"/> in <see cref="TimeZone"/>.
/// </summary>
public sealed record CompetitionImportFile(
    string Name,
    string Date,
    IReadOnlyList<CompetitionImportSection> Sections,
    string? OwnerEmail = null,
    string? TimeZone = null,
    string? EndTime = null,
    string? Location = null,
    string? Icon = null,
    string? Description = null,
    string? OrganiserName = null,
    string? ClubName = null,
    string? ArenaName = null,
    IReadOnlyList<string>? LaneHatbands = null);

/// <summary>An age group. <see cref="Format"/> is "Pairs" (default) or "Individual".</summary>
public sealed record CompetitionImportSection(
    string AgeGroup,
    IReadOnlyList<string> HeatRaces,
    IReadOnlyList<CompetitionImportHeat> Heats,
    string? Format = null,
    bool HasFinal = true,
    bool CarryPointsIntoFinal = false,
    int? MinutesPerHeat = null,
    IReadOnlyList<string>? FinalRaces = null,
    CompetitionImportFinals? Finals = null);

/// <summary>
/// One heat. <see cref="Lanes"/> holds each lane's riders in lane order (lane 1 first); null leaves a lane empty.
/// A pair with one rider is entered as "Name & partner TBC".
/// </summary>
public sealed record CompetitionImportHeat(string Start, IReadOnlyList<IReadOnlyList<string>?> Lanes, string? Label = null);

/// <summary>A planned finals session. Its heats are drawn on the day from the standings (Create finals).</summary>
public sealed record CompetitionImportFinals(string Start, int? MinutesPerFinal = null);

public sealed record CompetitionImportResult(
    int? CompetitionId, int Sections, int Sessions, int Heats, int Teams, int Riders, int Races, bool DryRun);

public sealed class CompetitionImportException(string message) : Exception(message);

/// <summary>
/// Adds one event from a <see cref="CompetitionImportFile"/>: sections, a heats session and a planned finals session
/// per age group, heats with their lanes and races, a team per pair with a dec form naming its riders. Nothing is
/// scored. Explicit command only (<c>--import-competition</c>); it refuses an event that already exists.
/// </summary>
public static class CompetitionFileImport
{
    public const string DefaultTimeZone = "Europe/London";
    public const string DefaultClub = "Unaffiliated";
    public const int DefaultMinutesPerHeat = 20;
    public const int DefaultMinutesPerFinal = 30;
    public const string MissingPartner = "partner TBC";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    public static CompetitionImportFile Parse(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<CompetitionImportFile>(json, Json)
                ?? throw new CompetitionImportException("The file is empty.");
        }
        catch (JsonException ex)
        {
            throw new CompetitionImportException($"The file is not valid event JSON: {ex.Message}");
        }
    }

    public static async Task<CompetitionImportResult> ImportAsync(AppDbContext db, CompetitionImportFile file, bool dryRun = false)
    {
        var name = Required(file.Name, "name");
        if (!DateOnly.TryParseExact(file.Date?.Trim(), "yyyy-MM-dd", out var date))
            throw new CompetitionImportException("date must be written yyyy-MM-dd.");
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(string.IsNullOrWhiteSpace(file.TimeZone) ? DefaultTimeZone : file.TimeZone.Trim()); }
        catch (TimeZoneNotFoundException) { throw new CompetitionImportException($"Unknown time zone \"{file.TimeZone}\"."); }
        DateTime At(string? time, string what)
        {
            if (!TimeOnly.TryParseExact(time?.Trim(), "HH:mm", out var t))
                throw new CompetitionImportException($"{what}: time must be written HH:mm (24-hour).");
            return TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(t, DateTimeKind.Unspecified), zone);
        }

        if (file.Sections is not { Count: > 0 }) throw new CompetitionImportException("The event has no sections.");
        var hatbands = file.LaneHatbands?.Select(h => h?.Trim() ?? string.Empty).ToList();
        if (hatbands is not null && hatbands.Any(h => h.Length == 0)) throw new CompetitionImportException("A lane hatband is blank.");

        db.ChangeTracker.Clear();
        var start = DateTime.SpecifyKind(date.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);
        if (await db.Competitions.AnyAsync(c => c.Name == name && c.StartDate >= start.AddDays(-1) && c.StartDate < start.AddDays(2)))
            throw new CompetitionImportException($"\"{name}\" on {date:yyyy-MM-dd} already exists. Nothing was changed.");

        string? ownerId = null;
        if (!string.IsNullOrWhiteSpace(file.OwnerEmail))
        {
            var normalised = file.OwnerEmail.Trim().ToUpperInvariant();
            ownerId = await db.Users.Where(u => u.NormalizedEmail == normalised).Select(u => u.Id).FirstOrDefaultAsync()
                ?? throw new CompetitionImportException($"No account uses {file.OwnerEmail.Trim()}. Sign up first, then run the import again.");
            // The day-of tools (scoring, finals, timetable) let an owner in only as an Admin or Trainer.
            string[] organiser = [Roles.Admin, Roles.Trainer];
            if (!await db.UserRoles.AnyAsync(ur => ur.UserId == ownerId
                    && db.Roles.Any(r => r.Id == ur.RoleId && organiser.Contains(r.Name!))))
                throw new CompetitionImportException($"{file.OwnerEmail.Trim()} is not an admin or approved trainer, so they couldn't run the event. Approve them first.");
        }

        var clubName = string.IsNullOrWhiteSpace(file.ClubName) ? DefaultClub : file.ClubName.Trim();
        var club = await db.Clubs.FirstOrDefaultAsync(c => c.Name.ToLower() == clubName.ToLower()) ?? new Club { Name = clubName };
        var arena = string.IsNullOrWhiteSpace(file.ArenaName) ? null : file.ArenaName.Trim();

        var competition = new Competition
        {
            Name = name,
            Icon = string.IsNullOrWhiteSpace(file.Icon) ? "flag" : file.Icon.Trim(),
            Location = Optional(file.Location),
            Description = Optional(file.Description),
            OrganiserName = Optional(file.OrganiserName),
            LaneHatbands = hatbands is null ? null : PlannedRaceList.Write(hatbands),
            CreatedByUserId = ownerId,
            // The entries are already known, so the public sign-up stays shut.
            SignupsLocked = true,
            IsActive = true,
        };

        var sessions = new List<(Session Session, DateTime End)>();
        int heatCount = 0, raceCount = 0, riderCount = 0;
        foreach (var import in file.Sections)
        {
            var ageGroup = Required(import.AgeGroup, "A section's ageGroup");
            var format = (import.Format?.Trim().ToLowerInvariant()) switch
            {
                null or "" or "pairs" => SectionFormat.Pairs,
                "individual" or "individuals" => SectionFormat.Individual,
                _ => throw new CompetitionImportException($"{ageGroup}: format must be Pairs or Individual."),
            };
            var ridersPerTeam = format == SectionFormat.Pairs ? 2 : 1;
            var heatRaces = Races(import.HeatRaces, $"{ageGroup} heats");
            if (import.Heats is not { Count: > 0 }) throw new CompetitionImportException($"{ageGroup} has no heats.");
            var minutesPerHeat = import.MinutesPerHeat ?? DefaultMinutesPerHeat;
            if (minutesPerHeat < 1) throw new CompetitionImportException($"{ageGroup}: minutesPerHeat must be at least 1.");

            var section = new CompetitionSection
            {
                Competition = competition,
                Format = format,
                AgeGroup = ageGroup,
                DisplayName = SectionNaming.DisplayName(format, ageGroup),
                HasFinal = import.HasFinal,
                CarryPointsIntoFinal = import.HasFinal && import.CarryPointsIntoFinal,
            };
            competition.Sections.Add(section);

            var lanesPerHeat = Math.Max(hatbands?.Count ?? 0, import.Heats.Max(h => h.Lanes?.Count ?? 0));
            var heatsSession = new Session
            {
                Competition = competition,
                Section = section,
                Name = $"{section.DisplayName} heats",
                ArenaName = arena,
                LanesPerHeat = lanesPerHeat,
                MinutesPerHeat = minutesPerHeat,
                PlannedRaces = PlannedRaceList.Write(heatRaces),
            };
            // The same riders in a later heat are the same team.
            var teams = new Dictionary<string, Team>(StringComparer.OrdinalIgnoreCase);
            var heatEnd = DateTime.MinValue;
            for (var h = 0; h < import.Heats.Count; h++)
            {
                var heatImport = import.Heats[h];
                var label = string.IsNullOrWhiteSpace(heatImport.Label) ? $"Heat {h + 1}" : heatImport.Label.Trim();
                var heatStart = At(heatImport.Start, $"{ageGroup} {label}");
                if (hatbands is not null && (heatImport.Lanes?.Count ?? 0) > hatbands.Count)
                    throw new CompetitionImportException($"{ageGroup} {label} has more lanes than there are hatbands.");
                var heat = new Heat
                {
                    Session = heatsSession,
                    Label = label,
                    OrderIndex = h + 1,
                    DurationMinutes = minutesPerHeat,
                    ScheduledStart = heatStart,
                };
                for (var lane = 0; lane < (heatImport.Lanes?.Count ?? 0); lane++)
                {
                    var riders = heatImport.Lanes![lane]?.Select(r => r?.Trim() ?? string.Empty).Where(r => r.Length > 0).ToList();
                    if (riders is not { Count: > 0 }) continue;
                    if (riders.Count > ridersPerTeam)
                        throw new CompetitionImportException($"{ageGroup} {label} lane {lane + 1} has {riders.Count} riders; a {section.DisplayName} entry has at most {ridersPerTeam}.");
                    var key = string.Join("|", riders.Order(StringComparer.OrdinalIgnoreCase));
                    if (!teams.TryGetValue(key, out var team))
                    {
                        team = NewTeam(competition, section, club, riders, ridersPerTeam);
                        teams[key] = team;
                        riderCount += riders.Count;
                    }
                    else if (heat.Entries.Any(e => e.Team == team))
                        throw new CompetitionImportException($"{ageGroup} {label}: {team.DisplayName} is in two lanes.");
                    heat.Entries.Add(new HeatEntry { Heat = heat, Team = team, LaneIndex = lane + 1 });
                }
                if (heat.Entries.Count == 0) throw new CompetitionImportException($"{ageGroup} {label} has nobody in it.");
                for (var r = 0; r < heatRaces.Count; r++)
                    heat.Races.Add(new Race { Heat = heat, Name = heatRaces[r], OrderIndex = r + 1 });
                raceCount += heatRaces.Count;
                heatsSession.Heats.Add(heat);
                var end = heatStart.AddMinutes(minutesPerHeat);
                if (end > heatEnd) heatEnd = end;
            }
            heatCount += heatsSession.Heats.Count;
            heatsSession.ScheduledStart = heatsSession.Heats.Min(x => x.ScheduledStart);
            competition.Sessions.Add(heatsSession);
            sessions.Add((heatsSession, heatEnd));

            if (import.Finals is { } finals)
            {
                if (!import.HasFinal) throw new CompetitionImportException($"{ageGroup} has finals but hasFinal is false.");
                var finalsStart = At(finals.Start, $"{ageGroup} finals");
                var minutesPerFinal = finals.MinutesPerFinal ?? DefaultMinutesPerFinal;
                if (minutesPerFinal < 1) throw new CompetitionImportException($"{ageGroup}: minutesPerFinal must be at least 1.");
                var finalRaces = import.FinalRaces is null ? heatRaces : Races(import.FinalRaces, $"{ageGroup} finals");
                var finalsSession = new Session
                {
                    Competition = competition,
                    Section = section,
                    Name = $"{section.DisplayName} finals",
                    ArenaName = arena,
                    ScheduledStart = finalsStart,
                    LanesPerHeat = lanesPerHeat,
                    MinutesPerHeat = minutesPerFinal,
                    PlannedRaces = PlannedRaceList.Write(finalRaces),
                };
                competition.Sessions.Add(finalsSession);
                // How many finals there will be isn't known until the draw; one slot is the least it takes.
                sessions.Add((finalsSession, finalsStart.AddMinutes(minutesPerFinal)));
            }
        }

        var order = 0;
        foreach (var (session, _) in sessions.OrderBy(x => x.Session.ScheduledStart).ThenBy(x => x.Session.Name, StringComparer.Ordinal))
            session.OrderIndex = ++order;
        competition.StartDate = sessions.Min(x => x.Session.ScheduledStart!.Value);
        var lastEnd = sessions.Max(x => x.End);
        competition.EndDate = string.IsNullOrWhiteSpace(file.EndTime) ? lastEnd : At(file.EndTime, "endTime");
        if (competition.EndDate < lastEnd) throw new CompetitionImportException("endTime is before the last session ends.");

        var result = new CompetitionImportResult(
            null, competition.Sections.Count, competition.Sessions.Count, heatCount, competition.Teams.Count, riderCount, raceCount, dryRun);
        if (dryRun)
        {
            db.ChangeTracker.Clear();
            return result;
        }
        db.Competitions.Add(competition);
        await db.SaveChangesAsync();
        return result with { CompetitionId = competition.Id };
    }

    private static Team NewTeam(Competition competition, CompetitionSection section, Club club, List<string> riders, int ridersPerTeam)
    {
        // Named the way a find-a-pair match names a pair: "Rider & Rider".
        var names = riders.Count < ridersPerTeam ? riders.Append(MissingPartner) : riders;
        var team = new Team
        {
            Competition = competition,
            Section = section,
            Club = club,
            DisplayName = string.Join(" & ", names),
            BibColour = club.BibColour,
        };
        var form = new DeclarationForm { Team = team };
        for (var i = 0; i < riders.Count; i++)
            form.Riders.Add(new RiderEntry { DeclarationForm = form, FullName = riders[i], IsCaptain = i == 0, OrderIndex = i });
        team.DeclarationForms.Add(form);
        competition.Teams.Add(team);
        section.Teams.Add(team);
        return team;
    }

    private static List<string> Races(IReadOnlyList<string>? races, string what)
    {
        var list = (races ?? []).Select(r => r?.Trim() ?? string.Empty).Where(r => r.Length > 0).ToList();
        if (list.Count == 0) throw new CompetitionImportException($"{what} have no races.");
        if (list.Count > PlannedRaceList.MaxRaces) throw new CompetitionImportException($"{what} have more than {PlannedRaceList.MaxRaces} races.");
        return list;
    }

    private static string Required(string? value, string what)
        => string.IsNullOrWhiteSpace(value) ? throw new CompetitionImportException($"{what} is missing.") : value.Trim();

    private static string? Optional(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
