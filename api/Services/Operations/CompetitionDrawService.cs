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
            var heatIds = heats.Select(h => h.Id).ToList();
            var sessionAssignments = RunTwoPhaseSessionDraw(
                teams,
                heats.Count,
                seed,
                session.Id,
                heatIds,
                opponentCounts,
                laneCounts,
                smallHeatCounts);

            var drawnHeats = new List<DrawHeatDto>(heats.Count);
            for (var heatIndex = 0; heatIndex < heats.Count; heatIndex++)
            {
                var heat = heats[heatIndex];
                var assignedTeams = sessionAssignments[heatIndex];
                drawnHeats.Add(new DrawHeatDto(
                    heat.Id,
                    heat.Label,
                    heat.OrderIndex,
                    assignedTeams.Select((team, index) =>
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

        var teamInputs = teams
            .OrderBy(t => t.TeamId)
            .Select(t => new TeamInput(t.TeamId, string.Empty, t.ClubId))
            .ToList();
        var heatIds = Enumerable.Range(1, groupCount).ToList();
        var drawn = RunTwoPhaseSessionDraw(
            teamInputs,
            groupCount,
            seed,
            contextId,
            heatIds,
            opponentCounts,
            laneCounts,
            smallHeatCounts);

        return drawn.Select(h => h.Select(t => t.Id).ToList()).ToList();
    }

    private static List<List<TeamInput>> RunTwoPhaseSessionDraw(
        IReadOnlyList<TeamInput> teams,
        int heatCount,
        int seed,
        int sessionId,
        IReadOnlyList<int> heatIds,
        Dictionary<(int Low, int High), int> opponentCounts,
        Dictionary<int, Dictionary<int, int>> laneCounts,
        Dictionary<int, int> smallHeatCounts)
    {
        var sizes = BalancedSizes(teams.Count, heatCount);
        var maxHeatSize = sizes.DefaultIfEmpty(0).Max();
        var available = teams.OrderBy(t => t.Id).ToDictionary(t => t.Id);
        var heatGroups = new List<List<TeamInput>>(heatCount);

        // Phase 1a: Group teams into heats (decoupled from lane index) with lane-compatibility lookahead.
        for (var heatIndex = 0; heatIndex < heatCount; heatIndex++)
        {
            var selected = new List<TeamInput>(sizes[heatIndex]);
            var isSmallerHeat = sizes[heatIndex] < maxHeatSize;
            var heatId = heatIds[heatIndex];

            for (var slot = 1; slot <= sizes[heatIndex]; slot++)
            {
                var candidate = available.Values
                    .Select(team =>
                    {
                        var trial = new List<TeamInput>(selected.Count + 1);
                        trial.AddRange(selected);
                        trial.Add(team);

                        var clubCost = selected.Count(other => other.ClubId == team.ClubId);
                        var smallCost = isSmallerHeat ? smallHeatCounts.GetValueOrDefault(team.Id) : 0;
                        var maxPair = selected.Select(other => OpponentCount(opponentCounts, team.Id, other.Id)).DefaultIfEmpty(0).Max();
                        var oppSum = selected.Sum(other => OpponentCount(opponentCounts, team.Id, other.Id));
                        var laneCompatCost = MinLaneRepeatCost(trial, laneCounts);
                        var tie = StableTie(seed, sessionId, heatId, slot, team.Id);
                        return new
                        {
                            Team = team,
                            ClubCost = clubCost,
                            SmallCost = smallCost,
                            MaxPair = maxPair,
                            OppSum = oppSum,
                            LaneCompatCost = laneCompatCost,
                            Tie = tie,
                        };
                    })
                    .OrderBy(x => x.ClubCost)
                    .ThenBy(x => x.SmallCost)
                    .ThenBy(x => x.MaxPair)
                    .ThenBy(x => x.OppSum)
                    .ThenBy(x => x.LaneCompatCost)
                    .ThenBy(x => x.Tie)
                    .ThenBy(x => x.Team.Id)
                    .First().Team;

                selected.Add(candidate);
                available.Remove(candidate.Id);
            }

            heatGroups.Add(selected);
        }

        // Phase 1b: 2-opt inter-heat swap pass to eliminate residual club clashes, lane bottlenecks, or repeat meetings.
        var improved = true;
        var guard = 0;
        while (improved && guard++ < 40)
        {
            improved = false;
            for (var h1 = 0; h1 < heatGroups.Count; h1++)
            for (var h2 = h1 + 1; h2 < heatGroups.Count; h2++)
            for (var i = 0; i < heatGroups[h1].Count; i++)
            for (var j = 0; j < heatGroups[h2].Count; j++)
            {
                var before1 = HeatGroupScore(heatGroups[h1], sizes[h1] < maxHeatSize, opponentCounts, smallHeatCounts, laneCounts);
                var before2 = HeatGroupScore(heatGroups[h2], sizes[h2] < maxHeatSize, opponentCounts, smallHeatCounts, laneCounts);
                var beforeTotal = AddGroupScores(before1, before2);

                (heatGroups[h1][i], heatGroups[h2][j]) = (heatGroups[h2][j], heatGroups[h1][i]);

                var after1 = HeatGroupScore(heatGroups[h1], sizes[h1] < maxHeatSize, opponentCounts, smallHeatCounts, laneCounts);
                var after2 = HeatGroupScore(heatGroups[h2], sizes[h2] < maxHeatSize, opponentCounts, smallHeatCounts, laneCounts);
                var afterTotal = AddGroupScores(after1, after2);

                if (CompareGroupScores(afterTotal, beforeTotal) < 0)
                {
                    improved = true;
                }
                else
                {
                    (heatGroups[h1][i], heatGroups[h2][j]) = (heatGroups[h2][j], heatGroups[h1][i]);
                }
            }
        }

        // Phase 2: Minimum-cost bipartite matching of teams in each heat to starting lanes 1..k.
        var result = new List<List<TeamInput>>(heatCount);
        for (var heatIndex = 0; heatIndex < heatCount; heatIndex++)
        {
            var group = heatGroups[heatIndex];
            var isSmallerHeat = sizes[heatIndex] < maxHeatSize;
            var heatId = heatIds[heatIndex];
            var orderedByLane = AssignOptimalLanes(group, laneCounts, seed, sessionId, heatId);

            for (var idx = 0; idx < orderedByLane.Count; idx++)
            {
                var team = orderedByLane[idx];
                var lane = idx + 1;
                if (!laneCounts.TryGetValue(team.Id, out var map))
                    laneCounts[team.Id] = map = new Dictionary<int, int>();
                map[lane] = map.GetValueOrDefault(lane) + 1;
                if (isSmallerHeat)
                    smallHeatCounts[team.Id] = smallHeatCounts.GetValueOrDefault(team.Id) + 1;
            }

            foreach (var pair in Pairs(orderedByLane.Select(t => t.Id)))
                opponentCounts[pair] = opponentCounts.GetValueOrDefault(pair) + 1;

            result.Add(orderedByLane);
        }

        return result;
    }

    private readonly record struct GroupScoreTuple(int ClubClashes, int LaneCost, int SmallCost, int MaxPair, int OppSum);

    private static GroupScoreTuple AddGroupScores(GroupScoreTuple a, GroupScoreTuple b) => new(
        a.ClubClashes + b.ClubClashes,
        a.LaneCost + b.LaneCost,
        a.SmallCost + b.SmallCost,
        Math.Max(a.MaxPair, b.MaxPair),
        a.OppSum + b.OppSum);

    private static int CompareGroupScores(GroupScoreTuple a, GroupScoreTuple b)
    {
        var c = a.ClubClashes.CompareTo(b.ClubClashes);
        if (c != 0) return c;
        c = a.LaneCost.CompareTo(b.LaneCost);
        if (c != 0) return c;
        c = a.SmallCost.CompareTo(b.SmallCost);
        if (c != 0) return c;
        c = a.MaxPair.CompareTo(b.MaxPair);
        if (c != 0) return c;
        return a.OppSum.CompareTo(b.OppSum);
    }

    private static GroupScoreTuple HeatGroupScore(
        IReadOnlyList<TeamInput> group,
        bool isSmallerHeat,
        Dictionary<(int Low, int High), int> opponentCounts,
        Dictionary<int, int> smallHeatCounts,
        Dictionary<int, Dictionary<int, int>> laneCounts)
    {
        var clubClashes = 0;
        var maxPair = 0;
        var oppSum = 0;
        for (var i = 0; i < group.Count; i++)
        for (var j = i + 1; j < group.Count; j++)
        {
            if (group[i].ClubId == group[j].ClubId) clubClashes++;
            var c = OpponentCount(opponentCounts, group[i].Id, group[j].Id);
            if (c > maxPair) maxPair = c;
            oppSum += c;
        }
        var smallCost = isSmallerHeat ? group.Sum(t => smallHeatCounts.GetValueOrDefault(t.Id)) : 0;
        var laneCost = MinLaneRepeatCost(group, laneCounts);
        return new GroupScoreTuple(clubClashes, laneCost, smallCost, maxPair, oppSum);
    }

    private static int MinLaneRepeatCost(
        IReadOnlyList<TeamInput> group,
        Dictionary<int, Dictionary<int, int>> laneCounts)
    {
        var k = group.Count;
        if (k == 0 || k > 12) return 0;

        var totalMasks = 1 << k;
        var dp = new int[totalMasks];
        Array.Fill(dp, int.MaxValue / 4);
        dp[0] = 0;

        for (var mask = 0; mask < totalMasks; mask++)
        {
            var idx = System.Numerics.BitOperations.PopCount((uint)mask);
            if (idx >= k) continue;
            var team = group[idx];
            laneCounts.TryGetValue(team.Id, out var teamLanes);

            for (var laneIdx = 0; laneIdx < k; laneIdx++)
            {
                if ((mask & (1 << laneIdx)) != 0) continue;
                var nextMask = mask | (1 << laneIdx);
                var uses = teamLanes?.GetValueOrDefault(laneIdx + 1) ?? 0;
                var cost = dp[mask] + uses * uses;
                if (cost < dp[nextMask]) dp[nextMask] = cost;
            }
        }

        return dp[totalMasks - 1];
    }

    private static List<TeamInput> AssignOptimalLanes(
        IReadOnlyList<TeamInput> group,
        Dictionary<int, Dictionary<int, int>> laneCounts,
        int seed,
        int sessionId,
        int heatId)
    {
        var k = group.Count;
        if (k <= 1) return group.ToList();
        if (k > 12)
        {
            // Fallback for unusually large heats (> 12 lanes)
            return group
                .Select((t, idx) => (Team: t, Tie: StableTie(seed, sessionId, heatId, idx + 1, t.Id)))
                .OrderBy(x => x.Tie)
                .ThenBy(x => x.Team.Id)
                .Select(x => x.Team)
                .ToList();
        }

        var totalMasks = 1 << k;
        var dpCost = new long[totalMasks];
        var dpTie = new ulong[totalMasks];
        var parentMask = new int[totalMasks];
        var chosenTeamIdx = new int[totalMasks];

        Array.Fill(dpCost, long.MaxValue / 4);
        Array.Fill(dpTie, ulong.MaxValue);
        dpCost[0] = 0;
        dpTie[0] = 0;

        for (var mask = 0; mask < totalMasks; mask++)
        {
            var laneIdx = System.Numerics.BitOperations.PopCount((uint)mask);
            if (laneIdx >= k) continue;
            var laneNumber = laneIdx + 1;

            for (var tIdx = 0; tIdx < k; tIdx++)
            {
                if ((mask & (1 << tIdx)) != 0) continue;
                var nextMask = mask | (1 << tIdx);
                var team = group[tIdx];
                var uses = laneCounts.TryGetValue(team.Id, out var map) ? map.GetValueOrDefault(laneNumber) : 0;
                var candidateCost = dpCost[mask] + (long)uses * uses * 1000L + uses;
                // Divide tie by k so summing across k lanes never overflows ulong
                var tieStep = StableTie(seed, sessionId, heatId, laneNumber, team.Id) / (ulong)Math.Max(1, k);
                var candidateTie = dpTie[mask] + tieStep;

                if (candidateCost < dpCost[nextMask]
                    || (candidateCost == dpCost[nextMask] && candidateTie < dpTie[nextMask]))
                {
                    dpCost[nextMask] = candidateCost;
                    dpTie[nextMask] = candidateTie;
                    parentMask[nextMask] = mask;
                    chosenTeamIdx[nextMask] = tIdx;
                }
            }
        }

        var assigned = new TeamInput[k];
        var cur = totalMasks - 1;
        for (var laneIdx = k - 1; laneIdx >= 0; laneIdx--)
        {
            var tIdx = chosenTeamIdx[cur];
            assigned[laneIdx] = group[tIdx];
            cur = parentMask[cur];
        }

        return assigned.ToList();
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
