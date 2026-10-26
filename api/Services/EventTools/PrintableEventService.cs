using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.EventTools;

public sealed class PrintableEventService(AppDbContext db)
{
    public async Task<PrintableDrawDto?> DrawAsync(int competitionId, CancellationToken ct)
    {
        var competition = await LoadAsync(competitionId, ct);
        if (competition is null) return null;
        var timings = Calendar.TimetableTimes.Compute(competition.Sessions);
        var sessions = competition.Sessions.Where(IsRace)
            .OrderBy(x => x.OrderIndex).ThenBy(x => x.Id)
            .Select(x => new PrintableSessionDto(
                x.Id, x.Section?.DisplayName ?? string.Empty, x.Name, x.ArenaName, x.OrderIndex,
                OrderedHeats(x).Select(h => new PrintableHeatDto(
                    h.Id, h.Label ?? $"Heat {h.OrderIndex}", HeatStart(x, h, timings),
                    h.Entries.OrderBy(e => e.LaneIndex).Select(e => new PrintableTeamDto(
                        e.TeamId, e.Team!.DisplayName, e.Team.Club!.Name, e.Team.Suffix, e.LaneIndex)).ToArray(),
                    h.Races.OrderBy(r => r.OrderIndex).Select(r => new PrintableRaceDto(r.Id, r.Name, r.OrderIndex)).ToArray())).ToArray()))
            .ToArray();
        return new PrintableDrawDto(ToCompetition(competition), sessions);
    }

    public async Task<PrintableScoreSheetsDto?> ScoreSheetsAsync(int competitionId, CancellationToken ct)
    {
        var competition = await LoadAsync(competitionId, ct);
        if (competition is null) return null;
        var timings = Calendar.TimetableTimes.Compute(competition.Sessions);
        var heats = BuildScoreHeats(competition.Sessions.Where(IsRace), timings);
        return new PrintableScoreSheetsDto(ToCompetition(competition), heats);
    }

