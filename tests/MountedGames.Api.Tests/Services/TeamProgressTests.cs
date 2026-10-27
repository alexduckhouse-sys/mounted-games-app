using System.Text.Json;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;

namespace MountedGames.Api.Tests.Services;

public class TeamProgressTests
{
    private static readonly DateTime Stamp = new(2026, 11, 21, 10, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void CountsUnfinishedHeatsInOwnArenaIncludingTheCurrentHeat()
    {
        var a = Session(1, 1, Heat(11, 1, 9), Heat(12, 2, 8));
        a.Heats.First().StartedAt = Stamp;
        var b = Session(2, 2, Heat(21, 1, 7));
        b.ArenaName = "Arena B";
        var target = Session(3, 3, Heat(31, 1, 1));
        var result = Calculate(target, b, a); // Input enumeration order is not running order.
        Assert.Equal(TeamProgressStatus.Upcoming, result.Status);
        Assert.Equal(2, result.HeatsUntil);
        Assert.Equal(31, result.HeatId);
        Assert.Equal("Arena A", result.ArenaName);
    }

    [Theory]
    [InlineData("heat")]
    [InlineData("races")]
    [InlineData("race-finish")]
    [InlineData("session-status")]
    [InlineData("session-finish")]
    public void CompletionEvidenceRemovesHeatsFromCount(string completion)
    {
        var before = Session(1, 1, Heat(11, 1, 2));
        var heat = before.Heats.Single();
        switch (completion)
        {
            case "heat": heat.FinishedAt = Stamp; break;
            case "races": foreach (var r in heat.Races) r.IsComplete = true; break;
            case "race-finish": foreach (var r in heat.Races) r.FinishedAt = Stamp; break;
            case "session-status": before.Status = SessionStatus.Finished; break;
            case "session-finish": before.FinishedAt = Stamp; break;
        }
        Assert.Equal(0, Calculate(before, Session(2, 2, Heat(21, 1, 1))).HeatsUntil);
    }

    [Fact]
    public void ZeroBeforeTomorrowDoesNotMeanInArenaOrDependOnScheduledClock()
    {
        var session = Session(1, 1, Heat(11, 1, 1));
        session.ScheduledStart = Stamp.AddDays(1);
        session.Status = SessionStatus.InArena; // Session state alone cannot identify a live heat.
        var tomorrow = Calculate(session);
        session.ScheduledStart = Stamp.AddYears(-10);
        session.Heats.Single().ScheduledStart = Stamp.AddYears(-10);
        Assert.Equal(tomorrow, Calculate(session));
        Assert.Equal(TeamProgressStatus.Upcoming, tomorrow.Status);
        Assert.Equal(0, tomorrow.HeatsUntil);
    }

    [Theory]
    [InlineData("heat")]
    [InlineData("race")]
    [InlineData("partial-results")]
    public void ActualHeatOrRaceEvidenceMakesTheTeamInArena(string source)
    {
        var heat = Heat(11, 1, 1);
        if (source == "heat") heat.StartedAt = Stamp;
        if (source == "race") heat.Races.First().StartedAt = Stamp;
        if (source == "partial-results") heat.Races.First().IsComplete = true;
        var result = Calculate(Session(1, 1, heat));
        Assert.Equal(TeamProgressStatus.InArena, result.Status);
        Assert.Equal(0, result.HeatsUntil);
    }

    [Fact]
    public void PauseKeepsKnownCountAndResumingRestoresUpcoming()
    {
        var session = Session(1, 1, Heat(11, 1, 2), Heat(12, 2, 1));
        session.Notes = "Private organiser note [paused:1795255200000] [shift:+20]";
        var paused = Calculate(session);
        Assert.Equal(TeamProgressStatus.Paused, paused.Status);
        Assert.Equal(1, paused.HeatsUntil);
        session.Notes = "[shift:+30]";
        Assert.Equal(TeamProgressStatus.Upcoming, Calculate(session).Status);
    }

    [Fact]
    public void PauseInOtherArenaDoesNotPauseThisTeam()
    {
        var other = Session(1, 1, Heat(11, 1, 2));
        other.ArenaName = "Arena B";
        other.Notes = "[paused:1795255200000]";
        Assert.Equal(TeamProgressStatus.Upcoming, Calculate(other, Session(2, 2, Heat(21, 1, 1))).Status);
    }

    [Theory]
    [InlineData("[paused:garbage]")]
    [InlineData("[paused:-1]")]
    [InlineData("[paused:999999999999999999999999999999999]")]
    [InlineData("[paused:253402300800000]")]
    public void MalformedPauseTagDoesNotInventAPause(string note)
    {
        var session = Session(1, 1, Heat(11, 1, 1));
        session.Notes = note;
        Assert.Equal(TeamProgressStatus.Upcoming, Calculate(session).Status);
    }

    [Fact]
    public void RedrawImmediatelyChangesNextHeatAndDrawnLaneWithoutMutatingTheSnapshot()
    {
        var first = Heat(11, 1, 2);
        var second = Heat(12, 4, 1); // Gaps in indices are legal after removed heats.
        var session = Session(1, 1, first, second);
        Assert.Equal(1, Calculate(session).HeatsUntil);
        second.Entries.Clear();
        first.Entries.Add(new HeatEntry { HeatId = 11, TeamId = 1, LaneIndex = 4 });
        session.LaneRotationMode = LaneRotationMode.MoveDown;
        var result = Calculate(session);
        Assert.Equal(11, result.HeatId);
        Assert.Equal(4, result.LaneIndex);
        Assert.Equal(2, first.Entries.Count);
        Assert.Equal(TeamProgressStatus.Upcoming, result.Status);
    }

    [Theory]
    [InlineData(TeamEntryStatus.Withdrawn)]
    [InlineData(TeamEntryStatus.NoShow)]
    public void WithdrawnAndNoShowEndFollowUpEvenIfHistoricalHeatsRemain(TeamEntryStatus status)
    {
        var team = Team();
        team.EntryStatus = status;
        var result = TeamProgress.Calculate(team, null, [], false);
        Assert.Equal(TeamProgressStatus.Withdrawn, result.Status);
        Assert.Null(result.HeatId);
        Assert.Null(result.HeatsUntil);
    }

    [Fact]
    public void CompletedTeamsHeatDoesNotWaitForOtherTeamsInSameSession()
    {
        var own = Heat(11, 1, 1);
        own.FinishedAt = Stamp;
        Assert.Equal(TeamProgressStatus.Finished, Calculate(Session(1, 1, own, Heat(12, 2, 2))).Status);
    }

    [Fact]
    public void NextAssignedHeatReplacesTheCompletedOne()
    {
        var first = Heat(11, 1, 1);
        first.FinishedAt = Stamp;
        var result = Calculate(Session(1, 1, first, Heat(12, 2, 2), Heat(13, 3, 1)));
        Assert.Equal(13, result.HeatId);
        Assert.Equal(1, result.HeatsUntil);
    }

    [Fact]
    public void StandardFinalNotYetCreatedIsPendingNotFinished()
    {
        var section = Section();
        section.HasFinal = true;
        var own = Heat(11, 1, 1);
        own.FinishedAt = Stamp;
        var result = TeamProgress.Calculate(Team(), section, [Session(1, 1, own)], true);
        Assert.Equal(TeamProgressStatus.DrawPending, result.Status);
        Assert.Null(result.HeatsUntil);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void StandardFinalWithConfirmedEntriesExcludesNonQualifyingTeam(bool teamQualified)
    {
        var section = Section();
        section.HasFinal = true;
        var own = Heat(11, 1, 1);
        own.FinishedAt = Stamp;
        var final = Heat(21, 1, teamQualified ? 1 : 2);
        final.Label = "A Final Part 1";
        var result = TeamProgress.Calculate(Team(), section, [Session(1, 1, own), Session(2, 2, final)], true);
        Assert.Equal(teamQualified ? TeamProgressStatus.Upcoming : TeamProgressStatus.Finished, result.Status);
    }

    [Fact]
    public void EmptyFinalScaffoldBeforeNextQualifierMustNotBeSkipped()
    {
        var section = Section();
        section.UsesRaceFinals = true;
        var qualifier = Heat(11, 1, 1);
        qualifier.FinishedAt = Stamp;
        qualifier.RaceRoundId = 5;
        qualifier.RaceRoundStage = RaceRoundStage.Qualifier;
        var final = Heat(12, 2);
        final.RaceRoundId = 5;
        final.RaceRoundStage = RaceRoundStage.Final;
        var result = TeamProgress.Calculate(Team(), section,
            [Session(1, 1, qualifier, final, Heat(13, 3, 1))], true);
        Assert.Equal(TeamProgressStatus.DrawPending, result.Status);
        Assert.Null(result.HeatsUntil);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void RaceFinalMissingOrEmptyRemainsPending(bool scaffoldExists)
    {
        var section = Section();
        section.UsesRaceFinals = true;
        var qualifier = Heat(11, 1, 1);
        qualifier.FinishedAt = Stamp;
        qualifier.RaceRoundStage = RaceRoundStage.Qualifier;
        qualifier.RaceRoundId = 5;
        var session = Session(1, 1, qualifier);
        if (scaffoldExists)
        {
            var final = Heat(12, 2);
            final.SessionId = session.Id;
            final.RaceRoundId = 5;
            final.RaceRoundStage = RaceRoundStage.Final;
            session.Heats.Add(final);
        }
        Assert.Equal(TeamProgressStatus.DrawPending, TeamProgress.Calculate(Team(), section, [session], true).Status);
    }

    [Fact]
    public void RaceFinalNonQualifierIsFinishedOnceDrawHasEntries()
    {
        var section = Section();
        section.UsesRaceFinals = true;
        var qualifier = Heat(11, 1, 1);
        qualifier.FinishedAt = Stamp;
        qualifier.RaceRoundStage = RaceRoundStage.Qualifier;
        qualifier.RaceRoundId = 5;
        var final = Heat(12, 2, 2);
        final.RaceRoundId = 5;
        final.RaceRoundStage = RaceRoundStage.Final;
        Assert.Equal(TeamProgressStatus.Finished,
            TeamProgress.Calculate(Team(), section, [Session(1, 1, qualifier, final)], true).Status);
    }

    [Fact]
    public void HorsConcoursTeamDoesNotWaitForAFinalItCannotEnter()
    {
        var section = Section();
        section.HasFinal = true;
        var team = Team();
        team.IsHorsConcours = true;
        var heat = Heat(11, 1, 1);
        heat.FinishedAt = Stamp;
        var final = Heat(21, 1);
        final.Label = "A Final";
        Assert.Equal(TeamProgressStatus.Finished, TeamProgress.Calculate(team, section,
            [Session(1, 1, heat), Session(2, 2, final)], true).Status);
    }

    [Fact]
    public void EmptyFutureSessionForTeamSectionIsDrawPending()
    {
        var heat = Heat(11, 1, 1);
        heat.FinishedAt = Stamp;
        Assert.Equal(TeamProgressStatus.DrawPending, Calculate(Session(1, 1, heat), Session(2, 2)).Status);
    }

    [Theory]
    [InlineData("unloaded")]
    [InlineData("missing-section")]
    [InlineData("other-competition")]
    [InlineData("duplicate-session")]
    [InlineData("duplicate-heat")]
    [InlineData("duplicate-entry")]
    [InlineData("duplicate-lane")]
    [InlineData("bad-lane")]
    [InlineData("wrong-heat-parent")]
    [InlineData("wrong-race-parent")]
    [InlineData("wrong-entry-parent")]
    [InlineData("unknown-status")]
    [InlineData("unknown-stage")]
    [InlineData("unknown-kind")]
    [InlineData("wrong-section")]
    public void MissingOrInconsistentSnapshotCannotProduceAConfidentCount(string problem)
    {
        var section = Section();
        var heat = Heat(11, 1, 1);
        var session = Session(1, 1, heat);
        var sessions = new List<Session> { session };
        switch (problem)
        {
            case "other-competition": session.CompetitionId = 2; break;
            case "duplicate-session": sessions.Add(session); break;
            case "duplicate-heat": session.Heats.Add(heat); break;
            case "duplicate-entry": heat.Entries.Add(new HeatEntry { HeatId = 11, TeamId = 1, LaneIndex = 2 }); break;
            case "duplicate-lane": heat.Entries.Add(new HeatEntry { HeatId = 11, TeamId = 2, LaneIndex = 1 }); break;
            case "bad-lane": heat.Entries.Single().LaneIndex = 0; break;
            case "wrong-heat-parent": heat.SessionId = 2; break;
            case "wrong-race-parent": heat.Races.First().HeatId = 2; break;
            case "wrong-entry-parent": heat.Entries.Single().HeatId = 2; break;
            case "unknown-status": session.Status = (SessionStatus)100; break;
            case "unknown-stage": heat.RaceRoundStage = (RaceRoundStage)100; break;
            case "unknown-kind": session.Kind = (SessionKind)100; break;
            case "wrong-section": session.CompetitionSectionId = 2; break;
        }
        var result = TeamProgress.Calculate(Team(), problem == "missing-section" ? null : section,
            sessions, problem != "unloaded");
        Assert.Equal(TeamProgressStatus.Unknown, result.Status);
        Assert.Null(result.HeatsUntil);
    }

    [Theory]
    [InlineData("session-order")]
    [InlineData("heat-order")]
    [InlineData("empty-earlier-session")]
    [InlineData("empty-earlier-draw")]
    [InlineData("missing-races")]
    [InlineData("unknown-arena")]
    [InlineData("two-started-heats")]
    [InlineData("later-heat-started")]
    [InlineData("target-started-before-preceding-heat-finished")]
    public void AmbiguousRunningOrderProducesUnknown(string problem)
    {
        var before = Heat(11, 1, 2);
        var target = Heat(21, 1, 1);
        var first = Session(1, 1, before);
        first.CompetitionSectionId = 2;
        var second = Session(2, 2, target);
        switch (problem)
        {
            case "session-order": second.OrderIndex = 1; break;
            case "heat-order": first.Heats.Add(Heat(12, 1, 3)); first.Heats.Last().SessionId = 1; break;
            case "empty-earlier-session": first.Heats.Clear(); break;
            case "empty-earlier-draw": before.Entries.Clear(); break;
            case "missing-races": target.Races.Clear(); break;
            case "unknown-arena": first.ArenaName = null; break;
            case "two-started-heats": before.StartedAt = Stamp; target.StartedAt = Stamp; break;
            case "later-heat-started": before.StartedAt = Stamp; first.OrderIndex = 3; break;
            case "target-started-before-preceding-heat-finished": target.StartedAt = Stamp; break;
        }
        var result = Calculate(first, second);
        Assert.Equal(TeamProgressStatus.Unknown, result.Status);
        Assert.Null(result.HeatsUntil);
    }

    [Fact]
    public void BreaksAndBriefingsAreNotCountedAsHeats()
    {
        var briefing = Session(1, 1);
        briefing.Kind = SessionKind.Briefing;
        var legacyBreak = Session(2, 2);
        legacyBreak.IsBreak = true;
        Assert.Equal(0, Calculate(briefing, legacyBreak, Session(3, 3, Heat(31, 1, 1))).HeatsUntil);
    }

    [Fact]
    public void SingleUnnamedArenaWorksAndExplicitlyFinishedPauseIsIgnored()
    {
        var previous = Session(1, 1);
        previous.Status = SessionStatus.Finished;
        previous.ArenaName = null;
        previous.Notes = "[paused:1795255200000]";
        var target = Session(2, 2, Heat(21, 1, 1));
        target.ArenaName = " ";
        var result = Calculate(previous, target);
        Assert.Equal(TeamProgressStatus.Upcoming, result.Status);
        Assert.Null(result.ArenaName);
        Assert.Equal(0, result.HeatsUntil);
    }

    [Fact]
    public void PublicContractContainsOnlyFrozenFieldsAndNumericStatus()
    {
        var result = Calculate(Session(1, 1, Heat(11, 1, 1)));
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(result, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        Assert.Equal(1, json.RootElement.GetProperty("status").GetInt32());
        Assert.Equal(new[] { "arenaName", "competitionId", "heatId", "heatLabel", "heatsUntil", "laneIndex", "sessionId", "status", "teamId" },
            json.RootElement.EnumerateObject().Select(p => p.Name).Order().ToArray());
    }

    private static Team Team() => new() { Id = 1, CompetitionId = 1, CompetitionSectionId = 1 };
    private static CompetitionSection Section() => new() { Id = 1, CompetitionId = 1, HasFinal = false };
    private static TeamProgressDto Calculate(params Session[] sessions)
        => TeamProgress.Calculate(Team(), Section(), sessions, true);

    private static Session Session(int id, int order, params Heat[] heats)
    {
        foreach (var heat in heats) heat.SessionId = id;
        return new() { Id = id, CompetitionId = 1, CompetitionSectionId = 1,
            ArenaName = "Arena A", OrderIndex = order, Heats = heats.ToList() };
    }

    private static Heat Heat(int id, int order, params int[] teams) => new()
    {
        Id = id, OrderIndex = order, Label = $"Heat {order}",
        Entries = teams.Select((t, i) => new HeatEntry { HeatId = id, TeamId = t, LaneIndex = i + 1 }).ToList(),
        Races = [new() { Id = id * 10, HeatId = id, OrderIndex = 1 }, new() { Id = id * 10 + 1, HeatId = id, OrderIndex = 2 }],
    };
}
