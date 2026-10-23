using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

public class TrainerRequestsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public TrainerRequestsTests(ApiFactory f) => _f = f;
    private const string Route = "/api/admin/trainer-requests";
    private static readonly object Competition = new
    {
        name = "Test approval competition",
        location = "Test venue",
        startDate = new DateTime(2031, 5, 4, 0, 0, 0, DateTimeKind.Utc)
    };

    [Fact]
    public void TrainerRequest_IsSeededButDoesNotGrantAnyRoleGroup()
    {
        Assert.Contains(Roles.TrainerRequest, Roles.All);
        Assert.Contains(Roles.ManagerRequest, Roles.All);
        foreach (var group in new[] { Roles.Organiser, Roles.TeamMember, Roles.TeamWork })
        {
            Assert.DoesNotContain(Roles.TrainerRequest, group.Split(','));
            Assert.DoesNotContain(Roles.ManagerRequest, group.Split(','));
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("Trainer")]
    public async Task SignupTrainer_CannotCreateCompetition(string? role)
    {
        var (client, auth) = await _f.SignupAsync(role);

        Assert.Equal(new[] { Roles.Member, Roles.TrainerRequest }, auth.User.Roles.Order());
        Assert.Equal(HttpStatusCode.Forbidden,
            (await client.PostAsJsonAsync("/api/competitions", Competition)).StatusCode);
    }

    [Fact]
    public async Task List_ReturnsOnlyPendingRequests_OldestFirst_WithUtcTimestampAndClub()
    {
        var clubName = $"Test Club {Guid.NewGuid():N}";
        await _f.InDbAsync(async db => { db.Clubs.Add(new Club { Name = clubName }); await db.SaveChangesAsync(); });
        var (_, newer) = await _f.SignupAsync();
        var (_, older) = await _f.SignupAsync(clubName: clubName);
        var (_, member) = await _f.SignupAsync(Roles.Member);
        var oldest = new DateTime(2020, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        await _f.InDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == older.User.Id)).CreatedAt = oldest;
            (await db.Users.SingleAsync(u => u.Id == newer.User.Id)).CreatedAt = oldest.AddDays(1);
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();

        var response = await admin.GetAsync(Route);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var requests = await response.ReadAsync<List<TrainerRequestDto>>();
        Assert.Equal(requests.OrderBy(r => r.RequestedAt).Select(r => r.UserId), requests.Select(r => r.UserId));
        Assert.Equal(new TrainerRequestDto(older.User.Id, older.User.FullName, older.User.Email, clubName, oldest), requests[0]);
        Assert.Equal(DateTimeKind.Utc, requests[0].RequestedAt.Kind);
        Assert.Equal(newer.User.Id, requests[1].UserId);
        Assert.Equal("Test Pony Club", requests[1].ClubName);
        Assert.DoesNotContain(requests, r => r.UserId == member.User.Id);
        Assert.DoesNotContain(requests, r => r.Email == TestClients.TrainerEmail || r.Email == TestClients.AdminEmail);
    }

    [Fact]
    public async Task Approve_RequiresFreshSignInBeforeOrganising_AndLeavesExistingTrainersAlone()
    {
        var (pending, auth) = await _f.SignupAsync();
        var existing = await _f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword);
        var admin = await _f.AdminAsync();

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"{Route}/{auth.User.Id}/approve", null)).StatusCode);

        var profile = await (await pending.GetAsync("/api/auth/me")).ReadAsync<UserProfile>();
        Assert.Equal(new[] { Roles.Trainer }, profile.Roles);
        Assert.Equal(HttpStatusCode.Forbidden, (await pending.PostAsJsonAsync("/api/competitions", Competition)).StatusCode);
        var fresh = await _f.LoginAsync(auth.User.Email, "Passw0rd!x");
        Assert.Equal(new[] { Roles.Trainer }, fresh.User.Roles);
        Assert.Equal(HttpStatusCode.Created, (await _f.WithToken(fresh.Token).PostAsJsonAsync("/api/competitions", Competition)).StatusCode);
        var requests = await (await admin.GetAsync(Route)).ReadAsync<List<TrainerRequestDto>>();
        Assert.DoesNotContain(requests, r => r.UserId == auth.User.Id);
        Assert.Equal(existing.User.Roles, (await _f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword)).User.Roles);
    }

    [Fact]
    public async Task Decline_KeepsMemberAccess_AndRemovesRequest()
    {
        var (_, auth) = await _f.SignupAsync();
        var admin = await _f.AdminAsync();

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"{Route}/{auth.User.Id}/decline", null)).StatusCode);

        var fresh = await _f.LoginAsync(auth.User.Email, "Passw0rd!x");
        Assert.Equal(new[] { Roles.Member }, fresh.User.Roles);
        Assert.Equal(HttpStatusCode.Forbidden, (await _f.WithToken(fresh.Token).PostAsJsonAsync("/api/competitions", Competition)).StatusCode);
        Assert.DoesNotContain(await (await admin.GetAsync(Route)).ReadAsync<List<TrainerRequestDto>>(), r => r.UserId == auth.User.Id);
    }

    [Theory]
    [InlineData("approve", false)]
    [InlineData("decline", false)]
    [InlineData("approve", true)]
    [InlineData("decline", true)]
    public async Task Review_Returns404_ForMissingUserOrUserWithoutRequest(string action, bool exists)
    {
        var userId = exists ? (await _f.SignupAsync(Roles.Member)).Auth.User.Id : "missing-user";
        var admin = await _f.AdminAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync($"{Route}/{userId}/{action}", null)).StatusCode);
    }

    [Theory]
    [InlineData("approve")]
    [InlineData("decline")]
    public async Task Review_Returns404_WhenAlreadyDecided(string action)
    {
        var (_, auth) = await _f.SignupAsync();
        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"{Route}/{auth.User.Id}/{action}", null)).StatusCode);

        foreach (var repeated in new[] { "approve", "decline" })
            Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync($"{Route}/{auth.User.Id}/{repeated}", null)).StatusCode);
    }

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(Roles.Member, HttpStatusCode.Forbidden)]
    [InlineData(Roles.TrainerRequest, HttpStatusCode.Forbidden)]
    [InlineData(Roles.Trainer, HttpStatusCode.Forbidden)]
    public async Task AllEndpoints_RequireAdminOrAClubManager(string? role, HttpStatusCode expected)
    {
        var (_, pending) = await _f.SignupAsync();
        var client = role switch
        {
            null => _f.CreateClient(),
            Roles.Trainer => await _f.TrainerAsync(),
            _ => (await _f.SignupAsync(role)).Client
        };

        Assert.Equal(expected, (await client.GetAsync(Route)).StatusCode);
        Assert.Equal(expected, (await client.PostAsync($"{Route}/{pending.User.Id}/approve", null)).StatusCode);
        Assert.Equal(expected, (await client.PostAsync($"{Route}/{pending.User.Id}/decline", null)).StatusCode);
        var admin = await _f.AdminAsync();
        Assert.Contains(await (await admin.GetAsync(Route)).ReadAsync<List<TrainerRequestDto>>(), r => r.UserId == pending.User.Id);
    }

    [Fact]
    public async Task SimultaneousDecisions_OnlyOneSucceeds()
    {
        var (_, pending) = await _f.SignupAsync();
        var admin = await _f.AdminAsync();

        var responses = await Task.WhenAll(
            admin.PostAsync($"{Route}/{pending.User.Id}/approve", null),
            admin.PostAsync($"{Route}/{pending.User.Id}/decline", null));

        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.NoContent);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.NotFound);
        var fresh = await _f.LoginAsync(pending.User.Email, "Passw0rd!x");
        Assert.Equal(new[] { responses[0].StatusCode == HttpStatusCode.NoContent ? Roles.Trainer : Roles.Member }, fresh.User.Roles);
    }
}