    public async Task<PrintableResultsDto?> ResultsAsync(int competitionId, CancellationToken ct, int? sessionId = null)
    {
        var competition = await LoadAsync(competitionId, ct);
        if (competition is null) return null;
        var raceSessions = competition.Sessions.Where(IsRace).OrderBy(x => x.OrderIndex).ThenBy(x => x.Id).ToArray();
        var selectedSession = sessionId.HasValue ? raceSessions.FirstOrDefault(s => s.Id == sessionId.Value) : null;
        var tiers = FinalsTiers.From(competition.Sessions);
        var ties = await TieBreaker.LoadAsync(db, competitionId, ct);
        var bonus = await TackCheck.TackCheckBonus.ForCompetitionAsync(db, competitionId, ct);
        var relevantSections = selectedSession?.CompetitionSectionId is { } targetSectionId
            ? competition.Sections.Where(s => s.Id == targetSectionId)
            : competition.Sections;
        var sections = relevantSections.OrderBy(x => x.DisplayName).Select(section =>
        {
            var rawRows = section.Teams.Where(x => !x.IsHorsConcours).Select(team =>
            {
                var rawResults = team.Results
                    .Where(x => x.Race?.Heat?.Session is { } s ? IsRace(s) : true)
                    .ToArray();
                var results = ties.EffectiveResults(rawResults);
                var finalResults = results.Where(x => x.Race?.Heat is { } heat && SectionScoring.IsFinalHeat(heat)).ToList();
                var finalPoints = finalResults.Sum(x => x.Points);
                var inFinal = tiers.TierOf(team.Id) is not null;
                var total = SectionScoring.Total(section, inFinal,
                    results.Sum(x => x.Points) - finalPoints, finalPoints, bonus.GetValueOrDefault(team.Id));
                var alone = inFinal && !SectionScoring.CarriesIntoFinal(section);
                var facts = ties.Facts(team.Id, section.Id, alone ? finalResults : results, total);
                return new
                {
                    Team = team,
                    Tier = tiers.SortKey(team.Id),
                    Total = total,
                    Bonus = bonus.GetValueOrDefault(team.Id),
                    Run = rawResults.Count(x => !x.IsSitOut),
                    Wins = results.Count(x => !x.IsSitOut && x.Placing == 1 && !x.Eliminated),
                    Eliminations = rawResults.Count(x => x.Eliminated && ResultStatuses.Of(x) == ResultStatus.Eliminated),
                    Facts = facts,
                };
            }).ToList();

            var rows = rawRows
                .GroupBy(x => (x.Tier, x.Total))
                .OrderBy(g => g.Key.Tier)
                .ThenByDescending(g => g.Key.Total)
                .SelectMany(g =>
                {
                    var byTeam = g.ToDictionary(x => x.Team.Id);
                    return ties.OrderLevel(g.Select(x => x.Facts).ToList()).Select(f => byTeam[f.TeamId]);
                })
                .ToList();

            (int Tier, double Total)? previous = null;
            var rank = 0;
            var result = new List<PrintableResultRowDto>();
            for (var i = 0; i < rows.Count; i++)
            {
                var key = (rows[i].Tier, rows[i].Total);
                if (previous != key)
                {
                    rank = i + 1;
                }
                else if (i > 0)
                {
                    var levelGroup = rows.Where(r => (r.Tier, r.Total) == key).Select(r => r.Facts).ToList();
                    if (!ties.AreLevel(levelGroup, rows[i - 1].Facts, rows[i].Facts))
                        rank = i + 1;
                }
                previous = key;
                result.Add(new PrintableResultRowDto(rank, rows[i].Team.Id, rows[i].Team.DisplayName,
                    rows[i].Team.Club?.Name ?? string.Empty, rows[i].Total, rows[i].Run, rows[i].Wins, rows[i].Eliminations, rows[i].Bonus));
            }
            return new PrintableSectionResultsDto(section.Id, section.DisplayName, result);
        }).ToArray();
        var timings = Calendar.TimetableTimes.Compute(competition.Sessions);
        var filteredSessions = selectedSession is not null ? [selectedSession] : raceSessions;
        var heats = BuildScoreHeats(filteredSessions, timings);
        var sessionSummaries = raceSessions.Select(s =>
        {
            var totalHeats = s.Heats.Count;
            var completedHeats = s.Heats.Count(h => h.Races.Count > 0 && h.Races.All(r => r.IsComplete || r.Results.Count > 0));
            var isCompleted = totalHeats > 0 && completedHeats == totalHeats;
            return new PrintableSessionSummaryDto(
                s.Id,
                s.Name,
                s.Section?.DisplayName ?? string.Empty,
                s.OrderIndex,
                totalHeats,
                completedHeats,
                isCompleted);
        }).ToArray();
        var races = filteredSessions.SelectMany(x => x.Heats).SelectMany(x => x.Races).ToArray();
        var provisional = races.Length == 0 || races.Any(x => !x.IsComplete);
        return new PrintableResultsDto(ToCompetition(competition), provisional, sections, heats, sessionSummaries);
    }

    private static PrintableScoreHeatDto[] BuildScoreHeats(
        IEnumerable<Session> sessions,
        IReadOnlyDictionary<int, Calendar.HeatTime>? timings = null)
        => sessions
            .OrderBy(x => x.OrderIndex).ThenBy(x => x.Id)
            .SelectMany(x => OrderedHeats(x).Select(h => new { Session = x, Heat = h }))
            .Select(x => new PrintableScoreHeatDto(
                x.Heat.Id, x.Heat.Label ?? $"Heat {x.Heat.OrderIndex}", x.Session.Section?.DisplayName ?? string.Empty,
                x.Session.Name, HeatStart(x.Session, x.Heat, timings),
                x.Heat.Races.OrderBy(r => r.OrderIndex).Select(r => new PrintableScoreRaceDto(
                    r.Id, r.Name,
                    x.Heat.Entries.OrderBy(e => e.LaneIndex).Select(e =>
                    {
                        var result = r.Results.SingleOrDefault(y => y.TeamId == e.TeamId);
                        return new PrintableScoreCellDto(e.TeamId, e.Team!.DisplayName, result?.Placing, result?.Eliminated ?? false, result?.Points,
                            e.LaneIndex, !string.IsNullOrWhiteSpace(e.BibColourOverride) ? e.BibColourOverride : (e.Team.BibDescription ?? e.Team.BibColour), result?.IsSitOut ?? false,
                            result is null ? ResultStatus.Finished : ResultStatuses.Of(result));
                    }).ToArray())).ToArray(),
                x.Session.Id))
            .ToArray();

