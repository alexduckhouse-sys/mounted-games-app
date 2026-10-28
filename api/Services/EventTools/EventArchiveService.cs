using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.EventTools;

/// <summary>
/// Builds a self-contained organiser archive bundle containing results-book.csv, standings.csv,
/// timetable.csv, declarations.csv, entries-summary.csv, and competition-snapshot.json.
/// </summary>
public sealed partial class EventArchiveService(
    AppDbContext db,
    StandingsService standings,
    ResultsBookService resultsBook)
{
    private static readonly JsonSerializerOptions SnapshotJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public async Task<EventArchiveDto?> BuildArchiveAsync(int competitionId, CancellationToken ct = default)
    {
        var competition = await db.Competitions.AsNoTracking().AsSplitQuery()
            .Include(x => x.Sections)
            .Include(x => x.Teams).ThenInclude(t => t.Club)
            .Include(x => x.Teams).ThenInclude(t => t.DeclarationForms).ThenInclude(f => f.Riders).ThenInclude(r => r.SavedRider)
            .Include(x => x.Sessions).ThenInclude(s => s.Section)
            .Include(x => x.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team).ThenInclude(t => t!.Club)
            .Include(x => x.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .SingleOrDefaultAsync(x => x.Id == competitionId, ct);

        if (competition is null) return null;

        var book = await resultsBook.BuildAsync(competitionId, includePrivate: false, ct);
        if (book is null) return null;

        var sectionById = competition.Sections.ToDictionary(s => s.Id);
        var orderedSections = competition.Sections
            .OrderBy(s => s.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(s => s.Id)
            .ToList();

        var standingsBySection = new Dictionary<int, List<StandingRow>>();
        foreach (var section in orderedSections)
        {
            standingsBySection[section.Id] = await standings.RowsAsync(competitionId, section.Id, ct);
        }

        var generatedAt = DateTime.UtcNow;
        var files = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["results-book.csv"] = BuildResultsBookCsv(book),
            ["standings.csv"] = BuildStandingsCsv(orderedSections, standingsBySection, book),
            ["timetable.csv"] = BuildTimetableCsv(competition.Sessions),
            ["declarations.csv"] = BuildDeclarationsCsv(competition.Teams, sectionById),
            ["entries-summary.csv"] = BuildEntriesSummaryCsv(competition.Teams, sectionById),
            ["competition-snapshot.json"] = BuildSnapshotJson(competition, orderedSections, standingsBySection, book, generatedAt),
        };

        var safeName = SafeFilename(competition.Name);
        return new EventArchiveDto(
            competition.Id,
            competition.Name,
            $"{safeName}-archive.zip",
            generatedAt,
            files);
    }

    public static byte[] BuildZipBytes(EventArchiveDto archive)
    {
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (name, content) in archive.Files)
            {
                var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
                using var stream = entry.Open();
                using var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: name.EndsWith(".csv", StringComparison.OrdinalIgnoreCase)));
                writer.Write(content);
            }
        }
        return ms.ToArray();
    }

    private static string BuildResultsBookCsv(ResultsBookDto book)
    {
        var blocks = new List<string>
        {
            ToCsv(["Results book", "Mounted Games"], [
                ["Event", book.Competition.Name],
                ["Date", book.Competition.StartDate.ToString("d MMMM yyyy", CultureInfo.GetCultureInfo("en-GB"))],
                ["Venue", book.Competition.Location ?? string.Empty],
                ["Status", book.IsProvisional ? "Provisional: some races are not complete" : "Final"],
                ["Copy", "Public"],
            ])
        };

        foreach (var section in book.Sections)
        {
            var hasBonus = section.Standings.Any(s => s.BonusPoints > 0);
            var header = hasBonus
                ? new[] { "Position", "Team", "Club", "Final", "Points", "of which bonus", "Races", "Wins", "Eliminations", "Note" }
                : new[] { "Position", "Team", "Club", "Final", "Points", "Races", "Wins", "Eliminations", "Note" };

            var rows = section.Standings.Select(s => hasBonus
                ? new object?[] { s.Rank, s.TeamName, s.ClubName, s.FinalLabel ?? string.Empty, PointValues.Format(s.TotalPoints), s.BonusPoints, s.RacesRun, s.Wins, s.Eliminations, s.Withdrawn ? "Withdrawn" : string.Empty }
                : new object?[] { s.Rank, s.TeamName, s.ClubName, s.FinalLabel ?? string.Empty, PointValues.Format(s.TotalPoints), s.RacesRun, s.Wins, s.Eliminations, s.Withdrawn ? "Withdrawn" : string.Empty });

            blocks.Add($"{ToCsv([$"{section.SectionName}: final standings"], [])}\r\n{ToCsv(header, rows)}");

            foreach (var final in section.Finals)
            {
                var finalHeader = new List<string> { "Position", "Team", "Club" };
                finalHeader.AddRange(final.RaceNames);
                finalHeader.Add("Points");

                var finalRows = final.Rows.Select(r =>
                {
                    var cells = new List<object?> { r.Rank, r.TeamName, r.ClubName };
                    cells.AddRange(r.RaceCells);
                    cells.Add(PointValues.Format(r.Points));
                    return (IReadOnlyList<object?>)cells;
                });

                blocks.Add($"{ToCsv([$"{section.SectionName}: {final.Label} ({final.SessionName})"], [])}\r\n{ToCsv(finalHeader, finalRows)}");
            }

            if (section.Awards.Count > 0)
            {
                var awardRows = section.Awards.Select(a => (IReadOnlyList<object?>)[a.Title, a.Recipient, a.Note ?? string.Empty]);
                blocks.Add($"{ToCsv([$"{section.SectionName}: special awards"], [])}\r\n{ToCsv(["Award", "Recipient", "Note"], awardRows)}");
            }
        }

        if (book.EventAwards.Count > 0)
        {
            var eventAwardRows = book.EventAwards.Select(a => (IReadOnlyList<object?>)[a.Title, a.Recipient, a.Note ?? string.Empty]);
            blocks.Add($"{ToCsv(["Special awards"], [])}\r\n{ToCsv(["Award", "Recipient", "Note"], eventAwardRows)}");
        }

        return string.Join("\r\n\r\n", blocks);
    }

    private static string BuildStandingsCsv(
        IReadOnlyList<CompetitionSection> sections,
        IReadOnlyDictionary<int, List<StandingRow>> standingsBySection,
        ResultsBookDto book)
    {
        var header = new[]
        {
            "Section", "Rank", "Team", "Club", "Bib", "Final", "TotalPoints",
            "BonusPoints", "RacesRun", "Wins", "Eliminations", "Withdrawn", "TieBreakReason"
        };
        var rows = new List<IReadOnlyList<object?>>();

        foreach (var section in sections)
        {
            var sectionRows = standingsBySection.GetValueOrDefault(section.Id) ?? [];
            // Same tie-aware ranks as results-book.csv (teams level on points share a rank unless a tie-break separates them).
            var ranks = (book.Sections.FirstOrDefault(x => x.SectionId == section.Id)?.Standings ?? [])
                .ToDictionary(x => x.TeamId, x => x.Rank);
            for (var i = 0; i < sectionRows.Count; i++)
            {
                var r = sectionRows[i];
                var rank = ranks.TryGetValue(r.TeamId, out var ranked) ? ranked : i + 1;
                var finalLabel = r.FinalTier is >= 0 and < 26 ? $"{(char)('A' + r.FinalTier.Value)} Final" : string.Empty;
                rows.Add([
                    section.DisplayName,
                    rank,
                    r.TeamName,
                    r.ClubName,
                    r.BibColour ?? string.Empty,
                    finalLabel,
                    PointValues.Format(r.TotalPoints),
                    r.BonusPoints,
                    r.RacesRun,
                    r.Wins,
                    r.Eliminations,
                    r.Withdrawn ? "Yes" : "No",
                    r.TieBreakReason ?? string.Empty
                ]);
            }
        }

        return ToCsv(header, rows);
    }

    private static string BuildTimetableCsv(ICollection<Session> sessions)
    {
        var header = new[]
        {
            "OrderIndex", "Session", "Kind", "Arena", "Section", "ScheduledStart",
            "Status", "Heat", "Lane", "Team", "Club", "Races"
        };
        var rows = new List<IReadOnlyList<object?>>();

        foreach (var session in sessions.OrderBy(s => s.OrderIndex).ThenBy(s => s.Id))
        {
            var kind = session.IsBreak ? SessionKind.Break : session.Kind;
            var scheduled = session.ScheduledStart?.ToString("O", CultureInfo.InvariantCulture) ?? string.Empty;
            var sectionName = session.Section?.DisplayName ?? string.Empty;
            var heats = session.Heats.OrderBy(h => h.OrderIndex).ThenBy(h => h.Id).ToList();

            if (heats.Count == 0)
            {
                rows.Add([
                    session.OrderIndex,
                    session.Name,
                    kind.ToString(),
                    session.ArenaName ?? string.Empty,
                    sectionName,
                    scheduled,
                    session.Status.ToString(),
                    string.Empty,
                    string.Empty,
                    string.Empty,
                    string.Empty,
                    string.Empty
                ]);
                continue;
            }

            foreach (var heat in heats)
            {
                var heatLabel = heat.Label ?? $"Heat {heat.OrderIndex}";
                var raceNames = string.Join(" | ", heat.Races.OrderBy(r => r.OrderIndex).ThenBy(r => r.Id).Select(r => r.Name));
                var entries = heat.Entries.OrderBy(e => e.LaneIndex).ThenBy(e => e.Id).ToList();
                var heatScheduled = (heat.ScheduledStart ?? session.ScheduledStart)?.ToString("O", CultureInfo.InvariantCulture) ?? string.Empty;

                if (entries.Count == 0)
                {
                    rows.Add([
                        session.OrderIndex,
                        session.Name,
                        kind.ToString(),
                        session.ArenaName ?? string.Empty,
                        sectionName,
                        heatScheduled,
                        session.Status.ToString(),
                        heatLabel,
                        string.Empty,
                        string.Empty,
                        string.Empty,
                        raceNames
                    ]);
                    continue;
                }

                foreach (var entry in entries)
                {
                    rows.Add([
                        session.OrderIndex,
                        session.Name,
                        kind.ToString(),
                        session.ArenaName ?? string.Empty,
                        sectionName,
                        heatScheduled,
                        session.Status.ToString(),
                        heatLabel,
                        entry.LaneIndex,
                        entry.Team?.DisplayName ?? $"Team {entry.TeamId}",
                        entry.Team?.Club?.Name ?? string.Empty,
                        raceNames
                    ]);
                }
            }
        }

        return ToCsv(header, rows);
    }

    private static string BuildDeclarationsCsv(
        ICollection<Team> teams,
        IReadOnlyDictionary<int, CompetitionSection> sectionById)
    {
        var header = new[]
        {
            "Section", "Team", "Club", "Bib", "Trainer", "Locked",
            "Rider", "Pony", "PonyHeightHands", "Captain", "Reserve", "Guest", "TermsAccepted"
        };
        var rows = new List<IReadOnlyList<object?>>();

        foreach (var team in teams.OrderBy(t => sectionById.GetValueOrDefault(t.CompetitionSectionId)?.DisplayName ?? string.Empty, StringComparer.OrdinalIgnoreCase)
                     .ThenBy(t => t.DisplayName, StringComparer.OrdinalIgnoreCase)
                     .ThenBy(t => t.Id))
        {
            var sectionName = sectionById.GetValueOrDefault(team.CompetitionSectionId)?.DisplayName ?? string.Empty;
            var form = team.DeclarationForms.OrderByDescending(f => f.SubmittedAt).ThenByDescending(f => f.Id).FirstOrDefault();
            var riders = (form?.Riders ?? []).OrderBy(r => r.IsReserve).ThenBy(r => r.OrderIndex).ThenBy(r => r.Id).ToList();

            if (riders.Count == 0)
            {
                rows.Add([
                    sectionName,
                    team.DisplayName,
                    team.Club?.Name ?? string.Empty,
                    ResultStatuses.PublicBibDescription(team.BibDescription) ?? team.BibColour ?? string.Empty,
                    form?.TrainerName ?? string.Empty,
                    form?.IsLocked == true ? "Yes" : "No",
                    string.Empty,
                    string.Empty,
                    string.Empty,
                    string.Empty,
                    string.Empty,
                    string.Empty,
                    form?.TermsAcceptedAt != null ? "Yes" : "No"
                ]);
                continue;
            }

            foreach (var rider in riders)
            {
                rows.Add([
                    sectionName,
                    team.DisplayName,
                    team.Club?.Name ?? string.Empty,
                    ResultStatuses.PublicBibDescription(team.BibDescription) ?? team.BibColour ?? string.Empty,
                    form?.TrainerName ?? string.Empty,
                    form?.IsLocked == true ? "Yes" : "No",
                    RiderNames.Display(rider.FullName, rider.UseInitialOnly || (rider.SavedRider?.UseInitialOnly ?? false), viewerSeesFullNames: false),
                    rider.HorseName?.Trim() ?? string.Empty,
                    rider.PonyHeightHands?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
                    rider.IsCaptain ? "Yes" : "No",
                    rider.IsReserve ? "Yes" : "No",
                    rider.IsGuestRider ? "Yes" : "No",
                    form?.TermsAcceptedAt != null ? "Yes" : "No"
                ]);
            }
        }

        return ToCsv(header, rows);
    }

    private static string BuildEntriesSummaryCsv(
        ICollection<Team> teams,
        IReadOnlyDictionary<int, CompetitionSection> sectionById)
    {
        var header = new[]
        {
            "Section", "Team", "Club", "Suffix", "Bib", "Status",
            "HorsConcours", "DeclaredRiders", "SubmittedTrainer"
        };
        var rows = new List<IReadOnlyList<object?>>();

        foreach (var team in teams.OrderBy(t => sectionById.GetValueOrDefault(t.CompetitionSectionId)?.DisplayName ?? string.Empty, StringComparer.OrdinalIgnoreCase)
                     .ThenBy(t => t.DisplayName, StringComparer.OrdinalIgnoreCase)
                     .ThenBy(t => t.Id))
        {
            var sectionName = sectionById.GetValueOrDefault(team.CompetitionSectionId)?.DisplayName ?? string.Empty;
            var form = team.DeclarationForms.OrderByDescending(f => f.SubmittedAt).ThenByDescending(f => f.Id).FirstOrDefault();
            rows.Add([
                sectionName,
                team.DisplayName,
                team.Club?.Name ?? string.Empty,
                team.Suffix,
                ResultStatuses.PublicBibDescription(team.BibDescription) ?? team.BibColour ?? string.Empty,
                team.EntryStatus.ToString(),
                team.IsHorsConcours ? "Yes" : "No",
                form?.Riders.Count ?? 0,
                form?.TrainerName ?? string.Empty
            ]);
        }

        return ToCsv(header, rows);
    }

    private static string BuildSnapshotJson(
        Competition competition,
        IReadOnlyList<CompetitionSection> sections,
        IReadOnlyDictionary<int, List<StandingRow>> standingsBySection,
        ResultsBookDto book,
        DateTime generatedAt)
    {
        var snapshot = new
        {
            GeneratedAt = generatedAt,
            Competition = new
            {
                competition.Id,
                competition.Name,
                competition.Location,
                competition.StartDate,
                competition.EndDate,
                competition.SignupsLocked,
            },
            Sections = sections.Select(s => new
            {
                s.Id,
                s.DisplayName,
                s.AgeGroup,
                Format = (int)s.Format,
                s.FinalistCount,
                TieBreakRule = (int)s.TieBreakRule,
                Standings = standingsBySection.GetValueOrDefault(s.Id) ?? [],
            }).ToList(),
            Teams = competition.Teams.OrderBy(t => t.Id).Select(t =>
            {
                var form = t.DeclarationForms.OrderByDescending(f => f.SubmittedAt).ThenByDescending(f => f.Id).FirstOrDefault();
                return new
                {
                    t.Id,
                    t.CompetitionSectionId,
                    t.DisplayName,
                    ClubName = t.Club?.Name ?? string.Empty,
                    t.Suffix,
                    t.BibColour,
                    t.IsHorsConcours,
                    Withdrawn = t.EntryStatus != TeamEntryStatus.Active,
                    Riders = (form?.Riders ?? []).OrderBy(r => r.IsReserve).ThenBy(r => r.OrderIndex).ThenBy(r => r.Id).Select(r => new
                    {
                        Name = RiderNames.Display(r.FullName, r.UseInitialOnly || (r.SavedRider?.UseInitialOnly ?? false), viewerSeesFullNames: false),
                        Pony = r.HorseName?.Trim(),
                        r.IsCaptain,
                        r.IsReserve,
                        r.IsGuestRider,
                    }).ToList(),
                };
            }).ToList(),
            ResultsBook = book,
        };

        return JsonSerializer.Serialize(snapshot, SnapshotJsonOptions);
    }

    private static string EscapeCsv(object? value)
    {
        if (value is null) return string.Empty;
        var s = Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
        if (value is not (int or long or double or float or decimal or bool)
            && s.Length > 0
            && (s[0] is '=' or '+' or '-' or '@' or '\t' or '\r')
            && !NegativeNumberRegex().IsMatch(s))
        {
            s = "'" + s;
        }
        if (s.IndexOfAny([',', '"', '\n', '\r']) >= 0)
        {
            return $"\"{s.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";
        }
        return s;
    }

    private static string ToCsv(IReadOnlyList<string> header, IEnumerable<IReadOnlyList<object?>> rows)
    {
        var lines = new List<string> { string.Join(',', header.Select(h => EscapeCsv(h))) };
        foreach (var r in rows)
        {
            lines.Add(string.Join(',', r.Select(EscapeCsv)));
        }
        return string.Join("\r\n", lines);
    }

    public static string SafeFilename(string? value)
    {
        var cleaned = UnsafeFilenameRegex().Replace(value ?? "competition", "_").Trim('_');
        if (string.IsNullOrWhiteSpace(cleaned)) cleaned = "competition";
        return cleaned.Length > 80 ? cleaned[..80] : cleaned;
    }

    [GeneratedRegex(@"^-[0-9]+(\.[0-9]+)?$")]
    private static partial Regex NegativeNumberRegex();

    [GeneratedRegex(@"[^a-zA-Z0-9-_.]+")]
    private static partial Regex UnsafeFilenameRegex();
}
