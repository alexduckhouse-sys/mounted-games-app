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
    IReadOnlyList<string>? LaneHatbands = null,
    bool IsIndoor = false);

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

/// <summary>
/// A planned finals session. <see cref="Heats"/> lists the start times of the A, B, C... finals in that order; they are
/// added with their races and no teams, and Create finals fills them from the standings on the day, up to
/// <see cref="LanesPerFinal"/> teams each. Without heats the session stays empty and Create finals draws it.
/// </summary>
public sealed record CompetitionImportFinals(
    string Start, int? MinutesPerFinal = null, int? LanesPerFinal = null, IReadOnlyList<string>? Heats = null);

public sealed record CompetitionImportResult(
    int? CompetitionId, int Sections, int Sessions, int Heats, int Teams, int Riders, int Races, bool DryRun);

public sealed class CompetitionImportException(string message) : Exception(message);

/// <summary>
/// Adds one event from a <see cref="CompetitionImportFile"/>: sections, a heats session and a planned finals session
/// per age group, heats with their lanes and races, a team per pair with a dec form naming its riders. Nothing is
/// scored. Explicit command only (<c>--import-competition</c>); it refuses an event that already exists.
/// <see cref="AddFinalsAsync"/> (<c>--finals-only</c>) adds just the empty finals heats to an event imported earlier.
/// </summary>
public static class CompetitionFileImport
{
    public const string DefaultTimeZone = "Europe/London";
    public const string DefaultClub = "Unaffiliated";
    public const int DefaultMinutesPerHeat = 20;
    public const int DefaultMinutesPerFinal = 30;
    public const string MissingPartner = "partner TBC";
    private const int MaxFinals = 26;

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
        var (name, date, At) = Header(file);
        var hatbands = file.LaneHatbands?.Select(h => h?.Trim() ?? string.Empty).ToList();
        if (hatbands is not null && hatbands.Any(h => h.Length == 0)) throw new CompetitionImportException("A lane hatband is blank.");

