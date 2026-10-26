using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Services.Operations;

public sealed class DrawValidationException(string message) : InvalidOperationException(message);
public sealed class DrawChangedException(string message) : InvalidOperationException(message);

public class CompetitionDrawService(AppDbContext db)
{
    public static bool IsFinalSession(Session s)
        => Regex.IsMatch(s.Name ?? string.Empty, @"\b([A-Z]\s+)?Finals?\b", RegexOptions.IgnoreCase)
            || (s.Heats.Count > 0 && s.Heats.All(h => FinalsTiers.ParseLabel(h.Label) is not null));

    public async Task<DrawPreviewDto> PreviewAsync(
        int competitionId, int sectionId, int seed, CancellationToken cancellationToken = default)
    {
        var sectionExists = await db.CompetitionSections.AsNoTracking()
            .AnyAsync(s => s.Id == sectionId && s.CompetitionId == competitionId, cancellationToken);
        if (!sectionExists) throw new KeyNotFoundException("Section not found.");

        var teams = await db.Teams.AsNoTracking()
            .Where(t => t.CompetitionId == competitionId && t.CompetitionSectionId == sectionId
                && t.EntryStatus == TeamEntryStatus.Active)
            .OrderBy(t => t.Id)
            .Select(t => new TeamInput(t.Id, t.DisplayName, t.ClubId))
            .ToListAsync(cancellationToken);
        if (teams.Count == 0) throw new DrawValidationException("The section has no teams to draw.");

        var sessions = (await db.Sessions.AsNoTracking()
            .Where(s => s.CompetitionId == competitionId && s.CompetitionSectionId == sectionId
                && s.Kind == SessionKind.Race && !s.IsBreak)
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .OrderBy(s => s.OrderIndex).ThenBy(s => s.Id)
            .ToListAsync(cancellationToken))
            .Where(s => !IsFinalSession(s))
            .ToList();
        if (sessions.Count == 0) throw new DrawValidationException("The section has no race sessions to draw.");
        if (sessions.Any(s => s.Heats.Count == 0))
            throw new DrawValidationException("Every race session must have at least one heat before drawing.");
        if (sessions.SelectMany(s => s.Heats).Any(h => h.RaceRoundStage != RaceRoundStage.None))
            throw new DrawValidationException("Race-finals heats cannot be redrawn with the section draw.");
        if (sessions.Any(s => s.Status != SessionStatus.Upcoming || s.StartedAt is not null || s.FinishedAt is not null)
            || sessions.SelectMany(s => s.Heats).Any(h => h.StartedAt is not null || h.FinishedAt is not null)
            || sessions.SelectMany(s => s.Heats).SelectMany(h => h.Races)
                .Any(r => r.StartedAt is not null || r.FinishedAt is not null))
            throw new DrawValidationException("Started or finished sessions cannot be redrawn.");
        if (sessions.SelectMany(s => s.Heats).SelectMany(h => h.Races)
            .Any(r => r.IsComplete || r.Results.Count > 0))
            throw new DrawValidationException("Scored or completed races cannot be redrawn.");
        // One team more than the lanes is fine: the extra team sits out each race in turn. More than that,
        // or a session that never moves teams between lanes, would leave teams that never race.
        if (sessions.Any(s => s.LanesPerHeat is > 0
                && BalancedSizes(teams.Count, s.Heats.Count).Max() > s.LanesPerHeat.Value + 1))
            throw new DrawValidationException("There are more teams per heat than the session's lane limit allows.");
        if (sessions.Any(s => s.LanesPerHeat is > 0 && s.LaneRotationMode == LaneRotationMode.Stay
                && BalancedSizes(teams.Count, s.Heats.Count).Max() > s.LanesPerHeat.Value))
            throw new DrawValidationException("A heat with more teams than lanes needs the teams to change lane between races.");

        var opponentCounts = new Dictionary<(int Low, int High), int>();
        var laneCounts = teams.ToDictionary(t => t.Id, _ => new Dictionary<int, int>());
        var smallHeatCounts = teams.ToDictionary(t => t.Id, _ => 0);
        var output = new List<DrawSessionDto>();

        foreach (var session in sessions)
        {
            var heats = session.Heats.OrderBy(h => h.OrderIndex).ThenBy(h => h.Id).ToList();
            var sizes = BalancedSizes(teams.Count, heats.Count);
            var maxHeatSize = sizes.DefaultIfEmpty(0).Max();
            var available = teams.ToDictionary(t => t.Id);
            var drawnHeats = new List<DrawHeatDto>();

            for (var heatIndex = 0; heatIndex < heats.Count; heatIndex++)
            {
                var selected = new List<TeamInput>();
                var isSmallerHeat = sizes[heatIndex] < maxHeatSize;
                for (var lane = 1; lane <= sizes[heatIndex]; lane++)
                {
                    var candidate = available.Values
                        .Select(team => new
                        {
                            Team = team,
                            OpponentCost = selected.Sum(other => OpponentCount(opponentCounts, team.Id, other.Id)),
                            ClubCost = selected.Count(other => other.ClubId == team.ClubId),
                            SmallHeatCost = isSmallerHeat ? smallHeatCounts[team.Id] : 0,
                            LaneCost = laneCounts[team.Id].GetValueOrDefault(lane),
                            Tie = StableTie(seed, session.Id, heats[heatIndex].Id, lane, team.Id),
                        })
                        .OrderBy(x => x.OpponentCost)
                        .ThenBy(x => x.ClubCost)
                        .ThenBy(x => x.SmallHeatCost)
                        .ThenBy(x => x.LaneCost)
                        .ThenBy(x => x.Tie)
                        .ThenBy(x => x.Team.Id)
                        .First().Team;
                    selected.Add(candidate);
                    available.Remove(candidate.Id);
                    laneCounts[candidate.Id][lane] = laneCounts[candidate.Id].GetValueOrDefault(lane) + 1;
                    if (isSmallerHeat) smallHeatCounts[candidate.Id]++;
                }

                foreach (var pair in Pairs(selected.Select(t => t.Id)))
                    opponentCounts[pair] = opponentCounts.GetValueOrDefault(pair) + 1;

                var heat = heats[heatIndex];
                drawnHeats.Add(new DrawHeatDto(heat.Id, heat.Label, heat.OrderIndex,
                    selected.Select((team, index) =>
                        new DrawTeamAssignmentDto(team.Id, team.Name, index + 1)).ToList()));
            }

            output.Add(new DrawSessionDto(session.Id, session.Name, drawnHeats));
        }

        var heatSizes = output.SelectMany(s => s.Heats).Select(h => h.Teams.Count).ToList();
        var repeatedPairs = opponentCounts.Count(x => x.Value > 1);
        var maximumMeetings = opponentCounts.Values.DefaultIfEmpty(0).Max();
        var maximumLane = heatSizes.DefaultIfEmpty(0).Max();
        var maximumLaneSpread = laneCounts.Values
            .Select(counts => Enumerable.Range(1, maximumLane).Select(lane => counts.GetValueOrDefault(lane)).DefaultIfEmpty(0))
            .Select(counts => counts.Max() - counts.Min())
            .DefaultIfEmpty(0).Max();
        var covered = output.All(session =>
            session.Heats.SelectMany(h => h.Teams).Select(t => t.TeamId).Order().SequenceEqual(teams.Select(t => t.Id)));
        var warnings = new List<string>();
        if (maximumMeetings > 1) warnings.Add($"Some opponents meet up to {maximumMeetings} times.");
        if (maximumLaneSpread > 1) warnings.Add("Some teams use one lane more often than other lanes.");

        var fingerprint = Fingerprint(competitionId, sectionId, seed, teams, sessions, output);
        return new DrawPreviewDto(sectionId, seed, fingerprint, output,
            new DrawFairnessDto(teams.Count, sessions.Count,
                heatSizes.Max() - heatSizes.Min(), maximumMeetings, repeatedPairs,
                maximumLaneSpread, covered, warnings));
    }

