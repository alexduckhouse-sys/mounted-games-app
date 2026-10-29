using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Signups;

public class SignupTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public SignupTests(ApiFactory f) => _f = f;

    private static string Url(CompetitionSection s) => $"/api/competitions/{s.CompetitionId}/sections/{s.Id}/signups";

    private static CreateSectionSignupRequest Entry(string name = "Rider One", string? club = null, string? code = null)
        => new(name, club, "rider@example.com", code, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion);

    [Fact]
    public async Task Create_RateLimitIsPerSignedInAccount()
    {
        using var factory = new SignupLimitedFactory();
        var section = await factory.NewSectionAsync();
        var first = await factory.TrainerAsync();
        var (second, _) = await factory.SignupAsync();

        Assert.Equal(HttpStatusCode.OK, (await first.PostAsJsonAsync(Url(section), Entry("Test entrant one"))).StatusCode);
        var limited = await first.PostAsJsonAsync(Url(section), Entry("Test entrant two"));
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Equal("60", limited.Headers.GetValues("Retry-After").Single());
        Assert.Equal(HttpStatusCode.OK, (await second.PostAsJsonAsync(Url(section), Entry("Test entrant three"))).StatusCode);
    }

    private sealed class SignupLimitedFactory : ApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("RateLimits:SignupPerMinute", "1");
        }
    }

    [Fact]
    public async Task Create_RecordsPendingSignupAtSectionPrice()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1500);

        var resp = await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry("  Alice  "));

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var dto = await resp.ReadAsync<SectionSignupDto>();
        Assert.Equal(("Alice", 1500, SignupPaymentStatus.Pending), (dto.FullName, dto.AmountMinor, dto.Status));
        Assert.Null(dto.PaidAt);
    }

    [Fact]
    public async Task Create_RecordsFreeSignupAsPaid()
    {
        var section = await _f.NewSectionAsync(priceMinor: 0);

        var dto = await (await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry()))
            .ReadAsync<SectionSignupDto>();

        Assert.Equal(SignupPaymentStatus.Paid, dto.Status);
        Assert.NotNull(dto.PaidAt);
    }

    [Fact]
    public async Task Create_Returns401_WhenAnonymous()
    {
        var section = await _f.NewSectionAsync();

        var resp = await _f.CreateClient().PostAsJsonAsync(Url(section), Entry());

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        Assert.False(await _f.InDbAsync(db => db.SectionSignups.AnyAsync(s => s.CompetitionSectionId == section.Id)));
    }

    [Fact]
    public async Task Create_LinksSignupToSignedInUser()
    {
        var section = await _f.NewSectionAsync();
        var (client, auth) = await _f.SignupAsync();

        await client.PostAsJsonAsync(Url(section), Entry());

        var userId = await _f.InDbAsync(db => db.SectionSignups
            .Where(s => s.CompetitionSectionId == section.Id).Select(s => s.UserId).SingleAsync());
        Assert.Equal(auth.User.Id, userId);
    }

    [Fact]
    public async Task Create_RejectsOverlongFields()
    {
        var section = await _f.NewSectionAsync();
        var trainer = await _f.TrainerAsync();

        var longName = await trainer.PostAsJsonAsync(Url(section), Entry(new string('x', 121)));
        var longClub = await trainer.PostAsJsonAsync(Url(section), Entry("Rider", club: new string('c', 151)));
        var longContact = await trainer.PostAsJsonAsync(Url(section),
            new CreateSectionSignupRequest("Rider", "Club", new string('p', 201), AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion));
        var longTeam = await trainer.PostAsJsonAsync(Url(section),
            new CreateSectionSignupRequest("Rider", "Club", null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, TeamName: new string('t', 121)));

        Assert.Equal(HttpStatusCode.BadRequest, longName.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, longClub.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, longContact.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, longTeam.StatusCode);
    }

    [Fact]
    public async Task Create_LetsAnAdminEnter_ForTestingAndClubUse()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1500);
        var admin = await _f.AdminAsync();

        var resp = await admin.PostAsJsonAsync(Url(section), Entry("Admin Entrant"));

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var dto = await resp.ReadAsync<SectionSignupDto>();
        Assert.Equal(("Admin Entrant", 1500, SignupPaymentStatus.Pending), (dto.FullName, dto.AmountMinor, dto.Status));
    }

    [Fact]
    public async Task Create_Returns404_WhenSectionNotInCompetition()
    {
        var section = await _f.NewSectionAsync();

        var resp = await (await _f.TrainerAsync()).PostAsJsonAsync(
            $"/api/competitions/{section.CompetitionId + 999}/sections/{section.Id}/signups", Entry());

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Create_Returns403_WhenSignupsLocked()
    {
        var section = await _f.NewSectionAsync(locked: true);

        var resp = await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry());

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Create_Returns400_WhenNameBlank(string name)
    {
        var section = await _f.NewSectionAsync();

        var resp = await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry(name));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Create_Returns403_WhenSectionFull()
    {
        var section = await _f.NewSectionAsync(max: 1);
        var client = await _f.TrainerAsync();
        await client.PostAsJsonAsync(Url(section), Entry("First"));

        var resp = await client.PostAsJsonAsync(Url(section), Entry("Second"));

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task Create_AllowsEntry_WhenCancelledSignupsFreeTheCap()
    {
        var section = await _f.NewSectionAsync(max: 1);
        var client = await _f.TrainerAsync();
        var first = await (await client.PostAsJsonAsync(Url(section), Entry("First"))).ReadAsync<SectionSignupDto>();
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/signups/{first.Id}/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Cancelled));

        var resp = await client.PostAsJsonAsync(Url(section), Entry("Second"));

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task Create_Returns403_WhenIpBlocked()
    {
        var section = await _f.NewSectionAsync();
        await _f.InDbAsync(async db =>
        {
            db.IpBlocks.Add(new IpBlock { IpAddress = "10.9.9.9" });
            await db.SaveChangesAsync();
        });
        var client = await _f.TrainerAsync();
        client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "10.9.9.9");

        var resp = await client.PostAsJsonAsync(Url(section), Entry());

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task Create_LinksTeam_WhenTeamCodeMatchesCaseInsensitively()
    {
        var section = await _f.NewSectionAsync();
        var teamId = await ArrangeTeamAsync(section, "JoinMe-1");

        var resp = await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry(code: " joinme-1 "));

        Assert.Equal(teamId, (await resp.ReadAsync<SectionSignupDto>()).TeamId);
    }

    [Fact]
    public async Task Create_DoesNotLinkAPublicCodeFromAnotherSection()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        await ArrangeTeamAsync(section, "SYNTHETIC-CROSS-SECTION");
        var other = await _f.WithDbAsync(async db =>
        {
            var second = new CompetitionSection { CompetitionId = section.CompetitionId, Format = SectionFormat.Teams, AgeGroup = "Synthetic", DisplayName = "Synthetic second section", PriceMinor = 1000 };
            db.Add(second);
            await db.SaveChangesAsync();
            return second;
        });
        var response = await (await _f.TrainerAsync()).PostAsJsonAsync(Url(other), Entry(code: "SYNTHETIC-CROSS-SECTION"));
        response.EnsureSuccessStatusCode();
        Assert.Null((await response.ReadAsync<SectionSignupDto>()).TeamId);
    }

    [Fact]
    public async Task Create_LeavesTeamEmpty_WhenTeamCodeUnknown()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000);

        var resp = await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry(code: "nope"));

        Assert.Null((await resp.ReadAsync<SectionSignupDto>()).TeamId);
    }

    [Fact]
    public async Task List_ReturnsOnlyThatCompetitionsSignups_NewestFirst()
    {
        var a = await _f.NewSectionAsync();
        var b = await _f.NewSectionAsync();
        var client = await _f.TrainerAsync();
        await client.PostAsJsonAsync(Url(a), Entry("A-first"));
        await client.PostAsJsonAsync(Url(a), Entry("A-second"));
        await client.PostAsJsonAsync(Url(b), Entry("B-only"));

        var admin = await _f.AdminAsync();

        var rows = await (await admin.GetAsync($"/api/competitions/{a.CompetitionId}/signups"))
            .ReadAsync<List<SectionSignupDto>>();

        Assert.Equal(new[] { "A-second", "A-first" }, rows.Select(r => r.FullName));
    }

    [Fact]
    public async Task List_IsRestrictedToOrganisers_WhoOwnTheCompetition()
    {
        var a = await _f.NewSectionAsync();
        var trainer = await _f.TrainerAsync();

        var anonymous = await _f.CreateClient().GetAsync($"/api/competitions/{a.CompetitionId}/signups");
        var notOwner = await trainer.GetAsync($"/api/competitions/{a.CompetitionId}/signups");

        Assert.Equal((HttpStatusCode.Unauthorized, HttpStatusCode.NotFound), (anonymous.StatusCode, notOwner.StatusCode));
    }

    [Fact]
    public async Task UpdateStatus_PreservesOriginalReceiptDate_WhenRefunded()
    {
        var section = await _f.NewSectionAsync();
        var created = await (await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry())).ReadAsync<SectionSignupDto>();
        var admin = await _f.AdminAsync();

        var refunded = await (await admin.PutAsJsonAsync($"/api/signups/{created.Id}/status",
            new UpdateSignupStatusRequest(SignupPaymentStatus.Refunded))).ReadAsync<SectionSignupDto>();

        Assert.NotNull(created.PaidAt);
        Assert.Equal((SignupPaymentStatus.Refunded, created.PaidAt), (refunded.Status, refunded.PaidAt));
    }

    [Theory]
    [InlineData(SignupPaymentStatus.Refunded)]
    [InlineData(SignupPaymentStatus.Cancelled)]
    public async Task UpdateStatus_KeepsReceiptDateForPaidEntries_WithoutInventingOneForUnpaidEntries(SignupPaymentStatus status)
    {
        var section = await _f.NewSectionAsync(priceMinor: 4000);
        var entrant = await _f.TrainerAsync();
        var admin = await _f.AdminAsync();
        var created = await (await entrant.PostAsJsonAsync(Url(section), Entry("Synthetic receipt"))).ReadAsync<SectionSignupDto>();
        var paid = await (await admin.PutAsJsonAsync($"/api/signups/{created.Id}/status",
            new UpdateSignupStatusRequest(SignupPaymentStatus.Paid))).ReadAsync<SectionSignupDto>();
        var closed = await (await admin.PutAsJsonAsync($"/api/signups/{created.Id}/status",
            new UpdateSignupStatusRequest(status))).ReadAsync<SectionSignupDto>();
        Assert.NotNull(paid.PaidAt);
        Assert.Equal(paid.PaidAt, closed.PaidAt);
        Assert.Equal(status, closed.Status);

        var unpaid = await (await entrant.PostAsJsonAsync(Url(section), Entry("Synthetic unpaid"))).ReadAsync<SectionSignupDto>();
        var closedUnpaid = await (await admin.PutAsJsonAsync($"/api/signups/{unpaid.Id}/status",
            new UpdateSignupStatusRequest(status))).ReadAsync<SectionSignupDto>();
        Assert.Null(closedUnpaid.PaidAt);
    }

    [Fact]
    public async Task UpdateStatus_StampsPaidAt_WhenMarkedPaid()
    {
        var section = await _f.NewSectionAsync();
        var created = await (await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry())).ReadAsync<SectionSignupDto>();
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/signups/{created.Id}/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Pending));

        var paid = await (await admin.PutAsJsonAsync($"/api/signups/{created.Id}/status",
            new UpdateSignupStatusRequest(SignupPaymentStatus.Paid))).ReadAsync<SectionSignupDto>();

        Assert.NotNull(paid.PaidAt);
    }

    [Fact]
    public async Task UpdateStatus_Returns404_WhenMissing()
    {
        var admin = await _f.AdminAsync();

        var resp = await admin.PutAsJsonAsync("/api/signups/999999/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Paid));

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task UpdateStatus_Returns401_WhenAnonymous()
    {
        var resp = await _f.CreateClient().PutAsJsonAsync("/api/signups/1/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Paid));

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task UpdateStatus_Returns403_ForRider()
    {
        var rider = await ArrangeRiderClientAsync();

        var resp = await rider.PutAsJsonAsync("/api/signups/1/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Paid));

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task Delete_RemovesSignup()
    {
        var section = await _f.NewSectionAsync();
        var created = await (await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry())).ReadAsync<SectionSignupDto>();
        var admin = await _f.AdminAsync();

        var resp = await admin.DeleteAsync($"/api/signups/{created.Id}");

        Assert.Equal(
            (HttpStatusCode.NoContent, false),
            (resp.StatusCode, await _f.InDbAsync(db => db.SectionSignups.AnyAsync(s => s.Id == created.Id))));
    }

    [Fact]
    public async Task Delete_PreservesManuallyPaidSignupAudit()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1500);
        var created = await (await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry()))
            .ReadAsync<SectionSignupDto>();
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/signups/{created.Id}/status",
            new UpdateSignupStatusRequest(SignupPaymentStatus.Paid));

        var response = await admin.DeleteAsync($"/api/signups/{created.Id}");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(SignupPaymentStatus.Paid, await _f.InDbAsync(db => db.SectionSignups
            .Where(x => x.Id == created.Id).Select(x => x.Status).SingleAsync()));
    }

    [Fact]
    public async Task Delete_CancelsAndPreservesUnpaidPricedSignup()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1500);
        var created = await (await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry()))
            .ReadAsync<SectionSignupDto>();
        var admin = await _f.AdminAsync();

        var response = await admin.DeleteAsync($"/api/signups/{created.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(SignupPaymentStatus.Cancelled, await _f.InDbAsync(db => db.SectionSignups
            .Where(x => x.Id == created.Id).Select(x => x.Status).SingleAsync()));
    }

    [Fact]
    public async Task Delete_Returns404_WhenMissing()
    {
        var admin = await _f.AdminAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync("/api/signups/999999")).StatusCode);
    }

    [Fact]
    public async Task MySignups_Returns401_WhenAnonymous()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync("/api/me/signups")).StatusCode);
    }

    [Fact]
    public async Task MySignups_ListsOwnSignupsWithTeamName_NotOthers()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        var teamId = await ArrangeTeamAsync(section, "MYCODE");
        var (me, _) = await _f.SignupAsync();
        var (other, _) = await _f.SignupAsync();
        await me.PostAsJsonAsync(Url(section), Entry("Mine", code: "MYCODE"));
        await me.PostAsJsonAsync(Url(section), Entry("Mine without team"));
        await other.PostAsJsonAsync(Url(section), Entry("Theirs"));

        var rows = await (await me.GetAsync("/api/me/signups")).ReadAsync<List<MySignupDto>>();

        Assert.Equal(
            new[] { ("Mine without team", (int?)null), ("Mine", teamId) },
            rows.Select(r => (r.FullName, r.TeamId)));
    }

    [Fact]
    public async Task MySignups_ShowsTeamDisplayName()
    {
        var section = await _f.NewSectionAsync();
        await ArrangeTeamAsync(section, "NAMEDTEAM");
        var (me, _) = await _f.SignupAsync();
        await me.PostAsJsonAsync(Url(section), Entry("Mine", code: "NAMEDTEAM"));

        var rows = await (await me.GetAsync("/api/me/signups")).ReadAsync<List<MySignupDto>>();

        Assert.Equal("Test Club A", rows.Single().TeamName);
    }

    [Fact]
    public async Task CompetitionDetail_ShowsEveryoneHowManyEntriesAreTakingSeats()
    {
        var section = await _f.NewSectionAsync(priceMinor: 500, max: 5);
        var trainer = await _f.TrainerAsync();
        foreach (var n in new[] { "R1", "R2", "R3" }) (await trainer.PostAsJsonAsync(Url(section), Entry(n))).EnsureSuccessStatusCode();
        var admin = await _f.AdminAsync();
        var list = await (await admin.GetAsync($"/api/competitions/{section.CompetitionId}/signups")).ReadAsync<List<SectionSignupDto>>();
        await admin.PutAsJsonAsync($"/api/signups/{list.First(x => x.FullName == "R1").Id}/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Paid));
        await admin.PutAsJsonAsync($"/api/signups/{list.First(x => x.FullName == "R2").Id}/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Cancelled));

        var detail = await (await _f.CreateClient().GetAsync($"/api/competitions/{section.CompetitionId}")).ReadAsync<CompetitionDetail>();

        Assert.Equal(2, detail.Sections.Single().ActiveSignupsCount);
    }

    // ---- form-teams ----

    private string FormUrl(CompetitionSection s) => $"/api/competitions/{s.CompetitionId}/sections/{s.Id}/form-teams";

    private async Task SignUpAsync(CompetitionSection s, string name, string? club)
        => (await (await _f.TrainerAsync()).PostAsJsonAsync(Url(s), Entry(name, club))).EnsureSuccessStatusCode();

    [Fact]
    public async Task FormTeams_Returns403_ForRider()
    {
        var rider = await ArrangeRiderClientAsync();

        var resp = await rider.PostAsJsonAsync("/api/competitions/1/sections/1/form-teams", new FormTeamsFromSignupsRequest(null, true, false));

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task FormTeams_Returns404_WhenSectionMissing()
    {
        var admin = await _f.AdminAsync();

        var resp = await admin.PostAsJsonAsync("/api/competitions/1/sections/999999/form-teams", new FormTeamsFromSignupsRequest(null, true, false));

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task FormTeams_Returns400_WhenNoPaidSignups()
    {
        var section = await _f.NewSectionAsync();
        var admin = await _f.AdminAsync();

        var resp = await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, true, false));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Theory]
    [InlineData(SectionFormat.Teams, 4)]
    [InlineData(SectionFormat.Pairs, 2)]
    [InlineData(SectionFormat.Individual, 1)]
    public async Task FormTeams_UsesFormatDefaultTeamSize(SectionFormat format, int expected)
    {
        var section = await _f.NewSectionAsync(format, priceMinor: 1000);
        await SignUpAsync(section, "R1", null);
        var admin = await _f.AdminAsync();

        await _f.PayPendingAsync(section.Id);
        var result = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, true, false)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal(expected, result.RidersPerTeam);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(50, 12)]
    public async Task FormTeams_ClampsRidersPerTeam(int requested, int expected)
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        await SignUpAsync(section, "R1", null);
        var admin = await _f.AdminAsync();

        await _f.PayPendingAsync(section.Id);
        var result = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(requested, true, false)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal(expected, result.RidersPerTeam);
    }

    [Fact]
    public async Task FormTeams_Preview_GroupsByClubAndSpillsIntoSuffixes_WithoutWriting()
    {
        var clubName = await ArrangeClubAsync($"Club{Guid.NewGuid():N}");
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        foreach (var n in new[] { "A1", "A2", "A3" }) await SignUpAsync(section, n, clubName);
        await SignUpAsync(section, "Loner", null);
        var admin = await _f.AdminAsync();

        await _f.PayPendingAsync(section.Id);
        var result = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(2, true, false)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal(
            (true, 0, "A,B,A"),
            (result.Preview, result.Created.Count, string.Join(",", result.Teams.Select(t => t.Suffix))));
    }

    [Fact]
    public async Task FormTeams_Preview_DoesNotCreateTeams()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        await SignUpAsync(section, "R1", null);
        var admin = await _f.AdminAsync();

        await _f.PayPendingAsync(section.Id);
        await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, true, false));

        Assert.Equal(0, await _f.InDbAsync(db => db.Teams.CountAsync(t => t.CompetitionSectionId == section.Id)));
    }

    [Fact]
    public async Task FormTeams_IgnoresUnpaidSignups()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        await SignUpAsync(section, "Paid", null);
        await SignUpAsync(section, "Refunded", null);
        var admin = await _f.AdminAsync();
        var list = await (await admin.GetAsync($"/api/competitions/{section.CompetitionId}/signups")).ReadAsync<List<SectionSignupDto>>();
        await admin.PutAsJsonAsync($"/api/signups/{list.Single(s => s.FullName == "Refunded").Id}/status",
            new UpdateSignupStatusRequest(SignupPaymentStatus.Refunded));

        await _f.PayPendingAsync(section.Id);
        var result = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, true, false)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal(1, result.PaidSignups);
    }

    [Fact]
    public async Task FormTeams_CreatesTeamsAndLinksSignups()
    {
        var clubName = await ArrangeClubAsync($"Club{Guid.NewGuid():N}");
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        await SignUpAsync(section, "A1", clubName);
        await SignUpAsync(section, "A2", clubName);
        var admin = await _f.AdminAsync();

        await _f.PayPendingAsync(section.Id);
        var result = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(4, false, false)))
            .ReadAsync<FormTeamsResult>();

        var linked = await _f.InDbAsync(db => db.SectionSignups
            .Where(s => s.CompetitionSectionId == section.Id && s.TeamId == result.Created.Single().Id).CountAsync());
        Assert.Equal(2, linked);
    }

    [Fact]
    public async Task FormTeams_GivesEachNewClubItsOwnTeam_AndBlankClubsGoToUnaffiliated()
    {
        var suffix = Guid.NewGuid().ToString("N")[..6];
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        await SignUpAsync(section, "R1", $"Welsh Dragons {suffix}");
        await SignUpAsync(section, "R2", $"Gower MG {suffix}");
        await SignUpAsync(section, "R3", $"gower mg {suffix}");
        await SignUpAsync(section, "R4", null);
        var admin = await _f.AdminAsync();

        await _f.PayPendingAsync(section.Id);
        var preview = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, true, false)))
            .ReadAsync<FormTeamsResult>();
        Assert.Equal(0, await _f.InDbAsync(db => db.Clubs.CountAsync(c => c.Name.EndsWith(suffix))));
        Assert.Equal(3, preview.Teams.Count);

        var result = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, false)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal(
            new[] { $"Gower MG {suffix} A", "Unaffiliated A", $"Welsh Dragons {suffix} A" },
            result.Created.Select(t => t.DisplayName).Order(StringComparer.Ordinal));
        var gower = result.Created.Single(t => t.DisplayName.StartsWith("Gower"));
        Assert.Equal(2, await _f.InDbAsync(db => db.SectionSignups.CountAsync(x => x.TeamId == gower.Id)));
    }

    [Fact]
    public async Task FormTeams_DoesNotReBinSignupsThatAreAlreadyOnATeam()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        await SignUpAsync(section, "R1", null);
        var admin = await _f.AdminAsync();
        await _f.PayPendingAsync(section.Id);
        await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, false));
        await SignUpAsync(section, "R2", null);

        await _f.PayPendingAsync(section.Id);
        var second = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, false)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal(1, second.PaidSignups);
        Assert.Equal(new[] { "B" }, second.Created.Select(t => t.Suffix));
        Assert.Equal(2, await _f.InDbAsync(db => db.Teams.CountAsync(t => t.CompetitionSectionId == section.Id)));
    }

    [Fact]
    public async Task FormTeams_ReplaceExisting_ReFormsUnusedTeamsWithoutDuplicates()
    {
        var section = await _f.NewSectionAsync();
        await SignUpAsync(section, "R1", null);
        var admin = await _f.AdminAsync();
        await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, false));

        var preview = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, true, true)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal(1, preview.PaidSignups);
        Assert.Single(preview.Teams);
    }

    [Fact]
    public async Task FormTeams_KeepsRidersWhoShareACustomTeamNameTogether()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        var trainer = await _f.TrainerAsync();
        foreach (var n in new[] { "R1", "R2", "R3", "R4", "R5" })
            (await trainer.PostAsJsonAsync(Url(section), new CreateSectionSignupRequest(n, "Stockport", null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, TeamName: "Stockport Stars")))
                .EnsureSuccessStatusCode();
        var admin = await _f.AdminAsync();

        await _f.PayPendingAsync(section.Id);
        var result = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(4, false, false)))
            .ReadAsync<FormTeamsResult>();

        var team = Assert.Single(result.Created);
        Assert.Equal("Stockport Stars", team.DisplayName);
        Assert.Equal(5, await _f.InDbAsync(db => db.SectionSignups.CountAsync(x => x.TeamId == team.Id)));
    }

    [Fact]
    public async Task FormTeams_FormsAWholeTeamEntryAsOneTeam()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        (await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section),
            new CreateSectionSignupRequest("Manager", "Stockport", null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, WholeTeam: true, TeamName: "Stockport Reds")))
            .EnsureSuccessStatusCode();
        var admin = await _f.AdminAsync();

        await _f.PayPendingAsync(section.Id);
        var result = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, false)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal("Stockport Reds", Assert.Single(result.Created).DisplayName);
    }

    [Fact]
    public async Task Create_WholeTeam_NeedsATeamSectionAManagerOrTrainerAndAName()
    {
        var teams = await _f.NewSectionAsync(SectionFormat.Teams);
        var pairs = await _f.NewSectionAsync(SectionFormat.Pairs);
        var trainer = await _f.TrainerAsync();
        var (member, _) = await _f.SignupAsync("Member");

        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(Url(pairs),
            new CreateSectionSignupRequest("M", null, null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, WholeTeam: true, TeamName: "X"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(Url(teams),
            new CreateSectionSignupRequest("M", null, null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, WholeTeam: true))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync(Url(teams),
            new CreateSectionSignupRequest("M", null, null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, WholeTeam: true, TeamName: "X"))).StatusCode);
    }

    [Fact]
    public async Task FormTeams_PairsAndIndividual_UseRiderNamesWithoutSuffixA()
    {
        var pairsSection = await _f.NewSectionAsync(SectionFormat.Pairs, priceMinor: 1000);
        await SignUpAsync(pairsSection, "Alice Rider", "Stockport");
        await SignUpAsync(pairsSection, "Bob Rider", "Stockport");
        var indSection = await _f.NewSectionAsync(SectionFormat.Individual, priceMinor: 1000);
        await SignUpAsync(indSection, "Solo Sam", "Stockport");

        var admin = await _f.AdminAsync();
        await _f.PayPendingAsync(pairsSection.Id);
        var pairsResult = await (await admin.PostAsJsonAsync(FormUrl(pairsSection), new FormTeamsFromSignupsRequest(null, false, false)))
            .ReadAsync<FormTeamsResult>();
        await _f.PayPendingAsync(indSection.Id);
        var indResult = await (await admin.PostAsJsonAsync(FormUrl(indSection), new FormTeamsFromSignupsRequest(null, false, false)))
            .ReadAsync<FormTeamsResult>();

        var pairTeam = Assert.Single(pairsResult.Created);
        Assert.Equal("Alice Rider & Bob Rider", pairTeam.DisplayName);
        Assert.Equal("", pairTeam.Suffix);

        var indTeam = Assert.Single(indResult.Created);
        Assert.Equal("Solo Sam", indTeam.DisplayName);
        Assert.Equal("", indTeam.Suffix);
    }

    [Fact]
    public async Task LookingForPair_ChargesHalfPrice_AndMutualAcceptFormsPairTeam()
    {
        var pairsSection = await _f.NewSectionAsync(SectionFormat.Pairs, priceMinor: 2000);
        var (rider1, _) = await _f.SignupAsync("Rider");
        var (rider2, _) = await _f.SignupAsync("Rider");

        var r1 = await rider1.PostAsJsonAsync(Url(pairsSection), new
        {
            fullName = "Alice Half",
            ponyClubName = "Cheshire PC",
            acceptTerms = true,
            consentVersion = SignupTerms.WordingVersion,
            lookingForPair = true,
        });
        r1.EnsureSuccessStatusCode();
        var dto1 = await r1.ReadAsync<SectionSignupDto>();
        Assert.Equal(1000, dto1.AmountMinor);

        var r2 = await rider2.PostAsJsonAsync(Url(pairsSection), new
        {
            fullName = "Beth Half",
            ponyClubName = "Cheshire PC",
            acceptTerms = true,
            consentVersion = SignupTerms.WordingVersion,
            lookingForPair = true,
        });
        r2.EnsureSuccessStatusCode();
        var dto2 = await r2.ReadAsync<SectionSignupDto>();
        Assert.Equal(1000, dto2.AmountMinor);

        var reqResp = await rider1.PostAsJsonAsync($"/api/my/signups/{dto1.Id}/pair-request", new { targetSignupId = dto2.Id });
        reqResp.EnsureSuccessStatusCode();

        var acceptResp = await rider2.PostAsJsonAsync($"/api/my/signups/{dto2.Id}/pair-respond", new { accept = true });
        acceptResp.EnsureSuccessStatusCode();
        var accepted = await acceptResp.ReadAsync<MySignupDto>();

        Assert.NotNull(accepted.TeamId);
        Assert.Equal("Alice Half & Beth Half", accepted.TeamName);
    }

    [Fact]
    public async Task GuestWaiting_CannotDiscountAWholeTeam_AndPublicCapacityExcludesWaiters()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Teams, priceMinor: 4000, max: 1);
        var admin = await _f.AdminAsync();
        var invalid = await admin.PostAsJsonAsync(Url(section), new
        {
            fullName = "Test Team Contact", teamName = "Example Team", wholeTeam = true,
            waitingForGuestSpot = true, acceptTerms = true, consentVersion = SignupTerms.WordingVersion,
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var waiting = await admin.PostAsJsonAsync(Url(section), new
        {
            fullName = "Test Guest", waitingForGuestSpot = true,
            acceptTerms = true, consentVersion = SignupTerms.WordingVersion,
        });
        waiting.EnsureSuccessStatusCode();
        var detail = await (await _f.CreateClient().GetAsync($"/api/competitions/{section.CompetitionId}")).ReadAsync<CompetitionDetail>();
        Assert.Equal(0, detail.Sections.Single(s => s.Id == section.Id).ActiveSignupsCount);
    }

    [Fact]
    public async Task PairRequests_PreservePrivacy_RejectOverwritingAndRepeatedAcceptance()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Pairs, priceMinor: 2000);
        var entrants = new List<(HttpClient Client, SectionSignupDto Signup)>();
        foreach (var name in new[] { "Test Alpha", "Test Beta", "Test Gamma" })
        {
            var (client, _) = await _f.SignupAsync("Member");
            var response = await client.PostAsJsonAsync(Url(section), new
            {
                fullName = name, lookingForPair = true, useInitialOnly = true,
                acceptTerms = true, consentVersion = SignupTerms.WordingVersion,
            });
            response.EnsureSuccessStatusCode();
            entrants.Add((client, await response.ReadAsync<SectionSignupDto>()));
        }
        var first = entrants[0]; var second = entrants[1]; var third = entrants[2];
        (await first.Client.PostAsJsonAsync($"/api/my/signups/{first.Signup.Id}/pair-request", new { targetSignupId = second.Signup.Id })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await third.Client.PostAsJsonAsync($"/api/my/signups/{third.Signup.Id}/pair-request", new { targetSignupId = second.Signup.Id })).StatusCode);
        var publicListing = await _f.CreateClient().GetStringAsync($"/api/competitions/{section.CompetitionId}/matchmaking");
        Assert.DoesNotContain("Test Alpha", publicListing);
        Assert.Contains("Test A.", publicListing);
        var accepted = await (await second.Client.PostAsJsonAsync($"/api/my/signups/{second.Signup.Id}/pair-respond", new { accept = true })).ReadAsync<MySignupDto>();
        Assert.Equal("Test A. & Test B.", accepted.TeamName);
        Assert.Equal(HttpStatusCode.BadRequest, (await second.Client.PostAsJsonAsync($"/api/my/signups/{second.Signup.Id}/pair-respond", new { accept = true })).StatusCode);
    }

    [Fact]
    public async Task PairRequests_RequireTheEntryOwnerAndAllowDecliningWithoutGrantingAccess()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Pairs, priceMinor: 0);
        var (first, firstAuth) = await _f.SignupAsync("Member");
        var (second, secondAuth) = await _f.SignupAsync("Member");
        var ids = await _f.WithDbAsync(async db =>
        {
            var a = new SectionSignup { CompetitionSectionId = section.Id, UserId = firstAuth.User.Id, FullName = "Synthetic Alpha", Status = SignupPaymentStatus.Paid };
            var b = new SectionSignup { CompetitionSectionId = section.Id, UserId = secondAuth.User.Id, FullName = "Synthetic Beta", Status = SignupPaymentStatus.Paid };
            db.AddRange(a, b);
            await db.SaveChangesAsync();
            db.AddRange(new SignupMatchmaking { SignupId = a.Id, LookingForPair = true }, new SignupMatchmaking { SignupId = b.Id, LookingForPair = true });
            await db.SaveChangesAsync();
            return new[] { a.Id, b.Id };
        });
        var requestUrl = $"/api/my/signups/{ids[0]}/pair-request";
        var responseUrl = $"/api/my/signups/{ids[1]}/pair-respond";
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsJsonAsync(requestUrl, new { targetSignupId = ids[1] })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await second.PostAsJsonAsync(requestUrl, new { targetSignupId = ids[1] })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await first.PostAsJsonAsync(requestUrl, new { targetSignupId = ids[0] })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await first.PostAsJsonAsync(requestUrl, new { targetSignupId = -1 })).StatusCode);
        (await first.PostAsJsonAsync(requestUrl, new { targetSignupId = ids[1] })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsJsonAsync(responseUrl, new { accept = true })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await first.PostAsJsonAsync(responseUrl, new { accept = true })).StatusCode);
        (await second.PostAsJsonAsync(responseUrl, new { accept = false })).EnsureSuccessStatusCode();
        await _f.WithDbAsync(async db =>
        {
            var metadata = await db.Set<SignupMatchmaking>().Where(m => ids.Contains(m.SignupId)).ToListAsync();
            Assert.All(metadata, m => { Assert.Null(m.PairRequestStatus); Assert.Null(m.PairRequestFromSignupId); Assert.Null(m.PairRequestToSignupId); Assert.False(m.DeclarationAccessGranted); });
        });
        Assert.Equal(HttpStatusCode.BadRequest, (await second.PostAsJsonAsync(responseUrl, new { accept = true })).StatusCode);
        (await first.PostAsJsonAsync(requestUrl, new { targetSignupId = ids[1] })).EnsureSuccessStatusCode();
        var admin = await _f.AdminAsync();
        (await admin.PutAsJsonAsync($"/api/signups/{ids[0]}/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Cancelled))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await first.PostAsJsonAsync(requestUrl, new { targetSignupId = ids[1] })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await second.PostAsJsonAsync(responseUrl, new { accept = true })).StatusCode);
        (await admin.PutAsJsonAsync($"/api/signups/{ids[0]}/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Paid))).EnsureSuccessStatusCode();
        (await second.PostAsJsonAsync($"/api/my/signups/{ids[1]}/pair-request", new { targetSignupId = ids[0] })).EnsureSuccessStatusCode();
        (await admin.DeleteAsync($"/api/signups/{ids[0]}")).EnsureSuccessStatusCode();
        await _f.WithDbAsync(async db =>
        {
            var survivor = await db.Set<SignupMatchmaking>().SingleAsync(m => m.SignupId == ids[1]);
            Assert.Null(survivor.PairRequestStatus);
            Assert.Null(survivor.PairRequestToSignupId);
        });
    }

    [Fact]
    public async Task WaitingForGuestSpot_IsFree_AndDoesNotConsumeCap()
    {
        var teamsSection = await _f.NewSectionAsync(SectionFormat.Teams, priceMinor: 4000, max: 1);
        var (rider, _) = await _f.SignupAsync("Rider");

        var waitResp = await rider.PostAsJsonAsync(Url(teamsSection), new
        {
            fullName = "Guest Waiter",
            ponyClubName = "Unaffiliated",
            acceptTerms = true,
            consentVersion = SignupTerms.WordingVersion,
            waitingForGuestSpot = true,
        });
        waitResp.EnsureSuccessStatusCode();
        var waitDto = await waitResp.ReadAsync<SectionSignupDto>();
        Assert.Equal(0, waitDto.AmountMinor);
        Assert.Equal(SignupPaymentStatus.Paid, waitDto.Status);

        // A paid entry can still take the 1 available cap slot because the waiting list entry is free and does not consume cap.
        var trainer = await _f.TrainerAsync();
        var paidResp = await trainer.PostAsJsonAsync(Url(teamsSection), Entry("Paid Team"));
        Assert.Equal(HttpStatusCode.OK, paidResp.StatusCode);
    }

    [Fact]
    public async Task FormTeams_BumpsSuffix_WhenTeamAlreadyExistsForClub()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        await SignUpAsync(section, "R1", null);
        var admin = await _f.AdminAsync();
        await _f.PayPendingAsync(section.Id);
        await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, false));
        await SignUpAsync(section, "R2", null);
        await SignUpAsync(section, "R3", null);

        await _f.PayPendingAsync(section.Id);
        var second = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(1, false, false)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal(new[] { "B", "C" }, second.Created.Select(t => t.Suffix).Order());
    }

    [Fact]
    public async Task FormTeams_ReplaceExisting_RemovesUnusedTeamsAndKeepsUsedOnes()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        await SignUpAsync(section, "R1", null);
        var admin = await _f.AdminAsync();
        await _f.PayPendingAsync(section.Id);
        var first = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, false)))
            .ReadAsync<FormTeamsResult>();
        var oldTeamId = first.Created.Single().Id;

        var again = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, true)))
            .ReadAsync<FormTeamsResult>();

        var oldStillThere = await _f.InDbAsync(db => db.Teams.AnyAsync(t => t.Id == oldTeamId));
        Assert.Equal((false, "A"), (oldStillThere, again.Created.Single().Suffix));
    }

    [Fact]
    public async Task FormTeams_ReplaceExisting_KeepsTeamsWithHeatEntries()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1000);
        await SignUpAsync(section, "R1", null);
        var admin = await _f.AdminAsync();
        await _f.PayPendingAsync(section.Id);
        var first = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, false)))
            .ReadAsync<FormTeamsResult>();
        var usedTeamId = first.Created.Single().Id;
        await _f.InDbAsync(async db =>
        {
            var session = new Session { CompetitionId = section.CompetitionId, Name = "S" };
            var heat = new Heat { Session = session, Label = "H" };
            heat.Entries.Add(new HeatEntry { TeamId = usedTeamId });
            db.Heats.Add(heat);
            await db.SaveChangesAsync();
        });

        await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, true));

        Assert.True(await _f.InDbAsync(db => db.Teams.AnyAsync(t => t.Id == usedTeamId)));
    }

    [Fact]
    public async Task Create_WhenEntriesCloseAtInPast_RejectsPublicButAllowsAdminLateEntry()
    {
        var section = await _f.NewSectionAsync();
        var admin = await _f.AdminAsync();

        var putRes = await admin.PutAsJsonAsync(
            $"/api/competitions/{section.CompetitionId}/entry-settings",
            new { entriesCloseAt = DateTime.UtcNow.AddDays(-1) });
        Assert.Equal(HttpStatusCode.OK, putRes.StatusCode);

        var (entrant, _) = await _f.SignupAsync();
        var blocked = await entrant.PostAsJsonAsync(Url(section), Entry("Late Rider"));
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);

        var lateAdmin = await admin.PostAsJsonAsync(Url(section), Entry("Admin Late Entry"));
        Assert.Equal(HttpStatusCode.OK, lateAdmin.StatusCode);
    }

    [Fact]
    public async Task Create_WithStables_AppearsInOrganiserStablingListGroupedByClub()
    {
        var section = await _f.NewSectionAsync();
        var (c1, _) = await _f.SignupAsync();
        var (c2, _) = await _f.SignupAsync();

        var s1 = await c1.PostAsJsonAsync(
            Url(section),
            Entry("Rider One") with { StablesCount = 2, StablingClubOrTeam = "Cheshire PC" });
        var s2 = await c2.PostAsJsonAsync(
            Url(section),
            Entry("Rider Two") with { StablesCount = 3, StablingClubOrTeam = "Cheshire PC" });
        Assert.Equal(HttpStatusCode.OK, s1.StatusCode);
        Assert.Equal(HttpStatusCode.OK, s2.StatusCode);

        var admin = await _f.AdminAsync();
        var stablingRes = await admin.GetAsync($"/api/competitions/{section.CompetitionId}/stabling");
        Assert.Equal(HttpStatusCode.OK, stablingRes.StatusCode);
        var body = await stablingRes.Content.ReadAsStringAsync();
        Assert.Contains("\"totalStables\":5", body);
        Assert.Contains("Cheshire PC", body);
    }

    [Fact]
    public async Task SharedVenueCapacity_EnforcesMaxStablesAndMaxHookupsAcrossEntriesAndShopOrders()
    {
        var section = await _f.NewSectionAsync();
        var admin = await _f.AdminAsync();

        var setCapRes = await admin.PutAsJsonAsync(
            $"/api/competitions/{section.CompetitionId}/entry-settings",
            new { maxStables = 4, maxHookups = 2 });
        Assert.Equal(HttpStatusCode.OK, setCapRes.StatusCode);
        var initialSettings = await setCapRes.Content.ReadFromJsonAsync<MountedGames.Api.Controllers.CompetitionEntrySettingsDto>();
        Assert.Equal(4, initialSettings!.MaxStables);
        Assert.Equal(2, initialSettings.MaxHookups);
        Assert.Equal(4, initialSettings.StablesRemaining);
        Assert.Equal(2, initialSettings.HookupsRemaining);

        // 1. Entry books 2 stables and 1 electric hook-up
        var (c1, _) = await _f.SignupAsync();
        var entry1 = await c1.PostAsJsonAsync(
            Url(section),
            Entry("Rider One") with { StablesCount = 2, HookupsCount = 1, StablingClubOrTeam = "Cheshire PC" });
        Assert.Equal(HttpStatusCode.OK, entry1.StatusCode);

        // 2. Organiser lists stabling and electric hook-up in the Event Shop, and a buyer orders 1 stable and 1 hook-up
        var stableCatRes = await admin.PostAsJsonAsync("/api/commerce/catalogue", new
        {
            title = "Weekend stabling",
            description = "On-site box",
            priceMinor = 3000,
            stockQuantity = (int?)null,
            category = 2, // Camping
        });
        stableCatRes.EnsureSuccessStatusCode();
        var stableCat = await stableCatRes.Content.ReadFromJsonAsync<CatalogueItemDto>();

        var hookupCatRes = await admin.PostAsJsonAsync("/api/commerce/catalogue", new
        {
            title = "Electric hook-up",
            description = "16A pitch",
            priceMinor = 2000,
            stockQuantity = (int?)null,
            category = 2, // Camping
        });
        hookupCatRes.EnsureSuccessStatusCode();
        var hookupCat = await hookupCatRes.Content.ReadFromJsonAsync<CatalogueItemDto>();

        var stableListRes = await admin.PostAsJsonAsync(
            $"/api/commerce/competitions/{section.CompetitionId}/listings",
            new { catalogueItemId = stableCat!.Id });
        var stableListing = await stableListRes.Content.ReadFromJsonAsync<CompetitionListingDto>();

        var hookupListRes = await admin.PostAsJsonAsync(
            $"/api/commerce/competitions/{section.CompetitionId}/listings",
            new { catalogueItemId = hookupCat!.Id });
        var hookupListing = await hookupListRes.Content.ReadFromJsonAsync<CompetitionListingDto>();

        var (buyer, _) = await _f.SignupAsync();
        var shopOrderOk = await buyer.PostAsJsonAsync(
            $"/api/commerce/competitions/{section.CompetitionId}/orders",
            new
            {
                idempotencyKey = Guid.NewGuid().ToString("N"),
                items = new[]
                {
                    new { listingId = stableListing!.Id, quantity = 1 },
                    new { listingId = hookupListing!.Id, quantity = 1 },
                },
            });
        Assert.Equal(HttpStatusCode.OK, shopOrderOk.StatusCode);

        // Now 3 of 4 stables and 2 of 2 hook-ups are booked across both routes (1 stable left, 0 hook-ups left)
        var midSettings = await admin.GetFromJsonAsync<MountedGames.Api.Controllers.CompetitionEntrySettingsDto>(
            $"/api/competitions/{section.CompetitionId}/entry-settings");
        Assert.Equal(3, midSettings!.StablesBooked);
        Assert.Equal(1, midSettings.StablesRemaining);
        Assert.Equal(2, midSettings.HookupsBooked);
        Assert.Equal(0, midSettings.HookupsRemaining);

        // 3. Another entry asking for 2 stables is rejected with "Only 1 stable remaining at this venue."
        var (c2, _) = await _f.SignupAsync();
        var tooManyStables = await c2.PostAsJsonAsync(
            Url(section),
            Entry("Rider Two") with { StablesCount = 2 });
        Assert.Equal(HttpStatusCode.Conflict, tooManyStables.StatusCode);
        Assert.Contains("Only 1 stable remaining at this venue.", await tooManyStables.Content.ReadAsStringAsync());

        // 4. Shop order asking for another electric hook-up is rejected with "All electric hook-ups are booked."
        var tooManyHookups = await buyer.PostAsJsonAsync(
            $"/api/commerce/competitions/{section.CompetitionId}/orders",
            new
            {
                idempotencyKey = Guid.NewGuid().ToString("N"),
                items = new[] { new { listingId = hookupListing.Id, quantity = 1 } },
            });
        Assert.Equal(HttpStatusCode.Conflict, tooManyHookups.StatusCode);
        Assert.Contains("All electric hook-ups are booked.", await tooManyHookups.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task MarkPaid_MarksBacsSignupPaidAndTriggersFormTeams()
    {
        var section = await _f.NewSectionAsync(priceMinor: 2500);
        var trainer = await _f.TrainerAsync();
        var createRes = await trainer.PostAsJsonAsync(
            Url(section),
            Entry("BACS Manager") with { TeamName = "Welsh Dragons", WholeTeam = true, PaymentMethod = "bacs" });
        Assert.Equal(HttpStatusCode.OK, createRes.StatusCode);
        var created = await createRes.ReadAsync<SectionSignupDto>();
        Assert.Equal(SignupPaymentStatus.Pending, created.Status);

        var admin = await _f.AdminAsync();
        var markRes = await admin.PostAsJsonAsync(
            $"/api/competitions/{section.CompetitionId}/signups/{created.Id}/mark-paid",
            new { });
        Assert.Equal(HttpStatusCode.OK, markRes.StatusCode);

        var teams = await _f.InDbAsync(db => db.Teams.Where(t => t.CompetitionSectionId == section.Id).ToListAsync());
        Assert.Single(teams);
        Assert.Equal("Welsh Dragons", teams[0].DisplayName);
    }

    [Fact]
    public async Task WithdrawMySignup_BeforeDraw_FreesSpotRemovesUndrawnTeamAndMarksRefundPending()
    {
        var section = await _f.NewSectionAsync(max: 1, priceMinor: 2000);
        var trainer = await _f.TrainerAsync();
        var createRes = await trainer.PostAsJsonAsync(
            Url(section),
            Entry("Withdrawing Manager") with { TeamName = "Temp Team", WholeTeam = true });
        var created = await createRes.ReadAsync<SectionSignupDto>();

        var admin = await _f.AdminAsync();
        await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{created.Id}/mark-paid", new { });
        Assert.True(await _f.InDbAsync(db => db.Teams.AnyAsync(t => t.CompetitionSectionId == section.Id)));

        var withdrawRes = await trainer.PostAsJsonAsync($"/api/my/signups/{created.Id}/withdraw", new { });
        Assert.Equal(HttpStatusCode.OK, withdrawRes.StatusCode);
        var withdrawBody = await withdrawRes.Content.ReadAsStringAsync();
        Assert.Contains("\"isWithdrawn\":true", withdrawBody);
        Assert.Contains("\"refundPending\":true", withdrawBody);

        // Un-drawn team is removed and the spot in the section is freed.
        Assert.False(await _f.InDbAsync(db => db.Teams.AnyAsync(t => t.CompetitionSectionId == section.Id)));

        var (nextEntrant, _) = await _f.SignupAsync();
        var nextRes = await nextEntrant.PostAsJsonAsync(Url(section), Entry("Replacement Rider"));
        Assert.Equal(HttpStatusCode.OK, nextRes.StatusCode);
    }

    [Fact]
    public async Task WithdrawMySignup_AfterDraw_ReturnsConflict()
    {
        var section = await _f.NewSectionAsync();
        var (entrant, _) = await _f.SignupAsync();
        var createRes = await entrant.PostAsJsonAsync(Url(section), Entry("Drawn Rider"));
        var created = await createRes.ReadAsync<SectionSignupDto>();

        await _f.InDbAsync(async db =>
        {
            var club = new Club { Name = "Drawn Club" };
            var team = new Team
            {
                CompetitionId = section.CompetitionId,
                CompetitionSectionId = section.Id,
                Club = club,
                Suffix = "A",
                DisplayName = "Drawn Club A",
            };
            var session = new Session { CompetitionId = section.CompetitionId, Name = "Session 1" };
            var heat = new Heat { Session = session, Label = "Heat 1" };
            heat.Entries.Add(new HeatEntry { Team = team });
            db.Heats.Add(heat);
            await db.SaveChangesAsync();
        });

        var withdrawRes = await entrant.PostAsJsonAsync($"/api/my/signups/{created.Id}/withdraw", new { });
        Assert.Equal(HttpStatusCode.Conflict, withdrawRes.StatusCode);
        // The web matches on the code, so it must stay as it is.
        using var body = System.Text.Json.JsonDocument.Parse(await withdrawRes.Content.ReadAsStringAsync());
        Assert.Equal("draw-happened", body.RootElement.GetProperty("code").GetString());
        Assert.Equal("You can’t withdraw once the draw has happened.", body.RootElement.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Create_WaitlistWhenSectionFull_SucceedsWithZeroAmountAndSkipsTeamFormation()
    {
        var section = await _f.NewSectionAsync(max: 1, priceMinor: 1500);
        var (c1, _) = await _f.SignupAsync();
        var (c2, _) = await _f.SignupAsync();

        var first = await c1.PostAsJsonAsync(Url(section), Entry("Full Spot Rider"));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var firstDto = await first.ReadAsync<SectionSignupDto>();

        var waitlistRes = await c2.PostAsJsonAsync(
            Url(section),
            Entry("Waitlist Rider") with { IsWaitlist = true });
        Assert.Equal(HttpStatusCode.OK, waitlistRes.StatusCode);
        var waitlisted = await waitlistRes.ReadAsync<MountedGames.Api.Controllers.SectionSignupExtendedDto>();
        Assert.True(waitlisted.IsWaitlist);
        Assert.Equal(0, waitlisted.AmountMinor);

        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/signups/{firstDto.Id}/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Paid));
        var formRes = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, false)))
            .ReadAsync<FormTeamsResult>();
        Assert.Single(formRes.Created);
    }

    [Fact]
    public async Task Create_MultipleTeamsWholeTeam_MultipliesPriceAndExpandsIntoTeams()
    {
        var section = await _f.NewSectionAsync(max: 4, priceMinor: 3000);
        var trainer = await _f.TrainerAsync();
        var res = await trainer.PostAsJsonAsync(
            Url(section),
            Entry("Multi Manager", club: "Monmouthshire") with
            {
                TeamName = "Monmouthshire A, Monmouthshire B",
                WholeTeam = true,
                TeamsCount = 2,
            });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var created = await res.ReadAsync<MountedGames.Api.Controllers.SectionSignupExtendedDto>();
        Assert.Equal(6000, created.AmountMinor);
        Assert.Equal(2, created.TeamsCount);

        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/signups/{created.Id}/status", new UpdateSignupStatusRequest(SignupPaymentStatus.Paid));
        var formed = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, false)))
            .ReadAsync<FormTeamsResult>();
        Assert.Equal(2, formed.Created.Count);
        Assert.Contains(formed.Created, t => t.DisplayName == "Monmouthshire A");
        Assert.Contains(formed.Created, t => t.DisplayName == "Monmouthshire B");
    }

    // ---- arrange helpers ----

    private Task<int> ArrangeTeamAsync(CompetitionSection section, string joinKey)
        => _f.InDbAsync(async db =>
        {
            var club = new Club { Name = $"Test Club {Guid.NewGuid():N}" };
            var team = new Team
            {
                CompetitionId = section.CompetitionId,
                CompetitionSectionId = section.Id,
                Club = club,
                Suffix = "A",
                DisplayName = "Test Club A",
                SupporterJoinKey = joinKey,
            };
            db.Teams.Add(team);
            await db.SaveChangesAsync();
            return team.Id;
        });

    private Task<string> ArrangeClubAsync(string name)
        => _f.InDbAsync(async db =>
        {
            db.Clubs.Add(new Club { Name = name });
            await db.SaveChangesAsync();
            return name;
        });

    private async Task<HttpClient> ArrangeRiderClientAsync()
    {
        var (client, auth) = await _f.SignupAsync();
        await _f.InDbAsync(async db =>
        {
            var userRoles = db.UserRoles.Where(r => r.UserId == auth.User.Id);
            db.UserRoles.RemoveRange(userRoles);
            await db.SaveChangesAsync();
        });
        // Fresh token reflects the (now empty) role set.
        var login = await _f.LoginAsync(auth.User.Email, "Passw0rd!x");
        return _f.WithToken(login.Token);
    }
}
