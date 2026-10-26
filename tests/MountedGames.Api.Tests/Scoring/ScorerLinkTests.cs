using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MountedGames.Api.Auth;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Scoring;

/// <summary>Scorer links: a volunteer scores a competition from a link, with no account, and can do nothing else.</summary>
public class ScorerLinkTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ScorerLinkTests(ApiFactory f) => _f = f;

    private static int _ipCounter = 10;

    /// <summary>A competition owned by a fresh trainer, with a heat of two races in arena "Main" and another heat in arena "Side".</summary>
    private sealed record World(Arena Arena, int[] MainRaces, int[] SideRaces, HttpClient Owner, string OwnerId);

    private async Task<World> WorldAsync()
    {
        var (owner, auth) = await _f.ApprovedTrainerAsync();
        var arena = await _f.CreateArenaAsync(3);
        int sideSession = 0;
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(arena.CompetitionId))!.CreatedByUserId = auth.User.Id;
            (await db.Sessions.FindAsync(arena.SessionId))!.ArenaName = "Main";
            var side = new Session { CompetitionId = arena.CompetitionId, CompetitionSectionId = arena.SectionId, Name = "Session B", ArenaName = "Side", OrderIndex = 2 };
            db.Sessions.Add(side);
            await db.SaveChangesAsync();
            sideSession = side.Id;
        });
        var (_, main) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 2);
        var (_, side2) = await _f.AddHeatAsync(sideSession, arena.TeamIds, raceCount: 1);
        return new World(arena, main, side2, owner, auth.User.Id);
    }

    private static string LinksUrl(int competitionId) => $"/api/competitions/{competitionId}/scorer-links";

    private async Task<(string Token, ScorerLinkDto Link)> CreateLinkAsync(World w, string arena = "Main", string label = "Sam", HttpClient? by = null, DateTime? expiresAt = null)
    {
        var response = await (by ?? w.Owner).PostAsJsonAsync(LinksUrl(w.Arena.CompetitionId), new { label, arenaName = arena, expiresAt });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var created = await response.ReadAsync<CreatedScorerLinkDto>();
        return (created.Token, created.Link);
    }

    /// <summary>An anonymous phone, on its own address so one test's wrong guesses never count against another's.</summary>
    private HttpClient Scorer(string? token, string? ip = null, Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program>? factory = null)
    {
        var client = (factory ?? _f).CreateClient();
        client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, ip ?? $"10.20.{Interlocked.Increment(ref _ipCounter) / 250}.{_ipCounter % 250}");
        if (token is not null) client.DefaultRequestHeaders.Add(ScorerLinkTokens.Header, token);
        return client;
    }

    private static string Score(int raceId) => $"/api/scorer/races/{raceId}/score";

    private static UpdateRaceScoreRequest Put(World w, int revision, string id, string? reason = null, int winner = 0)
    {
        var ids = w.Arena.TeamIds;
        var order = ids.Skip(winner).Concat(ids.Take(winner)).ToArray();
        return new UpdateRaceScoreRequest(order.Select((t, i) => new FinishingPlaceDto(t, i + 1, false)).ToList(), revision, id, reason);
    }

    // ---- creating, listing, revoking --------------------------------------------------------------

    [Fact]
    public async Task Create_ShowsTheTokenOnce_AndStoresOnlyItsHash()
    {
        var w = await WorldAsync();

        var response = await w.Owner.PostAsJsonAsync(LinksUrl(w.Arena.CompetitionId), new { label = "  Sam  ", arenaName = "Main" });
        var raw = await response.Content.ReadAsStringAsync();
        var created = System.Text.Json.JsonSerializer.Deserialize<CreatedScorerLinkDto>(raw, TestClients.Json)!;

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.StartsWith("mgs_", created.Token);
        Assert.Equal($"/score#t={created.Token}", created.Path);
        Assert.Equal("Sam", created.Link.Label);
        Assert.Equal("Main", created.Link.ArenaName);
        var stored = await _f.WithDbAsync(db => db.ScorerLinks.SingleAsync(l => l.Id == created.Link.Id));
        Assert.Equal(ScorerLinkTokens.Hash(created.Token), stored.TokenHash);
        Assert.DoesNotContain(created.Token, stored.TokenHash);
        Assert.Equal(64, stored.TokenHash.Length);

        // Never again: not in the list, the revoke reply, or anywhere with the hash.
        var list = await w.Owner.GetStringAsync(LinksUrl(w.Arena.CompetitionId));
        var revoked = await (await w.Owner.PostAsync($"{LinksUrl(w.Arena.CompetitionId)}/{created.Link.Id}/revoke", null)).Content.ReadAsStringAsync();
        foreach (var body in new[] { list, revoked })
        {
            Assert.DoesNotContain(created.Token, body);
            Assert.DoesNotContain(stored.TokenHash, body);
            Assert.DoesNotContain("token", body, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task Tokens_AreLongAndDifferentEveryTime()
    {
        var tokens = Enumerable.Range(0, 50).Select(_ => ScorerLinkTokens.Generate()).ToList();
        Assert.Equal(50, tokens.Distinct().Count());
        Assert.All(tokens, t => { Assert.True(ScorerLinkTokens.LooksValid(t)); Assert.Equal(47, t.Length); });
        Assert.False(ScorerLinkTokens.LooksValid(""));
        Assert.False(ScorerLinkTokens.LooksValid("mgs_"));
        Assert.False(ScorerLinkTokens.LooksValid("nope" + new string('a', 30)));
        Assert.False(ScorerLinkTokens.LooksValid("mgs_" + new string('a', 80)));
        Assert.False(ScorerLinkTokens.LooksValid("mgs_abc def"));
        Assert.False(ScorerLinkTokens.LooksValid("mgs_abc'; drop table"));
    }

    [Fact]
    public async Task List_ShowsLinksAndTheArenasThatCanBeChosen()
    {
        var w = await WorldAsync();
        var (_, link) = await CreateLinkAsync(w, "Side", "Pat");

        var list = await w.Owner.GetFromJsonAsync<ScorerLinkListDto>(LinksUrl(w.Arena.CompetitionId), TestClients.Json);

        Assert.Equal(["Main", "Side", "All arenas"], list!.Arenas);
        var shown = Assert.Single(list.Links);
        Assert.Equal(link.Id, shown.Id);
        Assert.Equal("Pat", shown.Label);
        Assert.Null(shown.LastUsedAt);
        Assert.Null(shown.RevokedAt);
        // End of the day after the competition's last day (it starts today and has no end date).
        Assert.Equal(DateTime.UtcNow.Date.AddDays(2), list.DefaultExpiresAt);
        Assert.Equal(list.DefaultExpiresAt, shown.ExpiresAt);
    }

    [Fact]
    public async Task DefaultMainArena_AndAllArenasLabels_AllowScoringAcrossTheCompetition()
    {
        var w = await WorldAsync();
        await _f.WithDbAsync(async db =>
        {
            (await db.Sessions.FindAsync(w.Arena.SessionId))!.ArenaName = null;
            await db.SaveChangesAsync();
        });

        var list = await w.Owner.GetFromJsonAsync<ScorerLinkListDto>(LinksUrl(w.Arena.CompetitionId), TestClients.Json);
        Assert.Equal(["Main arena", "Side", "All arenas"], list!.Arenas);

        var (mainToken, _) = await CreateLinkAsync(w, "Main arena", "MainScorer");
        var mainScorer = Scorer(mainToken);
        var mainSession = await mainScorer.GetFromJsonAsync<ScorerSessionDto>("/api/scorer/session", TestClients.Json);
        Assert.Equal(2, mainSession!.Sessions.Count);
        Assert.Equal(w.Arena.SessionId, mainSession.Sessions[0].Id);
        Assert.Equal(HttpStatusCode.OK, (await mainScorer.PutAsJsonAsync(Score(w.MainRaces[0]), Put(w, 0, "main-1"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await mainScorer.GetAsync(Score(w.SideRaces[0]))).StatusCode);

        var (allToken, _) = await CreateLinkAsync(w, "All arenas", "AllScorer");
        var allScorer = Scorer(allToken);
        var allSession = await allScorer.GetFromJsonAsync<ScorerSessionDto>("/api/scorer/session", TestClients.Json);
        Assert.Equal(2, allSession!.Sessions.Count);
        Assert.Equal(HttpStatusCode.OK, (await allScorer.GetAsync(Score(w.MainRaces[0]))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await allScorer.PutAsJsonAsync(Score(w.SideRaces[0]), Put(w, 0, "all-1"))).StatusCode);
    }

    [Fact]
    public async Task Create_ChecksTheRequest()
    {
        var w = await WorldAsync();
        var url = LinksUrl(w.Arena.CompetitionId);
        var soon = DateTime.UtcNow.AddHours(3);

        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.PostAsJsonAsync(url, new { label = "", arenaName = "Main" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.PostAsJsonAsync(url, new { label = "   ", arenaName = "Main" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.PostAsJsonAsync(url, new { label = new string('x', 61), arenaName = "Main" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.PostAsJsonAsync(url, new { label = "Sam", arenaName = "Nowhere" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.PostAsJsonAsync(url, new { label = "Sam", arenaName = "main" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await w.Owner.PostAsJsonAsync(url, new { label = "Sam", arenaName = "Main", expiresAt = DateTime.UtcNow.AddMinutes(-5) })).StatusCode);
        // Later than the day after the event ends: refused. Earlier: honoured.
        var late = await w.Owner.PostAsJsonAsync(url, new { label = "Sam", arenaName = "Main", expiresAt = DateTime.UtcNow.Date.AddDays(3) });
        Assert.Equal(HttpStatusCode.BadRequest, late.StatusCode);
        var (_, early) = await CreateLinkAsync(w, expiresAt: soon);
        Assert.Equal(soon, early.ExpiresAt, TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task Create_RefusedOnceTheCompetitionIsOver()
    {
        var w = await WorldAsync();
        await _f.WithDbAsync(async db =>
        {
            var c = (await db.Competitions.FindAsync(w.Arena.CompetitionId))!;
            c.StartDate = DateTime.UtcNow.Date.AddDays(-10);
            c.EndDate = DateTime.UtcNow.Date.AddDays(-9);
            await db.SaveChangesAsync();
        });

        var response = await w.Owner.PostAsJsonAsync(LinksUrl(w.Arena.CompetitionId), new { label = "Sam", arenaName = "Main" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task EventRunningLate_DefaultExpiryIsTheEndOfTheDayAfterItEnds()
    {
        var w = await WorldAsync();
        var end = DateTime.UtcNow.Date.AddDays(1);
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(w.Arena.CompetitionId))!.EndDate = end;
            await db.SaveChangesAsync();
        });

        var (_, link) = await CreateLinkAsync(w);

        Assert.Equal(end.AddDays(2), link.ExpiresAt);
    }

    [Fact]
    public async Task Create_StopsAtTheLimitOfActiveLinks()
    {
        var w = await WorldAsync();
        await _f.WithDbAsync(async db =>
        {
            for (var i = 0; i < 100; i++)
                db.ScorerLinks.Add(new ScorerLink
                {
                    CompetitionId = w.Arena.CompetitionId, Label = $"L{i}", ArenaName = "Main", TokenHash = ScorerLinkTokens.Hash($"filler-{Guid.NewGuid()}"),
                    CreatedByUserId = w.OwnerId, CreatedAt = DateTime.UtcNow, ExpiresAt = DateTime.UtcNow.AddDays(1),
                });
            await db.SaveChangesAsync();
        });

        var response = await w.Owner.PostAsJsonAsync(LinksUrl(w.Arena.CompetitionId), new { label = "One too many", arenaName = "Main" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Revoke_IsIdempotent_AndStaysWithinTheCompetition()
    {
        var w = await WorldAsync();
        var other = await WorldAsync();
        var (token, link) = await CreateLinkAsync(w);

        var first = await (await w.Owner.PostAsync($"{LinksUrl(w.Arena.CompetitionId)}/{link.Id}/revoke", null)).ReadAsync<ScorerLinkDto>();
        var second = await (await w.Owner.PostAsync($"{LinksUrl(w.Arena.CompetitionId)}/{link.Id}/revoke", null)).ReadAsync<ScorerLinkDto>();

        Assert.NotNull(first.RevokedAt);
        Assert.Equal(first.RevokedAt, second.RevokedAt);
        Assert.Equal(HttpStatusCode.Gone, (await Scorer(token).GetAsync("/api/scorer/session")).StatusCode);
        // Another competition's owner can't reach it, and an unknown id is 404.
        Assert.Equal(HttpStatusCode.NotFound, (await other.Owner.PostAsync($"{LinksUrl(w.Arena.CompetitionId)}/{link.Id}/revoke", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.Owner.PostAsync($"{LinksUrl(other.Arena.CompetitionId)}/{link.Id}/revoke", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await w.Owner.PostAsync($"{LinksUrl(w.Arena.CompetitionId)}/999999/revoke", null)).StatusCode);
    }

    // ---- who may manage links ---------------------------------------------------------------------

    [Fact]
    public async Task OnlyTheOwnerItsTeamAndAdminsManageLinks()
    {
        var w = await WorldAsync();
        var other = await WorldAsync();
        var (member, _) = await _f.SignupAsync("Member");
        var (teamMember, teamAuth) = await _f.SignupAsync("Member");
        var (otherTeam, otherTeamAuth) = await _f.SignupAsync("Member");
        await w.Owner.PostAsJsonAsync($"/api/competitions/{w.Arena.CompetitionId}/team", new { email = teamAuth.User.Email });
        await other.Owner.PostAsJsonAsync($"/api/competitions/{other.Arena.CompetitionId}/team", new { email = otherTeamAuth.User.Email });
        var url = LinksUrl(w.Arena.CompetitionId);
        var body = new { label = "Sam", arenaName = "Main" };

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsJsonAsync(url, body)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync(url, body)).StatusCode);
        // Another trainer, and a team member of a different competition: not found, never "forbidden".
        Assert.Equal(HttpStatusCode.NotFound, (await other.Owner.PostAsJsonAsync(url, body)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.Owner.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTeam.PostAsJsonAsync(url, body)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherTeam.GetAsync(url)).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await w.Owner.PostAsJsonAsync(url, body)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await teamMember.PostAsJsonAsync(url, body)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await _f.AdminAsync()).PostAsJsonAsync(url, body)).StatusCode);
        Assert.Equal(3, (await teamMember.GetFromJsonAsync<ScorerLinkListDto>(url, TestClients.Json))!.Links.Count);
    }

    // ---- what a link can do -----------------------------------------------------------------------

    [Fact]
    public async Task LinkSeesItsOwnArenaOnly()
    {
        var w = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w, "Main", "Sam");

        var session = await Scorer(token).GetFromJsonAsync<ScorerSessionDto>("/api/scorer/session", TestClients.Json);

        Assert.Equal("Sam", session!.Label);
        Assert.Equal("Main", session.ArenaName);
        Assert.Equal(w.Arena.CompetitionId, session.CompetitionId);
        Assert.Equal(2, session.Sessions.Count);
        var main = session.Sessions[0];
        Assert.Equal(w.Arena.SessionId, main.Id);
        Assert.Equal(w.MainRaces, main.Heats.Single().Races.Select(r => r.Id).ToArray());
    }

    [Fact]
    public async Task LinkEntersScores_AndTheHistoryNamesTheLink()
    {
        var w = await WorldAsync();
        var (token, link) = await CreateLinkAsync(w, "Main", "Sam");
        var scorer = Scorer(token);
        var race = w.MainRaces[0];

        var saved = await scorer.PutAsJsonAsync(Score(race), Put(w, 0, "first"));
        var corrected = await scorer.PutAsJsonAsync(Score(race), Put(w, 1, "second", "Judge changed the order", winner: 1));

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.Equal(HttpStatusCode.OK, corrected.StatusCode);
        var read = await scorer.GetFromJsonAsync<RaceScoreDto>(Score(race), TestClients.Json);
        Assert.Equal(2, read!.Revision);
        Assert.Equal(w.Arena.TeamIds[1], read.Results.Single(r => r.Place == 1).TeamId);
        var admin = await _f.AdminAsync();
        var history = await admin.GetFromJsonAsync<List<RaceScoreHistoryDto>>($"/api/races/{race}/score/history", TestClients.Json);
        Assert.All(history!, h => { Assert.Equal("Scorer link: Sam", h.ActorLabel); Assert.Null(h.ActorUserId); });
        var results = await _f.WithDbAsync(db => db.Results.Where(r => r.RaceId == race).ToListAsync());
        Assert.All(results, r => Assert.Null(r.RecordedByUserId));
        var used = (await w.Owner.GetFromJsonAsync<ScorerLinkListDto>(LinksUrl(w.Arena.CompetitionId), TestClients.Json))!.Links.Single(l => l.Id == link.Id);
        Assert.NotNull(used.LastUsedAt);
    }

    [Fact]
    public async Task ScoresEnteredByAnAccount_LeaveNoActorLabel()
    {
        var w = await WorldAsync();
        var race = w.MainRaces[0];

        await w.Owner.PutAsJsonAsync($"/api/races/{race}/score", Put(w, 0, "owner-save"));

        var history = await w.Owner.GetFromJsonAsync<List<RaceScoreHistoryDto>>($"/api/races/{race}/score/history", TestClients.Json);
        var entry = Assert.Single(history!);
        Assert.Null(entry.ActorLabel);
        Assert.Equal(w.OwnerId, entry.ActorUserId);
    }

    [Fact]
    public async Task OutboxSave_WorksThroughTheLink_AndConflictsReturnTheWinningHeat()
    {
        var w = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w, "Main", "Sam");
        var scorer = Scorer(token);
        var race = w.MainRaces[0];
        var ids = w.Arena.TeamIds;
        var first = ids.Select((t, i) => new FinishingPlaceDto(t, i + 1, false)).ToList();
        var swapped = new List<FinishingPlaceDto> { new(ids[1], 1, false), new(ids[0], 2, false), new(ids[2], 3, false) };

        var saved = await scorer.PostAsJsonAsync($"/api/scorer/races/{race}/results", new SubmitRaceResultsRequest(first, []));
        // A phone that missed the first save sends a correction against what it last saw (nothing): refused with the heat.
        var stale = await scorer.PostAsJsonAsync($"/api/scorer/races/{race}/results", new SubmitRaceResultsRequest(swapped, [], "Order was wrong"));
        var fixedUp = await scorer.PostAsJsonAsync($"/api/scorer/races/{race}/results", new SubmitRaceResultsRequest(swapped, first, "Order was wrong"));

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.Equal(race, (await saved.ReadAsync<HeatDto>()).Races.First().Id);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        var conflict = await stale.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>(TestClients.Json);
        Assert.Equal(w.Arena.SessionId, conflict.GetProperty("sessionId").GetInt32());
        Assert.Equal(race, conflict.GetProperty("heat").GetProperty("races")[0].GetProperty("id").GetInt32());
        Assert.Equal(HttpStatusCode.OK, fixedUp.StatusCode);
        var events = await _f.WithDbAsync(db => db.Set<RaceScoreEvent>().Where(e => e.RaceId == race).OrderBy(e => e.Revision).ToListAsync());
        Assert.All(events, e => Assert.Equal("Scorer link: Sam", e.ActorLabel));
        Assert.Equal(2, events.Count);
    }

    [Fact]
    public async Task TheLink_CanRecordWhyATeamDidNotFinish_ButNeverReadsOrChangesRefereeNotes()
    {
        var w = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w, "Main", "Sam");
        var scorer = Scorer(token);
        var race = w.MainRaces[0];
        var ids = w.Arena.TeamIds;

        // Staff score the race with a private note.
        var staffSave = await w.Owner.PutAsJsonAsync($"/api/races/{race}/score", new UpdateRaceScoreRequest(new[]
        {
            new FinishingPlaceDto(ids[0], 1, false, null, "Staff note: protest lodged"),
            new FinishingPlaceDto(ids[1], 2, false), new FinishingPlaceDto(ids[2], 0, true),
        }, 0, "staff-1", null));
        Assert.Equal(HttpStatusCode.OK, staffSave.StatusCode);

        // The link's read of the same race leaves the note out.
        var read = await scorer.GetStringAsync(Score(race));
        Assert.DoesNotContain("protest", read);
        Assert.Contains("\"status\":1", read);

        // The link corrects the race (team 3 turns out to be a DNS) and records an elimination reason note,
        // while leaving team 1's existing staff note intact when null is sent.
        var corrected = await scorer.PutAsJsonAsync(Score(race), new UpdateRaceScoreRequest(new[]
        {
            new FinishingPlaceDto(ids[0], 1, false, null, null),
            new FinishingPlaceDto(ids[1], 2, false), new FinishingPlaceDto(ids[2], 0, true, ResultStatus.DidNotStart, "Missed equipment"),
        }, 1, "link-1", "Team 3 never started"));
        Assert.Equal(HttpStatusCode.OK, corrected.StatusCode);
        Assert.DoesNotContain("protest", await corrected.Content.ReadAsStringAsync());
        Assert.DoesNotContain("Missed equipment", await corrected.Content.ReadAsStringAsync());

        var stored = await _f.WithDbAsync(db => db.Results.AsNoTracking().Where(r => r.RaceId == race).OrderBy(r => r.TeamId).ToListAsync());
        Assert.Equal("Staff note: protest lodged", stored.Single(r => r.TeamId == ids[0]).RefereeNote);
        Assert.Equal("Missed equipment", stored.Single(r => r.TeamId == ids[2]).RefereeNote);
        Assert.Equal(ResultStatus.DidNotStart, stored.Single(r => r.TeamId == ids[2]).Status);

        // The outbox's legacy save also records the elimination reason note without returning it.
        var legacy = await scorer.PostAsJsonAsync($"/api/scorer/races/{w.MainRaces[1]}/results", new SubmitRaceResultsRequest(new[]
        {
            new FinishingPlaceDto(ids[0], 1, false), new FinishingPlaceDto(ids[1], 0, true, ResultStatus.Retired, "Unruly pony"),
            new FinishingPlaceDto(ids[2], 2, false),
        }));
        Assert.Equal(HttpStatusCode.OK, legacy.StatusCode);
        var second = await _f.WithDbAsync(db => db.Results.AsNoTracking().Where(r => r.RaceId == w.MainRaces[1]).ToListAsync());
        Assert.Equal("Unruly pony", second.Single(r => r.TeamId == ids[1]).RefereeNote);
        Assert.Equal(ResultStatus.Retired, second.Single(r => r.TeamId == ids[1]).Status);
    }

    [Fact]
    public async Task LongCorrectionReasonIsRefused()
    {
        var w = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w);

        var response = await Scorer(token).PostAsJsonAsync($"/api/scorer/races/{w.MainRaces[0]}/results",
            new SubmitRaceResultsRequest([new(w.Arena.TeamIds[0], 1, false)], [], new string('x', 1001)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ReplayingTheSameRequestId_IsIdempotent_AndTheOtherRulesStillApply()
    {
        var w = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w);
        var scorer = Scorer(token);
        var race = w.MainRaces[0];

        var first = await (await scorer.PutAsJsonAsync(Score(race), Put(w, 0, "offline-1"))).ReadAsync<RaceScoreDto>();
        var retry = await (await scorer.PutAsJsonAsync(Score(race), Put(w, 0, "offline-1"))).ReadAsync<RaceScoreDto>();
        var reused = await scorer.PutAsJsonAsync(Score(race), Put(w, 0, "offline-1", winner: 1));
        var stale = await scorer.PutAsJsonAsync(Score(race), Put(w, 0, "offline-2", "Changed", 1));
        var noReason = await scorer.PutAsJsonAsync(Score(race), Put(w, 1, "offline-3", null, 1));
        var tooFew = await scorer.PutAsJsonAsync(Score(race), new UpdateRaceScoreRequest([new(w.Arena.TeamIds[0], 1, false)], 1, "offline-4", "Changed"));

        Assert.Equal(first.Revision, retry.Revision);
        Assert.True(retry.IdempotentReplay);
        Assert.Equal(HttpStatusCode.Conflict, reused.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, noReason.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooFew.StatusCode);
        Assert.Single(await _f.WithDbAsync(db => db.Set<RaceScoreEvent>().Where(e => e.RaceId == race).ToListAsync()));
    }

    [Fact]
    public async Task SignedOffResults_RefuseTheLink()
    {
        var w = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w);
        var scorer = Scorer(token);
        var race = w.MainRaces[0];
        var saved = await (await scorer.PutAsJsonAsync(Score(race), Put(w, 0, "s1"))).ReadAsync<RaceScoreDto>();
        await w.Owner.PostAsJsonAsync($"/api/races/{race}/score/sign-off", new ScoreActionRequest(saved.Revision, "so", "Checked"));

        var versioned = await scorer.PutAsJsonAsync(Score(race), Put(w, saved.Revision + 1, "s2", "Change", 1));
        var legacy = await scorer.PostAsJsonAsync($"/api/scorer/races/{race}/results", new SubmitRaceResultsRequest(
            [new(w.Arena.TeamIds[1], 1, false), new(w.Arena.TeamIds[0], 2, false), new(w.Arena.TeamIds[2], 3, false)], null, "Change"));

        Assert.Equal(HttpStatusCode.Conflict, versioned.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, legacy.StatusCode);
    }

    [Fact]
    public async Task WrongArena_AndWrongCompetition_AreNotFound()
    {
        var w = await WorldAsync();
        var other = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w, "Main");
        var scorer = Scorer(token);

        // Any arena in the same competition is accessible to the competition's scorer link.
        Assert.Equal(HttpStatusCode.OK, (await scorer.GetAsync(Score(w.SideRaces[0]))).StatusCode);

        foreach (var race in new[] { other.MainRaces[0], 999999 })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await scorer.GetAsync(Score(race))).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await scorer.PutAsJsonAsync(Score(race), Put(w, 0, "x"))).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await scorer.PostAsJsonAsync($"/api/scorer/races/{race}/results", new SubmitRaceResultsRequest([], null))).StatusCode);
        }
        Assert.Empty(await _f.WithDbAsync(db => db.Set<RaceScoreEvent>().Where(e => e.RaceId == other.MainRaces[0]).ToListAsync()));
    }

    [Fact]
    public async Task ARenamedArena_LeavesTheLinkWithNothingToScore()
    {
        var w = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w, "Main");
        await _f.WithDbAsync(async db =>
        {
            (await db.Sessions.FindAsync(w.Arena.SessionId))!.ArenaName = "Renamed";
            await db.SaveChangesAsync();
        });
        var scorer = Scorer(token);

        Assert.Equal(2, (await scorer.GetFromJsonAsync<ScorerSessionDto>("/api/scorer/session", TestClients.Json))!.Sessions.Count);
        Assert.Equal(HttpStatusCode.OK, (await scorer.GetAsync(Score(w.MainRaces[0]))).StatusCode);
    }

    // ---- the token -------------------------------------------------------------------------------

    [Fact]
    public async Task MissingUnknownExpiredAndRevokedTokens_AreToldApart()
    {
        var w = await WorldAsync();
        var (expired, expiredLink) = await CreateLinkAsync(w, label: "Late");
        var (revoked, revokedLink) = await CreateLinkAsync(w, label: "Gone");
        await _f.WithDbAsync(async db =>
        {
            (await db.ScorerLinks.FindAsync(expiredLink.Id))!.ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        });
        await w.Owner.PostAsync($"{LinksUrl(w.Arena.CompetitionId)}/{revokedLink.Id}/revoke", null);
        var race = w.MainRaces[0];

        foreach (var call in new Func<HttpClient, Task<HttpResponseMessage>>[]
        {
            c => c.GetAsync("/api/scorer/session"),
            c => c.GetAsync(Score(race)),
            c => c.PutAsJsonAsync(Score(race), Put(w, 0, "t")),
            c => c.PostAsJsonAsync($"/api/scorer/races/{race}/results", new SubmitRaceResultsRequest([], null)),
        })
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await call(Scorer(null))).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await call(Scorer(" "))).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await call(Scorer(ScorerLinkTokens.Generate()))).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await call(Scorer("not-a-token"))).StatusCode);
            Assert.Equal(HttpStatusCode.Gone, (await call(Scorer(expired))).StatusCode);
            Assert.Equal(HttpStatusCode.Gone, (await call(Scorer(revoked))).StatusCode);
        }
        Assert.Empty(await _f.WithDbAsync(db => db.Set<RaceScoreEvent>().Where(e => e.RaceId == race).ToListAsync()));
    }

    [Fact]
    public async Task UnknownTokensAnswerIdentically_SoNothingCanBeEnumerated()
    {
        var w = await WorldAsync();
        var (real, _) = await CreateLinkAsync(w);
        var almost = real[..^1] + (real[^1] == 'a' ? 'b' : 'a');

        var bodies = new List<string>();
        foreach (var guess in new[] { almost, ScorerLinkTokens.Generate(), "mgs_short", "x" })
        {
            var response = await Scorer(guess).GetAsync("/api/scorer/session");
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            // ProblemDetails carries a per-request trace id; everything else must match.
            var problem = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>(TestClients.Json);
            bodies.Add($"{problem.GetProperty("type")}|{problem.GetProperty("title")}|{problem.GetProperty("status")}");
        }
        Assert.Single(bodies.Distinct());
    }

    [Fact]
    public async Task WrongGuessesFromOneAddress_AreSlowedDown_AndOtherAddressesCarryOn()
    {
        var w = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w);
        var attacker = "10.99.0.1";

        for (var i = 0; i < 20; i++)
            Assert.Equal(HttpStatusCode.NotFound, (await Scorer(ScorerLinkTokens.Generate(), attacker).GetAsync("/api/scorer/session")).StatusCode);
        var blocked = await Scorer(ScorerLinkTokens.Generate(), attacker).GetAsync("/api/scorer/session");

        Assert.Equal(HttpStatusCode.TooManyRequests, blocked.StatusCode);
        Assert.Equal("60", blocked.Headers.GetValues("Retry-After").Single());
        Assert.Equal(HttpStatusCode.OK, (await Scorer(token, "10.99.0.2").GetAsync("/api/scorer/session")).StatusCode);
    }

    [Fact]
    public void FailureCounts_ResetAfterAMinute()
    {
        var clock = new ManualTimeProvider();
        var guard = new ScorerTokenGuard(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["RateLimits:ScorerFailuresPerMinute"] = "3" }).Build(), clock);

        for (var i = 0; i < 3; i++) { Assert.False(guard.IsBlocked("1.1.1.1")); guard.RecordFailure("1.1.1.1"); }
        Assert.True(guard.IsBlocked("1.1.1.1"));
        Assert.False(guard.IsBlocked("2.2.2.2"));

        clock.Advance(TimeSpan.FromMinutes(1));
        Assert.False(guard.IsBlocked("1.1.1.1"));
        guard.RecordFailure("1.1.1.1");
        Assert.False(guard.IsBlocked("1.1.1.1"));
    }

    [Fact]
    public async Task ScorerReads_HaveTheirOwnLimit_AndDoNotPreventSaves()
    {
        using var limited = _f.WithWebHostBuilder(b =>
        {
            b.UseSetting("RateLimits:PublicReadsPerMinute", "1");
            b.UseSetting("RateLimits:ScorerReadsPerMinute", "2");
        });
        var w = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w);
        var scorer = Scorer(token, "198.51.100.45", limited);
        var share = $"/api/share/competitions/{w.Arena.CompetitionId}";

        Assert.Equal(HttpStatusCode.OK, (await scorer.GetAsync(share)).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await scorer.GetAsync(share)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await scorer.GetAsync("/api/scorer/session")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await scorer.GetAsync(Score(w.MainRaces[0]))).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await scorer.GetAsync("/api/scorer/session")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await scorer.PutAsJsonAsync(Score(w.MainRaces[0]), Put(w, 0, "read-limit-save"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await Scorer(token, "198.51.100.46", limited).GetAsync("/api/scorer/session")).StatusCode);
    }

    [Fact]
    public async Task ScorerSaves_HaveTheirOwnRateLimit()
    {
        using var limited = _f.WithWebHostBuilder(b => b.UseSetting("RateLimits:ScorerWritesPerMinute", "3"));
        var w = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w);
        var scorer = Scorer(token, "10.88.0.1", limited);

        var codes = new List<HttpStatusCode>();
        for (var i = 0; i < 5; i++)
            codes.Add((await scorer.PutAsJsonAsync(Score(w.MainRaces[0]), Put(w, 0, $"limit-{i}"))).StatusCode);

        Assert.Equal(HttpStatusCode.OK, codes[0]);
        Assert.Contains(HttpStatusCode.TooManyRequests, codes);
        // Another address is untouched.
        Assert.Equal(HttpStatusCode.OK, (await Scorer(token, "10.88.0.2", limited).GetAsync("/api/scorer/session")).StatusCode);
    }

    [Fact]
    public async Task TheTokenIsNeverLogged()
    {
        var logs = new CapturedLogs();
        using var logged = _f.WithWebHostBuilder(b => b.ConfigureServices(services => services.AddLogging(l => { l.ClearProviders(); l.SetMinimumLevel(LogLevel.Trace); l.AddProvider(logs); })));
        var w = await WorldAsync();
        var created = await w.Owner.PostAsJsonAsync(LinksUrl(w.Arena.CompetitionId), new { label = "Quiet", arenaName = "Main" });
        var token = (await created.ReadAsync<CreatedScorerLinkDto>()).Token;
        var scorer = Scorer(token, factory: logged);
        var stranger = Scorer(token + "x", factory: logged);

        await scorer.GetAsync("/api/scorer/session");
        await scorer.PutAsJsonAsync(Score(w.MainRaces[0]), Put(w, 0, "log-1"));
        await scorer.PutAsJsonAsync(Score(w.SideRaces[0]), Put(w, 0, "log-2"));
        await stranger.GetAsync("/api/scorer/session");
        var bearer = logged.CreateClient();
        bearer.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        await bearer.GetAsync($"/api/races/{w.MainRaces[0]}/score");

        Assert.NotEmpty(logs.Lines);
        Assert.DoesNotContain(logs.Lines, line => line.Contains(token, StringComparison.Ordinal));
        Assert.DoesNotContain(logs.Lines, line => line.Contains(ScorerLinkTokens.Hash(token), StringComparison.Ordinal));
        // The events table holds the label, not any part of the token.
        var events = await _f.WithDbAsync(db => db.Set<RaceScoreEvent>().Where(e => e.RaceId == w.MainRaces[0]).ToListAsync());
        Assert.DoesNotContain(events, e => (e.RequestId + e.Reason + e.ActorLabel + e.BeforeJson + e.AfterJson).Contains(token));
    }

    // ---- the link against every other endpoint -----------------------------------------------------

    private static readonly Regex RouteParameter = new(@"\{\*?(?<name>\w+)(?<constraint>:[^}?]+)?\??\}", RegexOptions.Compiled);

    [Fact]
    public async Task TheLinkOpensNoOtherStaffEndpoint()
    {
        var w = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w);
        var endpoints = _f.Services.GetServices<EndpointDataSource>().SelectMany(s => s.Endpoints).OfType<RouteEndpoint>()
            .Where(e => e.Metadata.GetMetadata<IAuthorizeData>() is not null && e.Metadata.GetMetadata<IAllowAnonymous>() is null)
            .Where(e => !e.RoutePattern.RawText!.StartsWith("api/scorer/", StringComparison.OrdinalIgnoreCase))
            .ToList();
        Assert.True(endpoints.Count > 100, "The test should be walking the whole API.");

        var failures = new List<string>();
        foreach (var endpoint in endpoints)
        {
            var path = "/" + RouteParameter.Replace(endpoint.RoutePattern.RawText!, m => m.Groups["constraint"].Value.Contains("int") ? "1" : "x");
            foreach (var method in endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? ["GET"])
            {
                foreach (var how in new[] { "header", "bearer" })
                {
                    var client = Scorer(token);
                    if (how == "bearer")
                    {
                        client.DefaultRequestHeaders.Remove(ScorerLinkTokens.Header);
                        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    }
                    using var request = new HttpRequestMessage(new HttpMethod(method), path);
                    if (method is "POST" or "PUT" or "PATCH") request.Content = JsonContent.Create(new { });
                    var response = await client.SendAsync(request);
                    if (response.StatusCode is not (HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.NotFound))
                        failures.Add($"{method} {path} ({how}) -> {(int)response.StatusCode}");
                }
            }
        }

        Assert.Empty(failures);
    }

    [Fact]
    public async Task TheLinkCannotRunTheClockOrSignOffEvenOnItsOwnRaces()
    {
        var w = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w);
        var scorer = Scorer(token);
        var race = w.MainRaces[0];

        Assert.Equal(HttpStatusCode.Unauthorized, (await scorer.PostAsync($"/api/races/{race}/start", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await scorer.PostAsync($"/api/races/{race}/stop", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await scorer.PostAsJsonAsync($"/api/races/{race}/score/sign-off", new ScoreActionRequest(0, "x", null))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await scorer.PutAsJsonAsync($"/api/races/{race}/score", Put(w, 0, "direct"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await scorer.GetAsync($"/api/races/{race}/score/history")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await scorer.GetAsync($"/api/competitions/{w.Arena.CompetitionId}/team")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await scorer.GetAsync(LinksUrl(w.Arena.CompetitionId))).StatusCode);
        var scorerCannotCreateLinks = await scorer.PostAsJsonAsync(LinksUrl(w.Arena.CompetitionId), new { label = "Mine", arenaName = "Main" });
        Assert.Equal(HttpStatusCode.Unauthorized, scorerCannotCreateLinks.StatusCode);
    }

    // ---- housekeeping ------------------------------------------------------------------------------

    [Fact]
    public async Task DeletingTheCompetition_RemovesItsLinks()
    {
        var w = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w);
        var admin = await _f.AdminAsync();

        var deleted = await admin.DeleteAsync($"/api/competitions/{w.Arena.CompetitionId}");

        Assert.True(deleted.IsSuccessStatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Scorer(token).GetAsync("/api/scorer/session")).StatusCode);
        Assert.Empty(await _f.WithDbAsync(db => db.ScorerLinks.Where(l => l.CompetitionId == w.Arena.CompetitionId).ToListAsync()));
    }

    [Fact]
    public async Task ScopedLinks_CameraOnlyCannotScore_AndScoreAndStreamCanBothScoreAndControlStreams()
    {
        var w = await WorldAsync();
        var url = LinksUrl(w.Arena.CompetitionId);

        // Invalid scope (99) is rejected with 400
        var invalidResp = await w.Owner.PostAsJsonAsync(url, new { label = "Bad", arenaName = "Main", scope = 99 });
        Assert.Equal(HttpStatusCode.BadRequest, invalidResp.StatusCode);

        // Scope 1 = Camera only
        var camCreated = await (await w.Owner.PostAsJsonAsync(url, new { label = "Tripod Cam", arenaName = "Main", scope = 1 })).ReadAsync<CreatedScorerLinkDto>();
        Assert.Equal(1, camCreated.Link.Scope);
        var camClient = Scorer(camCreated.Token);
        var camSession = await camClient.GetFromJsonAsync<ScorerSessionDto>("/api/scorer/session", TestClients.Json);
        Assert.Equal(1, camSession!.Scope);

        // Camera-only link cannot read or submit race scores (403 Forbidden)
        var race = w.MainRaces[0];
        Assert.Equal(HttpStatusCode.Forbidden, (await camClient.GetAsync(Score(race))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await camClient.PutAsJsonAsync(Score(race), Put(w, 0, "cam-try"))).StatusCode);
        var places = w.Arena.TeamIds.Select((t, i) => new FinishingPlaceDto(t, i + 1, false)).ToList();
        Assert.Equal(HttpStatusCode.Forbidden, (await camClient.PostAsJsonAsync($"/api/scorer/races/{race}/results", new SubmitRaceResultsRequest(places, []))).StatusCode);

        // Camera-only link CAN reach competition overlays for its competition
        Assert.Equal(HttpStatusCode.OK, (await camClient.GetAsync($"/api/competitions/{w.Arena.CompetitionId}/overlays")).StatusCode);

        // Scope 2 = ScoreAndStream
        var bothCreated = await (await w.Owner.PostAsJsonAsync(url, new { label = "Judge + Stream", arenaName = "Main", scope = 2 })).ReadAsync<CreatedScorerLinkDto>();
        Assert.Equal(2, bothCreated.Link.Scope);
        var bothClient = Scorer(bothCreated.Token);
        var bothSession = await bothClient.GetFromJsonAsync<ScorerSessionDto>("/api/scorer/session", TestClients.Json);
        Assert.Equal(2, bothSession!.Scope);

        // ScoreAndStream link can both score races and update overlays
        Assert.Equal(HttpStatusCode.OK, (await bothClient.PutAsJsonAsync(Score(race), Put(w, 0, "both-save"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await bothClient.GetAsync($"/api/competitions/{w.Arena.CompetitionId}/overlays")).StatusCode);

        // Score/ScoreAndStream link can update collecting-ring gate check-in, while Camera-only link cannot
        var heatId = camSession.Sessions[0].Heats[0].Id;
        var teamId = w.Arena.TeamIds[0];
        Assert.Equal(HttpStatusCode.Forbidden,
            (await camClient.PutAsJsonAsync($"/api/scorer/heats/{heatId}/gate-check", new { teamId, status = "at-gate" })).StatusCode);
        var gateResp = await bothClient.PutAsJsonAsync($"/api/scorer/heats/{heatId}/gate-check", new { teamId, status = "at-gate" });
        Assert.Equal(HttpStatusCode.OK, gateResp.StatusCode);
        var updatedSession = await gateResp.ReadAsync<SessionDto>();
        Assert.Contains($"[gate:{heatId}:{teamId}=at-gate]", updatedSession.Notes);
    }

    [Fact]
    public async Task ScorerResponses_AreNeverCachedBySharedCaches()
    {
        var w = await WorldAsync();
        var (token, _) = await CreateLinkAsync(w);

        var response = await Scorer(token).GetAsync("/api/scorer/session");

        var cacheControl = response.Headers.CacheControl!;
        Assert.True(cacheControl.NoStore || cacheControl.NoCache);
        Assert.False(cacheControl.Public);
    }

    private sealed class CapturedLogs : ILoggerProvider
    {
        public List<string> Lines { get; } = [];
        public ILogger CreateLogger(string categoryName) => new Sink(this, categoryName);
        public void Dispose() { }

        private sealed class Sink(CapturedLogs owner, string category) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                var text = $"{category}: {formatter(state, exception)} {exception}";
                // Include structured values too, in case a template hides one from the rendered message.
                if (state is IEnumerable<KeyValuePair<string, object?>> pairs)
                    text += " " + string.Join(' ', pairs.Select(p => $"{p.Key}={p.Value}"));
                lock (owner.Lines) owner.Lines.Add(text);
            }
        }
    }
}
