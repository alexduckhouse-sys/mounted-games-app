using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Operations;

public class CommentatorBriefingService(AppDbContext db)
{
    public async Task<CommentatorBriefingDto> GetAsync(
        int competitionId,
        int sessionId,
        int heatId,
        CancellationToken ct = default)
    {
        var session = await db.Sessions
            .AsNoTracking()
            .Include(s => s.Section)
            .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team).ThenInclude(t => t!.Club)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.CompetitionId == competitionId, ct)
            ?? throw new KeyNotFoundException("Session not found.");

        var heat = session.Heats.FirstOrDefault(h => h.Id == heatId)
            ?? throw new KeyNotFoundException("Heat not found in this session.");

        var sectionId = session.CompetitionSectionId;
        var allSectionSessions = await db.Sessions
            .AsNoTracking()
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .Where(s => s.CompetitionId == competitionId
                && !s.IsBreak
                && s.Kind == SessionKind.Race
                && (sectionId == null || s.CompetitionSectionId == sectionId))
            .OrderBy(s => s.OrderIndex)
            .ThenBy(s => s.Id)
            .ToListAsync(ct);

        var sectionTeams = await db.Teams
            .AsNoTracking()
            .Include(t => t.Club)
            .Include(t => t.DeclarationForms).ThenInclude(df => df.Riders)
            .Where(t => t.CompetitionId == competitionId
                && (sectionId == null || t.CompetitionSectionId == sectionId))
            .ToListAsync(ct);

        var teamsById = sectionTeams.ToDictionary(t => t.Id);

        // Compute current standings across all scored races in the section.
        var allCompletedRaces = allSectionSessions
            .SelectMany(s => s.Heats)
            .SelectMany(h => h.Races)
            .Where(r => r.IsComplete)
            .ToList();

        var activeTeams = sectionTeams
            .Where(t => !t.IsHorsConcours && t.EntryStatus == TeamEntryStatus.Active)
            .ToList();

        var standings = activeTeams
            .Select(t =>
            {
                var teamResults = allCompletedRaces
                    .SelectMany(r => r.Results)
                    .Where(res => res.TeamId == t.Id)
                    .ToList();
                var totalPoints = teamResults.Sum(res => res.Points);
                var wins = teamResults.Count(res => !res.Eliminated && res.Placing == 1);
                var racesRun = teamResults.Count(res => !res.IsSitOut);
                return (Team: t, TotalPoints: totalPoints, Wins: wins, RacesRun: racesRun);
            })
            .OrderByDescending(x => x.TotalPoints)
            .ThenByDescending(x => x.Wins)
            .ThenBy(x => x.Team.DisplayName)
            .ToList();

        var rankByTeamId = new Dictionary<int, int>();
        var pointsByTeamId = new Dictionary<int, double>();
        for (var i = 0; i < standings.Count; i++)
        {
            rankByTeamId[standings[i].Team.Id] = i + 1;
            pointsByTeamId[standings[i].Team.Id] = standings[i].TotalPoints;
        }

        // Compute biggest standings mover from the latest finished session compared with earlier sessions.
        string? biggestMoverHeadline = ComputeBiggestMoverHeadline(allSectionSessions, activeTeams, rankByTeamId);

        var cutline = Math.Clamp(
            session.Section?.FinalistCount ?? session.LanesPerHeat ?? 5,
            2,
            Math.Max(2, standings.Count));
        var cutlinePoints = standings.Count >= cutline ? standings[cutline - 1].TotalPoints : 0;
        var firstOutsidePoints = standings.Count > cutline ? standings[cutline].TotalPoints : 0;
        var hasScoredRaces = standings.Any(s => s.RacesRun > 0);

        var orderedHeatRaces = heat.Races.OrderBy(r => r.OrderIndex).ThenBy(r => r.Id).ToList();
        var currentRace = orderedHeatRaces.FirstOrDefault(r => !r.IsComplete) ?? orderedHeatRaces.LastOrDefault();
        var canonicalCurrentGame = currentRace is not null
            ? BuiltInRaceMetadata.ResolveCanonicalName(currentRace.Name)
            : null;

        var lanes = new List<CommentatorLaneSquadDto>();
        var talkingPoints = new List<string>();

        foreach (var entry in heat.Entries.OrderBy(e => e.LaneIndex).ThenBy(e => e.Id))
        {
            teamsById.TryGetValue(entry.TeamId, out var team);
            var teamName = team?.DisplayName ?? entry.Team?.DisplayName ?? $"Team {entry.TeamId}";
            var clubName = team?.Club?.Name ?? entry.Team?.Club?.Name ?? string.Empty;
            var bibColour = string.IsNullOrWhiteSpace(entry.BibColourOverride)
                ? (team?.BibColour ?? entry.Team?.BibColour)
                : entry.BibColourOverride;
            var bibDesc = ResultStatuses.PublicBibDescription(team?.BibDescription ?? entry.Team?.BibDescription);
            var flag = ResultStatuses.TeamFlagOf(team?.BibDescription ?? entry.Team?.BibDescription);

            var ridersAndPonies = ExtractPrivacySafeSquad(team);
            var rank = rankByTeamId.TryGetValue(entry.TeamId, out var r) ? (int?)r : null;
            var pts = pointsByTeamId.GetValueOrDefault(entry.TeamId, 0);

            string? stakesHeadline = null;
            if (hasScoredRaces && rank.HasValue)
            {
                if (rank.Value == 1)
                {
                    var leadMargin = standings.Count > 1 ? pts - standings[1].TotalPoints : 0;
                    stakesHeadline = leadMargin > 0
                        ? $"Leading overall on {PointValues.Format(pts)} pts (+{PointValues.Format(leadMargin)} clear of 2nd)"
                        : $"Joint leader on {PointValues.Format(pts)} pts";
                }
                else if (standings.Count > cutline && rank.Value <= cutline)
                {
                    var cushion = pts - firstOutsidePoints;
                    stakesHeadline = $"#{rank.Value} overall ({PointValues.Format(pts)} pts) — +{PointValues.Format(cushion)} pts above the Top {cutline} A-Final cutline";
                }
                else if (standings.Count > cutline && rank.Value > cutline)
                {
                    var deficit = cutlinePoints - pts;
                    if (deficit <= 10)
                        stakesHeadline = $"#{rank.Value} overall ({PointValues.Format(pts)} pts) — {PointValues.Format(deficit)} pts off the Top {cutline} A-Final cutline";
                    else
                        stakesHeadline = $"#{rank.Value} overall ({PointValues.Format(pts)} pts)";
                }
                else
                {
                    stakesHeadline = $"#{rank.Value} overall ({PointValues.Format(pts)} pts)";
                }
            }

            var specialistNote = BuildGameSpecialistNote(
                entry.TeamId,
                canonicalCurrentGame,
                allCompletedRaces,
                orderedHeatRaces);

            lanes.Add(new CommentatorLaneSquadDto(
                LaneIndex: entry.LaneIndex,
                TeamId: entry.TeamId,
                TeamName: teamName,
                ClubName: clubName,
                BibColour: bibColour,
                BibDescription: bibDesc,
                Flag: flag,
                CurrentRank: rank,
                TotalPoints: pts,
                RidersAndPonies: ridersAndPonies,
                StakesHeadline: stakesHeadline,
                GameSpecialistNote: specialistNote));

            if (stakesHeadline is not null && (rank == 1 || rank == cutline || rank == cutline + 1))
                talkingPoints.Add($"Lane {entry.LaneIndex} ({teamName}): {stakesHeadline}.");
            if (specialistNote is not null)
                talkingPoints.Add($"Lane {entry.LaneIndex} ({teamName}): {specialistNote}.");
        }

        if (!string.IsNullOrWhiteSpace(biggestMoverHeadline))
            talkingPoints.Insert(0, biggestMoverHeadline!);

        if (talkingPoints.Count == 0 && currentRace is not null)
            talkingPoints.Add($"Up next in {(!string.IsNullOrWhiteSpace(heat.Label) ? heat.Label : $"Heat {heat.OrderIndex}")}: {currentRace.Name}.");

        var heatLabel = !string.IsNullOrWhiteSpace(heat.Label) ? heat.Label!.Trim() : $"Heat {heat.OrderIndex}";
        return new CommentatorBriefingDto(
            CompetitionId: competitionId,
            SessionId: session.Id,
            SessionName: session.Name,
            HeatId: heat.Id,
            HeatLabel: heatLabel,
            CurrentRaceId: currentRace?.Id,
            CurrentRaceName: currentRace?.Name,
            TalkingPoints: talkingPoints.Take(6).ToList(),
            BiggestMoverHeadline: biggestMoverHeadline,
            Lanes: lanes);
    }

    private static IReadOnlyList<string> ExtractPrivacySafeSquad(Team? team)
    {
        if (team?.DeclarationForms is null || team.DeclarationForms.Count == 0)
            return [];

        var latest = team.DeclarationForms
            .OrderByDescending(d => d.IsLocked)
            .ThenByDescending(d => d.SubmittedAt)
            .ThenByDescending(d => d.Id)
            .FirstOrDefault();
        if (latest is null) return [];

        var list = new List<string>();
        foreach (var rider in latest.Riders.OrderBy(r => r.IsReserve).ThenBy(r => r.OrderIndex).ThenBy(r => r.Id))
        {
            var safeName = RiderNames.Display(rider.FullName, rider.UseInitialOnly, viewerSeesFullNames: false);
            var pony = CompetitionFields.Trimmed(rider.HorseName);
            var suffix = rider.IsCaptain ? " (Capt)" : rider.IsReserve ? " (Reserve)" : string.Empty;
            var line = !string.IsNullOrEmpty(pony)
                ? $"{safeName} on {pony}{suffix}"
                : $"{safeName}{suffix}";
            list.Add(line);
        }
        return list;
    }

    private static string? BuildGameSpecialistNote(
        int teamId,
        string? canonicalCurrentGame,
        IReadOnlyList<Race> allCompletedRaces,
        IReadOnlyList<Race> heatRaces)
    {
        var notes = new List<string>();

        if (!string.IsNullOrWhiteSpace(canonicalCurrentGame))
        {
            var sameGameRaces = allCompletedRaces
                .Where(r => string.Equals(
                    BuiltInRaceMetadata.ResolveCanonicalName(r.Name),
                    canonicalCurrentGame,
                    StringComparison.OrdinalIgnoreCase))
                .ToList();

            var runs = 0;
            var wins = 0;
            foreach (var r in sameGameRaces)
            {
                var res = r.Results.FirstOrDefault(x => x.TeamId == teamId && !x.IsSitOut);
                if (res is null) continue;
                runs++;
                if (!res.Eliminated && res.Placing == 1) wins++;
            }

            if (wins >= 2)
                notes.Add($"Won {wins} of {runs} in {canonicalCurrentGame}");
            else if (wins == 1 && runs == 1)
                notes.Add($"Won their previous {canonicalCurrentGame} run");
        }

        // Check heat win streak
        var completedInHeat = heatRaces.Where(r => r.IsComplete).OrderByDescending(r => r.OrderIndex).ToList();
        var streak = 0;
        foreach (var r in completedInHeat)
        {
            var res = r.Results.FirstOrDefault(x => x.TeamId == teamId);
            if (res is null || res.Eliminated || res.Placing != 1) break;
            streak++;
        }
        if (streak >= 2)
            notes.Add($"On a {streak}-race win streak in this heat");
        else if (streak == 1 && notes.Count == 0)
            notes.Add("Won the last race in this heat");

        return notes.Count == 0 ? null : string.Join(" · ", notes);
    }

    private static string? ComputeBiggestMoverHeadline(
        IReadOnlyList<Session> sessions,
        IReadOnlyList<Team> activeTeams,
        IReadOnlyDictionary<int, int> currentRankByTeam)
    {
        var scoredSessions = sessions
            .Where(s => s.Heats.Any(h => h.Races.Any(r => r.IsComplete)))
            .ToList();
        if (scoredSessions.Count < 2) return null;

        var priorRaces = scoredSessions
            .Take(scoredSessions.Count - 1)
            .SelectMany(s => s.Heats)
            .SelectMany(h => h.Races)
            .Where(r => r.IsComplete)
            .ToList();
        if (priorRaces.Count == 0) return null;

        var latestSession = scoredSessions[^1];
        var latestRaces = latestSession.Heats.SelectMany(h => h.Races).Where(r => r.IsComplete).ToList();

        var priorOrder = activeTeams
            .Select(t =>
            {
                var pts = priorRaces.SelectMany(r => r.Results).Where(res => res.TeamId == t.Id).Sum(res => res.Points);
                var wins = priorRaces.SelectMany(r => r.Results).Count(res => res.TeamId == t.Id && !res.Eliminated && res.Placing == 1);
                return (Team: t, Points: pts, Wins: wins);
            })
            .OrderByDescending(x => x.Points)
            .ThenByDescending(x => x.Wins)
            .ThenBy(x => x.Team.DisplayName)
            .ToList();

        var bestClimb = 0;
        Team? bestTeam = null;
        double latestSessionGain = 0;

        for (var i = 0; i < priorOrder.Count; i++)
        {
            var prevRank = i + 1;
            var team = priorOrder[i].Team;
            if (!currentRankByTeam.TryGetValue(team.Id, out var nowRank)) continue;
            var climb = prevRank - nowRank;
            if (climb > bestClimb)
            {
                bestClimb = climb;
                bestTeam = team;
                latestSessionGain = latestRaces.SelectMany(r => r.Results).Where(res => res.TeamId == team.Id).Sum(res => res.Points);
            }
        }

        if (bestTeam is null || bestClimb < 1) return null;
        var placesWord = bestClimb == 1 ? "1 place" : $"{bestClimb} places";
        return $"Biggest mover: {bestTeam.DisplayName} climbed {placesWord} to #{currentRankByTeam[bestTeam.Id]} (+{PointValues.Format(latestSessionGain)} pts in {latestSession.Name}).";
    }
}
