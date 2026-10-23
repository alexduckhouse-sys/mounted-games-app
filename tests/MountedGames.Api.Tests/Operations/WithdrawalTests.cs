using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

public class WithdrawalTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public WithdrawalTests(ApiFactory f) => _f = f;

    private sealed record Setup(Arena Arena, int[][] Heats, int[] HeatIds, int[][] RaceIds);

    /// <summary>One session whose heats hold the teams in order, split by <paramref name="sizes"/>.</summary>
    private async Task<Setup> BuildAsync(params int[] sizes)
    {
        var arena = await _f.CreateArenaAsync(sizes.Sum());
        var heats = new List<int[]>();
        var heatIds = new List<int>();
        var raceIds = new List<int[]>();
        var next = 0;
        for (var i = 0; i < sizes.Length; i++)
        {
            var teams = arena.TeamIds.Skip(next).Take(sizes[i]).ToArray();
            next += sizes[i];
            var (heatId, races) = await _f.AddHeatAsync(arena.SessionId, teams, $"Heat {i + 1}", i + 1, 1);
            heats.Add(teams);
            heatIds.Add(heatId);
            raceIds.Add(races);
        }
        return new Setup(arena, heats.ToArray(), heatIds.ToArray(), raceIds.ToArray());
    }

    private static string Base(Arena a) => $"/api/competitions/{a.CompetitionId}";
    private static string StatusUrl(Arena a, int teamId) => $"{Base(a)}/teams/{teamId}/entry-status";
    private static string PreviewUrl(Arena a) => $"{Base(a)}/sections/{a.SectionId}/redraw/preview";
    private static string ApplyUrl(Arena a) => $"{Base(a)}/sections/{a.SectionId}/redraw/apply";

    private async Task WithdrawAsync(HttpClient client, Arena arena, int teamId, string reason = "Pony lame")
    {
        var response = await client.PutAsJsonAsync(StatusUrl(arena, teamId),
            new SetTeamEntryStatusRequest(TeamEntryStatus.Withdrawn, reason));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private Task<List<(int HeatId, int TeamId, int Lane)>> EntriesAsync(int competitionId) => _f.WithDbAsync(async db =>
        (await db.HeatEntries.AsNoTracking().Where(e => e.Heat!.Session!.CompetitionId == competitionId)
            .OrderBy(e => e.HeatId).ThenBy(e => e.LaneIndex).ToListAsync())
        .Select(e => (e.HeatId, e.TeamId, e.LaneIndex)).ToList());

    private Task ScoreAsync(int raceId, int teamId) => _f.WithDbAsync(async db =>
    {
        var race = await db.Races.SingleAsync(r => r.Id == raceId);
        race.IsComplete = true;
        db.Results.Add(new Result { RaceId = raceId, TeamId = teamId, Placing = 1, Points = 3 });
        await db.SaveChangesAsync();
    });

    // --- Team status ---

    [Fact]
    public async Task Withdrawing_RemovesTheTeamFromUnscoredHeats_AndRecordsReasonAndActor()
    {
        var s = await BuildAsync(3, 3);
        var admin = await _f.AdminAsync();
        var team = s.Heats[0][1];

        var response = await admin.PutAsJsonAsync(StatusUrl(s.Arena, team),
            new SetTeamEntryStatusRequest(TeamEntryStatus.Withdrawn, "  Pony lame  "));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.ReadAsync<SetTeamEntryStatusResult>();
        Assert.Equal(TeamEntryStatus.Withdrawn, result.Team.Status);
        Assert.Equal("Pony lame", result.Team.Reason);
        Assert.Equal(1, result.HeatPlacesChanged);
        Assert.DoesNotContain(await EntriesAsync(s.Arena.CompetitionId), e => e.TeamId == team);
        var stored = await _f.WithDbAsync(db => db.Set<TeamStatusEvent>().SingleAsync(e => e.TeamId == team));
        Assert.Equal("Pony lame", stored.Reason);
        Assert.Equal(TeamEntryStatus.Withdrawn, stored.Status);
        Assert.True(stored.CreatedAt > DateTime.UtcNow.AddMinutes(-1));
    }

    [Fact]
    public async Task Withdrawing_NeedsAReason_ButANoShowDefaultsOne()
    {
        var s = await BuildAsync(3, 3);
        var admin = await _f.AdminAsync();

        var missing = await admin.PutAsJsonAsync(StatusUrl(s.Arena, s.Heats[0][0]),
            new SetTeamEntryStatusRequest(TeamEntryStatus.Withdrawn, " "));
        var noShow = await admin.PutAsJsonAsync(StatusUrl(s.Arena, s.Heats[0][1]),
            new SetTeamEntryStatusRequest(TeamEntryStatus.NoShow, null));
        var tooLong = await admin.PutAsJsonAsync(StatusUrl(s.Arena, s.Heats[1][0]),
            new SetTeamEntryStatusRequest(TeamEntryStatus.Withdrawn, new string('x', 501)));
        var unknown = await admin.PutAsJsonAsync(StatusUrl(s.Arena, s.Heats[1][0]),
            new SetTeamEntryStatusRequest((TeamEntryStatus)9, "x"));

        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Equal(HttpStatusCode.OK, noShow.StatusCode);
        Assert.Equal("Did not arrive", (await noShow.ReadAsync<SetTeamEntryStatusResult>()).Team.Reason);
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
    }

    [Fact]
    public async Task ScoredAndSignedOffHeats_KeepTheTeam_AndOnlyUnscoredHeatsLoseIt()
    {
        var arena = await _f.CreateArenaAsync(6);
        var session2 = await _f.WithDbAsync(async db =>
        {
            var session = new Session { CompetitionId = arena.CompetitionId, CompetitionSectionId = arena.SectionId, Name = "Session B", OrderIndex = 2 };
            db.Sessions.Add(session);
            await db.SaveChangesAsync();
            return session.Id;
        });
        var scored = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds[..3], "Heat 1", 1);
        var signedOff = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds[3..], "Heat 2", 2);
        var later = await _f.AddHeatAsync(session2, arena.TeamIds[..3], "Heat 1", 1);
        var laterB = await _f.AddHeatAsync(session2, arena.TeamIds[3..], "Heat 2", 2);
        await ScoreAsync(scored.RaceIds[0], arena.TeamIds[0]);
        await _f.WithDbAsync(async db =>
        {
            db.Set<RaceScoreState>().Add(new RaceScoreState { RaceId = signedOff.RaceIds[0], Revision = 1, IsSignedOff = true });
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();

        await WithdrawAsync(admin, arena, arena.TeamIds[0]);
        await WithdrawAsync(admin, arena, arena.TeamIds[3]);

        var entries = await EntriesAsync(arena.CompetitionId);
        Assert.Contains(entries, e => e.HeatId == scored.HeatId && e.TeamId == arena.TeamIds[0]);
        Assert.Contains(entries, e => e.HeatId == signedOff.HeatId && e.TeamId == arena.TeamIds[3]);
        Assert.DoesNotContain(entries, e => e.HeatId == later.HeatId && e.TeamId == arena.TeamIds[0]);
        Assert.DoesNotContain(entries, e => e.HeatId == laterB.HeatId && e.TeamId == arena.TeamIds[3]);
        Assert.Single(await _f.WithDbAsync(db => db.Results.Where(r => r.RaceId == scored.RaceIds[0]).ToListAsync()));
    }

    [Fact]
    public async Task Withdrawing_TwiceIsHarmless()
    {
        var s = await BuildAsync(3, 3);
        var admin = await _f.AdminAsync();
        var team = s.Heats[0][0];
        await WithdrawAsync(admin, s.Arena, team);

        var again = await admin.PutAsJsonAsync(StatusUrl(s.Arena, team), new SetTeamEntryStatusRequest(TeamEntryStatus.Withdrawn, "Again"));

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(0, (await again.ReadAsync<SetTeamEntryStatusResult>()).HeatPlacesChanged);
        Assert.Equal(1, await _f.WithDbAsync(db => db.Set<TeamStatusEvent>().CountAsync(e => e.TeamId == team)));
    }

    [Fact]
    public async Task Reinstating_BeforeADrawPutsTheTeamBack_AndAfterOneIsRefused()
    {
        var s = await BuildAsync(3, 3);
        var admin = await _f.AdminAsync();
        var team = s.Heats[0][1];
        var before = await EntriesAsync(s.Arena.CompetitionId);
        await WithdrawAsync(admin, s.Arena, team);

        var back = await admin.PutAsJsonAsync(StatusUrl(s.Arena, team), new SetTeamEntryStatusRequest(TeamEntryStatus.Active, null));

        Assert.Equal(HttpStatusCode.OK, back.StatusCode);
        Assert.Equal(before, await EntriesAsync(s.Arena.CompetitionId));
        Assert.Equal(TeamEntryStatus.Active, await _f.WithDbAsync(async db => (await db.Teams.SingleAsync(t => t.Id == team)).EntryStatus));

        // Out again, then a draw is applied: the withdrawal is now locked in.
        await WithdrawAsync(admin, s.Arena, team);
        var preview = await (await admin.GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>();
        Assert.True(preview.HasChanges);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync(ApplyUrl(s.Arena), new ApplyRedrawRequest(preview.Fingerprint, "req-lock"))).StatusCode);
        var listed = await (await admin.GetAsync($"{Base(s.Arena)}/entries")).ReadAsync<List<TeamEntryDto>>();
        Assert.False(listed.Single(e => e.TeamId == team).CanReinstate);

        var refused = await admin.PutAsJsonAsync(StatusUrl(s.Arena, team), new SetTeamEntryStatusRequest(TeamEntryStatus.Active, null));

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
    }

    [Fact]
    public async Task SwitchingWithdrawnToNoShow_KeepsTheRememberedPlaces()
    {
        var s = await BuildAsync(3, 3);
        var admin = await _f.AdminAsync();
        var team = s.Heats[1][0];
        var before = await EntriesAsync(s.Arena.CompetitionId);
        await WithdrawAsync(admin, s.Arena, team);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync(StatusUrl(s.Arena, team),
            new SetTeamEntryStatusRequest(TeamEntryStatus.NoShow, "Did not arrive"))).StatusCode);

        await admin.PutAsJsonAsync(StatusUrl(s.Arena, team), new SetTeamEntryStatusRequest(TeamEntryStatus.Active, null));

        Assert.Equal(before, await EntriesAsync(s.Arena.CompetitionId));
    }

    [Fact]
    public async Task OrganiserEndpoints_RequireTheCompetitionsOrganiser()
    {
        var s = await BuildAsync(3, 3);
        var ownerId = await _f.TrainerIdAsync();
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(s.Arena.CompetitionId))!.CreatedByUserId = ownerId;
            await db.SaveChangesAsync();
        });
        var urls = new (HttpMethod Method, string Url, object? Body)[]
        {
            (HttpMethod.Get, $"{Base(s.Arena)}/entries", null),
            (HttpMethod.Put, StatusUrl(s.Arena, s.Heats[0][0]), new SetTeamEntryStatusRequest(TeamEntryStatus.Withdrawn, "x")),
            (HttpMethod.Get, PreviewUrl(s.Arena), null),
            (HttpMethod.Post, ApplyUrl(s.Arena), new ApplyRedrawRequest("f", "r")),
            (HttpMethod.Post, $"{Base(s.Arena)}/declaration-forms/1/swap", new SwapRiderRequest(1, 2, "x", false, "r")),
            (HttpMethod.Get, $"{Base(s.Arena)}/declaration-forms/1/swaps", null),
        };
        var (other, _) = await _f.ApprovedTrainerAsync();
        var (member, _) = await _f.SignupAsync("Member");
        var anonymous = _f.CreateClient();

        foreach (var (method, url, body) in urls)
        {
            HttpRequestMessage Request() => new(method, url) { Content = body is null ? null : JsonContent.Create(body) };
            Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.SendAsync(Request())).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await member.SendAsync(Request())).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await other.SendAsync(Request())).StatusCode);
        }
        Assert.Equal(HttpStatusCode.OK, (await (await _f.TrainerAsync()).GetAsync($"{Base(s.Arena)}/entries")).StatusCode);
        Assert.DoesNotContain(await _f.WithDbAsync(db => db.Set<TeamStatusEvent>().ToListAsync()), e => e.CompetitionId == s.Arena.CompetitionId);
    }

    [Fact]
    public async Task ATeamFromAnotherCompetition_IsNotFound()
    {
        var s = await BuildAsync(3, 3);
        var other = await BuildAsync(3, 3);
        var admin = await _f.AdminAsync();

        var response = await admin.PutAsJsonAsync(StatusUrl(s.Arena, other.Heats[0][0]),
            new SetTeamEntryStatusRequest(TeamEntryStatus.Withdrawn, "x"));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // --- Re-draw preview and apply ---

    [Fact]
    public async Task Preview_RebalancesUnscoredHeats_WithBeforeAndAfter()
    {
        var s = await BuildAsync(3, 3, 3);
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, s.Heats[2][0]);
        await WithdrawAsync(admin, s.Arena, s.Heats[2][1]);

        var preview = await (await admin.GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>();

        Assert.True(preview.HasChanges);
        Assert.Equal(2, preview.OutTeams.Count);
        var session = Assert.Single(preview.Sessions);
        Assert.Equal(new[] { 3, 3, 1 }, session.Before.Select(h => h.Teams.Count));
        Assert.Equal(new[] { 3, 2, 2 }, session.After.Select(h => h.Teams.Count));
        Assert.Empty(session.RemovedHeatIds);
        Assert.NotEmpty(session.Moves);
        // Everyone still racing appears exactly once, with lanes 1..n.
        Assert.Equal(7, session.After.SelectMany(h => h.Teams).Select(t => t.TeamId).Distinct().Count());
        Assert.All(session.After, h => Assert.Equal(Enumerable.Range(1, h.Teams.Count), h.Teams.Select(t => t.LaneIndex)));
        Assert.DoesNotContain(session.After.SelectMany(h => h.Teams), t => t.TeamId == s.Heats[2][0] || t.TeamId == s.Heats[2][1]);
        // Previewing changes nothing.
        Assert.Equal(7, (await EntriesAsync(s.Arena.CompetitionId)).Count);
    }

    [Fact]
    public async Task Preview_MergesAndRemovesAHeatThatWouldBeTooSmall()
    {
        var s = await BuildAsync(2, 2, 2);
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, s.Heats[2][0]);

        var preview = await (await admin.GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>();

        var session = Assert.Single(preview.Sessions);
        Assert.Equal(new[] { s.HeatIds[2] }, session.RemovedHeatIds);
        Assert.Equal(new[] { 3, 2 }, session.After.Select(h => h.Teams.Count));
        Assert.Contains(preview.Notes, n => n.Contains("removed"));
    }

    [Fact]
    public async Task Preview_RespectsTheSessionsLaneLimit()
    {
        var s = await BuildAsync(2, 2, 2);
        await _f.WithDbAsync(async db =>
        {
            (await db.Sessions.FindAsync(s.Arena.SessionId))!.LanesPerHeat = 2;
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, s.Heats[2][0]);

        var session = Assert.Single((await (await admin.GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>()).Sessions);

        // A merge into 3 + 2 would break the limit of 2, so all three heats stay: 2, 2, 1.
        Assert.Empty(session.RemovedHeatIds);
        Assert.All(session.After, h => Assert.InRange(h.Teams.Count, 1, 2));
    }

    [Fact]
    public async Task Preview_RemovesEmptyHeats()
    {
        var s = await BuildAsync(2, 2, 1);
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, s.Heats[2][0]);

        var session = Assert.Single((await (await admin.GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>()).Sessions);

        Assert.Equal(new[] { s.HeatIds[2] }, session.RemovedHeatIds);
        Assert.Equal(new[] { 2, 2 }, session.After.Select(h => h.Teams.Count));
    }

    [Fact]
    public async Task Preview_WithNoWithdrawnTeamsHasNothingToDo()
    {
        var s = await BuildAsync(3, 3);

        var preview = await (await (await _f.AdminAsync()).GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>();

        Assert.False(preview.HasChanges);
        Assert.Contains(preview.Notes, n => n.Contains("nothing to re-draw"));
    }

    [Fact]
    public async Task Preview_LeavesScoredAndSignedOffHeatsAlone_AndIsDeterministic()
    {
        var s = await BuildAsync(3, 3, 3);
        await ScoreAsync(s.RaceIds[0][0], s.Heats[0][0]);
        await _f.WithDbAsync(async db =>
        {
            db.Set<RaceScoreState>().Add(new RaceScoreState { RaceId = s.RaceIds[1][0], Revision = 1, IsSignedOff = true });
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, s.Heats[2][0]);
        await WithdrawAsync(admin, s.Arena, s.Heats[2][1]);

        var first = await (await admin.GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>();
        var second = await (await admin.GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>();

        Assert.Equal(first.Fingerprint, second.Fingerprint);
        Assert.Equal(JsonSerializer.Serialize(first.Sessions), JsonSerializer.Serialize(second.Sessions));
        var session = Assert.Single(first.Sessions);
        Assert.Equal(2, session.ProtectedHeats);
        // Only the one unscored heat is left, so there is nothing to merge it with and nothing moves.
        Assert.DoesNotContain(session.Before.Concat(session.After), h => h.HeatId == s.HeatIds[0] || h.HeatId == s.HeatIds[1]);
    }

    [Fact]
    public async Task Preview_IgnoresFinalsHeats()
    {
        var s = await BuildAsync(3, 3);
        await _f.AddHeatAsync(s.Arena.SessionId, s.Heats[0][..2], "A Final", 3);
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, s.Heats[1][0]);

        var preview = await (await admin.GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>();

        Assert.False(preview.HasChanges);
    }

    [Fact]
    public async Task Apply_WritesTheNewHeats_KeepsScoredHeatsAndBroadcastsTheSession()
    {
        var s = await BuildAsync(2, 2, 2);
        await ScoreAsync(s.RaceIds[0][0], s.Heats[0][0]);
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, s.Heats[2][0]);
        await WithdrawAsync(admin, s.Arena, s.Heats[1][0]);
        var preview = await (await admin.GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>();
        var scoredBefore = (await EntriesAsync(s.Arena.CompetitionId)).Where(e => e.HeatId == s.HeatIds[0]).ToList();

        await using var hub = await ConnectAsync();
        await hub.InvokeAsync("JoinCompetition", s.Arena.CompetitionId);
        var broadcast = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        hub.On<JsonElement>("sessionUpdated", update => broadcast.TrySetResult(update));

        var response = await admin.PostAsJsonAsync(ApplyUrl(s.Arena), new ApplyRedrawRequest(preview.Fingerprint, "req-apply"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var entries = await EntriesAsync(s.Arena.CompetitionId);
        Assert.Equal(scoredBefore, entries.Where(e => e.HeatId == s.HeatIds[0]).ToList());
        var session = Assert.Single(preview.Sessions);
        foreach (var heat in session.After)
            Assert.Equal(heat.Teams.Select(t => (t.TeamId, t.LaneIndex)),
                entries.Where(e => e.HeatId == heat.HeatId).Select(e => (e.TeamId, e.Lane)));
        var survivingHeats = await _f.WithDbAsync(db => db.Heats.Where(h => h.SessionId == s.Arena.SessionId).Select(h => h.Id).ToListAsync());
        Assert.Empty(survivingHeats.Intersect(session.RemovedHeatIds));
        var update = await broadcast.Task.WaitAsync(TimeSpan.FromSeconds(15));
        Assert.Equal(s.Arena.SessionId, update.GetProperty("id").GetInt32());
        Assert.Equal(1 + session.After.Count, update.GetProperty("heats").GetArrayLength());
        var audit = await _f.WithDbAsync(db => db.Set<DrawChange>().SingleAsync(d => d.RequestId == "req-apply"));
        Assert.Equal(DrawChangeKind.Redraw, audit.Kind);
        Assert.NotNull(audit.ActorUserId);
    }

    [Fact]
    public async Task Apply_RetriedWithTheSameRequestId_ReturnsTheSameAnswerAndChangesNothingTwice()
    {
        var s = await BuildAsync(2, 2, 2);
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, s.Heats[2][0]);
        var preview = await (await admin.GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>();
        var request = new ApplyRedrawRequest(preview.Fingerprint, "req-retry");

        var first = await admin.PostAsJsonAsync(ApplyUrl(s.Arena), request);
        var afterFirst = await EntriesAsync(s.Arena.CompetitionId);
        var second = await admin.PostAsJsonAsync(ApplyUrl(s.Arena), request);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.False((await first.ReadAsync<RedrawPreviewDto>()).Replayed);
        var replay = await second.ReadAsync<RedrawPreviewDto>();
        Assert.True(replay.Replayed);
        Assert.Equal(preview.Fingerprint, replay.Fingerprint);
        Assert.Equal(afterFirst, await EntriesAsync(s.Arena.CompetitionId));
        Assert.Equal(1, await _f.WithDbAsync(db => db.Set<DrawChange>().CountAsync(d => d.RequestId == "req-retry")));

        // The same id for a different section is not a retry.
        var otherSection = await admin.PostAsJsonAsync(
            $"{Base(s.Arena)}/sections/{s.Arena.SectionId + 100000}/redraw/apply", request);
        Assert.Equal(HttpStatusCode.Conflict, otherSection.StatusCode);
    }

    [Fact]
    public async Task Apply_WithANewRequestIdAfterItWentThrough_IsRefusedAsStale()
    {
        var s = await BuildAsync(2, 2, 2);
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, s.Heats[2][0]);
        var preview = await (await admin.GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>();
        await admin.PostAsJsonAsync(ApplyUrl(s.Arena), new ApplyRedrawRequest(preview.Fingerprint, "req-a"));

        var again = await admin.PostAsJsonAsync(ApplyUrl(s.Arena), new ApplyRedrawRequest(preview.Fingerprint, "req-b"));

        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task Apply_RefusesAPreviewThatWentStale_AndChangesNothing()
    {
        var s = await BuildAsync(3, 3, 3);
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, s.Heats[2][0]);
        await WithdrawAsync(admin, s.Arena, s.Heats[2][1]);
        var preview = await (await admin.GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>();
        // Between preview and apply a heat in the plan gets scored.
        await ScoreAsync(s.RaceIds[1][0], s.Heats[1][0]);
        var before = await EntriesAsync(s.Arena.CompetitionId);

        var response = await admin.PostAsJsonAsync(ApplyUrl(s.Arena), new ApplyRedrawRequest(preview.Fingerprint, "req-stale"));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(before, await EntriesAsync(s.Arena.CompetitionId));
        Assert.Empty(await _f.WithDbAsync(db => db.Set<DrawChange>().Where(d => d.RequestId == "req-stale").ToListAsync()));
    }

    [Fact]
    public async Task Apply_NeedsAFingerprintAndARequestId_AndSomethingToDo()
    {
        var s = await BuildAsync(3, 3);
        var admin = await _f.AdminAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(ApplyUrl(s.Arena), new ApplyRedrawRequest("", "r"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(ApplyUrl(s.Arena), new ApplyRedrawRequest("abc", ""))).StatusCode);
        var preview = await (await admin.GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>();
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync(ApplyUrl(s.Arena), new ApplyRedrawRequest(preview.Fingerprint, "req-none"))).StatusCode);
    }

    [Fact]
    public async Task Apply_IsAtomic_WhenTheLastWriteFails()
    {
        var s = await BuildAsync(2, 2, 2);
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, s.Heats[2][0]);
        var preview = await (await admin.GetAsync(PreviewUrl(s.Arena))).ReadAsync<RedrawPreviewDto>();
        var before = await EntriesAsync(s.Arena.CompetitionId);
        var heatCount = await _f.WithDbAsync(db => db.Heats.CountAsync(h => h.SessionId == s.Arena.SessionId));
        await _f.WithDbAsync(db => db.Database.ExecuteSqlRawAsync(
            "CREATE TRIGGER fail_redraw BEFORE INSERT ON DrawChange BEGIN SELECT RAISE(ABORT, 'boom'); END;"));
        try
        {
            var failure = await Record.ExceptionAsync(async () =>
            {
                var response = await admin.PostAsJsonAsync(ApplyUrl(s.Arena), new ApplyRedrawRequest(preview.Fingerprint, "req-boom"));
                Assert.False(response.IsSuccessStatusCode);
            });
            Assert.Null(failure);
        }
        finally
        {
            await _f.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("DROP TRIGGER fail_redraw;"));
        }

        Assert.Equal(before, await EntriesAsync(s.Arena.CompetitionId));
        Assert.Equal(heatCount, await _f.WithDbAsync(db => db.Heats.CountAsync(h => h.SessionId == s.Arena.SessionId)));
    }

    [Fact]
    public async Task ScoringTheShrunkenHeat_NeedsOnlyTheTeamsStillRacing()
    {
        var s = await BuildAsync(3, 3);
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, s.Heats[1][2]);
        var remaining = s.Heats[1][..2];

        var result = await _f.WithDbAsync(async db => await new ScoringService(db).ApplyVersionedAsync(
            s.RaceIds[1][0],
            new UpdateRaceScoreRequest([new FinishingPlaceDto(remaining[0], 1, false), new FinishingPlaceDto(remaining[1], 2, false)], 0, "score-1", null), null));

        Assert.Equal(2, result.Results.Count);
    }

    // --- What the public sees ---

    [Fact]
    public async Task PublicEndpoints_ShowTheRemainingTeams_ButNeverTheReasonOrWhoDidIt()
    {
        var s = await BuildAsync(3, 3);
        var admin = await _f.AdminAsync();
        var team = s.Heats[0][1];
        await WithdrawAsync(admin, s.Arena, team, "Rider in hospital after a fall");
        var anonymous = _f.CreateClient();

        var timetable = await anonymous.GetStringAsync($"{Base(s.Arena)}/sessions");
        var teams = await anonymous.GetStringAsync($"{Base(s.Arena)}/teams");
        var detail = await anonymous.GetStringAsync(Base(s.Arena));
        var standings = await anonymous.GetStringAsync($"{Base(s.Arena)}/standings");

        var sessions = JsonSerializer.Deserialize<List<SessionDto>>(timetable, TestClients.Json)!;
        Assert.DoesNotContain(sessions.SelectMany(x => x.Heats).SelectMany(h => h.Entries), e => e.TeamId == team);
        foreach (var body in new[] { timetable, teams, detail, standings })
        {
            Assert.DoesNotContain("hospital", body, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("Reason", body, StringComparison.OrdinalIgnoreCase);
        }
        var publicTeams = JsonSerializer.Deserialize<List<TeamDto>>(teams, TestClients.Json)!;
        Assert.True(publicTeams.Single(t => t.Id == team).IsWithdrawn);
        Assert.Equal(401, (int)(await anonymous.GetAsync($"{Base(s.Arena)}/entries")).StatusCode);
    }

    [Fact]
    public async Task Standings_KeepWhatWasScored_AndMarkTheTeamWithdrawn()
    {
        var s = await BuildAsync(3, 3);
        var scoredTeam = s.Heats[0][0];
        await ScoreAsync(s.RaceIds[0][0], scoredTeam);
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, scoredTeam);

        var rows = await (await _f.CreateClient().GetAsync($"{Base(s.Arena)}/standings")).ReadAsync<List<StandingRow>>();

        var row = rows.Single(r => r.TeamId == scoredTeam);
        Assert.Equal(3, row.TotalPoints);
        Assert.True(row.Withdrawn);
        Assert.Equal(scoredTeam, rows[0].TeamId);
        Assert.Contains(await EntriesAsync(s.Arena.CompetitionId), e => e.TeamId == scoredTeam && e.HeatId == s.HeatIds[0]);
    }

    [Fact]
    public async Task FinalsSeeding_LeavesOutAWithdrawnTeam()
    {
        var s = await BuildAsync(3, 3);
        await ScoreAsync(s.RaceIds[0][0], s.Heats[0][0]);
        await _f.WithDbAsync(async db =>
        {
            db.Results.Add(new Result { RaceId = s.RaceIds[0][0], TeamId = s.Heats[0][1], Placing = 2, Points = 2 });
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, s.Heats[0][0]);

        var response = await admin.PostAsJsonAsync($"{Base(s.Arena)}/finals",
            new CreateFinalsRequest(s.Arena.SectionId, 2, ["Final"], null, null));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var finalists = (await response.ReadAsync<SessionDto>()).Heats.SelectMany(h => h.Entries).Select(e => e.TeamId).ToList();
        Assert.DoesNotContain(s.Heats[0][0], finalists);
        Assert.Contains(s.Heats[0][1], finalists);
    }

    [Fact]
    public async Task WithdrawnTeams_CannotBePlacedInAHeat_ButGenerationLeavesThemOut()
    {
        var s = await BuildAsync(3, 3);
        var admin = await _f.AdminAsync();
        var out1 = s.Heats[0][0];
        await WithdrawAsync(admin, s.Arena, out1);
        var sessionUrl = $"{Base(s.Arena)}/sessions/{s.Arena.SessionId}";

        var add = await admin.PostAsJsonAsync($"{sessionUrl}/heats", new CreateHeatRequest("Extra", 9, [out1], ["Race"]));
        var assign = await admin.PutAsJsonAsync($"{sessionUrl}/heat-assignments",
            new UpdateHeatAssignmentsRequest([new HeatAssignmentEntry("Heat 2", s.Heats[1].Append(out1).ToList())]));
        var generate = await admin.PostAsJsonAsync($"{sessionUrl}/generate-heats",
            new GenerateHeatsRequest(s.Arena.TeamIds, ["Race"], 6, true));

        Assert.Equal(HttpStatusCode.Conflict, add.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, assign.StatusCode);
        Assert.Equal(HttpStatusCode.OK, generate.StatusCode);
        Assert.DoesNotContain((await generate.ReadAsync<SessionDto>()).Heats.SelectMany(h => h.Entries), e => e.TeamId == out1);
    }

    [Fact]
    public async Task SectionDraw_LeavesOutAWithdrawnTeam_AndLocksTheWithdrawal()
    {
        var s = await BuildAsync(3, 3);
        var admin = await _f.AdminAsync();
        var out1 = s.Heats[0][0];
        await WithdrawAsync(admin, s.Arena, out1);
        var url = $"{Base(s.Arena)}/sections/{s.Arena.SectionId}/draw";

        var preview = await (await admin.PostAsJsonAsync($"{url}/preview", new DrawRequest(3))).ReadAsync<DrawPreviewDto>();
        var applied = await admin.PostAsJsonAsync($"{url}/apply", new ApplyDrawRequest(3, preview.Fingerprint));

        Assert.Equal(5, preview.Fairness.TeamCount);
        Assert.DoesNotContain(preview.Sessions.SelectMany(x => x.Heats).SelectMany(h => h.Teams), t => t.TeamId == out1);
        Assert.Equal(HttpStatusCode.OK, applied.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await admin.PutAsJsonAsync(StatusUrl(s.Arena, out1), new SetTeamEntryStatusRequest(TeamEntryStatus.Active, null))).StatusCode);
    }

    [Fact]
    public async Task Readiness_DoesNotChaseAWithdrawnTeamsDeclaration()
    {
        var s = await BuildAsync(3, 3);
        var admin = await _f.AdminAsync();
        var before = await (await admin.GetAsync($"{Base(s.Arena)}/operations/readiness")).ReadAsync<CompetitionReadinessDto>();
        Assert.Contains(before.MissingDeclarations, m => m.TeamId == s.Heats[0][0]);

        await WithdrawAsync(admin, s.Arena, s.Heats[0][0]);

        var after = await (await admin.GetAsync($"{Base(s.Arena)}/operations/readiness")).ReadAsync<CompetitionReadinessDto>();
        Assert.DoesNotContain(after.MissingDeclarations, m => m.TeamId == s.Heats[0][0]);
        Assert.DoesNotContain(after.IncompleteTeams, m => m.TeamId == s.Heats[0][0]);
    }

    [Fact]
    public async Task Entries_ListEveryTeamWithItsStatus()
    {
        var s = await BuildAsync(3, 3);
        var admin = await _f.AdminAsync();
        await WithdrawAsync(admin, s.Arena, s.Heats[0][0], "Illness");

        var entries = await (await admin.GetAsync($"{Base(s.Arena)}/entries")).ReadAsync<List<TeamEntryDto>>();

        Assert.Equal(6, entries.Count);
        var withdrawn = entries.Single(e => e.Status == TeamEntryStatus.Withdrawn);
        Assert.Equal("Illness", withdrawn.Reason);
        Assert.True(withdrawn.CanReinstate);
        Assert.True(withdrawn.RedrawAvailable);
        Assert.All(entries.Where(e => e.Status == TeamEntryStatus.Active), e => Assert.Null(e.Reason));
    }

    private async Task<HubConnection> ConnectAsync()
    {
        _f.CreateClient();
        var conn = new HubConnectionBuilder()
            .WithUrl(new Uri(_f.Server.BaseAddress, "/hubs/live"), o =>
            {
                o.HttpMessageHandlerFactory = _ => _f.Server.CreateHandler();
                o.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
            })
            .Build();
        await conn.StartAsync();
        return conn;
    }
}
