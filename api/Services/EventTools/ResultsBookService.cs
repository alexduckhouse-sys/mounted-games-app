using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.EventTools;

/// <summary>
/// Builds the post-event results book: the final standings of every age group, the results of each final, any
/// special awards, and (organiser's copy only) the referee's private notes. Hors concours teams are left out,
/// as they are from every standings table. The public copy holds nothing a public results page doesn't show.
/// </summary>
public sealed class ResultsBookService(AppDbContext db, StandingsService standings)
{
    public async Task<ResultsBookDto?> BuildAsync(int competitionId, bool includePrivate, CancellationToken ct)
    {
        var competition = await db.Competitions.AsNoTracking().AsSplitQuery()
            .Include(x => x.Sections)
            .Include(x => x.Sessions).ThenInclude(x => x.Heats).ThenInclude(x => x.Entries).ThenInclude(x => x.Team).ThenInclude(x => x!.Club)
            .Include(x => x.Sessions).ThenInclude(x => x.Heats).ThenInclude(x => x.Races).ThenInclude(x => x.Results)
            .SingleOrDefaultAsync(x => x.Id == competitionId, ct);
        if (competition is null) return null;

        var awards = await db.SpecialAwards.AsNoTracking()
            .Where(a => a.CompetitionId == competitionId).OrderBy(a => a.OrderIndex).ThenBy(a => a.Id).ToListAsync(ct);
        SpecialAwardDto ToDto(SpecialAward a) => new(a.Id, a.CompetitionSectionId, a.Title, a.Recipient, a.Note);

        var ties = await TieBreaker.LoadAsync(db, competitionId, ct);
        var teamResults = await db.Teams.AsNoTracking()
            .Where(t => t.CompetitionId == competitionId && !t.IsHorsConcours)
            .Include(t => t.Results)
            .ToDictionaryAsync(t => t.Id, t => t.Results, ct);
        var raceSessions = competition.Sessions.Where(s => s.Kind == SessionKind.Race && !s.IsBreak).ToList();
        var sections = new List<ResultsBookSectionDto>();
        var notes = new List<ResultsBookNoteDto>();
        foreach (var section in competition.Sections.OrderBy(s => s.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(s => s.Id))
        {
            var rows = await standings.RowsAsync(competitionId, section.Id, ct);
            var sectionSessions = raceSessions.Where(s => s.CompetitionSectionId == section.Id).OrderBy(s => s.OrderIndex).ThenBy(s => s.Id).ToList();
            var alone = !SectionScoring.CarriesIntoFinal(section);
            var facts = rows.ToDictionary(
                r => r.TeamId,
                r =>
                {
                    var results = teamResults.GetValueOrDefault(r.TeamId) ?? [];
                    var effective = ties.EffectiveResults(results);
                    var tieResults = r.FinalTier is not null && alone
                        ? effective.Where(x => ties.IsFinalRace(x.RaceId)).ToList()
                        : effective;
                    return ties.Facts(r.TeamId, section.Id, tieResults, r.TotalPoints);
                });
            sections.Add(new ResultsBookSectionDto(
                section.Id, section.DisplayName, (int)section.Format,
                Rank(rows, ties, facts), FinalsOf(sectionSessions),
                awards.Where(a => a.CompetitionSectionId == section.Id).Select(ToDto).ToList()));
            if (includePrivate) notes.AddRange(NotesOf(section.DisplayName, sectionSessions));
        }

        var races = raceSessions.SelectMany(s => s.Heats).SelectMany(h => h.Races).ToList();
        var provisional = races.Count == 0 || races.Any(r => !r.IsComplete);
        return new ResultsBookDto(
            new PrintableCompetitionDto(competition.Id, competition.Name, competition.Location, competition.StartDate, competition.EndDate,
                competition.CompetitionNumber),
            provisional, includePrivate, DateTime.UtcNow, sections,
            awards.Where(a => a.CompetitionSectionId is null).Select(ToDto).ToList(), notes);
    }

    /// <summary>
    /// Formats a clean, public-safe plain-text results summary with podiums (🥇 1st, 🥈 2nd, 🥉 3rd),
    /// finalists, points, riders formatted safely through <see cref="RiderNames.Display"/> so <c>UseInitialOnly</c>
    /// minors never have their surname exposed, pony names, and special awards.
    /// </summary>
    public async Task<PublicResultsSummaryDto?> BuildPublicSummaryAsync(int competitionId, CancellationToken ct = default)
    {
        var book = await BuildAsync(competitionId, includePrivate: false, ct);
        if (book is null) return null;

        var teams = await db.Teams.AsNoTracking()
            .Include(t => t.DeclarationForms).ThenInclude(f => f.Riders).ThenInclude(r => r.SavedRider)
            .Where(t => t.CompetitionId == competitionId)
            .ToListAsync(ct);

        var ridersByTeam = teams.ToDictionary(
            t => t.Id,
            t =>
            {
                // Public output: only a locked (submitted) form, never a draft.
                var form = t.DeclarationForms.Where(f => f.IsLocked).OrderByDescending(f => f.SubmittedAt).ThenByDescending(f => f.Id).FirstOrDefault();
                return (IReadOnlyList<(string Name, string? Pony)>)(form?.Riders ?? [])
                    .OrderBy(r => r.IsReserve)
                    .ThenBy(r => r.OrderIndex)
                    .ThenBy(r => r.Id)
                    .Select(r => (
                        Name: RiderNames.Display(r.FullName, r.UseInitialOnly || (r.SavedRider?.UseInitialOnly ?? false), viewerSeesFullNames: false),
                        Pony: string.IsNullOrWhiteSpace(r.HorseName) ? null : r.HorseName.Trim()))
                    .Where(r => !string.IsNullOrWhiteSpace(r.Name))
                    .ToList();
            });

        var sb = new StringBuilder();
        var titleSuffix = book.IsProvisional ? "Provisional Results Summary" : "Results Summary";
        sb.AppendLine($"🏆 {book.Competition.Name} — {titleSuffix}");
        var dateStr = book.Competition.StartDate.ToString("d MMMM yyyy", CultureInfo.GetCultureInfo("en-GB"));
        sb.AppendLine(string.IsNullOrWhiteSpace(book.Competition.Location)
            ? dateStr
            : $"{dateStr} · {book.Competition.Location}");

        foreach (var section in book.Sections.Where(s => s.Standings.Count > 0))
        {
            sb.AppendLine();
            sb.AppendLine($"=== {section.SectionName} ===");
            foreach (var row in section.Standings)
            {
                var prefix = row.Rank switch
                {
                    1 => "🥇 1st:",
                    2 => "🥈 2nd:",
                    3 => "🥉 3rd:",
                    _ => $"{TieBreaker.Ordinal(row.Rank)}:",
                };
                var finalPart = !string.IsNullOrWhiteSpace(row.FinalLabel) ? $", {row.FinalLabel}" : string.Empty;
                sb.AppendLine($"{prefix} {row.TeamName} ({PointValues.Format(row.TotalPoints)} pts{finalPart})");

                if (ridersByTeam.TryGetValue(row.TeamId, out var riders) && riders.Count > 0)
                {
                    var riderLine = string.Join(", ", riders.Select(r => r.Pony is not null ? $"{r.Name} ({r.Pony})" : r.Name));
                    sb.AppendLine($"   Riders: {riderLine}");
                }
            }

            foreach (var award in section.Awards)
            {
                var notePart = !string.IsNullOrWhiteSpace(award.Note) ? $" ({award.Note})" : string.Empty;
                sb.AppendLine($"🎖️ {award.Title}: {award.Recipient}{notePart}");
            }
        }

        if (book.EventAwards.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("=== Special Awards ===");
            foreach (var award in book.EventAwards)
            {
                var notePart = !string.IsNullOrWhiteSpace(award.Note) ? $" ({award.Note})" : string.Empty;
                sb.AppendLine($"🎖️ {award.Title}: {award.Recipient}{notePart}");
            }
        }

        return new PublicResultsSummaryDto(
            book.Competition.Id,
            book.Competition.Name,
            book.IsProvisional,
            sb.ToString().TrimEnd());
    }

    /// <summary>Teams level on points inside the same final share a rank unless separated by a tie-break.</summary>
    private static List<ResultsBookStandingDto> Rank(
        IReadOnlyList<StandingRow> rows,
        TieBreaker ties,
        IReadOnlyDictionary<int, TieFacts> facts)
    {
        var result = new List<ResultsBookStandingDto>();
        (int Tier, double Total)? previous = null;
        var rank = 0;
        for (var i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            var key = (row.FinalTier ?? FinalsTiers.NotInFinals, row.TotalPoints);
            if (previous != key)
            {
                rank = i + 1;
            }
            else if (i > 0
                && facts.TryGetValue(rows[i - 1].TeamId, out var prevF)
                && facts.TryGetValue(row.TeamId, out var currF))
            {
                var levelGroup = rows
                    .Where(r => (r.FinalTier ?? FinalsTiers.NotInFinals, r.TotalPoints) == key && facts.ContainsKey(r.TeamId))
                    .Select(r => facts[r.TeamId])
                    .ToList();
                if (!ties.AreLevel(levelGroup, prevF, currF))
                    rank = i + 1;
            }
            previous = key;
            result.Add(new ResultsBookStandingDto(
                rank, row.TeamId, row.TeamName, row.ClubName,
                row.FinalTier is { } tier ? FinalLabel(tier) : null,
                row.TotalPoints, row.BonusPoints, row.RacesRun, row.Wins, row.Eliminations, row.Withdrawn));
        }
        return result;
    }

    private static string FinalLabel(int tier) => tier is >= 0 and < 26 ? $"{(char)('A' + tier)} Final" : "Final";

    /// <summary>Every final that has results: a lettered final heat ("A Final") or the final of a heat-heat-final round.</summary>
    private static List<ResultsBookFinalDto> FinalsOf(IEnumerable<Session> sessions)
    {
        var finals = new List<ResultsBookFinalDto>();
        foreach (var session in sessions)
        {
            foreach (var heat in session.Heats.OrderBy(h => h.OrderIndex).ThenBy(h => h.Id))
            {
                var isFinal = FinalsTiers.ParseLabel(heat.Label) is not null || heat.RaceRoundStage == RaceRoundStage.Final;
                var races = heat.Races.OrderBy(r => r.OrderIndex).ThenBy(r => r.Id).ToList();
                if (!isFinal || races.All(r => r.Results.Count == 0)) continue;

                var teams = heat.Entries.GroupBy(e => e.TeamId).Select(g => g.First().Team!).ToList();
                var table = teams.Select(team => new
                {
                    Team = team,
                    Points = races.Sum(r => r.Results.Where(x => x.TeamId == team.Id).Sum(x => x.Points)),
                    Cells = races.Select(r => Cell(r.Results.FirstOrDefault(x => x.TeamId == team.Id))).ToList(),
                }).OrderByDescending(x => x.Points).ThenBy(x => x.Team.DisplayName, StringComparer.OrdinalIgnoreCase).ToList();

                var rows = new List<ResultsBookFinalRowDto>();
                var rank = 0;
                double? previous = null;
                for (var i = 0; i < table.Count; i++)
                {
                    if (previous != table[i].Points) rank = i + 1;
                    previous = table[i].Points;
                    rows.Add(new ResultsBookFinalRowDto(rank, table[i].Team.Id, table[i].Team.DisplayName,
                        table[i].Team.Club?.Name ?? string.Empty, table[i].Points, table[i].Cells));
                }
                finals.Add(new ResultsBookFinalDto(heat.Label ?? $"Heat {heat.OrderIndex}", session.Name,
                    races.Select(r => r.Name).ToList(), rows));
            }
        }
        return finals;
    }

    /// <summary>The points, or the letters for a team that sat out or did not finish; empty if the race has no result for it.</summary>
    private static string Cell(Result? result)
    {
        if (result is null) return string.Empty;
        if (result.IsSitOut) return "S";
        return ResultStatuses.Letter(result.Eliminated, result.Status) ?? PointValues.Format(result.Points);
    }

    private static IEnumerable<ResultsBookNoteDto> NotesOf(string sectionName, IEnumerable<Session> sessions)
        => sessions.SelectMany(s => s.Heats.OrderBy(h => h.OrderIndex).ThenBy(h => h.Id))
            .SelectMany(h => h.Races.OrderBy(r => r.OrderIndex).ThenBy(r => r.Id).SelectMany(r =>
                r.Results.Where(x => !string.IsNullOrWhiteSpace(x.RefereeNote)).Select(x =>
                    new ResultsBookNoteDto(sectionName, h.Label ?? $"Heat {h.OrderIndex}", r.Name,
                        h.Entries.FirstOrDefault(e => e.TeamId == x.TeamId)?.Team?.DisplayName ?? "Unnamed team",
                        ResultStatuses.Letter(x.Eliminated, x.Status), x.RefereeNote!))));
}
