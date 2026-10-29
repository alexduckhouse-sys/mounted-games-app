using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.EventTools;

namespace MountedGames.Api.Services.TackCheck;

/// <summary>
/// Tack check per section: the set-up (on or off, what it counts for, the sectors), the stewards' marks per team,
/// the public Tack &amp; Turnout table and the printable form. Callers check access first.
/// </summary>
public sealed class TackCheckService(AppDbContext db)
{
    /// <summary>The sectors a section starts with until the organiser changes them.</summary>
    public static readonly IReadOnlyList<string> DefaultSectors = ["Saddle/Girth", "Bridle/Bit", "Rider Hat/Boots", "Turnout"];
    public const int DefaultMaxPoints = 10;
    public const int MaxSectors = 12;

    public async Task<TackCheckBoardDto> BoardAsync(int competitionId, CancellationToken ct)
    {
        var sections = await db.CompetitionSections.AsNoTracking()
            .Where(s => s.CompetitionId == competitionId).ToListAsync(ct);
        var setups = await SetupsAsync(competitionId, withMarks: true, ct);
        var teams = await db.Teams.AsNoTracking().Include(t => t.Club)
            .Include(t => t.DeclarationForms).ThenInclude(f => f.Riders).ThenInclude(r => r.SavedRider)
            .Where(t => t.CompetitionId == competitionId).ToListAsync(ct);
        return new TackCheckBoardDto(competitionId, sections
            .OrderBy(s => s.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(s => s.Id)
            .Select(s => SectionDto(s, setups.GetValueOrDefault(s.Id), teams.Where(t => t.CompetitionSectionId == s.Id)))
            .ToList());
    }

    public async Task<TackCheckSectionDto> SaveSettingsAsync(
        int competitionId, int sectionId, SaveTackCheckSettingsRequest request, CancellationToken ct)
    {
        var section = await db.CompetitionSections.SingleOrDefaultAsync(s => s.Id == sectionId && s.CompetitionId == competitionId, ct)
            ?? throw new EventToolsException("That age group is not in this competition.", StatusCodes.Status404NotFound);
        if (!Enum.IsDefined(request.Mode))
            throw new EventToolsException("Choose pass or fail, a separate table, or bonus points.", StatusCodes.Status400BadRequest);
        var names = request.Sectors.Select(x => (x.Name ?? string.Empty).Trim()).ToList();
        if (names.Count is 0 or > MaxSectors)
            throw new EventToolsException($"A tack check needs between 1 and {MaxSectors} sectors.", StatusCodes.Status400BadRequest);
        if (names.Any(n => n.Length is 0 or > 60))
            throw new EventToolsException("Every sector needs a name of up to 60 characters.", StatusCodes.Status400BadRequest);
        if (names.Distinct(StringComparer.OrdinalIgnoreCase).Count() != names.Count)
            throw new EventToolsException("Two sectors have the same name.", StatusCodes.Status400BadRequest);

        var setup = await db.Set<TackCheckSection>().Include(x => x.Sectors)
            .SingleOrDefaultAsync(x => x.CompetitionSectionId == sectionId, ct);
        if (setup is null)
        {
            setup = new TackCheckSection { CompetitionId = competitionId, CompetitionSectionId = sectionId };
            db.Add(setup);
        }
        var known = setup.Sectors.ToDictionary(x => x.Id);
        if (request.Sectors.Any(x => x.Id is { } id && !known.ContainsKey(id)))
            throw new EventToolsException("A sector belongs to another age group. Reload the page and try again.", StatusCodes.Status400BadRequest);

        var keep = request.Sectors.Where(x => x.Id is not null).Select(x => x.Id!.Value).ToHashSet();
        foreach (var gone in setup.Sectors.Where(x => !keep.Contains(x.Id)).ToList())
        {
            setup.Sectors.Remove(gone);
            db.Remove(gone);
        }
        for (var i = 0; i < request.Sectors.Count; i++)
        {
            var row = request.Sectors[i];
            if (row.Id is { } id)
            {
                known[id].Name = names[i];
                known[id].OrderIndex = i;
            }
            else
            {
                setup.Sectors.Add(new TackCheckSector { Name = names[i], OrderIndex = i });
            }
        }
        setup.IsEnabled = request.IsEnabled;
        setup.Mode = request.Mode;
        setup.MaxPoints = request.MaxPoints;
        setup.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return await SectionAsync(competitionId, section, ct);
    }

    public async Task<TackCheckSectionDto> SaveMarksAsync(
        int competitionId, int sectionId, int teamId, SaveTackCheckMarksRequest request, string? userId, CancellationToken ct)
    {
        var section = await db.CompetitionSections.SingleOrDefaultAsync(s => s.Id == sectionId && s.CompetitionId == competitionId, ct)
            ?? throw new EventToolsException("That age group is not in this competition.", StatusCodes.Status404NotFound);
        if (!await db.Teams.AnyAsync(t => t.Id == teamId && t.CompetitionId == competitionId && t.CompetitionSectionId == sectionId, ct))
            throw new EventToolsException("That team is not in this age group.", StatusCodes.Status404NotFound);
        var setup = await db.Set<TackCheckSection>().Include(x => x.Sectors).ThenInclude(x => x.Marks.Where(m => m.TeamId == teamId))
            .SingleOrDefaultAsync(x => x.CompetitionSectionId == sectionId, ct);
        if (setup is null || !setup.IsEnabled)
            throw new EventToolsException("Turn on the tack check for this age group first.", StatusCodes.Status409Conflict);

        var sectors = setup.Sectors.ToDictionary(x => x.Id);
        if (request.Marks.Any(m => !sectors.ContainsKey(m.SectorId)))
            throw new EventToolsException("A mark names a sector that is not in this tack check. Reload the page and try again.", StatusCodes.Status400BadRequest);
        if (request.Marks.GroupBy(m => m.SectorId).Any(g => g.Count() > 1))
            throw new EventToolsException("Each sector can be marked once.", StatusCodes.Status400BadRequest);
        if (request.Marks.Any(m => m.RiderPoints is { Count: > 10 }))
            throw new EventToolsException("A sector can have at most 10 rider scores.", StatusCodes.Status400BadRequest);
        if (request.Marks.Any(m =>
            (m.RiderPoints is { Count: > 0 } && m.RiderPoints.Any(p => p is { } rp && (rp < 0 || rp > setup.MaxPoints)))
            || (m.RiderPoints is not { Count: > 0 } && m.Points is { } tp && (tp < 0 || tp > setup.MaxPoints))))
            throw new EventToolsException($"Points go from 0 to {setup.MaxPoints}.", StatusCodes.Status400BadRequest);

        var now = DateTime.UtcNow;
        foreach (var sector in setup.Sectors)
        {
            var existing = sector.Marks.SingleOrDefault();
            var sent = request.Marks.SingleOrDefault(m => m.SectorId == sector.Id);
            var hasRiderPoints = sent?.RiderPoints is { Count: > 0 } && sent.RiderPoints.Any(p => p is not null);
            var riderJson = hasRiderPoints ? JsonSerializer.Serialize(sent!.RiderPoints) : null;
            var effectivePoints = hasRiderPoints ? sent!.RiderPoints!.Sum(p => p ?? 0) : sent?.Points;
            if (sent is null || (sent.Passed is null && effectivePoints is null))
            {
                if (existing is not null) db.Remove(existing);
                continue;
            }
            if (existing is null)
            {
                existing = new TackCheckMark { TackCheckSectorId = sector.Id, TeamId = teamId };
                db.Add(existing);
            }
            else if (existing.Passed == sent.Passed && existing.Points == effectivePoints && existing.RiderScoresJson == riderJson)
            {
                continue;
            }
            existing.Passed = sent.Passed;
            existing.Points = effectivePoints;
            existing.RiderScoresJson = riderJson;
            existing.RecordedByUserId = userId;
            existing.RecordedAt = now;
        }
        await db.SaveChangesAsync(ct);
        return await SectionAsync(competitionId, section, ct);
    }

    public async Task<TackLeaderboardDto> LeaderboardAsync(int competitionId, CancellationToken ct)
    {
        var sections = await db.CompetitionSections.AsNoTracking().Where(s => s.CompetitionId == competitionId).ToListAsync(ct);
        var setups = await SetupsAsync(competitionId, withMarks: true, ct);
        var teams = await db.Teams.AsNoTracking().Include(t => t.Club)
            .Where(t => t.CompetitionId == competitionId).ToListAsync(ct);
        var result = new List<TackLeaderboardSectionDto>();
        foreach (var section in sections.OrderBy(s => s.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(s => s.Id))
        {
            if (setups.GetValueOrDefault(section.Id) is not { IsEnabled: true } setup || setup.Mode == TackCheckMode.PassFail) continue;
            var sectors = setup.Sectors.OrderBy(x => x.OrderIndex).ThenBy(x => x.Id).ToList();
            var marked = teams.Where(t => t.CompetitionSectionId == section.Id)
                .Select(t => new
                {
                    Team = t,
                    Points = sectors.Select(s => s.Marks.FirstOrDefault(m => m.TeamId == t.Id)?.Points).ToList(),
                })
                .Where(x => x.Points.Any(p => p is not null))
                .Select(x => new { x.Team, x.Points, Total = x.Points.Sum(p => p ?? 0) })
                .OrderBy(x => x.Team.IsHorsConcours)
                .ThenByDescending(x => x.Total)
                .ThenBy(x => x.Team.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Team.Id)
                .ToList();
            var rows = new List<TackLeaderboardRowDto>();
            int? previous = null;
            var rank = 0;
            for (var i = 0; i < marked.Count; i++)
            {
                var row = marked[i];
                int? shown = null;
                if (!row.Team.IsHorsConcours)
                {
                    if (previous != row.Total) rank = i + 1;
                    previous = row.Total;
                    shown = rank;
                }
                rows.Add(new TackLeaderboardRowDto(shown, row.Team.Id, row.Team.DisplayName, row.Team.Club?.Name ?? string.Empty,
                    row.Points, row.Total, row.Team.IsHorsConcours));
            }
            result.Add(new TackLeaderboardSectionDto(section.Id, section.DisplayName, setup.Mode, setup.MaxPoints,
                sectors.Select(s => s.Name).ToList(), rows));
        }
        return new TackLeaderboardDto(result);
    }

    /// <summary>A form for every section, using its sectors (or the defaults when none are set), with each team's declared riders and ponies.</summary>
    public async Task<PrintableTackCheckDto?> PrintableAsync(int competitionId, CancellationToken ct)
    {
        var competition = await db.Competitions.AsNoTracking().AsSplitQuery()
            .Include(x => x.Sections).ThenInclude(x => x.Teams).ThenInclude(x => x.Club)
            .Include(x => x.Sections).ThenInclude(x => x.Teams).ThenInclude(x => x.DeclarationForms).ThenInclude(x => x.Riders).ThenInclude(r => r.SavedRider)
            .SingleOrDefaultAsync(x => x.Id == competitionId, ct);
        if (competition is null) return null;
        var setups = await SetupsAsync(competitionId, withMarks: false, ct);
        var sections = competition.Sections.OrderBy(x => x.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Id)
            .Select(section =>
            {
                var setup = setups.GetValueOrDefault(section.Id);
                var sectors = setup is { Sectors.Count: > 0 }
                    ? setup.Sectors.OrderBy(x => x.OrderIndex).ThenBy(x => x.Id).Select(x => x.Name).ToList()
                    : DefaultSectors.ToList();
                var teams = section.Teams.OrderBy(t => t.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(t => t.Id).Select(team =>
                {
                    var riders = DeclaredRiders(team).Select(r => new PrintableEntryRiderDto(RiderNames.Display(r.FullName, r.UseInitialOnly || (r.SavedRider?.UseInitialOnly ?? false), viewerSeesFullNames: false), PonyName(r.HorseName),
                        r.IsCaptain, r.IsReserve, r.IsGuestRider)).ToArray();
                    return new PrintableEntryTeamDto(team.Id, team.DisplayName, team.Club?.Name ?? string.Empty,
                        team.BibDescription ?? team.BibColour, team.EntryStatus != TeamEntryStatus.Active, team.IsHorsConcours, riders);
                }).ToArray();
                return new PrintableTackCheckSectionDto(section.Id, section.DisplayName, setup?.IsEnabled ?? false,
                    setup?.Mode ?? TackCheckMode.PassFail, setup?.MaxPoints ?? DefaultMaxPoints, sectors, teams);
            }).ToArray();
        return new PrintableTackCheckDto(new PrintableCompetitionDto(competition.Id, competition.Name, competition.Location,
            competition.StartDate, competition.EndDate, competition.CompetitionNumber), sections);
    }

    /// <summary>The riders on the team's latest declaration, reserves last.</summary>
    internal static IEnumerable<RiderEntry> DeclaredRiders(Team team)
    {
        var form = team.DeclarationForms.OrderByDescending(f => f.SubmittedAt).ThenByDescending(f => f.Id).FirstOrDefault();
        return (form?.Riders ?? []).OrderBy(r => r.IsReserve).ThenBy(r => r.OrderIndex).ThenBy(r => r.Id);
    }

    internal static string? PonyName(string? name) => string.IsNullOrWhiteSpace(name) ? null : name.Trim();

    internal static IReadOnlyList<string> TeamRiderLabels(CompetitionSection section, Team team)
    {
        var declared = DeclaredRiders(team)
            .Select(r => RiderNames.Display(r.FullName, r.UseInitialOnly || (r.SavedRider?.UseInitialOnly ?? false), viewerSeesFullNames: false))
            .Where(name => name.Length > 0)
            .ToList();
        if (declared.Count > 0) return declared;
        var count = section.Format switch
        {
            SectionFormat.Individual => 1,
            SectionFormat.Pairs => 2,
            _ => 4,
        };
        return Enumerable.Range(1, count).Select(i => $"Rider {i}").ToList();
    }

    internal static IReadOnlyList<int?>? ParseRiderPoints(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<List<int?>>(json); }
        catch { return null; }
    }

    private async Task<TackCheckSectionDto> SectionAsync(int competitionId, CompetitionSection section, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        var setups = await SetupsAsync(competitionId, withMarks: true, ct);
        var teams = await db.Teams.AsNoTracking().Include(t => t.Club)
            .Include(t => t.DeclarationForms).ThenInclude(f => f.Riders).ThenInclude(r => r.SavedRider)
            .Where(t => t.CompetitionSectionId == section.Id && t.CompetitionId == competitionId).ToListAsync(ct);
        return SectionDto(section, setups.GetValueOrDefault(section.Id), teams);
    }

    private async Task<Dictionary<int, TackCheckSection>> SetupsAsync(int competitionId, bool withMarks, CancellationToken ct)
    {
        var query = db.Set<TackCheckSection>().AsNoTracking().Include(x => x.Sectors).AsQueryable();
        if (withMarks) query = query.Include(x => x.Sectors).ThenInclude(x => x.Marks);
        var setups = await query.AsSplitQuery().Where(x => x.CompetitionId == competitionId).ToDictionaryAsync(x => x.CompetitionSectionId, ct);
        return setups;
    }

    private static TackCheckSectionDto SectionDto(CompetitionSection section, TackCheckSection? setup, IEnumerable<Team> teams)
    {
        var sectors = setup is null
            ? DefaultSectors.Select(name => new TackCheckSector { Name = name }).ToList()
            : setup.Sectors.OrderBy(x => x.OrderIndex).ThenBy(x => x.Id).ToList();
        var teamRows = teams.OrderBy(t => t.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(t => t.Id).Select(team =>
        {
            var marks = sectors.SelectMany(s => s.Marks.Where(m => m.TeamId == team.Id)
                .Select(m => new TackCheckMarkDto(s.Id, m.Passed, m.Points, ParseRiderPoints(m.RiderScoresJson)))).ToList();
            return new TackCheckTeamDto(team.Id, team.DisplayName, team.Club?.Name ?? string.Empty, team.IsHorsConcours,
                team.EntryStatus != TeamEntryStatus.Active, marks,
                marks.Sum(m => m.Points ?? 0), marks.Count(m => m.Passed == true), marks.Count(m => m.Passed == false),
                TeamRiderLabels(section, team));
        }).ToList();
        return new TackCheckSectionDto(section.Id, section.DisplayName, setup is not null, setup?.IsEnabled ?? false,
            setup?.Mode ?? TackCheckMode.PassFail, setup?.MaxPoints ?? DefaultMaxPoints,
            sectors.Select(s => new TackCheckSectorDto(s.Id, s.Name)).ToList(), teamRows);
    }
}

/// <summary>
/// Tack check bonus points: a team's sector points in a section whose tack check is on and set to
/// <see cref="TackCheckMode.BonusPoints"/>. Standings add them to the team's total (and show them separately).
/// Hors concours teams can be marked, but they are left out of standings, so their bonus never counts.
/// </summary>
public static class TackCheckBonus
{
    public static async Task<Dictionary<int, int>> ForCompetitionAsync(AppDbContext db, int competitionId, CancellationToken ct = default)
    {
        var rows = await db.Set<TackCheckMark>().AsNoTracking()
            .Where(m => m.Points != null
                && m.Sector!.TackCheckSection!.CompetitionId == competitionId
                && m.Sector.TackCheckSection.IsEnabled
                && m.Sector.TackCheckSection.Mode == TackCheckMode.BonusPoints
                && m.Team!.CompetitionSectionId == m.Sector.TackCheckSection.CompetitionSectionId)
            .Select(m => new { m.TeamId, Points = m.Points!.Value })
            .ToListAsync(ct);
        return rows.GroupBy(x => x.TeamId).ToDictionary(g => g.Key, g => g.Sum(x => x.Points));
    }
}
