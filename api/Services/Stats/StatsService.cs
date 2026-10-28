using System.Globalization;
using MountedGames.Api.Services.Seasons;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;

namespace MountedGames.Api.Services.Stats;

/// <param name="SeesFullNames">Site admins see riders' full names even when a rider asked for initials only.</param>
public readonly record struct StatsViewer(bool SeesFullNames);

/// <summary>
/// The cross-competition statistics hub: riders, ponies, teams and clubs, matched by name (see
/// <see cref="StatsNames"/>). It reads only what public pages already show:
/// <list type="bullet">
/// <item>finished competitions (archived, past their last day, or every race scored). Demo events count like any other;</item>
/// <item>riders and ponies from each team's latest locked declaration form, the one the public sees;</item>
/// <item>results of completed races, never a referee's note; sit-outs are left out.</item>
/// </list>
/// Places come from <see cref="StandingsService"/>, so hors concours teams have none. A rider who asked for
/// initials only is matched on the shortened name for anyone who isn't a site admin, so their surname finds nothing.
/// </summary>
public sealed class StatsService(AppDbContext db, StandingsService? standings = null)
{
    private readonly StandingsService? _standings = standings;
    public const int HitsPerKind = 8;
    public const int BrowsePageSize = 24;
    /// <summary>The most recent runs of one game sent with a team profile, so a long history stays a small answer.</summary>
    public const int MaxRunsPerGame = 40;
    private const int MaxSearchRows = 2000;
    private const int MaxBrowseRows = 20000;
    private const int MaxProfileRows = 5000;

    private sealed record RiderRow(string FullName, bool UseInitialOnly, string? HorseName, decimal? PonyHeightHands, bool IsReserve, int TeamId, int CompetitionId, SectionFormat Format);
    private sealed record NameRow(string Name, int CompetitionId, int TeamId);
    private sealed record Membership(int TeamId, string? RiderName, string? PonyName, bool IsReserve);
    private sealed record TeamRow(int TeamId, string TeamName, string ClubName, bool IsHorsConcours, int CompetitionId,
        string CompetitionName, DateTime StartDate, int SectionId, string SectionName, SectionFormat Format);
    private sealed record ResultRow(int TeamId, int RaceId, string RaceName, int SessionId, string SessionName, int SessionOrder,
        RaceRoundStage Stage, int? Placing, bool Eliminated, double Points);
    private sealed record Placing(int Place, int TeamsPlaced, int? FinalTier, bool SectionHasFinals);

    // ----- search -----

    /// <summary>Null when the query is too short, too long or has no letters to match.</summary>
    public async Task<StatsSearchDto?> SearchAsync(string? query, StatsViewer viewer, CancellationToken ct = default)
    {
        var q = StatsNames.Normalise(query);
        if (!StatsNames.IsValidQuery(q)) return null;
        var tokens = StatsNames.Tokens(q);

        var riders = await RiderRows(RidersNamed(tokens), MaxSearchRows).ToListAsync(ct);
        var ponies = await RiderRows(PoniesNamed(tokens), MaxSearchRows).ToListAsync(ct);
        var teams = await TeamsNamed(tokens)
            .OrderByDescending(t => t.Competition!.StartDate).Take(MaxSearchRows)
            .Select(t => new NameRow(t.DisplayName, t.CompetitionId, t.Id)).ToListAsync(ct);
        var clubs = await ClubsNamed(tokens)
            .OrderByDescending(t => t.Competition!.StartDate).Take(MaxSearchRows)
            .Select(t => new NameRow(t.Club!.Name, t.CompetitionId, t.Id)).ToListAsync(ct);

        var counted = await CountedCompetitionsAsync(
            riders.Select(r => r.CompetitionId).Concat(ponies.Select(r => r.CompetitionId))
                .Concat(teams.Select(t => t.CompetitionId)).Concat(clubs.Select(t => t.CompetitionId)), ct);

        return new StatsSearchDto(
            StatsNames.Tidy(query),
            Hits(StatsSubjectKind.Rider, riders.Where(Counts).Select(r => new NameRow(
                RiderNames.Display(r.FullName, r.UseInitialOnly, viewer.SeesFullNames), r.CompetitionId, r.TeamId)), q, counted),
            Hits(StatsSubjectKind.Pony, ponies.Where(Counts).Select(r => new NameRow(PonyName(r.HorseName, r.PonyHeightHands)!, r.CompetitionId, r.TeamId)), q, counted),
            Hits(StatsSubjectKind.Team, teams, q, counted),
            Hits(StatsSubjectKind.Club, clubs, q, counted));
    }

    private static List<StatsHitDto> Hits(StatsSubjectKind kind, IEnumerable<NameRow> rows, string q, HashSet<int> counted)
        => RankedHits(kind, rows, q, counted).Take(HitsPerKind).ToList();

