using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Payouts;
using MountedGames.Api.Services.DecForms;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Competitions;

public class CompetitionDetailSnapshotTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task PinnedPayoutChangesRefreshPublicSummary_AndPayoutQueriesHonourCancellation()
    {
        var club = await factory.SeedClubAsync("Synthetic payout club");
        var id = await factory.SeedCompetitionAsync();
        await factory.InDbAsync(async db =>
        {
            var c = await db.Competitions.FindAsync(id);
            c!.DecFormConfigJson = (DecFormConfig.Basic with { PayoutClubId = club }).ToJson();
            db.Add(new ClubPayoutAccount { ClubId = club, Status = PayoutStatus.Ready, AccountLast4 = "0000", LegalName = "Synthetic private legal name" });
            await db.SaveChangesAsync();
        });
        var anon = factory.CreateClient();
        var url = $"/api/competitions/{id}";
        Assert.True((await anon.GetFromJsonAsync<CompetitionDetail>(url))!.PayoutsTo!.Ready);
        await factory.InDbAsync(db => db.ClubPayoutAccounts.Where(a => a.ClubId == club).ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, PayoutStatus.InProgress)));
        var response = await anon.GetAsync(url);
        var updated = await response.ReadAsync<CompetitionDetail>();
        Assert.False(updated.PayoutsTo!.Ready);
        Assert.Null(updated.PayoutsTo.MaskedAccount);
        Assert.DoesNotContain("Synthetic private", await response.Content.ReadAsStringAsync());
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => factory.InDbAsync(db => db.PayoutsToForClubAsync(club, cancelled.Token)));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => factory.InDbAsync(db => db.PayoutsToAsync("synthetic-user", ct: cancelled.Token)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("/first-view")]
    public async Task SharedAnonymousSnapshotsNeverContainPaymentDetails_AndHistoricalCardsSurviveFlatProjection(string suffix)
    {
        var a = await factory.CreateArenaAsync(1);
        var (_, races) = await factory.AddHeatAsync(a.SessionId, a.TeamIds, "Synthetic heat", 1, 1);
        await factory.InDbAsync(async db =>
        {
            var comp = await db.Competitions.FindAsync(a.CompetitionId);
            comp!.PaymentDestination = "Synthetic private payment instructions";
            comp.PaymentLinkUrl = "https://example.invalid/pay";
            db.Results.Add(new Result { RaceId = races[0], TeamId = a.TeamIds[0], Points = 1, Placing = 1,
                RefereeNote = "[card:yellow] Synthetic private referee explanation" });
            await db.SaveChangesAsync();
        });
        var anon = factory.CreateClient();
        var admin = await factory.AdminAsync();
        var url = $"/api/competitions/{a.CompetitionId}{suffix}";
        for (var i = 0; i < 2; i++)
        {
            var authorised = await admin.GetFromJsonAsync<CompetitionDetail>(url);
            Assert.Equal("Synthetic private payment instructions", authorised!.PaymentDestination);
            var publicResponse = await anon.GetAsync(url);
            var publicText = await publicResponse.Content.ReadAsStringAsync();
            var detail = await publicResponse.ReadAsync<CompetitionDetail>();
            Assert.Null(detail.PaymentDestination);
            Assert.Null(detail.PaymentLinkUrl);
            Assert.DoesNotContain("Synthetic private", publicText);
            Assert.Equal("yellow", Assert.Single(detail.Teams).RefereeCard);
            Assert.Equal("yellow", Assert.Single(Assert.Single(Assert.Single(detail.Sessions).Heats).Entries).RefereeCard);
        }
        await factory.InDbAsync(db => db.Results.Where(r => r.RaceId == races[0]).ExecuteUpdateAsync(s => s.SetProperty(r => r.RefereeNote, "[card:red] Synthetic private replacement")));
        Assert.Equal("red", Assert.Single((await anon.GetFromJsonAsync<CompetitionDetail>(url))!.Teams).RefereeCard);
        var standings = await anon.GetFromJsonAsync<List<StandingRow>>($"/api/competitions/{a.CompetitionId}/standings");
        Assert.Equal("red", Assert.Single(standings!).RefereeCard);
    }

    [Fact]
    public async Task SignupAndCapacityChangesInvalidateDetailOnly_AndWaitlistExpiryBoundsSnapshotLifetime()
    {
        var section = await factory.NewSectionAsync();
        var expiry = DateTime.UtcNow.AddMinutes(10);
        var signupId = await factory.InDbAsync(async db =>
        {
            var signup = new SectionSignup { CompetitionSectionId = section.Id, FullName = "Synthetic entrant" };
            db.Add(signup);
            db.Add(new CompetitionEntrySettings { CompetitionId = section.CompetitionId, MaxStables = 10 });
            await db.SaveChangesAsync();
            db.Add(new SignupExtras { SignupId = signup.Id, TeamsCount = 2, StablesCount = 3, IsWaitlist = true, WaitlistOfferExpiresAt = expiry });
            await db.SaveChangesAsync(); return signup.Id;
        });
        var anon = factory.CreateClient();
        var url = $"/api/competitions/{section.CompetitionId}";
        var first = await anon.GetFromJsonAsync<CompetitionDetail>(url);
        Assert.Equal(7, first!.StablesRemaining);
        var snapshot = await factory.InDbAsync(db => CompetitionDetailReader.LoadAsync(db, section.CompetitionId, false, false, default));
        Assert.Equal(expiry, snapshot.ValidUntil);
        var standingsVersion = await factory.InDbAsync(db => CompetitionSnapshotCache.VersionAsync(db, section.CompetitionId, false, default));
        await factory.InDbAsync(db => db.Set<SignupExtras>().Where(x => x.SignupId == signupId).ExecuteUpdateAsync(s => s.SetProperty(x => x.IsWithdrawn, true)));
        Assert.Equal(10, (await anon.GetFromJsonAsync<CompetitionDetail>(url))!.StablesRemaining);
        Assert.Equal(standingsVersion, await factory.InDbAsync(db => CompetitionSnapshotCache.VersionAsync(db, section.CompetitionId, false, default)));
    }
}
