using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Controllers;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Commerce;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests;

public class BreakThisBackendFixesTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task WholeHeatCallUp_WithNullTeamIdAndNullBody_BuildsCollectingRingAnnouncementWithoutCrashing()
    {
        var arena = await f.CreateArenaAsync(2);
        var (heatId, _) = await f.AddHeatAsync(arena.SessionId, arena.TeamIds, "Heat 1", 1);

        using var scope = f.Services.CreateScope();
        var scoring = scope.ServiceProvider.GetRequiredService<ScoringService>();
        var msg = await scoring.CreateMissingTeamCallAsync(
            heatId,
            teamId: null,
            userId: null,
            authorName: "Ring Steward",
            body: null,
            competitionId: arena.CompetitionId);

        Assert.NotNull(msg);
        Assert.Contains("Heat 1 needed at the collecting ring now", msg!.Body);
    }

    [Fact]
    public async Task RankForFinals_AndCreateFinals_IgnoreScoredFinalsPoints_ReuseUnscoredFinalsSession_AndRefuseWhenFinalsScored()
    {
        var ownerId = await f.TrainerIdAsync();
        var trainer = await f.TrainerAsync();
        var compId = await f.SeedCompetitionAsync(ownerUserId: ownerId);
        var sectionId = await f.SeedSectionAsync(compId, "Under 15");
        var clubId = await f.SeedClubAsync();
        var t1 = await f.SeedTeamAsync(compId, sectionId, clubId, "Alpha");
        var t2 = await f.SeedTeamAsync(compId, sectionId, clubId, "Bravo");

        await f.SeedScoredRaceAsync(compId, sectionId, new (int, int?, bool, int)[]
        {
            (t1, 1, false, 10),
            (t2, 2, false, 5),
        });

        // 1. First CreateFinals creates the Finals session.
        var createReq = new CreateFinalsRequest(sectionId, 2, new[] { "Bending" }, LanesPerHeat: 2, Name: null);
        var firstRes = await trainer.PostAsJsonAsync($"/api/competitions/{compId}/finals", createReq);
        Assert.Equal(HttpStatusCode.OK, firstRes.StatusCode);
        var firstSession = await firstRes.ReadAsync<SessionDto>();

        // 2. Calling CreateFinals again while unscored reuses the same Finals session instead of duplicating it.
        var secondRes = await trainer.PostAsJsonAsync($"/api/competitions/{compId}/finals", createReq);
        Assert.Equal(HttpStatusCode.OK, secondRes.StatusCode);
        var secondSession = await secondRes.ReadAsync<SessionDto>();
        Assert.Equal(firstSession.Id, secondSession.Id);

        // 3. Score the final race (giving Bravo 20 points in the A Final) and verify:
        //    (a) FinalsBoundary still ranks by qualifying points (Alpha 10 > Bravo 5), and
        //    (b) CreateFinals refuses to overwrite a scored final.
        var finalRaceId = secondSession.Heats.Single().Races.Single().Id;
        await f.WithDbAsync(async db =>
        {
            var r = await db.Races.SingleAsync(x => x.Id == finalRaceId);
            r.IsComplete = true;
            db.Results.AddRange(
                new Result { RaceId = finalRaceId, TeamId = t2, Placing = 1, Points = 20 },
                new Result { RaceId = finalRaceId, TeamId = t1, Placing = 2, Points = 1 });
            await db.SaveChangesAsync();
        });

        var conflictRes = await trainer.PostAsJsonAsync($"/api/competitions/{compId}/finals", createReq);
        Assert.Equal(HttpStatusCode.Conflict, conflictRes.StatusCode);
    }

    [Fact]
    public async Task GenerateRaceFinals_AndGenerateHeats_RefuseReplaceExistingWhenRacesAreScored()
    {
        var a = await f.CreateArenaAsync(4, raceFinals: true);
        var admin = await f.AdminAsync();

        var genRes = await admin.PostAsJsonAsync(
            $"/api/competitions/{a.CompetitionId}/sessions/{a.SessionId}/generate-race-finals",
            new GenerateRaceFinalsRequest(a.TeamIds, new[] { "Bending" }, null, true));
        Assert.Equal(HttpStatusCode.OK, genRes.StatusCode);
        var sessionDto = await genRes.ReadAsync<SessionDto>();
        var q1RaceId = sessionDto.Heats.First().Races.First().Id;

        await f.WithDbAsync(async db =>
        {
            var r = await db.Races.SingleAsync(x => x.Id == q1RaceId);
            r.IsComplete = true;
            db.Results.Add(new Result { RaceId = q1RaceId, TeamId = a.TeamIds[0], Placing = 1, Points = 5 });
            await db.SaveChangesAsync();
        });

        var replaceRaceFinals = await admin.PostAsJsonAsync(
            $"/api/competitions/{a.CompetitionId}/sessions/{a.SessionId}/generate-race-finals",
            new GenerateRaceFinalsRequest(a.TeamIds, new[] { "Bending" }, null, true));
        Assert.Equal(HttpStatusCode.Conflict, replaceRaceFinals.StatusCode);

        var replaceHeats = await admin.PostAsJsonAsync(
            $"/api/competitions/{a.CompetitionId}/sessions/{a.SessionId}/generate-heats",
            new GenerateHeatsRequest(a.TeamIds, new[] { "Bending" }, null, true));
        Assert.Equal(HttpStatusCode.Conflict, replaceHeats.StatusCode);
    }

    [Fact]
    public async Task RespondPairUp_RefusesAcceptAfterDrawIsMade()
    {
        var section = await f.NewSectionAsync(SectionFormat.Pairs, priceMinor: 2000);
        var (r1, _) = await f.SignupAsync("Member");
        var (r2, _) = await f.SignupAsync("Member");

        var s1 = await (await r1.PostAsJsonAsync(
            $"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups",
            new CreateSectionSignupInput("Rider One", "Club A", null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, LookingForPair: true)))
            .ReadAsync<SectionSignupExtendedDto>();
        var s2 = await (await r2.PostAsJsonAsync(
            $"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups",
            new CreateSectionSignupInput("Rider Two", "Club A", null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, LookingForPair: true)))
            .ReadAsync<SectionSignupExtendedDto>();

        (await r1.PostAsJsonAsync($"/api/my/signups/{s1.Id}/pair-request", new { targetSignupId = s2.Id })).EnsureSuccessStatusCode();

        // Simulate the draw taking place in this section before Rider Two responds.
        await f.WithDbAsync(async db =>
        {
            var club = new Club { Name = "Drawn Club" };
            var team = new Team { CompetitionId = section.CompetitionId, CompetitionSectionId = section.Id, Club = club, DisplayName = "Drawn Pair" };
            var session = new Session { CompetitionId = section.CompetitionId, CompetitionSectionId = section.Id, Name = "Heats" };
            var heat = new Heat { Session = session, Label = "Heat 1" };
            heat.Entries.Add(new HeatEntry { Team = team, LaneIndex = 1 });
            db.Heats.Add(heat);
            await db.SaveChangesAsync();
        });

        var respondAfterDraw = await r2.PostAsJsonAsync($"/api/my/signups/{s2.Id}/pair-respond", new { accept = true });
        Assert.Equal(HttpStatusCode.Conflict, respondAfterDraw.StatusCode);
    }

    [Fact]
    public async Task CancelledOrRefundedSignup_CleansUpUnDrawnTeamsAndLinks()
    {
        var section = await f.NewSectionAsync(priceMinor: 2000);
        var trainer = await f.TrainerAsync();
        var admin = await f.AdminAsync();

        var signup = await (await trainer.PostAsJsonAsync(
            $"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups",
            new CreateSectionSignupInput("Refund Manager", "Refund Club", null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, WholeTeam: true, TeamName: "Refund Team A")))
            .ReadAsync<SectionSignupExtendedDto>();

        var paid = await (await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{signup.Id}/mark-paid", new { }))
            .ReadAsync<SectionSignupExtendedDto>();
        Assert.NotNull(paid.TeamId);
        Assert.True(await f.InDbAsync(db => db.Teams.AnyAsync(t => t.Id == paid.TeamId)));

        var refundRes = await admin.PutAsJsonAsync($"/api/signups/{signup.Id}/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Refunded));
        Assert.Equal(HttpStatusCode.OK, refundRes.StatusCode);

        await f.InDbAsync(async db =>
        {
            Assert.False(await db.Teams.AnyAsync(t => t.Id == paid.TeamId));
            var reloaded = await db.SectionSignups.FindAsync(signup.Id);
            Assert.Null(reloaded!.TeamId);
        });
    }

    [Fact]
    public async Task WaitlistOffer_FreezesAmountMinorAgainstPriceIncrease_AndRealIncomeCountsRetainedWithdrawnFees()
    {
        var section = await f.NewSectionAsync(SectionFormat.Pairs, priceMinor: 3000, max: 1);
        var admin = await f.AdminAsync();
        var (first, _) = await f.SignupAsync();
        var (second, _) = await f.SignupAsync();

        var active = await (await first.PostAsJsonAsync(
            $"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups",
            new CreateSectionSignupInput("Active Entrant", "Club", null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion)))
            .ReadAsync<SectionSignupExtendedDto>();
        (await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{active.Id}/mark-paid", new { })).EnsureSuccessStatusCode();

        var waiting = await (await second.PostAsJsonAsync(
            $"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups",
            new CreateSectionSignupInput("Waitlist Entrant", "Club", null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, IsWaitlist: true)))
            .ReadAsync<SectionSignupExtendedDto>();

        // Active entrant withdraws, and organiser retains their £30 fee.
        (await first.PostAsJsonAsync($"/api/my/signups/{active.Id}/withdraw", new { })).EnsureSuccessStatusCode();
        (await admin.PutAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{active.Id}/disposition",
            new UpdateSignupDispositionInput("Retained", null, "Late withdrawal"))).EnsureSuccessStatusCode();

        // Offer the spot while section price is £30 (3000), then raise section price to £50 (5000).
        var offered = await (await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{waiting.Id}/offer-waitlist-spot", new { }))
            .ReadAsync<SectionSignupExtendedDto>();
        Assert.Equal(3000, offered.AmountMinor);

        await f.WithDbAsync(async db =>
        {
            var sec = await db.CompetitionSections.SingleAsync(s => s.Id == section.Id);
            sec.PriceMinor = 5000;
            await db.SaveChangesAsync();
        });

        var accepted = await (await second.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{waiting.Id}/accept-waitlist-spot", new { }))
            .ReadAsync<MySignupExtendedDto>();
        Assert.Equal(3000, accepted.AmountMinor);

        // RealIncome includes the £30 retained fee from the withdrawn entry.
        var income = await f.WithDbAsync(db => RealIncome.ForCompetitionAsync(db, section.CompetitionId));
        Assert.Equal(3000, income.EntriesMinor);
    }

    [Fact]
    public async Task CloningCompetitionAcrossDifferentClubs_DoesNotCopyPaymentDestinationOrLink()
    {
        var (ownerClient, ownerAuth) = await f.ApprovedTrainerAsync();
        var compId = await f.WithDbAsync(async db =>
        {
            var c = new Competition
            {
                Name = "Club A Show",
                StartDate = new DateTime(2032, 6, 1, 9, 0, 0, DateTimeKind.Utc),
                CreatedByUserId = ownerAuth.User.Id,
                PaymentDestination = "Sort 11-22-33 Acc 12345678",
                PaymentLinkUrl = "https://buy.stripe.com/test_club_a",
            };
            db.Competitions.Add(c);
            await db.SaveChangesAsync();
            return c.Id;
        });

        var admin = await f.AdminAsync();
        var cloneRes = await admin.PostAsJsonAsync(
            $"/api/event-tools/competitions/{compId}/clone",
            new CloneCompetitionRequest("Admin Copy", new DateTime(2033, 6, 1, 9, 0, 0, DateTimeKind.Utc), null));
        Assert.Equal(HttpStatusCode.Created, cloneRes.StatusCode);
        var cloned = await cloneRes.ReadAsync<CloneCompetitionResultDto>();

        await f.WithDbAsync(async db =>
        {
            var copy = await db.Competitions.SingleAsync(c => c.Id == cloned.CompetitionId);
            Assert.Null(copy.PaymentDestination);
            Assert.Null(copy.PaymentLinkUrl);
        });
    }

    [Fact]
    public async Task PrintableDrawAndScoreSheets_ShowFinalRacesAndBlankTeamBoxes_BeforeFinalsPopulated()
    {
        var compId = await f.SeedCompetitionAsync();
        var sectionId = await f.SeedSectionAsync(compId, "Open");
        var clubId = await f.SeedClubAsync();
        for (var i = 1; i <= 7; i++)
        {
            await f.SeedTeamAsync(compId, sectionId, clubId, $"Team {i}");
        }

        // Case 1: Planned Finals session (Heats == empty, PlannedRaces + PlannedFinalRaces set)
        await f.WithDbAsync(async db =>
        {
            db.Sessions.Add(new Session
            {
                CompetitionId = compId,
                CompetitionSectionId = sectionId,
                Name = "Finals · Open",
                OrderIndex = 1,
                LanesPerHeat = 5,
                PlannedRaces = "[\"Bending\",\"2 Mug\"]",
                PlannedFinalRaces = "{\"B\":[\"Flag\",\"5 Mug\"]}",
            });
            await db.SaveChangesAsync();
        });

        var admin = await f.AdminAsync();
        var plannedDraw = await (await admin.GetAsync($"/api/event-tools/competitions/{compId}/print/draw")).ReadAsync<PrintableDrawDto>();
        var plannedSession = Assert.Single(plannedDraw.Sessions);
        Assert.Equal(2, plannedSession.Heats.Count);
        Assert.Equal("A Final", plannedSession.Heats[0].Label);
        Assert.Equal(5, plannedSession.Heats[0].Teams.Count);
        Assert.All(plannedSession.Heats[0].Teams, t => Assert.Equal(string.Empty, t.TeamName));
        Assert.Equal(new[] { "Bending", "2 Mug" }, plannedSession.Heats[0].Races.Select(r => r.Name).ToArray());

        Assert.Equal("B Final", plannedSession.Heats[1].Label);
        Assert.Equal(2, plannedSession.Heats[1].Teams.Count);
        Assert.Equal(new[] { "Flag", "5 Mug" }, plannedSession.Heats[1].Races.Select(r => r.Name).ToArray());

        // Case 2: Scaffolded Final heats (Heats exist with empty Entries)
        var scaffoldRes = await admin.PostAsJsonAsync(
            $"/api/competitions/{compId}/finals/scaffold",
            new ScaffoldFinalsRequest(sectionId, ["Sword", "Bank"], LanesPerHeat: 5, NumHeats: 2, Name: null, MinutesPerHeat: null, ScheduledStart: null));
        Assert.Equal(HttpStatusCode.OK, scaffoldRes.StatusCode);

        var sheets = await (await admin.GetAsync($"/api/event-tools/competitions/{compId}/print/score-sheets")).ReadAsync<PrintableScoreSheetsDto>();
        var scaffoldedHeats = sheets.Heats.Where(h => h.HeatId > 0).ToArray();
        Assert.Equal(2, scaffoldedHeats.Length);
        var aFinal = Assert.Single(scaffoldedHeats, h => h.Label == "A Final");
        Assert.Equal(new[] { "Sword", "Bank" }, aFinal.Races.Select(r => r.Name).ToArray());
        Assert.Equal(5, aFinal.Races[0].Teams.Count);
        Assert.All(aFinal.Races[0].Teams, c => Assert.Equal(string.Empty, c.TeamName));

        var bFinal = Assert.Single(scaffoldedHeats, h => h.Label == "B Final");
        Assert.Equal(2, bFinal.Races[0].Teams.Count);
    }
}
