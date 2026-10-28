using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Hubs;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

/// <summary>The protest and referee-decision log: staff only, blocks sign-off while open, public sees only "under review".</summary>
public class ProtestTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ProtestTests(ApiFactory f) => _f = f;

    private sealed record World(Arena Arena, int HeatId, int[] RaceIds, HttpClient Owner, string OwnerId);

    /// <summary>A competition owned by a fresh trainer with one heat of two races, all three teams racing.</summary>
    private async Task<World> WorldAsync()
    {
        var (owner, auth) = await _f.ApprovedTrainerAsync();
        var arena = await _f.CreateArenaAsync(3);
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(arena.CompetitionId))!.CreatedByUserId = auth.User.Id;
            await db.SaveChangesAsync();
        });
        var (heatId, races) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 2);
        return new World(arena, heatId, races, owner, auth.User.Id);
    }

    private static string Url(int competitionId) => $"/api/competitions/{competitionId}/protests";

    private static CreateProtestRequest Raise(int? raceId = null, int? heatId = null, int? raisedBy = null,
        int[]? concerns = null, string? reason = "Lane 2 crossed into lane 3 at the turn", string? name = "Jo (trainer)",
        string? requestId = null)
        => new(heatId, raceId, raisedBy, concerns, name, reason, requestId ?? Guid.NewGuid().ToString("N"));

    private static async Task<ProtestDto> CreatedAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<ProtestDto>();
    }

    private static UpdateRaceScoreRequest Score(World w, int revision, string id)
        => new(w.Arena.TeamIds.Select((t, i) => new FinishingPlaceDto(t, i + 1, false)).ToList(), revision, id, null);

    private async Task<RaceScoreDto> ScoredAsync(World w, int raceId)
    {
        var response = await w.Owner.PutAsJsonAsync($"/api/races/{raceId}/score", Score(w, 0, Guid.NewGuid().ToString("N")));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<RaceScoreDto>();
    }

    private static Task<HttpResponseMessage> SignOffAsync(HttpClient client, int raceId, int revision)
        => client.PostAsJsonAsync($"/api/races/{raceId}/score/sign-off", new ScoreActionRequest(revision, Guid.NewGuid().ToString("N"), null));

    private Task<bool[]> FlagsAsync(World w) => _f.WithDbAsync(db => db.Races.AsNoTracking()
        .Where(r => r.HeatId == w.HeatId).OrderBy(r => r.OrderIndex).Select(r => r.HasOpenProtest).ToArrayAsync());

    // ---- who can use it ---------------------------------------------------------------------------

    [Fact]
    public async Task OnlyTheCompetitionsStaffCanUseTheLog()
    {
        var w = await WorldAsync();
        var url = Url(w.Arena.CompetitionId);
        var (member, _) = await _f.SignupAsync("Member");
        var (otherTrainer, _) = await _f.ApprovedTrainerAsync();
        var admin = await _f.AdminAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsJsonAsync(url, Raise(w.RaceIds[0]))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync(url, Raise(w.RaceIds[0]))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTrainer.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTrainer.PostAsJsonAsync(url, Raise(w.RaceIds[0]))).StatusCode);

        var byOwner = await CreatedAsync(await w.Owner.PostAsJsonAsync(url, Raise(w.RaceIds[0])));
        Assert.Equal(HttpStatusCode.NotFound, (await otherTrainer.PostAsJsonAsync($"{url}/{byOwner.Id}/decision",
            new DecideProtestRequest(ProtestStatus.Dismissed, "No"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTrainer.PostAsJsonAsync($"{url}/{byOwner.Id}/withdraw",
            new WithdrawProtestRequest(null))).StatusCode);
        Assert.Equal(w.OwnerId, byOwner.CreatedByUserId);

        var byAdmin = await CreatedAsync(await admin.PostAsJsonAsync(url, Raise(w.RaceIds[1])));
        Assert.Equal(2, (await (await admin.GetAsync(url)).ReadAsync<List<ProtestDto>>()).Count);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"{url}/{byAdmin.Id}/withdraw", new WithdrawProtestRequest(null))).StatusCode);
    }

    [Fact]
    public async Task ACompetitionAdminOnTheTeamCanUseTheLog()
    {
        var w = await WorldAsync();
        var (_, helperAuth) = await _f.SignupAsync("Member");
        await _f.WithDbAsync(async db =>
        {
            db.CompetitionCollaborators.Add(new CompetitionCollaborator
            {
                CompetitionId = w.Arena.CompetitionId, UserId = helperAuth.User.Id,
                Role = CollaboratorRole.CompetitionAdmin, AddedByUserId = w.OwnerId, AddedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        });
        var helperClient = _f.WithToken((await _f.LoginAsync(helperAuth.User.Email, "Passw0rd!x")).Token);

        Assert.Equal(HttpStatusCode.OK, (await helperClient.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(w.RaceIds[0]))).StatusCode);
    }

    [Fact]
    public async Task ProtestsInAnotherCompetitionAreNotFound()
    {
        var mine = await WorldAsync();
        var theirs = await WorldAsync();
        var theirProtest = await CreatedAsync(await theirs.Owner.PostAsJsonAsync(Url(theirs.Arena.CompetitionId), Raise(theirs.RaceIds[0])));

        var decide = await mine.Owner.PostAsJsonAsync($"{Url(mine.Arena.CompetitionId)}/{theirProtest.Id}/decision",
            new DecideProtestRequest(ProtestStatus.Upheld, "Mine now"));
        var withdraw = await mine.Owner.PostAsJsonAsync($"{Url(mine.Arena.CompetitionId)}/{theirProtest.Id}/withdraw", new WithdrawProtestRequest(null));
        var listed = await (await mine.Owner.GetAsync(Url(mine.Arena.CompetitionId))).ReadAsync<List<ProtestDto>>();

        Assert.Equal(HttpStatusCode.NotFound, decide.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, withdraw.StatusCode);
        Assert.Empty(listed);
        Assert.Equal(ProtestStatus.Open, await _f.WithDbAsync(db => db.Set<Protest>().Where(p => p.Id == theirProtest.Id).Select(p => p.Status).SingleAsync()));
    }

    // ---- creating ---------------------------------------------------------------------------------

    [Fact]
    public async Task Create_ChecksEveryIdBelongsToTheCompetition_AndTheText()
    {
        var w = await WorldAsync();
        var other = await WorldAsync();
        var url = Url(w.Arena.CompetitionId);

        async Task<string> Refused(CreateProtestRequest request)
        {
            var response = await w.Owner.PostAsJsonAsync(url, request);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            return (await response.ReadAsync<JsonElement>()).GetProperty("message").GetString()!;
        }

        Assert.Equal("Say what the protest is about.", await Refused(Raise(w.RaceIds[0], reason: "  ")));
        Assert.Contains("1000", await Refused(Raise(w.RaceIds[0], reason: new string('x', 1001))));
        Assert.Equal("A request id is required.", await Refused(Raise(w.RaceIds[0]) with { RequestId = null }));
        Assert.Equal("The request id is too long.", await Refused(Raise(w.RaceIds[0], requestId: new string('r', 101))));
        Assert.Contains("120", await Refused(Raise(w.RaceIds[0], name: new string('n', 121))));
        Assert.Equal("That's too many teams for one protest.", await Refused(Raise(w.RaceIds[0], concerns: Enumerable.Range(1, 21).ToArray())));
        Assert.Equal("Choose the race or heat the protest is about.", await Refused(Raise()));
        Assert.Equal("That race isn't in this competition.", await Refused(Raise(other.RaceIds[0])));
        Assert.Equal("That heat isn't in this competition.", await Refused(Raise(heatId: other.HeatId)));
        Assert.Equal("That race isn't in that heat.", await Refused(Raise(w.RaceIds[0], heatId: other.HeatId)));
        Assert.Equal("Some of those teams aren't in this competition.", await Refused(Raise(w.RaceIds[0], concerns: [other.Arena.TeamIds[0]])));
        Assert.Equal("Some of those teams aren't in this competition.", await Refused(Raise(w.RaceIds[0], raisedBy: other.Arena.TeamIds[0])));
        Assert.Empty(await _f.WithDbAsync(db => db.Set<Protest>().Where(p => p.CompetitionId == w.Arena.CompetitionId).ToListAsync()));
    }

    [Fact]
    public async Task Create_RecordsTheProtest_AndARetryReturnsTheSameOne()
    {
        var w = await WorldAsync();
        var request = Raise(w.RaceIds[1], heatId: w.HeatId, raisedBy: w.Arena.TeamIds[0],
            concerns: [w.Arena.TeamIds[1], w.Arena.TeamIds[2], w.Arena.TeamIds[1]], name: "  Sam (trainer)  ");

        var first = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), request));
        var retry = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), request));

        Assert.Equal(first.Id, retry.Id);
        Assert.Single(await _f.WithDbAsync(db => db.Set<Protest>().Where(p => p.CompetitionId == w.Arena.CompetitionId).ToListAsync()));
        Assert.Equal((w.HeatId, w.RaceIds[1], "Race 2", "Heat 1", w.Arena.SessionId, "Session A"),
            (first.HeatId, first.RaceId, first.RaceName, first.HeatLabel, first.SessionId, first.SessionName));
        Assert.Equal(new ProtestTeamDto(w.Arena.TeamIds[0], "Team 1"), first.RaisedByTeam);
        Assert.Equal(new[] { w.Arena.TeamIds[1], w.Arena.TeamIds[2] }, first.Concerns.Select(c => c.TeamId));
        Assert.Equal("Sam (trainer)", first.RaisedByName);
        Assert.Equal(ProtestStatus.Open, first.Status);
        Assert.Null(first.Decision);
        Assert.False(first.RaceSignedOff);
    }

    [Fact]
    public async Task AHeatWideProtest_CoversEveryRace_AndARaceProtestOnlyItsRace()
    {
        var w = await WorldAsync();
        var raceOnly = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(w.RaceIds[1])));
        Assert.Equal(new[] { false, true }, await FlagsAsync(w));

        var heatWide = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(heatId: w.HeatId, name: null)));
        Assert.Null(heatWide.RaceId);
        Assert.Null(heatWide.RaceName);
        Assert.Null(heatWide.RaisedByName);
        Assert.Equal(new[] { true, true }, await FlagsAsync(w));

        // Withdrawing the heat-wide one leaves race 2 still covered by its own protest.
        await w.Owner.PostAsJsonAsync($"{Url(w.Arena.CompetitionId)}/{heatWide.Id}/withdraw", new WithdrawProtestRequest("Team agreed"));
        Assert.Equal(new[] { false, true }, await FlagsAsync(w));
        await w.Owner.PostAsJsonAsync($"{Url(w.Arena.CompetitionId)}/{raceOnly.Id}/decision", new DecideProtestRequest(ProtestStatus.Dismissed, "Video shows no crossing"));
        Assert.Equal(new[] { false, false }, await FlagsAsync(w));
    }

    // ---- deciding ---------------------------------------------------------------------------------

    [Theory]
    [InlineData(ProtestStatus.Upheld)]
    [InlineData(ProtestStatus.Dismissed)]
    public async Task Decide_KeepsTheDecisionAndWhoMadeIt_AndClearsTheFlag(ProtestStatus outcome)
    {
        var w = await WorldAsync();
        var protest = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(w.RaceIds[0])));
        Assert.Equal(new[] { true, false }, await FlagsAsync(w));

        var response = await w.Owner.PostAsJsonAsync($"{Url(w.Arena.CompetitionId)}/{protest.Id}/decision",
            new DecideProtestRequest(outcome, "  Referee watched the video: crossing confirmed.  "));

        var decided = await CreatedAsync(response);
        Assert.Equal(outcome, decided.Status);
        Assert.Equal("Referee watched the video: crossing confirmed.", decided.Decision);
        Assert.Equal(w.OwnerId, decided.DecidedByUserId);
        Assert.NotNull(decided.DecidedAt);
        Assert.Equal(new[] { false, false }, await FlagsAsync(w));
        // The reason the protest was raised is still there alongside the decision.
        var listed = await (await w.Owner.GetAsync(Url(w.Arena.CompetitionId))).ReadAsync<List<ProtestDto>>();
        Assert.Equal("Lane 2 crossed into lane 3 at the turn", listed.Single().Reason);
    }

    [Fact]
    public async Task Decide_NeedsAnOutcomeAndAReason_AndHappensOnce()
    {
        var w = await WorldAsync();
        var url = Url(w.Arena.CompetitionId);
        var protest = await CreatedAsync(await w.Owner.PostAsJsonAsync(url, Raise(w.RaceIds[0])));
        var decision = $"{url}/{protest.Id}/decision";

        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.PostAsJsonAsync(decision, new DecideProtestRequest(ProtestStatus.Open, "x"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.PostAsJsonAsync(decision, new DecideProtestRequest(ProtestStatus.Withdrawn, "x"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.PostAsJsonAsync(decision, new DecideProtestRequest(ProtestStatus.Upheld, " "))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await w.Owner.PostAsJsonAsync($"{url}/999999/decision", new DecideProtestRequest(ProtestStatus.Upheld, "x"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await w.Owner.PostAsJsonAsync(decision, new DecideProtestRequest(ProtestStatus.Upheld, "Yes"))).StatusCode);

        var again = await w.Owner.PostAsJsonAsync(decision, new DecideProtestRequest(ProtestStatus.Dismissed, "Changed my mind"));
        var withdrawLate = await w.Owner.PostAsJsonAsync($"{url}/{protest.Id}/withdraw", new WithdrawProtestRequest(null));
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("This protest has already been decided.", (await again.ReadAsync<JsonElement>()).GetProperty("message").GetString());
        Assert.Equal(HttpStatusCode.Conflict, withdrawLate.StatusCode);
        Assert.Equal("Yes", await _f.WithDbAsync(db => db.Set<Protest>().Where(p => p.Id == protest.Id).Select(p => p.Decision).SingleAsync()));
    }

    [Fact]
    public async Task Withdraw_TakesAnOptionalNote_AndOnlyOnce()
    {
        var w = await WorldAsync();
        var url = Url(w.Arena.CompetitionId);
        var quiet = await CreatedAsync(await w.Owner.PostAsJsonAsync(url, Raise(w.RaceIds[0])));
        var noted = await CreatedAsync(await w.Owner.PostAsJsonAsync(url, Raise(w.RaceIds[1])));

        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.PostAsJsonAsync($"{url}/{noted.Id}/withdraw", new WithdrawProtestRequest(new string('n', 1001)))).StatusCode);
        var withdrawn = await CreatedAsync(await w.Owner.PostAsJsonAsync($"{url}/{quiet.Id}/withdraw", new WithdrawProtestRequest("  ")));
        var withNote = await CreatedAsync(await w.Owner.PostAsJsonAsync($"{url}/{noted.Id}/withdraw", new WithdrawProtestRequest(" Trainer withdrew it ")));
        var twice = await w.Owner.PostAsJsonAsync($"{url}/{quiet.Id}/withdraw", new WithdrawProtestRequest(null));
        var decideWithdrawn = await w.Owner.PostAsJsonAsync($"{url}/{quiet.Id}/decision", new DecideProtestRequest(ProtestStatus.Upheld, "x"));

        Assert.Equal((ProtestStatus.Withdrawn, null), (withdrawn.Status, withdrawn.Decision));
        Assert.Equal("Trainer withdrew it", withNote.Decision);
        Assert.Equal(HttpStatusCode.Conflict, twice.StatusCode);
        Assert.Equal("This protest has already been withdrawn.", (await twice.ReadAsync<JsonElement>()).GetProperty("message").GetString());
        Assert.Equal(HttpStatusCode.Conflict, decideWithdrawn.StatusCode);
        Assert.Equal(new[] { false, false }, await FlagsAsync(w));
    }

    // ---- sign-off ---------------------------------------------------------------------------------

    [Fact]
    public async Task AnOpenProtest_BlocksSigningOffTheRace_UntilItIsDecided()
    {
        var w = await WorldAsync();
        var scored = await ScoredAsync(w, w.RaceIds[0]);
        var protest = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(w.RaceIds[0])));

        var blocked = await SignOffAsync(w.Owner, w.RaceIds[0], scored.Revision);
        Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);
        Assert.Equal("This race has an open protest. Decide it or mark it withdrawn before signing off.",
            (await blocked.ReadAsync<JsonElement>()).GetProperty("message").GetString());
        Assert.False(await _f.WithDbAsync(db => db.Set<RaceScoreState>().AnyAsync(s => s.RaceId == w.RaceIds[0] && s.IsSignedOff)));

        await w.Owner.PostAsJsonAsync($"{Url(w.Arena.CompetitionId)}/{protest.Id}/decision", new DecideProtestRequest(ProtestStatus.Dismissed, "Not proven"));
        var allowed = await SignOffAsync(w.Owner, w.RaceIds[0], scored.Revision);
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
        Assert.True((await allowed.ReadAsync<RaceScoreDto>()).IsSignedOff);
    }

    [Fact]
    public async Task AHeatWideProtest_BlocksEveryRaceInTheHeat_AndWithdrawingItUnblocks()
    {
        var w = await WorldAsync();
        var first = await ScoredAsync(w, w.RaceIds[0]);
        var second = await ScoredAsync(w, w.RaceIds[1]);
        var protest = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(heatId: w.HeatId)));
        var admin = await _f.AdminAsync();

        Assert.Equal(HttpStatusCode.Conflict, (await SignOffAsync(admin, w.RaceIds[0], first.Revision)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await SignOffAsync(admin, w.RaceIds[1], second.Revision)).StatusCode);

        await w.Owner.PostAsJsonAsync($"{Url(w.Arena.CompetitionId)}/{protest.Id}/withdraw", new WithdrawProtestRequest(null));

        Assert.Equal(HttpStatusCode.OK, (await SignOffAsync(admin, w.RaceIds[0], first.Revision)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SignOffAsync(admin, w.RaceIds[1], second.Revision)).StatusCode);
    }

    [Fact]
    public async Task AProtestOnAnotherRace_DoesNotBlockThisOne()
    {
        var w = await WorldAsync();
        var scored = await ScoredAsync(w, w.RaceIds[0]);
        await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(w.RaceIds[1])));

        Assert.Equal(HttpStatusCode.OK, (await SignOffAsync(w.Owner, w.RaceIds[0], scored.Revision)).StatusCode);
    }

    [Fact]
    public async Task ALateProtestOnASignedOffRace_IsRecorded_AndSaysSo()
    {
        var w = await WorldAsync();
        var scored = await ScoredAsync(w, w.RaceIds[0]);
        Assert.Equal(HttpStatusCode.OK, (await SignOffAsync(w.Owner, w.RaceIds[0], scored.Revision)).StatusCode);

        var late = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(w.RaceIds[0])));
        var heatWide = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(heatId: w.HeatId)));
        var otherRace = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(w.RaceIds[1])));

        Assert.True(late.RaceSignedOff);
        Assert.True(heatWide.RaceSignedOff);
        Assert.False(otherRace.RaceSignedOff);
    }

    [Fact]
    public async Task ADecisionNeverWritesResults()
    {
        var w = await WorldAsync();
        var scored = await ScoredAsync(w, w.RaceIds[0]);
        var protest = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(w.RaceIds[0], concerns: [w.Arena.TeamIds[1]])));

        await w.Owner.PostAsJsonAsync($"{Url(w.Arena.CompetitionId)}/{protest.Id}/decision", new DecideProtestRequest(ProtestStatus.Upheld, "Team 2 eliminated"));

        var after = await (await w.Owner.GetAsync($"/api/races/{w.RaceIds[0]}/score")).ReadAsync<RaceScoreDto>();
        Assert.Equal(scored.Revision, after.Revision);
        Assert.Equal(scored.Results.Select(r => (r.TeamId, r.Place, r.Points)), after.Results.Select(r => (r.TeamId, r.Place, r.Points)));
    }

    // ---- listing ----------------------------------------------------------------------------------

    [Fact]
    public async Task List_FiltersByOpenHeatAndRace_AndARacesListIncludesItsHeatsProtests()
    {
        var w = await WorldAsync();
        var url = Url(w.Arena.CompetitionId);
        var (otherHeat, otherRaces) = await _f.AddHeatAsync(w.Arena.SessionId, w.Arena.TeamIds, label: "Heat 2", orderIndex: 2);
        var race1 = await CreatedAsync(await w.Owner.PostAsJsonAsync(url, Raise(w.RaceIds[0])));
        var heatWide = await CreatedAsync(await w.Owner.PostAsJsonAsync(url, Raise(heatId: w.HeatId)));
        var race2 = await CreatedAsync(await w.Owner.PostAsJsonAsync(url, Raise(w.RaceIds[1])));
        var elsewhere = await CreatedAsync(await w.Owner.PostAsJsonAsync(url, Raise(otherRaces[0])));
        await w.Owner.PostAsJsonAsync($"{url}/{race2.Id}/decision", new DecideProtestRequest(ProtestStatus.Dismissed, "No"));

        async Task<int[]> Ids(string query) => (await (await w.Owner.GetAsync(url + query)).ReadAsync<List<ProtestDto>>()).Select(p => p.Id).ToArray();

        var all = await Ids("");
        Assert.Equal(4, all.Length);
        Assert.Equal(race2.Id, all[^1]); // decided ones come after the open ones
        Assert.Equal(new[] { elsewhere.Id, heatWide.Id, race1.Id }.Order(), (await Ids("?open=true")).Order());
        Assert.Equal(new[] { race1.Id, heatWide.Id, race2.Id }.Order(), (await Ids($"?heatId={w.HeatId}")).Order());
        Assert.Equal(new[] { race1.Id, heatWide.Id }.Order(), (await Ids($"?raceId={w.RaceIds[0]}")).Order());
        Assert.Equal(new[] { heatWide.Id }, await Ids($"?raceId={w.RaceIds[1]}&open=true"));
        Assert.Equal(new[] { elsewhere.Id }, await Ids($"?heatId={otherHeat}"));
    }

    [Fact]
    public async Task List_CopesWithTeamsThatHaveGone_AndAnUnreadableTeamList()
    {
        var w = await WorldAsync();
        var protest = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(w.RaceIds[0], concerns: [w.Arena.TeamIds[2]])));
        var broken = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(w.RaceIds[1])));
        await _f.WithDbAsync(async db =>
        {
            var row = await db.Set<Protest>().SingleAsync(p => p.Id == protest.Id);
            row.ConcernsTeamIdsJson = "[999999]";
            (await db.Set<Protest>().SingleAsync(p => p.Id == broken.Id)).ConcernsTeamIdsJson = "not json";
            await db.SaveChangesAsync();
        });

        var listed = await (await w.Owner.GetAsync(Url(w.Arena.CompetitionId))).ReadAsync<List<ProtestDto>>();

        Assert.All(listed, p => Assert.Empty(p.Concerns));
    }

    // ---- what the public sees ---------------------------------------------------------------------

    [Fact]
    public async Task ThePublicSeesOnlyUnderReview_NeverTheReasonNamesOrDecision()
    {
        var w = await WorldAsync();
        await ScoredAsync(w, w.RaceIds[0]);
        var protest = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId),
            Raise(w.RaceIds[0], raisedBy: w.Arena.TeamIds[0], concerns: [w.Arena.TeamIds[1]], reason: "SECRET-REASON-TEXT", name: "SECRET-RAISER-NAME")));
        var anonymous = _f.CreateClient();

        var body = await anonymous.GetStringAsync($"/api/competitions/{w.Arena.CompetitionId}/sessions");
        var sessions = JsonSerializer.Deserialize<List<SessionDto>>(body, TestClients.Json)!;
        var heat = sessions.Single(s => s.Id == w.Arena.SessionId).Heats.Single(h => h.Id == w.HeatId);
        Assert.True(heat.UnderReview);
        Assert.Equal(new[] { true, false }, heat.Races.OrderBy(r => r.OrderIndex).Select(r => r.UnderReview));
        Assert.DoesNotContain("SECRET", body);
        Assert.DoesNotContain("protest", body, StringComparison.OrdinalIgnoreCase);

        await w.Owner.PostAsJsonAsync($"{Url(w.Arena.CompetitionId)}/{protest.Id}/decision",
            new DecideProtestRequest(ProtestStatus.Upheld, "SECRET-DECISION-TEXT"));
        var after = await anonymous.GetStringAsync($"/api/competitions/{w.Arena.CompetitionId}/sessions/{w.Arena.SessionId}");
        var session = JsonSerializer.Deserialize<SessionDto>(after, TestClients.Json)!;
        Assert.False(session.Heats.Single(h => h.Id == w.HeatId).UnderReview);
        Assert.DoesNotContain("SECRET", after);
    }

    [Fact]
    public async Task StaffAreNudgedToReRead_AndEveryoneElseOnlyGetsThePublicHeat()
    {
        var w = await WorldAsync();
        var ownerToken = (await _f.LoginAsync(
            await _f.WithDbAsync(db => db.Users.Where(u => u.Id == w.OwnerId).Select(u => u.Email!).SingleAsync()), "Passw0rd!x")).Token;
        await using var staff = await ConnectAsync(ownerToken);
        await using var viewer = await ConnectAsync(null);
        await staff.InvokeAsync("JoinCompetition", w.Arena.CompetitionId);
        await viewer.InvokeAsync("JoinCompetition", w.Arena.CompetitionId);
        var staffNudged = Next(staff, "protestsChanged");
        var viewerResults = Next(viewer, "resultsUpdated");
        var leaked = false;
        viewer.On<JsonElement>("protestsChanged", _ => leaked = true);

        await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(w.RaceIds[0], reason: "SECRET-REASON-TEXT")));

        Assert.Equal(w.Arena.CompetitionId, (await staffNudged).GetProperty("competitionId").GetInt32());
        var results = await viewerResults;
        Assert.True(results.GetProperty("heat").GetProperty("underReview").GetBoolean());
        Assert.DoesNotContain("SECRET", results.GetRawText());
        Assert.False(leaked);
    }

    [Fact]
    public async Task ARetry_DoesNotTellThePublicAnythingChanged()
    {
        var w = await WorldAsync();
        var request = Raise(w.RaceIds[0]);
        await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), request));
        await using var viewer = await ConnectAsync(null);
        await viewer.InvokeAsync("JoinCompetition", w.Arena.CompetitionId);
        var got = false;
        viewer.On<JsonElement>("resultsUpdated", _ => got = true);

        await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), request));
        // A later public broadcast proves the viewer was listening and nothing came before it.
        var witness = Next(viewer, "announcement");
        await _f.Services.GetRequiredService<ILiveBroadcaster>().Announcement(w.Arena.CompetitionId, new { text = "after" });
        await witness;

        Assert.False(got);
    }

    // ---- housekeeping -----------------------------------------------------------------------------

    [Fact]
    public async Task CancellingARace_AndDeletingTheCompetition_RemoveItsProtests()
    {
        var w = await WorldAsync();
        var raceProtest = await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(w.RaceIds[1], raisedBy: w.Arena.TeamIds[0])));
        await CreatedAsync(await w.Owner.PostAsJsonAsync(Url(w.Arena.CompetitionId), Raise(heatId: w.HeatId)));

        var cancelled = await w.Owner.DeleteAsync($"/api/competitions/{w.Arena.CompetitionId}/sessions/{w.Arena.SessionId}/races/{w.RaceIds[1]}");
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.Set<Protest>().AnyAsync(p => p.Id == raceProtest.Id)));

        var deleted = await (await _f.AdminAsync()).DeleteAsync($"/api/competitions/{w.Arena.CompetitionId}");
        Assert.True(deleted.IsSuccessStatusCode);
        Assert.False(await _f.WithDbAsync(db => db.Set<Protest>().AnyAsync(p => p.CompetitionId == w.Arena.CompetitionId)));
    }

    private static readonly TimeSpan HubTimeout = TimeSpan.FromSeconds(15);

    private async Task<HubConnection> ConnectAsync(string? token)
    {
        _f.CreateClient();
        var conn = new HubConnectionBuilder()
            .WithUrl(new Uri(_f.Server.BaseAddress, "/hubs/live"), o =>
            {
                o.HttpMessageHandlerFactory = _ => _f.Server.CreateHandler();
                o.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
                if (token is not null) o.AccessTokenProvider = () => Task.FromResult<string?>(token);
            })
            .Build();
        await conn.StartAsync();
        return conn;
    }

    private static Task<JsonElement> Next(HubConnection conn, string method)
    {
        var tcs = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        conn.On<JsonElement>(method, e => tcs.TrySetResult(e));
        return tcs.Task.WaitAsync(HubTimeout);
    }
}