        db.ChangeTracker.Clear();
        if (await SameEvent(db, name, date).AnyAsync())
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
            IsIndoor = file.IsIndoor,
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
                    // The name Create finals looks for when it reuses a planned session.
                    Name = FinalsName(section),
                    ArenaName = arena,
                    ScheduledStart = finalsStart,
                    LanesPerHeat = lanesPerHeat,
                    MinutesPerHeat = minutesPerFinal,
                    PlannedRaces = PlannedRaceList.Write(finalRaces),
                };
                var finalsEnd = AddFinalHeats(finalsSession, finals, finalsStart, minutesPerFinal, finalRaces, hatbands, ageGroup, At);
                heatCount += finalsSession.Heats.Count;
                raceCount += finalsSession.Heats.Count * finalRaces.Count;
                competition.Sessions.Add(finalsSession);
                sessions.Add((finalsSession, finalsEnd));
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

    /// <summary>
    /// Adds the file's empty finals heats to the event it imported earlier, into each age group's planned finals
    /// session. Refuses, changing nothing, if an age group already has finals heats.
    /// </summary>
    public static async Task<CompetitionImportResult> AddFinalsAsync(AppDbContext db, CompetitionImportFile file, bool dryRun = false)
    {
        var (name, date, At) = Header(file);
        var hatbands = file.LaneHatbands?.Select(h => h?.Trim() ?? string.Empty).ToList();
        db.ChangeTracker.Clear();
        var matches = await SameEvent(db, name, date)
            .Include(c => c.Sections)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats)
            .ToListAsync();
        var competition = matches.Count switch
        {
            0 => throw new CompetitionImportException($"There's no \"{name}\" on {date:yyyy-MM-dd}. Import the event first."),
            1 => matches[0],
            _ => throw new CompetitionImportException($"There's more than one \"{name}\" on {date:yyyy-MM-dd}. Nothing was changed."),
        };
        hatbands ??= PlannedRaceList.Read(competition.LaneHatbands)?.ToList();

        int sectionCount = 0, heatCount = 0, raceCount = 0;
        var lastEnd = DateTime.MinValue;
        foreach (var import in file.Sections)
        {
            if (import.Finals is not { Heats.Count: > 0 } finals) continue;
            var ageGroup = Required(import.AgeGroup, "A section's ageGroup");
            var section = competition.Sections.SingleOrDefault(s => string.Equals(s.AgeGroup, ageGroup.Trim(), StringComparison.OrdinalIgnoreCase))
                ?? throw new CompetitionImportException($"\"{name}\" has no {ageGroup} age group.");
            var raceSessions = competition.Sessions.Where(s => s.CompetitionSectionId == section.Id && s.Kind == SessionKind.Race).ToList();
            if (raceSessions.Any(s => s.Heats.Any(h => FinalsTiers.ParseLabel(h.Label) is not null)))
                throw new CompetitionImportException($"{ageGroup} already has finals heats. Nothing was changed.");
            var planned = raceSessions.Where(s => s.Heats.Count == 0 && s.Status == SessionStatus.Upcoming).ToList();
            if (planned.Count != 1)
                throw new CompetitionImportException($"{ageGroup} has {(planned.Count == 0 ? "no" : "more than one")} empty finals session. Nothing was changed.");
            var session = planned[0];

            var finalsStart = At(finals.Start, $"{ageGroup} finals");
            var minutesPerFinal = finals.MinutesPerFinal ?? session.MinutesPerHeat ?? DefaultMinutesPerFinal;
            if (minutesPerFinal < 1) throw new CompetitionImportException($"{ageGroup}: minutesPerFinal must be at least 1.");
            var finalRaces = import.FinalRaces is not null ? Races(import.FinalRaces, $"{ageGroup} finals")
                : PlannedRaceList.Read(session.PlannedRaces) is { Count: > 0 } plannedRaces ? plannedRaces.ToList()
                : Races(import.HeatRaces, $"{ageGroup} finals");
            session.Name = FinalsName(section);
            session.ScheduledStart = finalsStart;
            session.MinutesPerHeat = minutesPerFinal;
            session.PlannedRaces = PlannedRaceList.Write(finalRaces);
            var end = AddFinalHeats(session, finals, finalsStart, minutesPerFinal, finalRaces, hatbands is { Count: > 0 } ? hatbands : null, ageGroup, At);
            if (end > lastEnd) lastEnd = end;
            sectionCount++;
            heatCount += session.Heats.Count;
            raceCount += session.Heats.Count * finalRaces.Count;
        }
        if (sectionCount == 0) throw new CompetitionImportException("The file lists no finals heats to add.");
        if (competition.EndDate < lastEnd) throw new CompetitionImportException("The last final ends after the event does. Nothing was changed.");

        var result = new CompetitionImportResult(competition.Id, sectionCount, sectionCount, heatCount, 0, 0, raceCount, dryRun);
        if (dryRun)
        {
            db.ChangeTracker.Clear();
            return result;
        }
        await db.SaveChangesAsync();
        return result;
    }

    /// <summary>
    /// The lettered finals, A first as on the scoresheet, each with the final races and no teams. A final runs for
    /// minutesPerFinal, or up to the next final's start if that comes sooner. Returns when the last one ends.
    /// </summary>
    private static DateTime AddFinalHeats(Session session, CompetitionImportFinals finals, DateTime finalsStart, int minutesPerFinal,
        List<string> races, List<string>? hatbands, string ageGroup, Func<string?, string, DateTime> at)
    {
        var end = finalsStart.AddMinutes(minutesPerFinal);
        if (finals.LanesPerFinal is { } lanes)
        {
            if (lanes < 1) throw new CompetitionImportException($"{ageGroup}: lanesPerFinal must be at least 1.");
            if (hatbands is not null && lanes > hatbands.Count)
                throw new CompetitionImportException($"{ageGroup}: lanesPerFinal is more than there are hatbands.");
            session.LanesPerHeat = lanes;
        }
        var starts = finals.Heats ?? [];
        if (starts.Count > MaxFinals) throw new CompetitionImportException($"{ageGroup} has more than {MaxFinals} finals.");
        var times = starts.Select((t, i) => at(t, $"{ageGroup} {(char)('A' + i)} Final")).ToList();
        for (var i = 0; i < times.Count; i++)
        {
            var label = $"{(char)('A' + i)} Final";
            if (times[i] < (i == 0 ? finalsStart : times[i - 1]))
                throw new CompetitionImportException($"{ageGroup} {label} starts before {(i == 0 ? "the finals session" : "the final before it")}.");
            var minutes = i + 1 < times.Count ? Math.Min(minutesPerFinal, (int)(times[i + 1] - times[i]).TotalMinutes) : minutesPerFinal;
            var heat = new Heat
            {
                Session = session,
                Label = label,
                OrderIndex = i + 1,
                DurationMinutes = Math.Max(1, minutes),
                ScheduledStart = times[i],
            };
            for (var r = 0; r < races.Count; r++)
                heat.Races.Add(new Race { Heat = heat, Name = races[r], OrderIndex = r + 1 });
            session.Heats.Add(heat);
            end = times[i].AddMinutes(heat.DurationMinutes.Value);
        }
        return end;
    }

    private static string FinalsName(CompetitionSection section) => $"Finals · {section.DisplayName}";

    private static (string Name, DateOnly Date, Func<string?, string, DateTime> At) Header(CompetitionImportFile file)
    {
        var name = Required(file.Name, "name");
        if (!DateOnly.TryParseExact(file.Date?.Trim(), "yyyy-MM-dd", out var date))
            throw new CompetitionImportException("date must be written yyyy-MM-dd.");
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(string.IsNullOrWhiteSpace(file.TimeZone) ? DefaultTimeZone : file.TimeZone.Trim()); }
        catch (TimeZoneNotFoundException) { throw new CompetitionImportException($"Unknown time zone \"{file.TimeZone}\"."); }
        if (file.Sections is not { Count: > 0 }) throw new CompetitionImportException("The event has no sections.");
        return (name, date, (time, what) =>
        {
            if (!TimeOnly.TryParseExact(time?.Trim(), "HH:mm", out var t))
                throw new CompetitionImportException($"{what}: time must be written HH:mm (24-hour).");
            return TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(t, DateTimeKind.Unspecified), zone);
        });
    }

    private static IQueryable<Competition> SameEvent(AppDbContext db, string name, DateOnly date)
    {
        var start = DateTime.SpecifyKind(date.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);
        return db.Competitions.Where(c => c.Name == name && c.StartDate >= start.AddDays(-1) && c.StartDate < start.AddDays(2));
    }

    private static Team NewTeam(Competition competition, CompetitionSection section, Club club, List<string> riders, int ridersPerTeam)
    {
        // Named the way a find-a-pair match names a pair: "Rider & Rider".
        var formatted = riders.Select(r => RiderNames.Display(r, DecForms.DecFormRules.HasSingleLetterSurnameInitial(r), viewerSeesFullNames: false));
        var names = riders.Count < ridersPerTeam ? formatted.Append(MissingPartner) : formatted;
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
            form.Riders.Add(new RiderEntry { DeclarationForm = form, FullName = riders[i], UseInitialOnly = DecForms.DecFormRules.HasSingleLetterSurnameInitial(riders[i]), IsCaptain = i == 0, OrderIndex = i });
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
