using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Signups;

/// <summary>A pair accepted before both halves are paid keeps its pairing but forms no team (and gives no declaration access) until both are paid.</summary>
public class PairUpPaymentTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public PairUpPaymentTests(ApiFactory f) => _f = f;

    private sealed record Pair(CompetitionSection Section, HttpClient First, HttpClient Second, SectionSignupDto A, SectionSignupDto B);

    private async Task<Pair> SeekersAsync(int priceMinor = 2000)
    {
        var section = await _f.NewSectionAsync(SectionFormat.Pairs, priceMinor: priceMinor);
        var (first, _) = await _f.SignupAsync("Member");
        var (second, _) = await _f.SignupAsync("Member");
        async Task<SectionSignupDto> JoinAsync(HttpClient client, string name)
        {
            var response = await client.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups", new
            {
                fullName = name, ponyClubName = "Pair Club", lookingForPair = true,
                acceptTerms = true, consentVersion = SignupTerms.WordingVersion,
            });
            response.EnsureSuccessStatusCode();
            return await response.ReadAsync<SectionSignupDto>();
        }
        return new Pair(section, first, second, await JoinAsync(first, "Pia Pending"), await JoinAsync(second, "Paul Pending"));
    }

    private static string Respond(SectionSignupDto s) => $"/api/my/signups/{s.Id}/pair-respond";

    private async Task RequestAsync(Pair p) =>
        (await p.First.PostAsJsonAsync($"/api/my/signups/{p.A.Id}/pair-request", new { targetSignupId = p.B.Id })).EnsureSuccessStatusCode();

    private async Task MarkPaidAsync(Pair p, SectionSignupDto s)
        => (await (await _f.AdminAsync()).PostAsJsonAsync($"/api/competitions/{p.Section.CompetitionId}/signups/{s.Id}/mark-paid", new { })).EnsureSuccessStatusCode();

    private Task<(int? TeamA, int? TeamB, bool AccessA, bool AccessB, string? Status)> StateAsync(Pair p) => _f.WithDbAsync(async db =>
    {
        var a = await db.SectionSignups.AsNoTracking().SingleAsync(s => s.Id == p.A.Id);
        var b = await db.SectionSignups.AsNoTracking().SingleAsync(s => s.Id == p.B.Id);
        var ma = await db.Set<SignupMatchmaking>().AsNoTracking().SingleAsync(m => m.SignupId == p.A.Id);
        var mb = await db.Set<SignupMatchmaking>().AsNoTracking().SingleAsync(m => m.SignupId == p.B.Id);
        return (a.TeamId, b.TeamId, ma.DeclarationAccessGranted, mb.DeclarationAccessGranted, ma.PairRequestStatus);
    });

    [Fact]
    public async Task AcceptingWhileUnpaid_KeepsThePairing_ButFormsNoTeamAndGivesNoDeclarationAccess()
    {
        var p = await SeekersAsync();
        await RequestAsync(p);

        var accepted = await (await p.Second.PostAsJsonAsync(Respond(p.B), new { accept = true })).ReadAsync<MySignupDto>();

        Assert.Null(accepted.TeamId);
        var state = await StateAsync(p);
        Assert.Equal((null, null, false, false, "AcceptedAwaitingPayment"), (state.TeamA, state.TeamB, state.AccessA, state.AccessB, state.Status));
        Assert.Empty(await _f.WithDbAsync(db => db.Teams.Where(t => t.CompetitionSectionId == p.Section.Id).ToListAsync()));
    }

    [Fact]
    public async Task TheTeamFormsWhenTheSecondEntryIsMarkedPaid_AndNotBefore()
    {
        var p = await SeekersAsync();
        await RequestAsync(p);
        (await p.Second.PostAsJsonAsync(Respond(p.B), new { accept = true })).EnsureSuccessStatusCode();

        await MarkPaidAsync(p, p.B);
        var half = await StateAsync(p);
        Assert.Null(half.TeamA);
        Assert.Null(half.TeamB);
        Assert.False(half.AccessB);

        await MarkPaidAsync(p, p.A);
        var done = await StateAsync(p);
        Assert.NotNull(done.TeamA);
        Assert.Equal(done.TeamA, done.TeamB);
        Assert.True(done.AccessA);
        Assert.True(done.AccessB);
        Assert.Equal("Accepted", done.Status);
        var team = await _f.WithDbAsync(db => db.Teams.AsNoTracking().SingleAsync(t => t.Id == done.TeamA));
        Assert.Equal("Pia Pending & Paul Pending", team.DisplayName);
        Assert.Equal(p.Section.Id, team.CompetitionSectionId);
    }

    [Fact]
    public async Task AcceptingWithOnePaidEntry_WaitsForTheOther()
    {
        var p = await SeekersAsync();
        await MarkPaidAsync(p, p.A);
        await RequestAsync(p);

        var accepted = await (await p.Second.PostAsJsonAsync(Respond(p.B), new { accept = true })).ReadAsync<MySignupDto>();
        Assert.Null(accepted.TeamId);

        await MarkPaidAsync(p, p.B);
        var done = await StateAsync(p);
        Assert.NotNull(done.TeamA);
        Assert.Equal(done.TeamA, done.TeamB);
    }

    [Fact]
    public async Task MarkClubPaid_FormsTheAcceptedPairToo()
    {
        var p = await SeekersAsync();
        await RequestAsync(p);
        (await p.Second.PostAsJsonAsync(Respond(p.B), new { accept = true })).EnsureSuccessStatusCode();

        var admin = await _f.AdminAsync();
        var response = await admin.PostAsJsonAsync($"/api/competitions/{p.Section.CompetitionId}/signups/mark-club-paid",
            new { ponyClubName = "Pair Club", sendReceiptEmail = false });

        response.EnsureSuccessStatusCode();
        var done = await StateAsync(p);
        Assert.NotNull(done.TeamA);
        Assert.Equal(done.TeamA, done.TeamB);
        Assert.Single(await _f.WithDbAsync(db => db.Teams.Where(t => t.CompetitionSectionId == p.Section.Id).ToListAsync()));
    }

    [Fact]
    public async Task OrganiserFormTeams_LeavesAnAwaitingPairAlone()
    {
        var p = await SeekersAsync();
        await RequestAsync(p);
        (await p.Second.PostAsJsonAsync(Respond(p.B), new { accept = true })).EnsureSuccessStatusCode();
        await MarkPaidAsync(p, p.A);

        var admin = await _f.AdminAsync();
        var formed = await admin.PostAsJsonAsync(
            $"/api/competitions/{p.Section.CompetitionId}/sections/{p.Section.Id}/form-teams",
            new FormTeamsFromSignupsRequest(null, Preview: false, ReplaceExisting: false));

        // The paid half is not turned into a one-rider team while its partner is still to pay.
        Assert.Equal(HttpStatusCode.BadRequest, formed.StatusCode);
        Assert.Empty(await _f.WithDbAsync(db => db.Teams.Where(t => t.CompetitionSectionId == p.Section.Id).ToListAsync()));
    }

    [Fact]
    public async Task CancellingAnAwaitingEntry_ReleasesThePairingAndPutsThePartnerBackOnTheList()
    {
        var p = await SeekersAsync();
        await RequestAsync(p);
        (await p.Second.PostAsJsonAsync(Respond(p.B), new { accept = true })).EnsureSuccessStatusCode();

        var admin = await _f.AdminAsync();
        (await admin.PutAsJsonAsync($"/api/signups/{p.A.Id}/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Cancelled))).EnsureSuccessStatusCode();

        await _f.WithDbAsync(async db =>
        {
            var mb = await db.Set<SignupMatchmaking>().AsNoTracking().SingleAsync(m => m.SignupId == p.B.Id);
            Assert.True(mb.LookingForPair);
            Assert.Null(mb.PairRequestStatus);
            Assert.Null(mb.PairRequestFromSignupId);
            Assert.Null(mb.PairRequestToSignupId);
        });
        // Paying the partner now does not conjure a team from a pairing that no longer exists.
        await MarkPaidAsync(p, p.B);
        Assert.Empty(await _f.WithDbAsync(db => db.Teams.Where(t => t.CompetitionSectionId == p.Section.Id).ToListAsync()));
    }

    [Fact]
    public async Task LockedEntries_RefuseBothTheRequestAndTheAcceptance_ButAllowDeclining()
    {
        var p = await SeekersAsync();
        await RequestAsync(p);
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.SingleAsync(c => c.Id == p.Section.CompetitionId)).SignupsLocked = true;
            await db.SaveChangesAsync();
        });

        var accept = await p.Second.PostAsJsonAsync(Respond(p.B), new { accept = true });
        Assert.Equal(HttpStatusCode.BadRequest, accept.StatusCode);
        Assert.Contains("closed", await accept.Content.ReadAsStringAsync());
        Assert.Null((await StateAsync(p)).TeamA);

        // Declining only frees the pairing up, so it stays open; the request can then not be remade.
        (await p.Second.PostAsJsonAsync(Respond(p.B), new { accept = false })).EnsureSuccessStatusCode();
        var request = await p.First.PostAsJsonAsync($"/api/my/signups/{p.A.Id}/pair-request", new { targetSignupId = p.B.Id });
        Assert.Equal(HttpStatusCode.BadRequest, request.StatusCode);
        Assert.Empty(await _f.WithDbAsync(db => db.Teams.Where(t => t.CompetitionSectionId == p.Section.Id).ToListAsync()));
    }

    [Fact]
    public async Task APastClosingTime_RefusesTheAcceptanceToo()
    {
        var p = await SeekersAsync();
        await RequestAsync(p);
        await _f.WithDbAsync(async db =>
        {
            db.Add(new CompetitionEntrySettings { CompetitionId = p.Section.CompetitionId, EntriesCloseAt = DateTime.UtcNow.AddMinutes(-5) });
            await db.SaveChangesAsync();
        });

        var accept = await p.Second.PostAsJsonAsync(Respond(p.B), new { accept = true });

        Assert.Equal(HttpStatusCode.BadRequest, accept.StatusCode);
        Assert.Null((await StateAsync(p)).TeamB);
    }

    [Fact]
    public async Task APairAcceptedWhilePaid_FormsItsTeamAtOnce()
    {
        var p = await SeekersAsync();
        await MarkPaidAsync(p, p.A);
        await MarkPaidAsync(p, p.B);
        await RequestAsync(p);

        var accepted = await (await p.Second.PostAsJsonAsync(Respond(p.B), new { accept = true })).ReadAsync<MySignupDto>();

        Assert.NotNull(accepted.TeamId);
        var state = await StateAsync(p);
        Assert.True(state.AccessA);
        Assert.True(state.AccessB);
    }
}