    /// <summary>Every subject matching <paramref name="q"/> (all of them when it is empty): exact name first, then most competitions, then name (ponies with the same name ordered by height).</summary>
    private static IEnumerable<StatsHitDto> RankedHits(StatsSubjectKind kind, IEnumerable<NameRow> rows, string q, HashSet<int> counted)
        => rows.Where(r => counted.Contains(r.CompetitionId))
            .Select(r => (Name: StatsNames.Tidy(r.Name), Key: StatsNames.Normalise(r.Name), r.CompetitionId))
            // The database filter is loose (words, dots trimmed); this is the real match, on the name the viewer may see.
            .Where(r => r.Key.Length > 0 && r.Key.Contains(q, StringComparison.Ordinal))
            .GroupBy(r => r.Key)
            .Select(g => new StatsHitDto(kind, g.First().Name, g.Key, g.Select(x => x.CompetitionId).Distinct().Count()))
            .OrderByDescending(h => h.Key == q).ThenByDescending(h => h.Competitions)
            .ThenBy(h => BasePonyName(h.Name), StringComparer.OrdinalIgnoreCase)
            .ThenBy(h => PonyHeightSortKey(h.Name))
            .ThenBy(h => h.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(h => h.Key, StringComparer.Ordinal);

    // ----- browse -----

    /// <summary>
    /// One page of every rider, pony, team or club in the counted competitions, most competitions first, then by
    /// name. A rider is listed under the name this viewer may see, exactly as in <see cref="SearchAsync"/>. Null when
    /// <paramref name="query"/> is given but is too short, too long or has no letters.
    /// </summary>
    public async Task<StatsBrowseDto?> BrowseAsync(StatsSubjectKind kind, string? query, int page, StatsViewer viewer, CancellationToken ct = default)
    {
        var q = StatsNames.Normalise(query);
        if (q.Length > 0 && !StatsNames.IsValidQuery(q)) return null;
        var tokens = StatsNames.Tokens(q);
        page = Math.Max(1, page);

        var counted = await CountedCompetitionsAsync(null, ct);
        var ids = counted.ToList();
        List<NameRow> rows = [];
        if (ids.Count > 0)
        {
            switch (kind)
            {
                case StatsSubjectKind.Rider:
                case StatsSubjectKind.Pony:
                    var source = kind == StatsSubjectKind.Rider ? RidersNamed(tokens) : PoniesNamed(tokens);
                    var riderRows = await RiderRows(source.Where(r => ids.Contains(r.DeclarationForm!.Team!.CompetitionId)), MaxBrowseRows).ToListAsync(ct);
                    rows = riderRows.Where(Counts).Select(r => new NameRow(
                        kind == StatsSubjectKind.Rider ? RiderNames.Display(r.FullName, r.UseInitialOnly, viewer.SeesFullNames) : PonyName(r.HorseName, r.PonyHeightHands)!,
                        r.CompetitionId, r.TeamId)).ToList();
                    break;
                default:
                    var teams = kind == StatsSubjectKind.Team ? TeamsNamed(tokens) : ClubsNamed(tokens);
                    rows = await teams.Where(t => ids.Contains(t.CompetitionId))
                        .OrderByDescending(t => t.Competition!.StartDate).Take(MaxBrowseRows)
                        .Select(t => new NameRow(kind == StatsSubjectKind.Team ? t.DisplayName : t.Club!.Name, t.CompetitionId, t.Id))
                        .ToListAsync(ct);
                    break;
            }
        }

        var all = RankedHits(kind, rows, q, counted).ToList();
        var items = all.Skip((page - 1) * BrowsePageSize).Take(BrowsePageSize).ToList();
        return new StatsBrowseDto(kind, StatsNames.Tidy(query), page, BrowsePageSize, all.Count, items);
    }

    /// <summary>A reserve in an individual or pairs entry didn't ride, so the entry isn't theirs (or their pony's).</summary>
    private static bool Counts(RiderRow row) => !row.IsReserve || row.Format == SectionFormat.Teams;

    // ----- profiles -----

    public async Task<StatsProfileDto?> RiderAsync(string? name, StatsViewer viewer, CancellationToken ct = default)
    {
        var key = StatsNames.Normalise(name);
        if (!StatsNames.IsValidQuery(key)) return null;
        var rows = await RiderRows(RidersNamed(StatsNames.Tokens(key)), MaxProfileRows).ToListAsync(ct);
        var mine = rows
            .Select(r => (Row: r, Shown: StatsNames.Tidy(RiderNames.Display(r.FullName, r.UseInitialOnly, viewer.SeesFullNames))))
            .Where(x => StatsNames.Normalise(x.Shown) == key)
            .ToList();
        if (mine.Count == 0) return null;
        var memberships = mine.Select(x => new Membership(x.Row.TeamId, x.Shown, PonyName(x.Row.HorseName, x.Row.PonyHeightHands), x.Row.IsReserve)).ToList();
        return await BuildAsync(StatsSubjectKind.Rider, mine[0].Shown, key, memberships, viewer, ct);
    }

    public async Task<StatsProfileDto?> PonyAsync(string? name, StatsViewer viewer, CancellationToken ct = default)
    {
        var key = StatsNames.Normalise(name);
        if (!StatsNames.IsValidQuery(key)) return null;
        var rows = await RiderRows(PoniesNamed(StatsNames.Tokens(key)), MaxProfileRows).ToListAsync(ct);
        var legacyName = rows.Any(r => StatsNames.Normalise(r.HorseName) == key);
        var mine = rows.Where(r => StatsNames.Normalise(legacyName ? r.HorseName : PonyName(r.HorseName, r.PonyHeightHands)) == key).ToList();
        if (mine.Count == 0) return null;
        var memberships = mine.Select(r => new Membership(r.TeamId,
            StatsNames.Tidy(RiderNames.Display(r.FullName, r.UseInitialOnly, viewer.SeesFullNames)), PonyName(r.HorseName, r.PonyHeightHands), r.IsReserve)).ToList();
        var displayName = legacyName ? StatsNames.Tidy(mine[0].HorseName) : memberships[0].PonyName!;
        return await BuildAsync(StatsSubjectKind.Pony, displayName, key, memberships, viewer, ct);
    }

    public async Task<StatsProfileDto?> TeamAsync(string? name, StatsViewer viewer, CancellationToken ct = default)
    {
        var key = StatsNames.Normalise(name);
        if (!StatsNames.IsValidQuery(key)) return null;
        var rows = await TeamsNamed(StatsNames.Tokens(key))
            .OrderByDescending(t => t.Competition!.StartDate).Take(MaxProfileRows)
            .Select(t => new NameRow(t.DisplayName, t.CompetitionId, t.Id)).ToListAsync(ct);
        return await TeamsProfileAsync(StatsSubjectKind.Team, key, rows, viewer, ct);
    }

    public async Task<StatsProfileDto?> ClubAsync(string? name, StatsViewer viewer, CancellationToken ct = default)
    {
        var key = StatsNames.Normalise(name);
        if (!StatsNames.IsValidQuery(key)) return null;
        var rows = await ClubsNamed(StatsNames.Tokens(key))
            .OrderByDescending(t => t.Competition!.StartDate).Take(MaxProfileRows)
            .Select(t => new NameRow(t.Club!.Name, t.CompetitionId, t.Id)).ToListAsync(ct);
        return await TeamsProfileAsync(StatsSubjectKind.Club, key, rows, viewer, ct);
    }

    /// <summary>A season profile uses explicit links and its latest published event memberships, never names.</summary>
    public async Task<StatsProfileDto?> TeamProfileAsync(Guid id, StatsViewer viewer, CancellationToken ct = default)
    {
        var profile = await db.Set<TeamProfile>().AsNoTracking()
            .Where(p => p.Id == id)
            .Select(p => new { p.DisplayName, Teams = p.EventTeams.Select(e => e.TeamId).ToList() })
            .SingleOrDefaultAsync(ct);
        if (profile is null) return null;
        var publishedTeams = await db.Set<SeasonRoundResult>().AsNoTracking()
            .Where(result => result.TeamProfileId == id
                && !db.Set<SeasonRoundPublication>().Any(newer =>
                    newer.SeasonRoundId == result.SeasonRoundPublication!.SeasonRoundId
                    && newer.Version > result.SeasonRoundPublication.Version))
            .Select(result => result.EventTeamId).Distinct().ToListAsync(ct);
        var memberships = profile.Teams.Concat(publishedTeams).Distinct()
            .Select(teamId => new Membership(teamId, null, null, false)).ToList();
        var initialOnly = await SeasonRiderPrivacy.InitialOnlyProfilesAsync(db, [id], ct);
        var name = SeasonRiderPrivacy.Display(id, profile.DisplayName, initialOnly);
        return await BuildAsync(StatsSubjectKind.Team, StatsNames.Tidy(name), id.ToString(), memberships, viewer, ct);
    }

    /// <summary>
    /// How each team in an age group has finished in earlier, finished competitions, for the stream's Favourites card. A
    /// team's past entries are the ones linked to its season profile plus teams with the same name (as the public team
    /// stats page matches them). Each past entry counts as its final place divided by the teams placed in that age
    /// group, so a win in a big field and a win in a small one both read as "near the top". Only team names and that
    /// one figure leave here; hors concours teams are left out, and so is the competition itself.
    /// </summary>
    public async Task<List<FavouriteHistoryDto>> FavouriteHistoryAsync(int competitionId, int sectionId, CancellationToken ct = default)
    {
        var current = await db.Teams.AsNoTracking()
            .Where(t => t.CompetitionId == competitionId && t.CompetitionSectionId == sectionId && !t.IsHorsConcours)
            .Select(t => new { t.Id, t.DisplayName }).ToListAsync(ct);
        if (current.Count == 0) return [];
        var currentIds = current.Select(t => t.Id).ToList();
        var lowerNames = current.Select(t => t.DisplayName.Trim().ToLower()).Distinct().ToList();

        // team id in this event -> earlier team ids that count as the same team
        var pastOf = current.ToDictionary(t => t.Id, _ => new HashSet<int>());
        var byName = await db.Teams.AsNoTracking()
            .Where(t => t.CompetitionId != competitionId && lowerNames.Contains(t.DisplayName.Trim().ToLower()))
            .Select(t => new { t.Id, t.DisplayName }).ToListAsync(ct);
        foreach (var team in current)
        {
            var key = StatsNames.Normalise(team.DisplayName);
            foreach (var past in byName.Where(p => StatsNames.Normalise(p.DisplayName) == key)) pastOf[team.Id].Add(past.Id);
        }
        var links = await db.Set<EventTeamProfileLink>().AsNoTracking()
            .Where(l => currentIds.Contains(l.TeamId) && l.CompetitionId == competitionId)
            .Select(l => new { l.TeamId, l.TeamProfileId }).ToListAsync(ct);
        if (links.Count > 0)
        {
            var profileIds = links.Select(l => l.TeamProfileId).Distinct().ToList();
            var linked = await db.Set<EventTeamProfileLink>().AsNoTracking()
                .Where(l => profileIds.Contains(l.TeamProfileId) && l.CompetitionId != competitionId)
                .Select(l => new { l.TeamId, l.TeamProfileId }).ToListAsync(ct);
            foreach (var link in links)
                foreach (var past in linked.Where(l => l.TeamProfileId == link.TeamProfileId)) pastOf[link.TeamId].Add(past.TeamId);
        }

        var pastIds = pastOf.Values.SelectMany(v => v).Distinct().ToList();
        var rows = pastIds.Count == 0 ? [] : await db.Teams.AsNoTracking()
            .Where(t => pastIds.Contains(t.Id) && !t.IsHorsConcours)
            .Select(t => new TeamRow(t.Id, t.DisplayName, t.Club != null ? t.Club.Name : string.Empty, t.IsHorsConcours,
                t.CompetitionId, t.Competition!.Name, t.Competition.StartDate,
                t.CompetitionSectionId, t.Section != null ? t.Section.DisplayName : string.Empty,
                t.Section != null ? t.Section.Format : SectionFormat.Teams))
            .ToListAsync(ct);
        var counted = await CountedCompetitionsAsync(rows.Select(t => t.CompetitionId), ct);
        rows = rows.Where(t => counted.Contains(t.CompetitionId)).ToList();
        var places = await PlacesAsync(rows, ct);

        return current.Select(team =>
        {
            var shares = pastOf[team.Id]
                .Where(id => places.TryGetValue(id, out var p) && p.TeamsPlaced > 1)
                .Select(id => (double)places[id].Place / places[id].TeamsPlaced)
                .ToList();
            return new FavouriteHistoryDto(team.Id, StatsNames.Tidy(team.DisplayName),
                shares.Count == 0 ? null : Math.Round(shares.Average(), 4), shares.Count);
        }).ToList();
    }

    private async Task<StatsProfileDto?> TeamsProfileAsync(StatsSubjectKind kind, string key, List<NameRow> rows, StatsViewer viewer, CancellationToken ct)
    {
        var mine = rows.Where(r => StatsNames.Normalise(r.Name) == key).ToList();
        if (mine.Count == 0) return null;
        var memberships = mine.Select(r => new Membership(r.TeamId, null, null, false)).ToList();
        return await BuildAsync(kind, StatsNames.Tidy(mine[0].Name), key, memberships, viewer, ct);
    }

    private async Task<StatsProfileDto> BuildAsync(
        StatsSubjectKind kind, string name, string key, List<Membership> memberships, StatsViewer viewer, CancellationToken ct)
    {
        var allFormats = kind is StatsSubjectKind.Team or StatsSubjectKind.Club;
        var teamIds = memberships.Select(m => m.TeamId).Distinct().ToList();
        var teams = teamIds.Count == 0 ? [] : await db.Teams.AsNoTracking()
            .Where(t => teamIds.Contains(t.Id))
            .Select(t => new TeamRow(t.Id, t.DisplayName, t.Club != null ? t.Club.Name : string.Empty, t.IsHorsConcours,
                t.CompetitionId, t.Competition!.Name, t.Competition.StartDate,
                t.CompetitionSectionId, t.Section != null ? t.Section.DisplayName : string.Empty,
                t.Section != null ? t.Section.Format : SectionFormat.Teams))
            .ToListAsync(ct);
        var counted = await CountedCompetitionsAsync(teams.Select(t => t.CompetitionId), ct);
        var teamById = teams.Where(t => counted.Contains(t.CompetitionId)).ToDictionary(t => t.TeamId);
        var kept = memberships
            .Where(m => teamById.TryGetValue(m.TeamId, out var t) && (!m.IsReserve || t.Format == SectionFormat.Teams))
            .ToList();
        var entryTeams = kept.Select(m => m.TeamId).Distinct().Select(id => teamById[id])
            .OrderByDescending(t => t.StartDate).ThenBy(t => t.CompetitionName).ThenBy(t => t.SectionName).ThenBy(t => t.TeamId)
            .ToList();
        var ids = entryTeams.Select(t => t.TeamId).ToList();

        var results = ids.Count == 0 ? [] : await db.Results.AsNoTracking()
            .Where(r => ids.Contains(r.TeamId) && r.Race!.IsComplete && !r.IsSitOut)
            .Select(r => new ResultRow(r.TeamId, r.RaceId, r.Race!.Name, r.Race.Heat!.SessionId, r.Race.Heat.Session!.Name,
                r.Race.Heat.Session.OrderIndex, r.Race.Heat.RaceRoundStage, r.Placing, r.Eliminated, r.Points))
            .ToListAsync(ct);
        var sessionIds = results.Select(r => r.SessionId).Distinct().ToList();
        var bases = await SessionBasesAsync(sessionIds, ct);
        // The winner's points: one in a race-finals qualifier, otherwise the session's largest field. Never below
        // what was actually given, so a quota can't pass 100% if a heat was resized after scoring.
        double MaxFor(ResultRow r) => Math.Max(r.Stage == RaceRoundStage.Qualifier ? 1 : bases.GetValueOrDefault(r.SessionId), r.Points);
        var places = await PlacesAsync(entryTeams.Where(t => !t.IsHorsConcours).ToList(), ct);

        var raceScope = results.Where(r => allFormats || teamById[r.TeamId].Format != SectionFormat.Teams).ToList();
        var placed = entryTeams.Where(t => places.ContainsKey(t.TeamId)).Select(t => places[t.TeamId]).ToList();
        var finalsEntries = placed.Count(p => p.SectionHasFinals);
        var aFinals = placed.Count(p => p.FinalTier == 0);
        var bFinals = placed.Count(p => p.FinalTier == 1);
        var cFinals = placed.Count(p => p.FinalTier == 2);
        var wins = raceScope.Count(IsWin);
        var points = raceScope.Sum(r => r.Points);
        var maxPoints = raceScope.Sum(MaxFor);
        var summary = new StatsSummaryDto(
            entryTeams.Select(t => t.CompetitionId).Distinct().Count(), entryTeams.Count, placed.Count,
            placed.Count(p => p.Place == 1), placed.Count(p => p.Place == 2), placed.Count(p => p.Place == 3),
            placed.Count == 0 ? null : Math.Round(placed.Average(p => p.Place), 1, MidpointRounding.AwayFromZero),
            finalsEntries, placed.Count(p => p.FinalTier is not null), aFinals, StatsNames.Percent(aFinals, finalsEntries),
            raceScope.Count, wins, StatsNames.Percent(wins, raceScope.Count),
            points, maxPoints, StatsNames.Percent(points, maxPoints),
            bFinals, cFinals);

        var games = raceScope
            .GroupBy(r => StatsNames.Normalise(r.RaceName))
            .Select(g =>
            {
                var gameWins = g.Count(IsWin);
                var gamePoints = g.Sum(r => r.Points);
                var gameMax = g.Sum(MaxFor);
                var avgPoints = Math.Round(gamePoints / g.Count(), 1, MidpointRounding.AwayFromZero);
                var placedRaces = g.Where(r => !r.Eliminated && r.Placing is > 0).Select(r => r.Placing!.Value).ToList();
                var avgPlace = placedRaces.Count == 0 ? (double?)null : Math.Round(placedRaces.Average(), 1, MidpointRounding.AwayFromZero);
                // A team profile also lists each run, oldest first, so the page can draw them. Other kinds don't need them.
                var runs = kind != StatsSubjectKind.Team ? null : g
                    .Select(r => (Row: r, Team: teamById[r.TeamId]))
                    .OrderByDescending(x => x.Team.StartDate).ThenByDescending(x => x.Row.SessionOrder).ThenByDescending(x => x.Row.RaceId)
                    .Take(MaxRunsPerGame)
                    .OrderBy(x => x.Team.StartDate).ThenBy(x => x.Row.SessionOrder).ThenBy(x => x.Row.RaceId)
                    .Select(x => new StatsRunDto(x.Team.CompetitionName, x.Team.StartDate,
                        !x.Row.Eliminated && x.Row.Placing is > 0 ? x.Row.Placing : null, x.Row.Eliminated, x.Row.Points, MaxFor(x.Row)))
                    .ToList();
                return new StatsGameDto(StatsNames.Tidy(g.First().RaceName), g.Count(), gameWins, StatsNames.Percent(gameWins, g.Count()),
                    g.Count(r => r.Eliminated), gamePoints, gameMax, StatsNames.Percent(gamePoints, gameMax), avgPoints, avgPlace, runs);
            })
            .OrderByDescending(g => g.PointQuotaPercent ?? -1).ThenByDescending(g => g.Races)
            .ThenBy(g => g.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        // Best and worst never overlap: with five games, the top three are best and the other two worst.
        var bestCount = Math.Min(3, (games.Count + 1) / 2);
        var best = games.Take(bestCount).Select(g => g.Name).ToList();
        var worst = games.Skip(bestCount).Reverse().Take(3).Select(g => g.Name).ToList();

        // Everyone gets the same detail (games, entries, partnerships, clubs and seasons). Only the names differ:
        // site admins see full names, everyone else sees what each rider chose to show.

        var sessionTables = await SessionTablesAsync(sessionIds, ct);
        var resultsByTeam = results.ToLookup(r => r.TeamId);
        var membersByTeam = kept.ToLookup(m => m.TeamId);
        var entries = entryTeams.Select(t =>
        {
            var teamResults = resultsByTeam[t.TeamId].ToList();
            var placing = places.GetValueOrDefault(t.TeamId);
            var sessions = teamResults
                .GroupBy(r => r.SessionId)
                .OrderBy(g => g.First().SessionOrder).ThenBy(g => g.Key)
                .Select(g =>
                {
                    var table = sessionTables.GetValueOrDefault(g.Key) ?? [];
                    var mine = g.Sum(r => r.Points);
                    int? rank = t.IsHorsConcours ? null : 1 + table.Count(other => other.Value > mine);
                    return new StatsSessionDto(g.Key, g.First().SessionName, mine, g.Sum(MaxFor), rank, table.Count);
                })
                .ToList();
            var members = membersByTeam[t.TeamId].ToList();
            var teamPoints = teamResults.Sum(r => r.Points);
            var teamMax = teamResults.Sum(MaxFor);
            return new StatsEntryDto(
                t.CompetitionId, t.CompetitionName, t.StartDate, t.SectionId, t.SectionName, t.Format,
                t.TeamId, t.TeamName, t.ClubName, t.IsHorsConcours,
                kind == StatsSubjectKind.Pony ? JoinNames(members.Select(m => m.RiderName)) : null,
                kind == StatsSubjectKind.Rider ? JoinNames(members.Select(m => m.PonyName)) : null,
                placing?.Place, placing?.TeamsPlaced ?? 0, placing?.FinalTier,
                teamResults.Count, teamPoints, teamMax, StatsNames.Percent(teamPoints, teamMax), sessions);
        }).ToList();

        var partnerships = allFormats
            ? await TeamPartnershipsAsync(teamById, ids, viewer, ct)
            : Partnerships(kept.Where(m => m.RiderName is not null && m.PonyName is not null)
                .Select(m => (m.RiderName!, m.PonyName!, teamById[m.TeamId].CompetitionId, m.TeamId)));

        var clubs = kind == StatsSubjectKind.Club ? [] : entries
            .Where(e => !string.IsNullOrWhiteSpace(e.ClubName))
            .GroupBy(e => StatsNames.Normalise(e.ClubName))
            .Select(g => new StatsClubDto(
                StatsNames.Tidy(g.First().ClubName),
                g.Count(),
                g.Select(e => e.CompetitionId).Distinct().Count(),
                g.Min(e => e.StartDate).ToString("yyyy-MM-dd"),
                g.Max(e => e.StartDate).ToString("yyyy-MM-dd")))
            .OrderByDescending(c => c.Competitions).ThenByDescending(c => c.Entries)
            .ThenBy(c => c.ClubName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var eventTeamIds = entries.Select(e => e.TeamId).ToArray();
        var seasonMemberships = await db.Set<SeasonRoundResult>().AsNoTracking()
            .Where(r => eventTeamIds.Contains(r.EventTeamId)
                && r.SeasonRoundPublication!.SeasonRound!.IsIncluded
                && !db.Set<SeasonRoundPublication>().Any(newer =>
                    newer.SeasonRoundId == r.SeasonRoundPublication.SeasonRoundId
                    && newer.Version > r.SeasonRoundPublication.Version))
            .Select(r => new { r.SeasonRoundPublication!.SeasonRound!.SeasonId, r.TeamProfileId })
            .Distinct().ToListAsync(ct);
        var seasons = new List<StatsSeasonStandingDto>();
        foreach (var group in seasonMemberships.GroupBy(m => m.SeasonId))
        {
            var table = await Services.Seasons.SeasonStandingsCalculator.CalculateAsync(db, group.Key, ct);
            if (table is null) continue;
            var profileIds = group.Select(m => m.TeamProfileId).ToHashSet();
            seasons.AddRange(table.Standings.Where(row => profileIds.Contains(row.TeamProfileId))
                .Select(row => new StatsSeasonStandingDto(table.SeasonId, table.Title, table.Year,
                    row.Rank, row.TotalPoints, row.Rounds.Count, row.TeamProfileId, row.TeamName)));
        }
        seasons = seasons.OrderByDescending(s => s.Year).ThenBy(s => s.SeasonName).ThenBy(s => s.Rank).ToList();

        return new StatsProfileDto(kind, name, key, true, allFormats, summary, games, best, worst, entries, partnerships, clubs, seasons);
    }

    private static bool IsWin(ResultRow r) => r.Placing == 1 && !r.Eliminated;

    private static string? JoinNames(IEnumerable<string?> names)
    {
        var list = names.Where(n => !string.IsNullOrEmpty(n)).Select(n => n!)
            .DistinctBy(StatsNames.Normalise).ToList();
        return list.Count == 0 ? null : string.Join(" / ", list);
    }

    private static string? PonyName(string? horse, decimal? heightHands = null)
    {
        var tidy = StatsNames.Tidy(horse);
        if (tidy.Length == 0) return null;
        return heightHands is > 0 ? FormattableString.Invariant($"{tidy} ({heightHands.Value:0.##}hh)") : tidy;
    }

    private static string BasePonyName(string name)
    {
        var open = name.LastIndexOf(" (", StringComparison.Ordinal);
        return open > 0 && name.EndsWith("hh)", StringComparison.OrdinalIgnoreCase) && TryParseHeightToken(name[(open + 1)..], out _)
            ? name[..open]
            : name;
    }

    private static decimal PonyHeightSortKey(string name)
    {
        var open = name.LastIndexOf(" (", StringComparison.Ordinal);
        return open > 0 && name.EndsWith("hh)", StringComparison.OrdinalIgnoreCase) && TryParseHeightToken(name[(open + 1)..], out var hh)
            ? hh
            : decimal.MaxValue;
    }

    private static bool TryParseHeightToken(string token, out decimal hands)
    {
        hands = 0m;
        var trimmed = token.Trim('(', ')', ' ');
        if (!trimmed.EndsWith("hh", StringComparison.OrdinalIgnoreCase)) return false;
        return decimal.TryParse(trimmed[..^2], NumberStyles.Number, CultureInfo.InvariantCulture, out hands) && hands > 0m;
    }

    private async Task<List<StatsPartnershipDto>> TeamPartnershipsAsync(
        Dictionary<int, TeamRow> teamById, List<int> ids, StatsViewer viewer, CancellationToken ct)
    {
        if (ids.Count == 0) return [];
        var riders = await PublicRiders()
            .Where(r => ids.Contains(r.DeclarationForm!.TeamId) && r.HorseName != null)
            .Select(r => new { r.FullName, UseInitialOnly = r.UseInitialOnly || (r.SavedRider != null && r.SavedRider.UseInitialOnly), r.HorseName, r.PonyHeightHands, r.DeclarationForm!.TeamId })
            .ToListAsync(ct);
        return Partnerships(riders
            .Where(r => PonyName(r.HorseName, r.PonyHeightHands) is not null)
            .Select(r => (StatsNames.Tidy(RiderNames.Display(r.FullName, r.UseInitialOnly, viewer.SeesFullNames)),
                PonyName(r.HorseName, r.PonyHeightHands)!, teamById[r.TeamId].CompetitionId, r.TeamId)));
    }

    private static List<StatsPartnershipDto> Partnerships(IEnumerable<(string Rider, string Pony, int CompetitionId, int TeamId)> pairs)
        => pairs
            .GroupBy(p => (StatsNames.Normalise(p.Rider), StatsNames.Normalise(p.Pony)))
            .Select(g => new StatsPartnershipDto(g.First().Rider, g.First().Pony,
                g.Select(p => p.TeamId).Distinct().Count(), g.Select(p => p.CompetitionId).Distinct().Count()))
            .OrderByDescending(p => p.Entries).ThenBy(p => p.RiderName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(p => p.PonyName, StringComparer.OrdinalIgnoreCase)
            .ToList();

    // ----- queries -----

    /// <summary>Riders on each team's latest locked declaration form: the one public pages show.</summary>
    private IQueryable<RiderEntry> PublicRiders() => db.RiderEntries.AsNoTracking()
        .Where(r => r.DeclarationForm!.IsLocked
            && r.DeclarationFormId == db.DeclarationForms
                .Where(f => f.TeamId == r.DeclarationForm.TeamId && f.IsLocked)
                .OrderByDescending(f => f.SubmittedAt).ThenByDescending(f => f.Id)
                .Select(f => f.Id).FirstOrDefault());

    private IQueryable<Team> PublicTeams() => db.Teams.AsNoTracking();

    // Each token is copied into its own local so every Where captures its own word.
    private IQueryable<RiderEntry> RidersNamed(IReadOnlyList<string> tokens)
    {
        var q = PublicRiders();
        foreach (var token in tokens) { var word = token; q = q.Where(r => r.FullName.ToLower().Contains(word)); }
        return q;
    }

    private IQueryable<RiderEntry> PoniesNamed(IReadOnlyList<string> tokens)
    {
        var q = PublicRiders().Where(r => r.HorseName != null);
        foreach (var token in tokens)
        {
            var word = token;
            if (TryParseHeightToken(word, out var hh))
                q = q.Where(r => r.PonyHeightHands == hh || r.HorseName!.ToLower().Contains(word));
            else
                q = q.Where(r => r.HorseName!.ToLower().Contains(word));
        }
        return q;
    }

    private IQueryable<Team> TeamsNamed(IReadOnlyList<string> tokens)
    {
        var q = PublicTeams();
        foreach (var token in tokens) { var word = token; q = q.Where(t => t.DisplayName.ToLower().Contains(word)); }
        return q;
    }

    private IQueryable<Team> ClubsNamed(IReadOnlyList<string> tokens)
    {
        var q = PublicTeams().Where(t => t.Club != null);
        foreach (var token in tokens) { var word = token; q = q.Where(t => t.Club!.Name.ToLower().Contains(word)); }
        return q;
    }

    private static IQueryable<RiderRow> RiderRows(IQueryable<RiderEntry> q, int max) => q
        .OrderByDescending(r => r.DeclarationForm!.Team!.Competition!.StartDate).ThenByDescending(r => r.Id)
        .Take(max)
        .Select(r => new RiderRow(r.FullName, r.UseInitialOnly || (r.SavedRider != null && r.SavedRider.UseInitialOnly), r.HorseName, r.PonyHeightHands, r.IsReserve,
            r.DeclarationForm!.TeamId, r.DeclarationForm.Team!.CompetitionId, r.DeclarationForm.Team.Section!.Format));

    /// <summary>
    /// The competitions whose results count: at least one race scored, and either over (archived or past its
    /// last day) or with every race scored. Demo events count like any other. One query for any number of
    /// competitions, or for all of them when <paramref name="competitionIds"/> is null.
    /// </summary>
    private async Task<HashSet<int>> CountedCompetitionsAsync(IEnumerable<int>? competitionIds, CancellationToken ct)
    {
        var ids = competitionIds?.Distinct().ToList();
        if (ids is { Count: 0 }) return [];
        var today = DateTime.UtcNow.Date;
        var rows = await db.Competitions.AsNoTracking()
            .Where(c => ids == null || ids.Contains(c.Id))
            .Select(c => new
            {
                c.Id,
                Over = c.IsArchived || (c.EndDate ?? c.StartDate) < today,
                Scored = db.Races.Any(r => r.Heat!.Session!.CompetitionId == c.Id && r.IsComplete),
                Open = db.Races.Any(r => r.Heat!.Session!.CompetitionId == c.Id && !r.IsComplete
                    && r.Heat.Session.Kind == SessionKind.Race && !r.Heat.Session.IsBreak),
            })
            .ToListAsync(ct);
        return rows.Where(r => r.Scored && (r.Over || !r.Open)).Select(r => r.Id).ToHashSet();
    }

    /// <summary>Each session's largest field, as <see cref="ScoringService.GetSessionBaseAsync"/> works it out.</summary>
    private async Task<Dictionary<int, int>> SessionBasesAsync(List<int> sessionIds, CancellationToken ct)
    {
        if (sessionIds.Count == 0) return [];
        var heats = await db.Heats.AsNoTracking()
            .Where(h => sessionIds.Contains(h.SessionId))
            .Select(h => new { h.SessionId, Size = h.Entries.Count, Lanes = h.Session!.LanesPerHeat })
            .ToListAsync(ct);
        return heats.GroupBy(h => h.SessionId)
            .ToDictionary(g => g.Key, g => g.Max(h => LaneRotation.LanesInUse(h.Size, h.Lanes)));
    }

    /// <summary>Session points of every team in each session (hors concours left out), for a rank.</summary>
    private async Task<Dictionary<int, Dictionary<int, double>>> SessionTablesAsync(List<int> sessionIds, CancellationToken ct)
    {
        if (sessionIds.Count == 0) return [];
        var rows = await db.Results.AsNoTracking()
            .Where(r => sessionIds.Contains(r.Race!.Heat!.SessionId) && r.Race.IsComplete && !r.Team!.IsHorsConcours)
            .Select(r => new { r.Race!.Heat!.SessionId, r.TeamId, r.Points })
            .GroupBy(r => new { r.SessionId, r.TeamId })
            .Select(g => new { g.Key.SessionId, g.Key.TeamId, Points = g.Sum(r => r.Points) })
            .ToListAsync(ct);
        return rows.GroupBy(r => r.SessionId)
            .ToDictionary(g => g.Key, g => g.ToDictionary(r => r.TeamId, r => r.Points));
    }

    /// <summary>
    /// Final places from the standings themselves (one call per age group entered), so finals tiers, tie rules
    /// and any bonus points stay exactly as the standings page shows them.
    /// </summary>
    private async Task<Dictionary<int, Placing>> PlacesAsync(List<TeamRow> teams, CancellationToken ct)
    {
        _ = _standings;
        var places = new Dictionary<int, Placing>();
        if (teams.Count == 0) return places;

        var compIds = teams.Select(t => t.CompetitionId).Distinct().ToList();
        var sectionIds = teams.Select(t => t.SectionId).Distinct().ToList();

        var allTeams = await db.Teams.AsNoTracking()
            .Include(t => t.Results)
            .Where(t => compIds.Contains(t.CompetitionId) && sectionIds.Contains(t.CompetitionSectionId) && !t.IsHorsConcours)
            .ToListAsync(ct);
        var allSections = await db.CompetitionSections.AsNoTracking()
            .Where(s => compIds.Contains(s.CompetitionId) && sectionIds.Contains(s.Id))
            .ToDictionaryAsync(s => s.Id, ct);

        var teamsByCompSection = allTeams.GroupBy(t => (t.CompetitionId, t.CompetitionSectionId))
            .ToDictionary(g => g.Key, g => g.ToList());

        foreach (var compGroup in teams.GroupBy(t => t.CompetitionId))
        {
            var compId = compGroup.Key;
            var tiers = await FinalsTiers.LoadAsync(db, compId, ct);
            var ties = await TieBreaker.LoadAsync(db, compId, ct);
            var bonus = await TackCheck.TackCheckBonus.ForCompetitionAsync(db, compId, ct);

            foreach (var sectionGroup in compGroup.GroupBy(t => t.SectionId))
            {
                if (!teamsByCompSection.TryGetValue((compId, sectionGroup.Key), out var sectionTeams) || sectionTeams.Count == 0)
                    continue;
                var section = allSections.GetValueOrDefault(sectionGroup.Key);
                var scores = sectionTeams.ToDictionary(t => t.Id, t =>
                {
                    var inFinal = tiers.TierOf(t.Id) is not null;
                    var effectiveResults = ties.EffectiveResults(t.Results);
                    var finalResults = effectiveResults.Where(r => ties.IsFinalRace(r.RaceId)).ToList();
                    var finalPoints = finalResults.Sum(r => r.Points);
                    var earlier = effectiveResults.Sum(r => r.Points) - finalPoints;
                    var total = SectionScoring.Total(section, inFinal, earlier, finalPoints, bonus.GetValueOrDefault(t.Id));
                    var alone = inFinal && !SectionScoring.CarriesIntoFinal(section);
                    return (Total: total, Tier: tiers.TierOf(t.Id), TieResults: alone ? finalResults : effectiveResults);
                });
                var facts = sectionTeams.ToDictionary(t => t.Id, t => ties.Facts(t.Id, t.CompetitionSectionId, scores[t.Id].TieResults, scores[t.Id].Total));
                var ordered = sectionTeams
                    .GroupBy(t => (Tier: scores[t.Id].Tier ?? FinalsTiers.NotInFinals, scores[t.Id].Total))
                    .OrderBy(g => g.Key.Tier)
                    .ThenByDescending(g => g.Key.Total)
                    .SelectMany(g => ties.OrderLevel(g.Select(t => facts[t.Id]).ToList()))
                    .ToList();

                var hasFinals = ordered.Any(f => scores[f.TeamId].Tier is not null);
                var wanted = sectionGroup.Select(t => t.TeamId).ToHashSet();
                for (var i = 0; i < ordered.Count; i++)
                {
                    var teamId = ordered[i].TeamId;
                    if (wanted.Contains(teamId))
                        places[teamId] = new Placing(i + 1, ordered.Count, scores[teamId].Tier, hasFinals);
                }
            }
        }
        return places;
    }
}
