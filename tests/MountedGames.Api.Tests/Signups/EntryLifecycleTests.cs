using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Signups;

public class EntryLifecycleTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public EntryLifecycleTests(ApiFactory f) => _f = f;
    private static string EntryUrl(CompetitionSection s) => $"/api/competitions/{s.CompetitionId}/sections/{s.Id}/signups";
    private static string PaidUrl(CompetitionSection s, int id) => $"/api/competitions/{s.CompetitionId}/signups/{id}/mark-paid";
    private static string FormUrl(CompetitionSection s) => $"/api/competitions/{s.CompetitionId}/sections/{s.Id}/form-teams";
    private static CreateSectionSignupInput Entry(bool whole = false, int teams = 1, bool waitlist = false, bool pair = false) =>
        new("Synthetic Entrant", "Synthetic Club", null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion,
            TeamName: whole ? "Synthetic Team" : null, WholeTeam: whole, TeamsCount: teams, IsWaitlist: waitlist, LookingForPair: pair);

    [Fact]
    public async Task MultipleTeams_GrantEachDeclaration_AndWithdrawAllLinksAtomically()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1200, max: 2);
        var entrant = await _f.TrainerAsync();
        var admin = await _f.AdminAsync();
        var signup = await (await entrant.PostAsJsonAsync(EntryUrl(section), Entry(true, 2))).ReadAsync<SectionSignupExtendedDto>();
        (await admin.PostAsJsonAsync(PaidUrl(section, signup.Id), new { })).EnsureSuccessStatusCode();
        var mine = (await (await entrant.GetAsync("/api/me/signups")).ReadAsync<List<MySignupExtendedDto>>()).Single(s => s.Id == signup.Id);
        Assert.True(mine.DeclarationAccessGranted);
        Assert.Equal(2, mine.LinkedTeams!.Count);
        foreach (var team in mine.LinkedTeams)
        {
            var submitted = await entrant.PostAsJsonAsync("/api/declaration-forms", new SubmitDeclarationFormRequest(team.Id, null,
                new[] { new RiderEntryInput(null, "Synthetic Rider", null, null, null, false, false, 0) }, false, null, AcceptTerms: true));
            Assert.Equal(HttpStatusCode.OK, submitted.StatusCode);
        }
        var withdrawn = await (await entrant.PostAsJsonAsync($"/api/my/signups/{signup.Id}/withdraw", new { })).ReadAsync<MySignupExtendedDto>();
        Assert.True(withdrawn.RefundPending);
        Assert.False(withdrawn.DeclarationAccessGranted);
        Assert.Empty(withdrawn.LinkedTeams!);
        await _f.InDbAsync(async db =>
        {
            Assert.False(await db.Set<SignupTeamLink>().AnyAsync(x => x.SignupId == signup.Id));
            var teams = await db.Teams.Where(t => t.CompetitionSectionId == section.Id).ToListAsync();
            Assert.Equal(2, teams.Count);
            Assert.All(teams, t => Assert.Equal(TeamEntryStatus.Withdrawn, t.EntryStatus));
            Assert.Equal(2, await db.Set<TeamStatusEvent>().CountAsync(x => x.CompetitionId == section.CompetitionId));
        });
        (await admin.PutAsJsonAsync($"/api/signups/{signup.Id}/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Refunded))).EnsureSuccessStatusCode();
        var refunded = (await (await entrant.GetAsync("/api/me/signups")).ReadAsync<List<MySignupExtendedDto>>()).Single(s => s.Id == signup.Id);
        Assert.True(refunded.IsWithdrawn);
        Assert.False(refunded.RefundPending);
        Assert.Equal(SignupPaymentStatus.Refunded, refunded.Status);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync(PaidUrl(section, signup.Id), new { })).StatusCode);
    }

    [Fact]
    public async Task ReplaceExisting_PreservesWholeMultiTeamGroupIfOneTeamHasHistory()
    {
        var section = await _f.NewSectionAsync();
        var entrant = await _f.TrainerAsync();
        var admin = await _f.AdminAsync();
        var signup = await (await entrant.PostAsJsonAsync(EntryUrl(section), Entry(true, 2))).ReadAsync<SectionSignupExtendedDto>();
        var formed = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, false))).ReadAsync<FormTeamsResult>();
        var retainedIds = formed.Created.Select(t => t.Id).Order().ToArray();
        await _f.InDbAsync(async db =>
        {
            db.DeclarationForms.Add(new DeclarationForm { TeamId = retainedIds[1] });
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, true))).StatusCode);
        var actual = await _f.InDbAsync(db => db.Teams.Where(t => t.CompetitionSectionId == section.Id).Select(t => t.Id).Order().ToArrayAsync());
        Assert.Equal(retainedIds, actual);
        Assert.Equal(2, await _f.InDbAsync(db => db.Set<SignupTeamLink>().CountAsync(l => l.SignupId == signup.Id)));
    }

    [Fact]
    public async Task ReplaceExisting_RebuildsEveryUnusedTeamAndItsLinks()
    {
        var section = await _f.NewSectionAsync();
        var entrant = await _f.TrainerAsync();
        var admin = await _f.AdminAsync();
        var signup = await (await entrant.PostAsJsonAsync(EntryUrl(section), Entry(true, 2))).ReadAsync<SectionSignupExtendedDto>();
        (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, false))).EnsureSuccessStatusCode();
        var rebuilt = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, true))).ReadAsync<FormTeamsResult>();
        Assert.Equal(2, rebuilt.Created.Count);
        Assert.Equal(2, await _f.InDbAsync(db => db.Teams.CountAsync(t => t.CompetitionSectionId == section.Id)));
        Assert.Equal(2, await _f.InDbAsync(db => db.Set<SignupTeamLink>().CountAsync(l => l.SignupId == signup.Id)));
    }

    [Fact]
    public async Task WaitlistPromotion_RequiresSpaceAndPreservesPairHalfPrice()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Pairs, priceMinor: 3000, max: 1);
        var admin = await _f.AdminAsync();
        var (first, _) = await _f.SignupAsync();
        var (second, _) = await _f.SignupAsync();
        var existing = await (await first.PostAsJsonAsync(EntryUrl(section), Entry())).ReadAsync<SectionSignupExtendedDto>();
        var waiting = await (await second.PostAsJsonAsync(EntryUrl(section), Entry(waitlist: true, pair: true))).ReadAsync<SectionSignupExtendedDto>();
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync(PaidUrl(section, waiting.Id), new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync($"/api/signups/{waiting.Id}/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Paid))).StatusCode);
        (await first.PostAsJsonAsync($"/api/my/signups/{existing.Id}/withdraw", new { })).EnsureSuccessStatusCode();
        var paid = await (await admin.PostAsJsonAsync(PaidUrl(section, waiting.Id), new { })).ReadAsync<SectionSignupExtendedDto>();
        Assert.Equal(1500, paid.AmountMinor);
        Assert.False(paid.IsWaitlist);
        Assert.Null(paid.TeamId);
    }

    [Fact]
    public async Task MarkPaid_DoesNotAutoPairOtherSeekingEntries()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Pairs, priceMinor: 1000);
        var admin = await _f.AdminAsync();
        var (entrant, _) = await _f.SignupAsync();
        var seeker = await (await entrant.PostAsJsonAsync(EntryUrl(section), Entry(pair: true))).ReadAsync<SectionSignupExtendedDto>();
        (await admin.PostAsJsonAsync(PaidUrl(section, seeker.Id), new { })).EnsureSuccessStatusCode();
        var ordinary = await (await entrant.PostAsJsonAsync(EntryUrl(section), Entry())).ReadAsync<SectionSignupExtendedDto>();
        (await admin.PostAsJsonAsync(PaidUrl(section, ordinary.Id), new { })).EnsureSuccessStatusCode();
        Assert.Null(await _f.InDbAsync(async db => (await db.SectionSignups.FindAsync(seeker.Id))!.TeamId));
        Assert.NotNull(await _f.InDbAsync(async db => (await db.SectionSignups.FindAsync(ordinary.Id))!.TeamId));
    }

    [Fact]
    public async Task Withdraw_PendingPairReleasesOtherRider_AndDoesNotInventRefund()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Pairs, priceMinor: 1000);
        var (first, _) = await _f.SignupAsync();
        var (second, _) = await _f.SignupAsync();
        var a = await (await first.PostAsJsonAsync(EntryUrl(section), Entry(pair: true))).ReadAsync<SectionSignupExtendedDto>();
        var b = await (await second.PostAsJsonAsync(EntryUrl(section), Entry(pair: true))).ReadAsync<SectionSignupExtendedDto>();
        (await first.PostAsJsonAsync($"/api/my/signups/{a.Id}/pair-request", new { targetSignupId = b.Id })).EnsureSuccessStatusCode();
        var withdrawn = await (await first.PostAsJsonAsync($"/api/my/signups/{a.Id}/withdraw", new { })).ReadAsync<MySignupExtendedDto>();
        Assert.False(withdrawn.RefundPending);
        var remaining = (await (await second.GetAsync("/api/me/signups")).ReadAsync<List<MySignupExtendedDto>>()).Single(s => s.Id == b.Id);
        Assert.Null(remaining.PairRequestStatus);
        Assert.Null(remaining.PairRequestFromSignupId);
        Assert.True(remaining.LookingForPair);
    }

    [Fact]
    public async Task DrawComplete_IsSpecificToTheEntrantsSection()
    {
        var section = await _f.NewSectionAsync();
        var (entrant, _) = await _f.SignupAsync();
        var signup = await (await entrant.PostAsJsonAsync(EntryUrl(section), Entry())).ReadAsync<SectionSignupExtendedDto>();
        await _f.InDbAsync(async db =>
        {
            var other = new CompetitionSection { CompetitionId = section.CompetitionId, DisplayName = "Other", AgeGroup = "Open" };
            var team = new Team { CompetitionId = section.CompetitionId, Section = other, Club = new Club { Name = "Synthetic Other Club" }, DisplayName = "Synthetic Team" };
            var session = new Session { CompetitionId = section.CompetitionId, Section = other, Name = "Other session" };
            var heat = new Heat { Session = session, Label = "Other heat" };
            heat.Entries.Add(new HeatEntry { Team = team }); db.Add(heat); await db.SaveChangesAsync();
        });
        var mine = (await (await entrant.GetAsync("/api/me/signups")).ReadAsync<List<MySignupExtendedDto>>()).Single(s => s.Id == signup.Id);
        Assert.False(mine.DrawComplete);
        (await entrant.PostAsJsonAsync($"/api/my/signups/{signup.Id}/withdraw", new { })).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task CapacityCountsEveryPurchasedTeamAndExcludesWaitlist()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000, max: 2);
        var entrant = await _f.TrainerAsync();
        (await entrant.PostAsJsonAsync(EntryUrl(section), Entry(true, 2))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await entrant.PostAsJsonAsync(EntryUrl(section), Entry())).StatusCode);
        (await entrant.PostAsJsonAsync(EntryUrl(section), Entry(waitlist: true))).EnsureSuccessStatusCode();
        var competition = await (await entrant.GetAsync($"/api/competitions/{section.CompetitionId}")).ReadAsync<System.Text.Json.JsonElement>();
        Assert.Equal(2, competition.GetProperty("sections")[0].GetProperty("activeSignupsCount").GetInt32());
    }

    [Fact]
    public async Task ExtrasFailure_RollsBackEntryAndMatchmakingTogether()
    {
        using var isolated = new ApiFactory();
        var section = await isolated.NewSectionAsync(SectionFormat.Pairs);
        var (entrant, _) = await isolated.SignupAsync();
        await isolated.InDbAsync(async db =>
        {
            await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER reject_entry_extras BEFORE INSERT ON SignupExtras BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");
        });
        Assert.Equal(HttpStatusCode.InternalServerError, (await entrant.PostAsJsonAsync(EntryUrl(section), Entry(pair: true))).StatusCode);
        await isolated.InDbAsync(async db =>
        {
            Assert.False(await db.SectionSignups.AnyAsync(s => s.CompetitionSectionId == section.Id));
            Assert.False(await db.Set<SignupMatchmaking>().AnyAsync());
        });
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task PublicSupporterCode_DoesNotGrantTeamWithdrawalControl(bool hasDeclaration)
    {
        var section = await _f.NewSectionAsync();
        var teamId = await _f.InDbAsync(async db =>
        {
            var team = new Team { CompetitionId = section.CompetitionId, CompetitionSectionId = section.Id,
                Club = new Club { Name = $"Synthetic Unrelated Club {hasDeclaration}" }, DisplayName = "Synthetic Unrelated Team", SupporterJoinKey = "synthetic-public-code" };
            db.Add(team); await db.SaveChangesAsync();
            if (hasDeclaration) { db.Add(new DeclarationForm { TeamId = team.Id }); await db.SaveChangesAsync(); }
            return team.Id;
        });
        var (entrant, _) = await _f.SignupAsync();
        var signup = await (await entrant.PostAsJsonAsync(EntryUrl(section), Entry() with { TeamCode = "synthetic-public-code" })).ReadAsync<SectionSignupExtendedDto>();
        Assert.Equal(teamId, signup.TeamId);
        (await entrant.PostAsJsonAsync($"/api/my/signups/{signup.Id}/withdraw", new { })).EnsureSuccessStatusCode();
        await _f.InDbAsync(async db =>
        {
            var team = await db.Teams.SingleAsync(t => t.Id == teamId);
            Assert.Equal(TeamEntryStatus.Active, team.EntryStatus);
            Assert.False(await db.Set<TeamStatusEvent>().AnyAsync(x => x.TeamId == teamId));
            Assert.Null((await db.SectionSignups.FindAsync(signup.Id))!.TeamId);
        });
    }

    [Fact]
    public async Task WaitlistedPairSeeker_IsNotAdvertisedUntilPromoted()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Pairs, priceMinor: 1000);
        var (entrant, _) = await _f.SignupAsync();
        var signup = await (await entrant.PostAsJsonAsync(EntryUrl(section), Entry(waitlist: true, pair: true))).ReadAsync<SectionSignupExtendedDto>();
        var url = $"/api/competitions/{section.CompetitionId}/matchmaking";
        Assert.DoesNotContain(await (await entrant.GetAsync(url)).ReadAsync<List<MatchmakingEntryDto>>(), x => x.SignupId == signup.Id);
        (await (await _f.AdminAsync()).PostAsJsonAsync(PaidUrl(section, signup.Id), new { })).EnsureSuccessStatusCode();
        Assert.Contains(await (await entrant.GetAsync(url)).ReadAsync<List<MatchmakingEntryDto>>(), x => x.SignupId == signup.Id);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(21, 1)]
    [InlineData(2, int.MaxValue)]
    public async Task Create_RejectsInvalidTeamCountOrFeeOverflow(int teams, int price)
    {
        var section = await _f.NewSectionAsync(priceMinor: price);
        var entrant = await _f.TrainerAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await entrant.PostAsJsonAsync(EntryUrl(section), Entry(true, teams))).StatusCode);
        Assert.False(await _f.InDbAsync(db => db.SectionSignups.AnyAsync(s => s.CompetitionSectionId == section.Id)));
    }

    [Fact]
    public async Task StablingAllocator_StoresBarnHookupVehicleRegAndExposesThemOnSignupsAndMySignups()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Teams, priceMinor: 10000);
        await _f.InDbAsync(async db =>
        {
            var comp = await db.Competitions.SingleAsync(c => c.Id == section.CompetitionId);
            comp.Location = "Newark Showground";
            comp.Postcode = "NG24 2NY";
            comp.What3Words = "filled.count.soap";
            comp.PaymentDestination = "Sort code 12-34-56 Acc 12345678";
            comp.PaymentLinkUrl = "https://buy.stripe.com/test_stabling";
            await db.SaveChangesAsync();
        });

        var entrant = await _f.TrainerAsync();
        var createReq = Entry(true, 1) with
        {
            StablesCount = 5,
            StablingClubOrTeam = "Warwickshire Hunt A",
            VehicleRegistration = "  ab12 cde ",
            ArrivalNotes = "  Arriving Friday 19:00  ",
        };
        var created = await (await entrant.PostAsJsonAsync(EntryUrl(section), createReq)).ReadAsync<SectionSignupExtendedDto>();
        Assert.Equal(5, created.StablesCount);
        Assert.Equal("AB12 CDE", created.VehicleRegistration);
        Assert.Equal("Arriving Friday 19:00", created.ArrivalNotes);
        Assert.Null(created.StableAssignment);
        Assert.Null(created.HookupAssignment);

        var admin = await _f.AdminAsync();
        var stablingUrl = $"/api/competitions/{section.CompetitionId}/signups/{created.Id}/stabling";
        var allocated = await (await admin.PutAsJsonAsync(stablingUrl, new UpdateSignupStablingInput(
            StableAssignment: "  Barn B, Boxes 14–18 ",
            HookupAssignment: "  Hook-up Post 4 "
        ))).ReadAsync<SectionSignupExtendedDto>();
        Assert.Equal("Barn B, Boxes 14–18", allocated.StableAssignment);
        Assert.Equal("Hook-up Post 4", allocated.HookupAssignment);
        Assert.Equal("AB12 CDE", allocated.VehicleRegistration);
        Assert.Equal("Arriving Friday 19:00", allocated.ArrivalNotes);

        // Null leaves fields untouched; blank clears HookupAssignment.
        var updated = await (await admin.PutAsJsonAsync(stablingUrl, new UpdateSignupStablingInput(
            StableAssignment: null,
            HookupAssignment: "   "
        ))).ReadAsync<SectionSignupExtendedDto>();
        Assert.Equal("Barn B, Boxes 14–18", updated.StableAssignment);
        Assert.Null(updated.HookupAssignment);

        var summary = await (await admin.GetAsync($"/api/competitions/{section.CompetitionId}/stabling")).ReadAsync<StablingSummaryDto>();
        var booking = Assert.Single(summary.Bookings, b => b.SignupId == created.Id);
        Assert.Equal("Barn B, Boxes 14–18", booking.StableAssignment);
        Assert.Equal("AB12 CDE", booking.VehicleRegistration);

        var mySignups = await (await entrant.GetAsync("/api/me/signups")).ReadAsync<List<MySignupExtendedDto>>();
        var mine = Assert.Single(mySignups, s => s.Id == created.Id);
        Assert.Equal("Barn B, Boxes 14–18", mine.StableAssignment);
        Assert.Equal("AB12 CDE", mine.VehicleRegistration);
        Assert.Equal("Arriving Friday 19:00", mine.ArrivalNotes);
        Assert.Equal("Sort code 12-34-56 Acc 12345678", mine.PaymentDestination);
        Assert.Equal("https://buy.stripe.com/test_stabling", mine.PaymentLinkUrl);
        Assert.Equal("Newark Showground", mine.CompetitionLocation);
        Assert.Equal("NG24 2NY", mine.CompetitionPostcode);
        Assert.Equal("filled.count.soap", mine.CompetitionWhat3Words);
    }
}
