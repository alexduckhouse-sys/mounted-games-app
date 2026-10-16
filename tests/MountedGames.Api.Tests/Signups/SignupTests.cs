using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Signups;

public class SignupTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public SignupTests(ApiFactory f) => _f = f;

    private static string Url(CompetitionSection s) => $"/api/competitions/{s.CompetitionId}/sections/{s.Id}/signups";

    private static CreateSectionSignupRequest Entry(string name = "Rider One", string? club = null, string? code = null)
        => new(name, club, "rider@example.com", code);

    [Fact]
    public async Task Create_RecordsPaidSignupAtSectionPrice_ForAnonymousEntrant()
    {
        var section = await _f.NewSectionAsync(priceMinor: 1500);

        var resp = await _f.CreateClient().PostAsJsonAsync(Url(section), Entry("  Alice  "));

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var dto = await resp.ReadAsync<SectionSignupDto>();
        Assert.Equal(("Alice", 1500, SignupPaymentStatus.Paid), (dto.FullName, dto.AmountMinor, dto.Status));
        Assert.NotNull(dto.PaidAt);
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
    public async Task Create_TruncatesOverlongName()
    {
        var section = await _f.NewSectionAsync();

        var resp = await _f.CreateClient().PostAsJsonAsync(Url(section), Entry(new string('x', 300)));

        Assert.Equal(200, (await resp.ReadAsync<SectionSignupDto>()).FullName.Length);
    }

    [Fact]
    public async Task Create_Returns403_ForAdmin()
    {
        var section = await _f.NewSectionAsync();
        var admin = await _f.AdminAsync();

        var resp = await admin.PostAsJsonAsync(Url(section), Entry());

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task Create_Returns404_WhenSectionNotInCompetition()
    {
        var section = await _f.NewSectionAsync();

        var resp = await _f.CreateClient().PostAsJsonAsync(
            $"/api/competitions/{section.CompetitionId + 999}/sections/{section.Id}/signups", Entry());

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Create_Returns403_WhenSignupsLocked()
    {
        var section = await _f.NewSectionAsync(locked: true);

        var resp = await _f.CreateClient().PostAsJsonAsync(Url(section), Entry());

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Create_Returns400_WhenNameBlank(string name)
    {
        var section = await _f.NewSectionAsync();

        var resp = await _f.CreateClient().PostAsJsonAsync(Url(section), Entry(name));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Create_Returns403_WhenSectionFull()
    {
        var section = await _f.NewSectionAsync(max: 1);
        var client = _f.CreateClient();
        await client.PostAsJsonAsync(Url(section), Entry("First"));

        var resp = await client.PostAsJsonAsync(Url(section), Entry("Second"));

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task Create_AllowsEntry_WhenCancelledSignupsFreeTheCap()
    {
        var section = await _f.NewSectionAsync(max: 1);
        var client = _f.CreateClient();
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
        var client = _f.CreateClient();
        client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "10.9.9.9");

        var resp = await client.PostAsJsonAsync(Url(section), Entry());

        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [Fact]
    public async Task Create_LinksTeam_WhenTeamCodeMatchesCaseInsensitively()
    {
        var section = await _f.NewSectionAsync();
        var teamId = await ArrangeTeamAsync(section, "JoinMe-1");

        var resp = await _f.CreateClient().PostAsJsonAsync(Url(section), Entry(code: " joinme-1 "));

        Assert.Equal(teamId, (await resp.ReadAsync<SectionSignupDto>()).TeamId);
    }

    [Fact]
    public async Task Create_LeavesTeamEmpty_WhenTeamCodeUnknown()
    {
        var section = await _f.NewSectionAsync();

        var resp = await _f.CreateClient().PostAsJsonAsync(Url(section), Entry(code: "nope"));

        Assert.Null((await resp.ReadAsync<SectionSignupDto>()).TeamId);
    }

    [Fact]
    public async Task List_ReturnsOnlyThatCompetitionsSignups_NewestFirst()
    {
        var a = await _f.NewSectionAsync();
        var b = await _f.NewSectionAsync();
        var client = _f.CreateClient();
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
    public async Task UpdateStatus_SetsPaidAt_OnlyWhenPaid()
    {
        var section = await _f.NewSectionAsync();
        var created = await (await _f.CreateClient().PostAsJsonAsync(Url(section), Entry())).ReadAsync<SectionSignupDto>();
        var admin = await _f.AdminAsync();

        var refunded = await (await admin.PutAsJsonAsync($"/api/signups/{created.Id}/status",
            new UpdateSignupStatusRequest(SignupPaymentStatus.Refunded))).ReadAsync<SectionSignupDto>();

        Assert.Equal((SignupPaymentStatus.Refunded, (DateTime?)null), (refunded.Status, refunded.PaidAt));
    }

    [Fact]
    public async Task UpdateStatus_StampsPaidAt_WhenMarkedPaid()
    {
        var section = await _f.NewSectionAsync();
        var created = await (await _f.CreateClient().PostAsJsonAsync(Url(section), Entry())).ReadAsync<SectionSignupDto>();
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
        var created = await (await _f.CreateClient().PostAsJsonAsync(Url(section), Entry())).ReadAsync<SectionSignupDto>();
        var admin = await _f.AdminAsync();

        var resp = await admin.DeleteAsync($"/api/signups/{created.Id}");

        Assert.Equal(
            (HttpStatusCode.NoContent, false),
            (resp.StatusCode, await _f.InDbAsync(db => db.SectionSignups.AnyAsync(s => s.Id == created.Id))));
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
        var section = await _f.NewSectionAsync();
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

    // ---- form-teams ----

    private string FormUrl(CompetitionSection s) => $"/api/competitions/{s.CompetitionId}/sections/{s.Id}/form-teams";

    private async Task SignUpAsync(CompetitionSection s, string name, string? club)
        => (await _f.CreateClient().PostAsJsonAsync(Url(s), Entry(name, club))).EnsureSuccessStatusCode();

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
        var section = await _f.NewSectionAsync(format);
        await SignUpAsync(section, "R1", null);
        var admin = await _f.AdminAsync();

        var result = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, true, false)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal(expected, result.RidersPerTeam);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(50, 12)]
    public async Task FormTeams_ClampsRidersPerTeam(int requested, int expected)
    {
        var section = await _f.NewSectionAsync();
        await SignUpAsync(section, "R1", null);
        var admin = await _f.AdminAsync();

        var result = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(requested, true, false)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal(expected, result.RidersPerTeam);
    }

    [Fact]
    public async Task FormTeams_Preview_GroupsByClubAndSpillsIntoSuffixes_WithoutWriting()
    {
        var clubName = await ArrangeClubAsync($"Club{Guid.NewGuid():N}");
        var section = await _f.NewSectionAsync();
        foreach (var n in new[] { "A1", "A2", "A3" }) await SignUpAsync(section, n, clubName);
        await SignUpAsync(section, "Loner", null);
        var admin = await _f.AdminAsync();

        var result = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(2, true, false)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal(
            (true, 0, "A,B,A"),
            (result.Preview, result.Created.Count, string.Join(",", result.Teams.Select(t => t.Suffix))));
    }

    [Fact]
    public async Task FormTeams_Preview_DoesNotCreateTeams()
    {
        var section = await _f.NewSectionAsync();
        await SignUpAsync(section, "R1", null);
        var admin = await _f.AdminAsync();

        await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, true, false));

        Assert.Equal(0, await _f.InDbAsync(db => db.Teams.CountAsync(t => t.CompetitionSectionId == section.Id)));
    }

    [Fact]
    public async Task FormTeams_IgnoresUnpaidSignups()
    {
        var section = await _f.NewSectionAsync();
        await SignUpAsync(section, "Paid", null);
        await SignUpAsync(section, "Refunded", null);
        var admin = await _f.AdminAsync();
        var list = await (await admin.GetAsync($"/api/competitions/{section.CompetitionId}/signups")).ReadAsync<List<SectionSignupDto>>();
        await admin.PutAsJsonAsync($"/api/signups/{list.Single(s => s.FullName == "Refunded").Id}/status",
            new UpdateSignupStatusRequest(SignupPaymentStatus.Refunded));

        var result = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, true, false)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal(1, result.PaidSignups);
    }

    [Fact]
    public async Task FormTeams_CreatesTeamsAndLinksSignups()
    {
        var clubName = await ArrangeClubAsync($"Club{Guid.NewGuid():N}");
        var section = await _f.NewSectionAsync();
        await SignUpAsync(section, "A1", clubName);
        await SignUpAsync(section, "A2", clubName);
        var admin = await _f.AdminAsync();

        var result = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(4, false, false)))
            .ReadAsync<FormTeamsResult>();

        var linked = await _f.InDbAsync(db => db.SectionSignups
            .Where(s => s.CompetitionSectionId == section.Id && s.TeamId == result.Created.Single().Id).CountAsync());
        Assert.Equal(2, linked);
    }

    [Fact]
    public async Task FormTeams_PutsUnmatchedClubsInUnaffiliated()
    {
        var section = await _f.NewSectionAsync();
        await SignUpAsync(section, "R1", "No such club");
        var admin = await _f.AdminAsync();

        var result = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, false)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal("Unaffiliated A", result.Created.Single().DisplayName);
    }

    [Fact]
    public async Task FormTeams_BumpsSuffix_WhenTeamAlreadyExistsForClub()
    {
        var section = await _f.NewSectionAsync();
        await SignUpAsync(section, "R1", null);
        var admin = await _f.AdminAsync();
        await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(null, false, false));
        await SignUpAsync(section, "R2", null);

        var second = await (await admin.PostAsJsonAsync(FormUrl(section), new FormTeamsFromSignupsRequest(1, false, false)))
            .ReadAsync<FormTeamsResult>();

        Assert.Equal(new[] { "B", "C" }, second.Created.Select(t => t.Suffix).Order());
    }

    [Fact]
    public async Task FormTeams_ReplaceExisting_RemovesUnusedTeamsAndKeepsUsedOnes()
    {
        var section = await _f.NewSectionAsync();
        await SignUpAsync(section, "R1", null);
        var admin = await _f.AdminAsync();
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
        var section = await _f.NewSectionAsync();
        await SignUpAsync(section, "R1", null);
        var admin = await _f.AdminAsync();
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
