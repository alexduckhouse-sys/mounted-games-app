using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Services.Operations;

/// <summary>
/// After a team withdraws, shows how the section's unscored heats would be tidied (heats merged, sizes
/// rebalanced, lanes closed up, empty heats removed) and applies it only when the organiser confirms.
/// It never touches a scored, signed-off or started heat, or a final. The result is a pure function of the
/// current timetable, so the same state always gives the same preview.
/// </summary>
public class WithdrawalRedrawService(AppDbContext db)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>A heat with fewer teams than this isn't a race, so such heats are merged away.</summary>
    private const int MinHeatSize = 2;

    public async Task<RedrawPreviewDto> PreviewAsync(
        int competitionId, int sectionId, CancellationToken ct = default)
    {
        if (!await db.CompetitionSections.AsNoTracking()
                .AnyAsync(s => s.Id == sectionId && s.CompetitionId == competitionId, ct))
            throw new KeyNotFoundException("Section not found.");

        var outTeams = await db.Teams.AsNoTracking()
            .Where(t => t.CompetitionId == competitionId && t.CompetitionSectionId == sectionId
                && t.EntryStatus != TeamEntryStatus.Active)
            .OrderBy(t => t.Id)
            .Select(t => new WithdrawnTeamDto(t.Id, t.DisplayName, t.EntryStatus))
            .ToListAsync(ct);
        var outIds = outTeams.Select(t => t.TeamId).ToHashSet();

        var sessions = await db.Sessions.AsNoTracking()
            .Where(s => s.CompetitionId == competitionId && s.CompetitionSectionId == sectionId
                && s.Kind == SessionKind.Race && !s.IsBreak)
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .OrderBy(s => s.OrderIndex).ThenBy(s => s.Id)
            .ToListAsync(ct);
        var names = await db.Teams.AsNoTracking()
            .Where(t => t.CompetitionId == competitionId)
            .ToDictionaryAsync(t => t.Id, t => t.DisplayName, ct);
        var signedOff = await HeatProtection.SignedOffRaceIdsAsync(
            db, sessions.SelectMany(s => s.Heats).SelectMany(h => h.Races).Select(r => r.Id), ct);

        var notes = new List<string>();
        var fingerprint = new StringBuilder().Append(competitionId).Append('|').Append(sectionId);
        foreach (var team in outTeams) fingerprint.Append("|o:").Append(team.TeamId).Append(':').Append((int)team.Status);

        // Where every team sits right now. Sessions are processed in order and each result is written back,
        // so later sessions see the earlier ones' new arrangement when they weigh up who has met whom.
        var arrangement = sessions.SelectMany(s => s.Heats).ToDictionary(
            h => h.Id,
            h => h.Entries.OrderBy(e => e.LaneIndex).ThenBy(e => e.Id).Select(e => e.TeamId).ToList());

        var output = new List<RedrawSessionDto>();
        foreach (var session in sessions)
        {
            var heats = session.Heats.OrderBy(h => h.OrderIndex).ThenBy(h => h.Id).ToList();
            fingerprint.Append("|s:").Append(session.Id).Append(':').Append(session.LanesPerHeat).Append(':').Append(session.Status);
            foreach (var heat in heats)
            {
                var isProtected = HeatProtection.IsProtected(heat, session, signedOff);
                fingerprint.Append("|h:").Append(heat.Id).Append(':').Append(heat.OrderIndex).Append(':').Append(heat.Label)
                    .Append(':').Append(isProtected ? 'p' : 'u').Append(':').Append(heat.Races.Count);
                foreach (var entry in heat.Entries.OrderBy(e => e.LaneIndex).ThenBy(e => e.Id))
                    fingerprint.Append("|e:").Append(entry.TeamId).Append(':').Append(entry.LaneIndex);
            }

            if (outIds.Count == 0) continue;
            // A finals session or a race-finals round isn't redrawn: who is in it was decided by results.
            if (heats.Any(h => h.RaceRoundStage != RaceRoundStage.None || FinalsTiers.ParseLabel(h.Label) is not null))
                continue;
            var unscored = heats.Where(h => !HeatProtection.IsProtected(h, session, signedOff)).ToList();
            if (unscored.Count == 0) continue;

            var plan = Plan(session, heats, unscored, outIds, arrangement, names, notes);
            if (plan is null) continue;
            output.Add(plan);
            foreach (var heat in plan.After) arrangement[heat.HeatId] = heat.Teams.Select(t => t.TeamId).ToList();
            foreach (var removedId in plan.RemovedHeatIds) arrangement[removedId] = [];
        }

        if (outTeams.Count == 0)
            notes.Add("No team in this section is withdrawn, so there is nothing to re-draw.");
        else if (output.Count == 0)
            notes.Add("The unscored heats are already tidy. Nothing needs to change.");
        foreach (var session in output)
            fingerprint.Append("|a:").Append(session.SessionId).Append(':')
                .Append(string.Join(',', session.After.Select(h => $"{h.HeatId}={string.Join('-', h.Teams.Select(t => $"{t.TeamId}@{t.LaneIndex}"))}")))
                .Append(':').Append(string.Join(',', session.RemovedHeatIds));

        return new RedrawPreviewDto(sectionId,
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(fingerprint.ToString()))).ToLowerInvariant(),
            output.Count > 0, outTeams, output, notes);
    }

    /// <summary>Plans one session, or null when its unscored heats need no change.</summary>
    private static RedrawSessionDto? Plan(
        Session session, List<Heat> heats, List<Heat> unscored, HashSet<int> outIds,
        Dictionary<int, List<int>> arrangement, Dictionary<int, string> names, List<string> notes)
    {
        // Teams per unscored heat, in lane order, without anyone who is out.
        var pool = unscored.ToDictionary(h => h.Id, h => arrangement[h.Id].Where(id => !outIds.Contains(id)).ToList());
        var total = pool.Values.Sum(l => l.Count);
        var nonEmpty = unscored.Where(h => pool[h.Id].Count > 0).ToList();
        // With no lane limit set, only the "too small to race" rule merges heats.
        var cap = session.LanesPerHeat is > 0 ? session.LanesPerHeat.Value : int.MaxValue;

        var keep = nonEmpty.Count;
        if (keep > 0)
        {
            while (keep > 1 && BalancedSizes(total, keep).Min() < MinHeatSize) keep--;
            while (keep < nonEmpty.Count && BalancedSizes(total, keep).Max() > cap) keep++;
            if (BalancedSizes(total, keep).Max() > cap)
                notes.Add($"{session.Name}: heats hold more teams than the lane limit of {cap}. Check the lanes setting.");
        }
        var kept = nonEmpty.Take(keep).ToList();
        var dropped = unscored.Where(h => !kept.Contains(h)).ToList();

        // Bigger target sizes go to the heats that are bigger now, so the fewest teams move.
        var targets = new Dictionary<int, int>();
        var sizes = keep == 0 ? [] : BalancedSizes(total, keep);
        var bySize = kept.Select((heat, index) => (heat, index)).OrderByDescending(x => pool[x.heat.Id].Count).ThenBy(x => x.index).ToList();
        for (var i = 0; i < bySize.Count; i++) targets[bySize[i].heat.Id] = sizes[i];

        var next = kept.ToDictionary(h => h.Id, h => pool[h.Id].ToList());
        var movers = new List<(int TeamId, int FromHeatId)>();
        foreach (var heat in kept)
        {
            var list = next[heat.Id];
            while (list.Count > targets[heat.Id])
            {
                movers.Add((list[^1], heat.Id));
                list.RemoveAt(list.Count - 1);
            }
        }
        foreach (var heat in dropped)
            foreach (var teamId in pool[heat.Id]) movers.Add((teamId, heat.Id));

        // Who has already raced whom, from every heat except the unscored ones being tidied.
        var meetings = new Dictionary<(int, int), int>();
        var tidied = unscored.Select(h => h.Id).ToHashSet();
        foreach (var (heatId, teams) in arrangement)
        {
            if (tidied.Contains(heatId)) continue;
            AddMeetings(meetings, teams);
        }
        foreach (var heat in kept) AddMeetings(meetings, next[heat.Id]);

        foreach (var (teamId, fromHeatId) in movers)
        {
            var target = kept
                .Where(h => next[h.Id].Count < targets[h.Id])
                .Select(h => new
                {
                    Heat = h,
                    Cost = next[h.Id].Sum(other => meetings.GetValueOrDefault(Pair(teamId, other))),
                    Tie = StableTie(session.Id, h.Id, teamId),
                })
                .OrderBy(x => x.Cost).ThenBy(x => x.Tie).ThenBy(x => x.Heat.OrderIndex).ThenBy(x => x.Heat.Id)
                .First().Heat;
            foreach (var other in next[target.Id])
                meetings[Pair(teamId, other)] = meetings.GetValueOrDefault(Pair(teamId, other)) + 1;
            next[target.Id].Add(teamId);
        }

        string Name(int teamId) => names.GetValueOrDefault(teamId, $"Team {teamId}");
        var before = unscored.Select(h => new DrawHeatDto(h.Id, h.Label, h.OrderIndex,
            h.Entries.OrderBy(e => e.LaneIndex).ThenBy(e => e.Id)
                .Select(e => new DrawTeamAssignmentDto(e.TeamId, Name(e.TeamId), e.LaneIndex)).ToList())).ToList();
        var after = kept.Select(h => new DrawHeatDto(h.Id, h.Label, h.OrderIndex,
            next[h.Id].Select((teamId, index) => new DrawTeamAssignmentDto(teamId, Name(teamId), index + 1)).ToList())).ToList();

        var removed = dropped.Select(h => h.Id).ToList();
        var beforeById = before.ToDictionary(h => h.HeatId);
        var changed = removed.Count > 0 || after.Any(h =>
            !beforeById[h.HeatId].Teams.Select(t => (t.TeamId, t.LaneIndex)).SequenceEqual(h.Teams.Select(t => (t.TeamId, t.LaneIndex))));
        if (!changed) return null;

        var from = before.SelectMany(h => h.Teams.Select(t => (t.TeamId, HeatId: h.HeatId))).ToDictionary(x => x.TeamId, x => x.HeatId);
        var to = after.SelectMany(h => h.Teams.Select(t => (t.TeamId, HeatId: h.HeatId))).ToDictionary(x => x.TeamId, x => x.HeatId);
        var moves = to.Where(kv => !from.TryGetValue(kv.Key, out var was) || was != kv.Value)
            .OrderBy(kv => kv.Key)
            .Select(kv => new RedrawHeatMoveDto(kv.Key, Name(kv.Key), from.TryGetValue(kv.Key, out var was) ? was : null, kv.Value))
            .ToList();
        if (removed.Count > 0)
            notes.Add($"{session.Name}: {(removed.Count == 1 ? "1 heat" : $"{removed.Count} heats")} would be removed.");

        return new RedrawSessionDto(session.Id, session.Name, heats.Count - unscored.Count, before, after, removed, moves);
    }

    public async Task<(RedrawPreviewDto Preview, IReadOnlyList<int> ChangedSessionIds)> ApplyAsync(
        int competitionId, int sectionId, ApplyRedrawRequest request, string? actorUserId,
        CancellationToken ct = default)
    {
        var requestId = (request.RequestId ?? string.Empty).Trim();
        if (requestId.Length is 0 or > 100) throw new EntryValidationException("A request id of up to 100 characters is required.");
        if (string.IsNullOrWhiteSpace(request.Fingerprint)) throw new EntryValidationException("A preview fingerprint is required.");

        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);

            // A retry of a request that already went through gets the same answer back.
            var earlier = await db.Set<DrawChange>().AsNoTracking()
                .FirstOrDefaultAsync(d => d.CompetitionId == competitionId && d.RequestId == requestId, ct);
            if (earlier is not null)
            {
                if (earlier.SectionId != sectionId || earlier.Kind != DrawChangeKind.Redraw)
                    throw new DrawChangedException("That request id was already used for something else.");
                var stored = JsonSerializer.Deserialize<RedrawPreviewDto>(earlier.ResultJson, Json)
                    ?? throw new DrawChangedException("The stored result could not be read.");
                return (stored with { Replayed = true }, stored.Sessions.Select(s => s.SessionId).ToList());
            }

            var preview = await PreviewAsync(competitionId, sectionId, ct);
            if (!CryptographicOperations.FixedTimeEquals(
                    Encoding.UTF8.GetBytes(preview.Fingerprint), Encoding.UTF8.GetBytes(request.Fingerprint)))
                throw new DrawChangedException("The timetable changed after this preview. Preview the re-draw again.");
            if (!preview.HasChanges) throw new DrawValidationException("There is nothing to re-draw.");

            var heatIds = preview.Sessions.SelectMany(s => s.After.Select(h => h.HeatId).Concat(s.RemovedHeatIds)).ToList();
            var heats = await db.Heats
                .Include(h => h.Entries)
                .Include(h => h.Races)
                .Where(h => heatIds.Contains(h.Id))
                .ToDictionaryAsync(h => h.Id, ct);

            foreach (var session in preview.Sessions)
            {
                foreach (var planned in session.After)
                {
                    var heat = heats[planned.HeatId];
                    var current = heat.Entries.OrderBy(e => e.LaneIndex).ThenBy(e => e.Id).Select(e => (e.TeamId, e.LaneIndex));
                    if (current.SequenceEqual(planned.Teams.Select(t => (t.TeamId, t.LaneIndex)))) continue;
                    db.HeatEntries.RemoveRange(heat.Entries);
                    foreach (var team in planned.Teams)
                        db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = team.TeamId, LaneIndex = team.LaneIndex });
                }
                foreach (var heatId in session.RemovedHeatIds)
                {
                    var heat = heats[heatId];
                    db.HeatEntries.RemoveRange(heat.Entries);
                    db.Races.RemoveRange(heat.Races);
                    db.Heats.Remove(heat);
                }
            }

            db.Set<DrawChange>().Add(new DrawChange
            {
                CompetitionId = competitionId,
                SectionId = sectionId,
                Kind = DrawChangeKind.Redraw,
                RequestId = requestId,
                Fingerprint = preview.Fingerprint,
                ActorUserId = actorUserId,
                ResultJson = JsonSerializer.Serialize(preview, Json),
                CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return (preview, preview.Sessions.Select(s => s.SessionId).ToList());
        });
    }

    private static int[] BalancedSizes(int teams, int heats)
    {
        var small = teams / heats;
        var larger = teams % heats;
        return Enumerable.Range(0, heats).Select(i => small + (i < larger ? 1 : 0)).ToArray();
    }

    private static (int Low, int High) Pair(int a, int b) => a < b ? (a, b) : (b, a);

    private static void AddMeetings(Dictionary<(int, int), int> meetings, IReadOnlyList<int> teams)
    {
        for (var i = 0; i < teams.Count; i++)
            for (var j = i + 1; j < teams.Count; j++)
                meetings[Pair(teams[i], teams[j])] = meetings.GetValueOrDefault(Pair(teams[i], teams[j])) + 1;
    }

    private static ulong StableTie(int sessionId, int heatId, int teamId)
        => BitConverter.ToUInt64(SHA256.HashData(Encoding.UTF8.GetBytes($"redraw:{sessionId}:{heatId}:{teamId}")), 0);
}
