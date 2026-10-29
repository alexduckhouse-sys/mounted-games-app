using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Services;

public static class WindRaceGuard
{
    // All operations which read-modify-write Session.Notes share this boundary. Lock before reading,
    // including sessions with no heats, and retry the complete transaction on production Postgres.
    public static Task<T> WithTimetableLockAsync<T>(AppDbContext db, int competitionId, Func<Task<T>> action, CancellationToken ct = default)
        => db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
            await db.Sessions.Where(s => s.CompetitionId == competitionId)
                .ExecuteUpdateAsync(set => set.SetProperty(s => s.Notes, s => s.Notes), ct);
            var result = await action();
            await transaction.CommitAsync(ct);
            return result;
        });

    public static bool MatchesProgramme(Session session, WindProgrammeSnapshot? expected)
    {
        if (expected?.PlannedRaces == null || expected.HeatIds == null || expected.Races == null) return false;
        var races = session.Heats.SelectMany(h => h.Races.Select(r =>
            new WindProgrammeRace(r.Id, h.Id, r.OrderIndex, r.Name, r.ProgrammeRevision)));
        return (PlannedRaceList.Read(session.PlannedRaces) ?? []).SequenceEqual(expected.PlannedRaces)
            && session.Heats.Select(h => h.Id).Order().SequenceEqual(expected.HeatIds.Order())
            && races.OrderBy(r => r.RaceId).SequenceEqual(expected.Races.OrderBy(r => r.RaceId));
    }

    public static void CheckVersion(Race race, int? expected)
    {
        if (race.ProgrammeRevision != (expected ?? 0))
            throw new ScoreConflictException("The race programme changed. Your scores are still on this phone. Review the new race before scoring it.");
    }

    // A real row update shares the same database lock as scoring/start, across API instances.
    // Call inside the transaction BEFORE loading the programme.
    public static Task<int> LockSessionAsync(AppDbContext db, int sessionId, CancellationToken ct = default)
        => db.Heats.Where(h => h.SessionId == sessionId).ExecuteUpdateAsync(
            set => set.SetProperty(h => h.StartedAt, h => h.StartedAt), ct);

    public static async Task<bool> ProtectedAsync(AppDbContext db, IEnumerable<Race> races, CancellationToken ct = default)
    {
        var list = races.ToList();
        if (list.Any(r => r.StartedAt.HasValue || r.FinishedAt.HasValue || r.IsComplete || r.Results.Count != 0)) return true;
        var ids = list.Select(r => r.Id).ToArray();
        return await db.Set<RaceScoreState>().AnyAsync(s => ids.Contains(s.RaceId) && (s.Revision > 0 || s.IsSignedOff), ct);
    }

    public static string? FinalLetter(Heat heat)
        => System.Text.RegularExpressions.Regex.Match(heat.Label ?? "", @"^([A-Z]) Final(?:$|\s)", System.Text.RegularExpressions.RegexOptions.IgnoreCase) is { Success: true } m ? m.Groups[1].Value.ToUpperInvariant() : null;

    public static List<Race> Scope(Session session, Race target)
    {
        var heat = session.Heats.Single(h => h.Id == target.HeatId);
        if (heat.RaceRoundId is { } round)
            return session.Heats.Where(h => h.RaceRoundId == round).SelectMany(h => h.Races).ToList();
        if (FinalLetter(heat) is { } final)
            return session.Heats.Where(h => FinalLetter(h) == final).SelectMany(h => h.Races.Where(r => r.OrderIndex == target.OrderIndex)).ToList();
        return session.Heats.Where(h => h.RaceRoundId == null && FinalLetter(h) == null)
            .SelectMany(h => h.Races.Where(r => r.OrderIndex == target.OrderIndex)).ToList();
    }

    public static void Replace(Session session, Race target, IReadOnlyList<Race> affected, string name)
    {
        var heat = session.Heats.Single(h => h.Id == target.HeatId);
        var oldName = target.Name;
        foreach (var race in affected) { race.Name = name; race.ProgrammeRevision++; }
        if (heat.RaceRoundId is { } round)
        {
            foreach (var h in session.Heats.Where(h => h.RaceRoundId == round))
                if (h.Label?.StartsWith(oldName + " ·", StringComparison.OrdinalIgnoreCase) == true)
                    h.Label = name + h.Label[oldName.Length..];
            // A race-round's slot is its distinct round order, not the race's OrderIndex (usually 1).
            var rounds = session.Heats.Where(h => h.RaceRoundId != null).OrderBy(h => h.OrderIndex)
                .Select(h => h.RaceRoundId!.Value).Distinct().ToList();
            session.PlannedRaces = ReplaceList(session.PlannedRaces, rounds.IndexOf(round), name);
        }
        else if (FinalLetter(heat) is { } final && final != "A")
        {
            var lists = PlannedFinalRaceLists.Read(session.PlannedFinalRaces)?.ToDictionary(k => k.Key, v => v.Value) ?? [];
            var original = lists.GetValueOrDefault(final) ?? PlannedRaceList.Read(session.PlannedRaces) ?? [];
            var changed = original.ToList();
            if (target.OrderIndex >= 1 && target.OrderIndex <= changed.Count) changed[target.OrderIndex - 1] = name;
            lists[final] = changed;
            session.PlannedFinalRaces = PlannedFinalRaceLists.Write(lists);
        }
        else
        {
            // Freeze inherited B/C lists before changing A: earlier printed programmes remain meaningful.
            if (FinalLetter(heat) == "A")
            {
                var lists = PlannedFinalRaceLists.Read(session.PlannedFinalRaces)?.ToDictionary(k => k.Key, v => v.Value) ?? [];
                foreach (var other in session.Heats.Select(FinalLetter).Where(x => x != null && x != "A").Distinct())
                    if (!lists.ContainsKey(other!)) lists[other!] = PlannedRaceList.Read(session.PlannedRaces) ?? [];
                session.PlannedFinalRaces = PlannedFinalRaceLists.Write(lists);
            }
            session.PlannedRaces = ReplaceList(session.PlannedRaces, target.OrderIndex - 1, name);
        }
    }

    private static string? ReplaceList(string? json, int index, string name)
    {
        var list = PlannedRaceList.Read(json)?.ToList();
        if (list == null || index < 0 || index >= list.Count) return json;
        list[index] = name;
        return PlannedRaceList.Write(list);
    }
}