    public async Task<DrawPreviewDto> ApplyAsync(
        int competitionId, int sectionId, ApplyDrawRequest request,
        CancellationToken cancellationToken = default, string? actorUserId = null)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
            var preview = await PreviewAsync(competitionId, sectionId, request.Seed, cancellationToken);
            if (!CryptographicOperations.FixedTimeEquals(
                    Encoding.UTF8.GetBytes(preview.Fingerprint), Encoding.UTF8.GetBytes(request.Fingerprint ?? string.Empty)))
                throw new DrawChangedException("The draw inputs changed after preview. Preview the draw again.");

            var sessionIds = preview.Sessions.Select(s => s.SessionId).Distinct().ToList();
            var sessionsBefore = await db.Sessions.AsNoTracking()
                .Where(s => s.CompetitionId == competitionId && sessionIds.Contains(s.Id))
                .Include(s => s.Heats).ThenInclude(h => h.Entries)
                .Include(s => s.Heats).ThenInclude(h => h.Races)
                .ToListAsync(cancellationToken);
            var sectionName = await db.CompetitionSections.AsNoTracking()
                .Where(s => s.Id == sectionId && s.CompetitionId == competitionId)
                .Select(s => s.DisplayName)
                .FirstOrDefaultAsync(cancellationToken) ?? $"Section {sectionId}";
            var undoSnapshotJson = DrawUndoService.BuildSnapshotJson(
                "SectionDraw",
                $"Draw for {sectionName}",
                sessionsBefore,
                sectionId: sectionId);

