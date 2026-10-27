using System.Text.RegularExpressions;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>Deterministic progress from recorded starts, completions and the published running order.</summary>
public static class TeamProgress
{
    /// <summary>
    /// Supply one consistent snapshot of ALL competition sessions, including every heat, entry and race.
    /// Set isCompleteSnapshot only after loading those collections without pagination or scorer-scope filtering.
    /// EF's empty navigation defaults cannot distinguish an unloaded collection from an empty draw.
    /// No clock, scheduled time, points total or session name is used to infer that a heat has started.
    /// </summary>
    public static TeamProgressDto Calculate(Team team, CompetitionSection? section,
        IReadOnlyList<Session> sessions, bool isCompleteSnapshot)
    {
        TeamProgressDto State(TeamProgressStatus status) => new(team.CompetitionId, team.Id, status,
            null, null, null, null, null, null);
        if (team.EntryStatus is TeamEntryStatus.Withdrawn or TeamEntryStatus.NoShow)
            return State(TeamProgressStatus.Withdrawn);
        if (!isCompleteSnapshot || section is null || section.Id != team.CompetitionSectionId
            || section.CompetitionId != team.CompetitionId || !Enum.IsDefined(team.EntryStatus)
            || !ValidSnapshot(team.CompetitionId, sessions))
            return State(TeamProgressStatus.Unknown);

        var raceSessions = sessions.Where(IsRace).OrderBy(s => s.OrderIndex).ToList();
        var all = raceSessions.SelectMany(s => s.Heats.Select(h => new Slot(s, h))).ToList();
        var own = all.Where(x => x.Heat.Entries.Any(e => e.TeamId == team.Id)).ToList();
        if (own.Any(x => x.Session.CompetitionSectionId is { } id && id != section.Id))
            return State(TeamProgressStatus.Unknown);

        var candidates = own.Where(x => !Complete(x)).ToList();
        // An empty section session has no reliable heat count yet. Final scaffolds can precede a later
        // known qualifier, so consider them in running order rather than only after the last assigned heat.
        var pendingSessions = raceSessions.Where(s => !Complete(s) && s.Heats.Count == 0
            && (s.CompetitionSectionId == section.Id || s.CompetitionSectionId is null)).ToList();
        var pendingFinals = team.IsHorsConcours ? [] : all.Where(x => !Complete(x)
            && x.Heat.Entries.Count == 0 && IsRelevantFinal(x, team, section)).ToList();

        var next = candidates.OrderBy(x => x.Session.OrderIndex).ThenBy(x => x.Heat.OrderIndex).FirstOrDefault();
        var pendingSession = pendingSessions.OrderBy(s => s.OrderIndex).FirstOrDefault();
        var pendingFinal = pendingFinals.OrderBy(x => x.Session.OrderIndex).ThenBy(x => x.Heat.OrderIndex).FirstOrDefault();
        if (pendingSession is not null && (next is null || pendingSession.OrderIndex <= next.Session.OrderIndex))
            return State(TeamProgressStatus.DrawPending);
        if (pendingFinal is not null && (next is null || Compare(pendingFinal, next) <= 0))
            return State(TeamProgressStatus.DrawPending);

        if (next is null)
        {
            if (own.Count == 0) return State(TeamProgressStatus.Unknown);
            // Standard finals have no explicit publication flag. Populated lettered finals for this
            // section prove the draw exists, even when this team did not qualify. A global final only
            // proves that for this team when it actually contains the team (section membership is absent).
            var finalDrawExists = all.Any(x => SectionScoring.IsFinalHeat(x.Heat)
                && x.Heat.Entries.Count > 0 && (x.Session.CompetitionSectionId == section.Id
                    || x.Heat.Entries.Any(e => e.TeamId == team.Id)));
            if (!team.IsHorsConcours && !section.UsesRaceFinals && section.HasFinal && !finalDrawExists)
                return State(TeamProgressStatus.DrawPending);
            // A missing race-final scaffold is not evidence that the qualified team's day is over.
            if (!team.IsHorsConcours && section.UsesRaceFinals && own.Any(x =>
                x.Heat.RaceRoundStage == RaceRoundStage.Qualifier && (x.Heat.RaceRoundId is null
                    || !all.Any(f => f.Session.Id == x.Session.Id
                        && f.Heat.RaceRoundStage == RaceRoundStage.Final
                        && f.Heat.RaceRoundId == x.Heat.RaceRoundId))))
                return State(TeamProgressStatus.DrawPending);
            if (raceSessions.Any(s => !Complete(s) && s.CompetitionSectionId == section.Id
                && !own.Any(x => x.Session.Id == s.Id)
                && s.Heats.Any(h => h.RaceRoundStage == RaceRoundStage.None
                    && !SectionScoring.IsFinalHeat(h) && !Complete(new Slot(s, h)))))
                return State(TeamProgressStatus.Unknown);
            return State(TeamProgressStatus.Finished);
        }

        var arena = Arena(next.Session);
        var hasNamedArenas = raceSessions.Any(s => Arena(s).Length > 0);
        if (hasNamedArenas && (arena.Length == 0 || raceSessions.Any(s => !Complete(s)
            && s.OrderIndex <= next.Session.OrderIndex && Arena(s).Length == 0)))
            return State(TeamProgressStatus.Unknown);
        // Duplicate order indices cannot be resolved by a database id. Gaps are legal after deletion.
        var relevantSessions = raceSessions.Where(s => Arena(s) == arena).ToList();
        if (relevantSessions.GroupBy(s => s.OrderIndex).Any(g => g.Count() > 1)
            || candidates.Where(x => x.Session.Id != next.Session.Id)
                .Any(x => x.Session.OrderIndex == next.Session.OrderIndex)
            || relevantSessions.Any(s => s.Heats.GroupBy(h => h.OrderIndex).Any(g => g.Count() > 1)))
            return State(TeamProgressStatus.Unknown);

        var arenaHeats = all.Where(x => Arena(x.Session) == arena).ToList();
        var before = arenaHeats.Where(x => Compare(x, next) < 0 && !Complete(x)).ToList();
        if (relevantSessions.Any(s => !Complete(s) && s.OrderIndex < next.Session.OrderIndex && s.Heats.Count == 0)
            || before.Any(x => x.Heat.Entries.Count == 0 || x.Heat.Races.Count == 0)
            || next.Heat.Races.Count == 0)
            return State(TeamProgressStatus.Unknown);

        var started = arenaHeats.Where(x => !Complete(x) && Started(x.Heat)).ToList();
        if (started.Count > 1 || started.Any(x => Compare(x, next) > 0)
            || (Started(next.Heat) && before.Count > 0))
            return State(TeamProgressStatus.Unknown);

        var entry = next.Heat.Entries.Single(e => e.TeamId == team.Id);
        var paused = sessions.Any(s => !Complete(s) && s.OrderIndex <= next.Session.OrderIndex
            && (Arena(s) == arena || (!IsRace(s) && Arena(s).Length == 0)) && Paused(s));
        var status = paused ? TeamProgressStatus.Paused
            : Started(next.Heat) ? TeamProgressStatus.InArena : TeamProgressStatus.Upcoming;
        return new(team.CompetitionId, team.Id, status, next.Session.Id, next.Heat.Id,
            entry.LaneIndex, before.Count, arena.Length == 0 ? null : arena, next.Heat.Label);
    }

