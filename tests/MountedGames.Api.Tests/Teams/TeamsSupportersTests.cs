using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Teams;

/// <summary>My-teams plus the supporter join-key, join, accept and remove flows.</summary>
public class TeamsSupportersTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public TeamsSupportersTests(ApiFactory f) => _f = f;

    private AuthResponse? _trainer;
    private async Task<AuthResponse> TrainerAuthAsync()
        => _trainer ??= await _f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword);

    /// <summary>A team coached by the seeded trainer.</summary>
    private async Task<(int Comp, int Team)> TeamOfTrainerAsync(string? joinKey = null, DateTime? start = null)
    {
        var comp = await _f.SeedCompetitionAsync(start: start);
        var section = await _f.SeedSectionAsync(comp);
        var club = await _f.SeedClubAsync();
        var team = await _f.SeedTeamAsync(comp, section, club, trainerUserId: (await TrainerAuthAsync()).User.Id, joinKey: joinKey);
        return (comp, team);
    }

    private Task<int> SeedSupporterAsync(int team, string userId, TeamSupporterStatus status)
        => _f.WithDbAsync(async db =>
        {
            var row = new TeamSupporter { TeamId = team, UserId = userId, Status = status };
            db.TeamSupporters.Add(row);
            await db.SaveChangesAsync();
            return row.Id;
        });

    private async Task<HttpClient> CoachAsync()
        => _f.WithToken((await _f.LoginAsync("coach@mg.local", "Trainer!234")).Token);

    [Fact]
    public async Task Join_AcceptsCaseInsensitiveCode_ForAuthenticatedMember()
    {
        var key = "SYNTHETIC" + Guid.NewGuid().ToString("N")[..10].ToUpperInvariant();
        var (_, teamId) = await TeamOfTrainerAsync(joinKey: key);
        var (member, _) = await _f.SignupAsync("Member");
        var joined = await (await member.PostAsJsonAsync("/api/teams/join", new JoinTeamRequest(key.ToLowerInvariant()))).ReadAsync<TeamSupporterDto>();
        Assert.Equal(teamId, joined.TeamId);
        Assert.Equal(TeamSupporterStatus.Pending, joined.Status);
    }

    // ---- my teams ----

    [Fact]
    public async Task MyTeams_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().GetAsync("/api/trainer/my-teams");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task MyTeams_ReturnsEmpty_ForUserWithNoTeams()
    {
        var (client, _) = await _f.SignupAsync("Member");
        var teams = await (await client.GetAsync("/api/trainer/my-teams")).ReadAsync<List<TeamDto>>();
        Assert.Empty(teams);
    }

    [Fact]
    public async Task MyTeams_ListsCoachedAndAcceptedSupportedTeams_NewestCompetitionFirst()
    {
        var (client, auth) = await _f.SignupAsync("Member");
        var (_, supported) = await TeamOfTrainerAsync(start: DateTime.UtcNow.Date.AddDays(500));
        var (_, pending) = await TeamOfTrainerAsync(start: DateTime.UtcNow.Date.AddDays(501));
        var (_, older) = await TeamOfTrainerAsync(start: DateTime.UtcNow.Date.AddDays(499));
        var (comp, coached) = await TeamOfTrainerAsync(joinKey: "SECRETKEY", start: DateTime.UtcNow.Date.AddDays(502));
        await SeedSupporterAsync(supported, auth.User.Id, TeamSupporterStatus.Accepted);
        await SeedSupporterAsync(pending, auth.User.Id, TeamSupporterStatus.Pending);
        await _f.WithDbAsync(async db =>
        {
            (await db.Teams.SingleAsync(t => t.Id == coached)).TrainerUserId = auth.User.Id;
            await db.SaveChangesAsync();
        });

        var teams = await (await client.GetAsync("/api/trainer/my-teams")).ReadAsync<List<TeamDto>>();

        Assert.Equal(new[] { coached, supported }, teams.Select(t => t.Id));
        Assert.DoesNotContain(teams, t => t.Id == pending || t.Id == older);
        Assert.Equal("trainer", teams[0].Relationship);
        Assert.Equal("SECRETKEY", teams[0].SupporterJoinKey);
        Assert.Equal("supporter", teams[1].Relationship);
        Assert.Null(teams[1].SupporterJoinKey);
        Assert.Equal(comp, teams[0].CompetitionId);
    }

    // ---- rotate key ----

    [Fact]
    public async Task RotateKey_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PostAsync("/api/competitions/1/teams/1/supporter-key", null);
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task RotateKey_Returns404_WhenTeamMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsync("/api/competitions/1/teams/999999/supporter-key", null);
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task RotateKey_Returns403_ForNonOwner()
    {
        var (comp, team) = await TeamOfTrainerAsync();
        var coach = await CoachAsync();
        var r = await coach.PostAsync($"/api/competitions/{comp}/teams/{team}/supporter-key", null);
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task RotateKey_GeneratesUnambiguousEightCharKey_ForOwner()
    {
        var (comp, team) = await TeamOfTrainerAsync();
        var trainer = await _f.TrainerAsync();

        var first = await (await trainer.PostAsync($"/api/competitions/{comp}/teams/{team}/supporter-key", null))
            .ReadAsync<GenerateJoinKeyResponse>();
        var second = await (await trainer.PostAsync($"/api/competitions/{comp}/teams/{team}/supporter-key", null))
            .ReadAsync<GenerateJoinKeyResponse>();

        Assert.Matches(new Regex("^[A-HJ-NP-Z2-9]{8}$"), first.Key);
        Assert.NotEqual(first.Key, second.Key);
        var stored = await _f.WithDbAsync(db => db.Teams.AsNoTracking().SingleAsync(t => t.Id == team));
        Assert.Equal(second.Key, stored.SupporterJoinKey);
    }

    [Fact]
    public async Task RotateKey_AllowsAdminOnAnyTeam()
    {
        var (comp, team) = await TeamOfTrainerAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsync($"/api/competitions/{comp}/teams/{team}/supporter-key", null);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    // ---- set team code ----

    [Fact]
    public async Task SetTeamCode_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PutAsJsonAsync("/api/competitions/1/teams/1/team-code", new { code = "ABC" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task SetTeamCode_Returns404_WhenTeamMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync("/api/competitions/1/teams/999999/team-code", new { code = "ABC" });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task SetTeamCode_Returns403_ForNonOwner()
    {
        var (comp, team) = await TeamOfTrainerAsync();
        var coach = await CoachAsync();
        var r = await coach.PutAsJsonAsync($"/api/competitions/{comp}/teams/{team}/team-code", new { code = "ABC" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Theory]
    [InlineData("AB")]
    [InlineData("  a ")]
    [InlineData("ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFG")]
    [InlineData("AB CD")]
    [InlineData("AB!CD")]
    public async Task SetTeamCode_Returns400_ForInvalidCode(string code)
    {
        var (comp, team) = await TeamOfTrainerAsync();
        var trainer = await _f.TrainerAsync();

        var r = await trainer.PutAsJsonAsync($"/api/competitions/{comp}/teams/{team}/team-code", new { code });

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task SetTeamCode_Returns400_WhenCodeMissing()
    {
        var (comp, team) = await TeamOfTrainerAsync();
        var trainer = await _f.TrainerAsync();
        var r = await trainer.PutAsJsonAsync($"/api/competitions/{comp}/teams/{team}/team-code", new { });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task SetTeamCode_Returns409_WhenAnotherTeamInSameCompetitionUsesIt_CaseInsensitively()
    {
        var (comp, team) = await TeamOfTrainerAsync();
        var section = await _f.WithDbAsync(db => db.Teams.Where(t => t.Id == team).Select(t => t.CompetitionSectionId).SingleAsync());
        var club = await _f.SeedClubAsync();
        await _f.SeedTeamAsync(comp, section, club, joinKey: "clash-1");
        var trainer = await _f.TrainerAsync();

        var r = await trainer.PutAsJsonAsync($"/api/competitions/{comp}/teams/{team}/team-code", new { code = "CLASH-1" });

        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
    }

    [Fact]
    public async Task SetTeamCode_StoresTrimmedUppercaseCode_AndAllowsReusingOwnCode()
    {
        var (comp, team) = await TeamOfTrainerAsync();
        var trainer = await _f.TrainerAsync();

        var first = await trainer.PutAsJsonAsync($"/api/competitions/{comp}/teams/{team}/team-code", new { code = "  my_team-9 " });
        var again = await trainer.PutAsJsonAsync($"/api/competitions/{comp}/teams/{team}/team-code", new { code = "MY_TEAM-9" });

        Assert.Equal("MY_TEAM-9", (await first.ReadAsync<GenerateJoinKeyResponse>()).Key);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
    }

    [Fact]
    public async Task SetTeamCode_AllowsSameCodeInDifferentCompetition()
    {
        await TeamOfTrainerAsync(joinKey: "SHARED-CODE");
        var (comp, team) = await TeamOfTrainerAsync();
        var trainer = await _f.TrainerAsync();

        var r = await trainer.PutAsJsonAsync($"/api/competitions/{comp}/teams/{team}/team-code", new { code = "SHARED-CODE" });

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    // ---- revoke ----

    [Fact]
    public async Task RevokeKey_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().DeleteAsync("/api/competitions/1/teams/1/supporter-key");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task RevokeKey_Returns403_ForNonOwner()
    {
        var (comp, team) = await TeamOfTrainerAsync(joinKey: "REVOKE-ME");
        var coach = await CoachAsync();
        var r = await coach.DeleteAsync($"/api/competitions/{comp}/teams/{team}/supporter-key");
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task RevokeKey_ClearsKey_ForOwner()
    {
        var (comp, team) = await TeamOfTrainerAsync(joinKey: "REVOKE-ME");
        var trainer = await _f.TrainerAsync();

        var r = await trainer.DeleteAsync($"/api/competitions/{comp}/teams/{team}/supporter-key");

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.Null((await _f.WithDbAsync(db => db.Teams.AsNoTracking().SingleAsync(t => t.Id == team))).SupporterJoinKey);
    }

    // ---- list supporters ----

    [Fact]
    public async Task ListSupporters_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().GetAsync("/api/competitions/1/teams/1/supporters");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task ListSupporters_Returns403_ForNonOwner()
    {
        var (comp, team) = await TeamOfTrainerAsync();
        var (member, _) = await _f.SignupAsync("Member");
        var r = await member.GetAsync($"/api/competitions/{comp}/teams/{team}/supporters");
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task ListSupporters_ReturnsRowsNewestFirst_ForOwner()
    {
        var (comp, team) = await TeamOfTrainerAsync();
        var (_, first) = await _f.SignupAsync("Member");
        var (_, second) = await _f.SignupAsync("Member");
        var older = await SeedSupporterAsync(team, first.User.Id, TeamSupporterStatus.Accepted);
        await _f.WithDbAsync(async db =>
        {
            (await db.TeamSupporters.SingleAsync(s => s.Id == older)).CreatedAt = DateTime.UtcNow.AddDays(-1);
            await db.SaveChangesAsync();
        });
        var newer = await SeedSupporterAsync(team, second.User.Id, TeamSupporterStatus.Pending);
        var trainer = await _f.TrainerAsync();

        var rows = await (await trainer.GetAsync($"/api/competitions/{comp}/teams/{team}/supporters"))
            .ReadAsync<List<TeamSupporterDto>>();

        Assert.Equal(new[] { newer, older }, rows.Select(x => x.Id));
        Assert.Equal(TeamSupporterStatus.Pending, rows[0].Status);
        Assert.Equal(second.User.Id, rows[0].UserId);
    }

    // ---- join ----

    [Fact]
    public async Task Join_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/teams/join", new { key = "ABC" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Join_Returns400_WhenKeyBlank(string key)
    {
        var (member, _) = await _f.SignupAsync("Member");
        var r = await member.PostAsJsonAsync("/api/teams/join", new { key });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Join_Returns404_WhenNoTeamMatches()
    {
        var (member, _) = await _f.SignupAsync("Member");
        var r = await member.PostAsJsonAsync("/api/teams/join", new { key = "NO-SUCH-KEY" });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Join_Returns400_WhenCallerAlreadyTrainsTheTeam()
    {
        await TeamOfTrainerAsync(joinKey: "OWN-TEAM-KEY");
        var trainer = await _f.TrainerAsync();
        var r = await trainer.PostAsJsonAsync("/api/teams/join", new { key = "OWN-TEAM-KEY" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Join_CreatesPendingRequest_AndIsIdempotent()
    {
        var (_, team) = await TeamOfTrainerAsync(joinKey: "JOIN-ME-1");
        var (member, auth) = await _f.SignupAsync("Member");

        var r = await member.PostAsJsonAsync("/api/teams/join", new { key = " JOIN-ME-1 " });
        var again = await member.PostAsJsonAsync("/api/teams/join", new { key = "JOIN-ME-1" });

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var row = await r.ReadAsync<TeamSupporterDto>();
        Assert.Equal(team, row.TeamId);
        Assert.Equal(auth.User.Id, row.UserId);
        Assert.Equal(TeamSupporterStatus.Pending, row.Status);
        Assert.Equal(row.Id, (await again.ReadAsync<TeamSupporterDto>()).Id);
        Assert.Equal(1, await _f.WithDbAsync(db => db.TeamSupporters.CountAsync(s => s.TeamId == team)));
    }

    // ---- accept ----

    [Fact]
    public async Task Accept_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PutAsync("/api/team-supporters/1/accept", null);
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Accept_Returns404_WhenRowMissing()
    {
        var trainer = await _f.TrainerAsync();
        var r = await trainer.PutAsync("/api/team-supporters/999999/accept", null);
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Accept_Returns403_ForSomeoneWhoDoesNotCoachTheTeam()
    {
        var (_, team) = await TeamOfTrainerAsync();
        var (_, supporter) = await _f.SignupAsync("Member");
        var row = await SeedSupporterAsync(team, supporter.User.Id, TeamSupporterStatus.Pending);
        var coach = await CoachAsync();

        var r = await coach.PutAsync($"/api/team-supporters/{row}/accept", null);

        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Accept_MarksAccepted_ForCoach()
    {
        var (_, team) = await TeamOfTrainerAsync();
        var (_, supporter) = await _f.SignupAsync("Member");
        var row = await SeedSupporterAsync(team, supporter.User.Id, TeamSupporterStatus.Pending);
        var trainer = await _f.TrainerAsync();

        var r = await trainer.PutAsync($"/api/team-supporters/{row}/accept", null);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(TeamSupporterStatus.Accepted, (await r.ReadAsync<TeamSupporterDto>()).Status);
    }

    [Fact]
    public async Task Accept_AllowsAdmin()
    {
        var (_, team) = await TeamOfTrainerAsync();
        var (_, supporter) = await _f.SignupAsync("Member");
        var row = await SeedSupporterAsync(team, supporter.User.Id, TeamSupporterStatus.Pending);
        var admin = await _f.AdminAsync();

        var r = await admin.PutAsync($"/api/team-supporters/{row}/accept", null);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    // ---- remove ----

    [Fact]
    public async Task RemoveSupporter_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().DeleteAsync("/api/team-supporters/1");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task RemoveSupporter_Returns404_WhenRowMissing()
    {
        var trainer = await _f.TrainerAsync();
        var r = await trainer.DeleteAsync("/api/team-supporters/999999");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task RemoveSupporter_Returns403_ForUnrelatedUser()
    {
        var (_, team) = await TeamOfTrainerAsync();
        var (_, supporter) = await _f.SignupAsync("Member");
        var row = await SeedSupporterAsync(team, supporter.User.Id, TeamSupporterStatus.Accepted);
        var (stranger, _) = await _f.SignupAsync("Member");

        var r = await stranger.DeleteAsync($"/api/team-supporters/{row}");

        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.True(await _f.WithDbAsync(db => db.TeamSupporters.AnyAsync(s => s.Id == row)));
    }

    [Fact]
    public async Task RemoveSupporter_LetsSupporterLeave()
    {
        var (_, team) = await TeamOfTrainerAsync();
        var (client, supporter) = await _f.SignupAsync("Member");
        var row = await SeedSupporterAsync(team, supporter.User.Id, TeamSupporterStatus.Accepted);

        var r = await client.DeleteAsync($"/api/team-supporters/{row}");

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.TeamSupporters.AnyAsync(s => s.Id == row)));
    }

    [Fact]
    public async Task RemoveSupporter_LetsCoachKick()
    {
        var (_, team) = await TeamOfTrainerAsync();
        var (_, supporter) = await _f.SignupAsync("Member");
        var row = await SeedSupporterAsync(team, supporter.User.Id, TeamSupporterStatus.Accepted);
        var trainer = await _f.TrainerAsync();

        var r = await trainer.DeleteAsync($"/api/team-supporters/{row}");

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.TeamSupporters.AnyAsync(s => s.Id == row)));
    }
}