    /// <summary>
    /// Every team of every section with its declared riders and ponies, so the organiser can check the entries
    /// before the event. Staff only: it shows riders' full names.
    /// </summary>
    public async Task<PrintableEntriesDto?> EntriesAsync(int competitionId, CancellationToken ct)
    {
        var competition = await db.Competitions.AsNoTracking().AsSplitQuery()
            .Include(x => x.Sections).ThenInclude(x => x.Teams).ThenInclude(x => x.Club)
            .Include(x => x.Sections).ThenInclude(x => x.Teams).ThenInclude(x => x.DeclarationForms).ThenInclude(x => x.Riders)
            .SingleOrDefaultAsync(x => x.Id == competitionId, ct);
        if (competition is null) return null;
        var sections = competition.Sections.OrderBy(x => x.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Id)
            .Select(section => new PrintableEntriesSectionDto(section.Id, section.DisplayName,
                section.Teams.OrderBy(t => t.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(t => t.Id).Select(team =>
                {
                    var form = team.DeclarationForms.OrderByDescending(f => f.SubmittedAt).ThenByDescending(f => f.Id).FirstOrDefault();
                    var riders = (form?.Riders ?? []).OrderBy(r => r.IsReserve).ThenBy(r => r.OrderIndex).ThenBy(r => r.Id)
                        .Select(r => new PrintableEntryRiderDto(r.FullName, string.IsNullOrWhiteSpace(r.HorseName) ? null : r.HorseName.Trim(),
                            r.IsCaptain, r.IsReserve, r.IsGuestRider)).ToArray();
                    return new PrintableEntryTeamDto(team.Id, team.DisplayName, team.Club?.Name ?? string.Empty,
                        team.BibDescription ?? team.BibColour, team.EntryStatus != TeamEntryStatus.Active, team.IsHorsConcours, riders);
                }).ToArray())).ToArray();
        return new PrintableEntriesDto(ToCompetition(competition), sections);
    }

    /// <summary>Only race sessions have a draw and score sheets; breaks, briefings and custom items don't.</summary>
    private static bool IsRace(Session s) => s.Kind == SessionKind.Race && !s.IsBreak;

    private static IEnumerable<Heat> OrderedHeats(Session s) => s.Heats.OrderBy(h => h.OrderIndex).ThenBy(h => h.Id);

    /// <summary>
    /// When a heat starts: its own time if one was set, otherwise the session's start plus the length of
    /// the heats before it (the auto-timetable only sets the session's start).
    /// </summary>
    private static DateTime? HeatStart(
        Session session,
        Heat heat,
        IReadOnlyDictionary<int, Calendar.HeatTime>? timings = null)
    {
        if (heat.ScheduledStart is not null) return heat.ScheduledStart;
        if (session.ScheduledStart is null)
            return timings is not null && timings.TryGetValue(heat.Id, out var t) ? t.Start : null;
        var start = session.ScheduledStart.Value;
        foreach (var earlier in OrderedHeats(session))
        {
            if (earlier.Id == heat.Id) return start;
            start = earlier.ScheduledStart is not null
                ? earlier.ScheduledStart.Value.AddMinutes(HeatMinutes(session, earlier))
                : start.AddMinutes(HeatMinutes(session, earlier));
        }
        return start;
    }

    /// <summary>The same length the timetable uses: the heat's own, else minutes per heat, else 30.</summary>
    private static int HeatMinutes(Session session, Heat heat)
        => heat.DurationMinutes is > 0 ? heat.DurationMinutes.Value
            : session.MinutesPerHeat is > 0 ? session.MinutesPerHeat.Value
            : 30;

    private Task<Competition?> LoadAsync(int competitionId, CancellationToken ct)
        => db.Competitions.AsNoTracking().AsSplitQuery()
            .Include(x => x.Sections).ThenInclude(x => x.Teams).ThenInclude(x => x.Club)
            .Include(x => x.Sections).ThenInclude(x => x.Teams).ThenInclude(x => x.Results).ThenInclude(x => x.Race)!.ThenInclude(x => x!.Heat)!.ThenInclude(x => x!.Session)
            .Include(x => x.Sessions).ThenInclude(x => x.Section)
            .Include(x => x.Sessions).ThenInclude(x => x.Heats).ThenInclude(x => x.Entries).ThenInclude(x => x.Team)!.ThenInclude(x => x!.Club)
            .Include(x => x.Sessions).ThenInclude(x => x.Heats).ThenInclude(x => x.Races).ThenInclude(x => x.Results)
            .SingleOrDefaultAsync(x => x.Id == competitionId, ct);

    private static PrintableCompetitionDto ToCompetition(Competition x)
        => new(x.Id, x.Name, x.Location, x.StartDate, x.EndDate);
}