    private sealed record Slot(Session Session, Heat Heat);
    private static bool IsRace(Session session) => session.Kind == SessionKind.Race && !session.IsBreak;
    private static string Arena(Session session) => session.ArenaName?.Trim() ?? "";
    private static bool Complete(Session session) => session.Status == SessionStatus.Finished || session.FinishedAt.HasValue;
    private static bool Complete(Slot slot) => Complete(slot.Session) || slot.Heat.FinishedAt.HasValue
        || (slot.Heat.Races.Count > 0 && slot.Heat.Races.All(r => r.IsComplete || r.FinishedAt.HasValue));
    private static bool Started(Heat heat) => heat.StartedAt.HasValue
        || heat.Races.Any(r => r.StartedAt.HasValue || r.IsComplete || r.FinishedAt.HasValue);
    private static int Compare(Slot a, Slot b) => a.Session.OrderIndex != b.Session.OrderIndex
        ? a.Session.OrderIndex.CompareTo(b.Session.OrderIndex) : a.Heat.OrderIndex.CompareTo(b.Heat.OrderIndex);
    private static bool Paused(Session session)
    {
        var match = Regex.Match(session.Notes ?? "", @"\[paused:(\d+)\]");
        return match.Success && long.TryParse(match.Groups[1].Value, out var stamp)
            && stamp <= DateTimeOffset.MaxValue.ToUnixTimeMilliseconds();
    }

    private static bool IsRelevantFinal(Slot slot, Team team, CompetitionSection section)
    {
        if (slot.Session.CompetitionSectionId is { } id && id != section.Id) return false;
        if (!section.UsesRaceFinals) return section.HasFinal && SectionScoring.IsFinalHeat(slot.Heat);
        return slot.Heat.RaceRoundStage == RaceRoundStage.Final && slot.Heat.RaceRoundId is { } round
            && slot.Session.Heats.Any(h => h.RaceRoundStage == RaceRoundStage.Qualifier
                && h.RaceRoundId == round && h.Entries.Any(e => e.TeamId == team.Id));
    }

    private static bool ValidSnapshot(int competitionId, IReadOnlyList<Session> sessions)
    {
        if (sessions.Any(s => s.CompetitionId != competitionId || !Enum.IsDefined(s.Status) || !Enum.IsDefined(s.Kind))
            || sessions.Select(s => s.Id).Distinct().Count() != sessions.Count) return false;
        var heats = sessions.SelectMany(s => s.Heats).ToList();
        if (heats.Select(h => h.Id).Distinct().Count() != heats.Count) return false;
        return sessions.All(s => s.Heats.All(h => h.SessionId == s.Id
            && Enum.IsDefined(h.RaceRoundStage)
            && h.Races.All(r => r.HeatId == h.Id)
            && h.Entries.All(e => e.HeatId == h.Id && e.LaneIndex > 0)
            && h.Entries.Select(e => e.TeamId).Distinct().Count() == h.Entries.Count
            && h.Entries.Select(e => e.LaneIndex).Distinct().Count() == h.Entries.Count));
    }
}