            var heatIds = preview.Sessions.SelectMany(s => s.Heats).Select(h => h.HeatId).ToList();
            var oldEntries = await db.HeatEntries.Where(e => heatIds.Contains(e.HeatId)).ToListAsync(cancellationToken);
            db.HeatEntries.RemoveRange(oldEntries);
            foreach (var heat in preview.Sessions.SelectMany(s => s.Heats))
            foreach (var team in heat.Teams)
                db.HeatEntries.Add(new HeatEntry { HeatId = heat.HeatId, TeamId = team.TeamId, LaneIndex = team.LaneIndex });

            // A withdrawal can be undone only until a draw has been built without the team.
            db.Set<DrawChange>().Add(new DrawChange
            {
                CompetitionId = competitionId,
                SectionId = sectionId,
                Kind = DrawChangeKind.SectionDraw,
                RequestId = $"section-draw-{Guid.NewGuid():N}",
                Fingerprint = preview.Fingerprint,
                ActorUserId = actorUserId,
                ResultJson = undoSnapshotJson,
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            var undoStatus = await DrawUndoService.GetStatusAsync(db, competitionId, cancellationToken);
            return preview with { DrawUndo = undoStatus };
        });
    }

    private static int[] BalancedSizes(int teams, int heats)
    {
        var small = teams / heats;
        var larger = teams % heats;
        return Enumerable.Range(0, heats).Select(i => small + (i < larger ? 1 : 0)).ToArray();
    }

    private static int OpponentCount(Dictionary<(int Low, int High), int> counts, int first, int second)
        => counts.GetValueOrDefault(NormalPair(first, second));

    private static IEnumerable<(int Low, int High)> Pairs(IEnumerable<int> ids)
    {
        var list = ids.ToList();
        for (var i = 0; i < list.Count; i++)
        for (var j = i + 1; j < list.Count; j++)
            yield return NormalPair(list[i], list[j]);
    }

    private static (int Low, int High) NormalPair(int first, int second)
        => first < second ? (first, second) : (second, first);

    private static ulong StableTie(int seed, int sessionId, int heatId, int lane, int teamId)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{seed}:{sessionId}:{heatId}:{lane}:{teamId}"));
        return BitConverter.ToUInt64(bytes, 0);
    }

    private static string Fingerprint(int competitionId, int sectionId, int seed,
        IReadOnlyList<TeamInput> teams, IReadOnlyList<Session> sessions, IReadOnlyList<DrawSessionDto> output)
    {
        var source = new StringBuilder()
            .Append(competitionId).Append('|').Append(sectionId).Append('|').Append(seed);
        foreach (var team in teams)
            source.Append("|t:").Append(team.Id).Append(':').Append(team.Name);
        foreach (var session in sessions.OrderBy(s => s.Id))
        {
            source.Append("|s:").Append(session.Id).Append(':').Append(session.OrderIndex).Append(':')
                .Append(session.Name).Append(':').Append(session.LanesPerHeat);
            foreach (var heat in session.Heats.OrderBy(h => h.Id))
            {
                source.Append("|h:").Append(heat.Id).Append(':').Append(heat.OrderIndex).Append(':')
                    .Append(heat.Label).Append(':').Append(heat.RaceRoundId).Append(':').Append((int)heat.RaceRoundStage);
                foreach (var entry in heat.Entries.OrderBy(e => e.Id))
                    source.Append("|e:").Append(entry.Id).Append(':').Append(entry.TeamId).Append(':').Append(entry.LaneIndex);
                foreach (var race in heat.Races.OrderBy(r => r.Id))
                    source.Append("|r:").Append(race.Id).Append(':').Append(race.OrderIndex).Append(':')
                        .Append(race.Name).Append(':').Append(race.IsComplete).Append(':').Append(race.Results.Count);
            }
        }
        foreach (var heat in output.SelectMany(s => s.Heats))
        foreach (var team in heat.Teams)
            source.Append("|a:").Append(heat.HeatId).Append(':').Append(team.TeamId).Append(':').Append(team.LaneIndex);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source.ToString()))).ToLowerInvariant();
    }

    public static List<List<int>> DrawGroups(
        IReadOnlyList<(int TeamId, int ClubId)> teams,
        int groupCount,
        int seed,
        int contextId,
        Dictionary<(int Low, int High), int>? opponentCounts = null,
        Dictionary<int, Dictionary<int, int>>? laneCounts = null,
        Dictionary<int, int>? smallHeatCounts = null)
    {
        if (groupCount < 1) groupCount = 1;
        opponentCounts ??= new Dictionary<(int Low, int High), int>();
        laneCounts ??= new Dictionary<int, Dictionary<int, int>>();
        smallHeatCounts ??= new Dictionary<int, int>();
        foreach (var t in teams)
        {
            if (!laneCounts.ContainsKey(t.TeamId)) laneCounts[t.TeamId] = new Dictionary<int, int>();
            if (!smallHeatCounts.ContainsKey(t.TeamId)) smallHeatCounts[t.TeamId] = 0;
        }

        var sizes = BalancedSizes(teams.Count, groupCount);
        var maxHeatSize = sizes.DefaultIfEmpty(0).Max();
        var available = teams.OrderBy(t => t.TeamId).ToDictionary(t => t.TeamId);
        var groups = new List<List<int>>(groupCount);

        for (var heatIndex = 0; heatIndex < groupCount; heatIndex++)
        {
            var selected = new List<(int TeamId, int ClubId)>();
            var isSmallerHeat = sizes[heatIndex] < maxHeatSize;
            for (var lane = 1; lane <= sizes[heatIndex]; lane++)
            {
                var candidate = available.Values
                    .Select(team => new
                    {
                        Team = team,
                        OpponentCost = selected.Sum(other => OpponentCount(opponentCounts, team.TeamId, other.TeamId)),
                        ClubCost = selected.Count(other => other.ClubId == team.ClubId),
                        SmallHeatCost = isSmallerHeat ? smallHeatCounts.GetValueOrDefault(team.TeamId) : 0,
                        LaneCost = laneCounts[team.TeamId].GetValueOrDefault(lane),
                        Tie = StableTie(seed, contextId, heatIndex + 1, lane, team.TeamId),
                    })
                    .OrderBy(x => x.OpponentCost)
                    .ThenBy(x => x.ClubCost)
                    .ThenBy(x => x.SmallHeatCost)
                    .ThenBy(x => x.LaneCost)
                    .ThenBy(x => x.Tie)
                    .ThenBy(x => x.Team.TeamId)
                    .First().Team;
                selected.Add(candidate);
                available.Remove(candidate.TeamId);
                laneCounts[candidate.TeamId][lane] = laneCounts[candidate.TeamId].GetValueOrDefault(lane) + 1;
                if (isSmallerHeat) smallHeatCounts[candidate.TeamId] = smallHeatCounts.GetValueOrDefault(candidate.TeamId) + 1;
            }
            foreach (var pair in Pairs(selected.Select(t => t.TeamId)))
                opponentCounts[pair] = opponentCounts.GetValueOrDefault(pair) + 1;
            groups.Add(selected.Select(t => t.TeamId).ToList());
        }
        return groups;
    }

    public static void RecordExistingHeats(
        IEnumerable<Heat> heats,
        Dictionary<(int Low, int High), int> opponentCounts,
        Dictionary<int, Dictionary<int, int>> laneCounts,
        Dictionary<int, int> smallHeatCounts)
    {
        var list = heats.Where(h => h.Entries.Count > 0 && h.RaceRoundStage != RaceRoundStage.Final).ToList();
        if (list.Count == 0) return;
        var maxSize = list.Max(h => h.Entries.Count);
        foreach (var h in list)
        {
            var entries = h.Entries.OrderBy(e => e.LaneIndex).ThenBy(e => e.Id).ToList();
            var isSmaller = entries.Count < maxSize;
            foreach (var e in entries)
            {
                if (!laneCounts.TryGetValue(e.TeamId, out var lanes))
                    laneCounts[e.TeamId] = lanes = new Dictionary<int, int>();
                lanes[e.LaneIndex] = lanes.GetValueOrDefault(e.LaneIndex) + 1;
                if (isSmaller) smallHeatCounts[e.TeamId] = smallHeatCounts.GetValueOrDefault(e.TeamId) + 1;
            }
            foreach (var pair in Pairs(entries.Select(e => e.TeamId)))
                opponentCounts[pair] = opponentCounts.GetValueOrDefault(pair) + 1;
        }
    }

    private sealed record TeamInput(int Id, string Name, int ClubId);
}
