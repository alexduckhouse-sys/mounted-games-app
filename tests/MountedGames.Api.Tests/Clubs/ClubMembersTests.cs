using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Clubs;

/// <summary>The Members screen: who is in a club, and a manager's (or admin's) power over them.</summary>
public class ClubMembersTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ClubMembersTests(ApiFactory f) => _f = f;

    private static string NewClubName() => $"Members Club {Guid.NewGuid():N}";
    private Task<int> ClubIdAsync(string name) => _f.WithDbAsync(db => db.Clubs.Where(c => c.Name == name).Select(c => c.Id).SingleAsync());
    private static string Members(int clubId) => $"/api/clubs/{clubId}/members";
    private static string RoleUrl(int clubId, string userId) => $"/api/clubs/{clubId}/members/{userId}/role";

    private Task<List<string>> RolesOfAsync(string userId) => _f.WithDbAsync(db =>
        (from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id where ur.UserId == userId orderby r.Name select r.Name!).ToListAsync());

    private async Task<AuthResponse> ApprovedTrainerInAsync(string club)
    {
        var (_, pending) = await _f.SignupAsync("Trainer", club);
        (await (await _f.AdminAsync()).PostAsync($"/api/admin/trainer-requests/{pending.User.Id}/approve", null)).EnsureSuccessStatusCode();
        return pending;
    }

    private static async Task<ClubMembersDto> ReadAsync(HttpClient c, int clubId) => await (await c.GetAsync(Members(clubId))).ReadAsync<ClubMembersDto>();

    private static Task<HttpResponseMessage> SetRoleAsync(HttpClient c, int clubId, string userId, string role)
        => c.PutAsJsonAsync(RoleUrl(clubId, userId), new ChangeMemberRoleRequest(role));

    // ---- who may look ----

    [Fact]
    public async Task List_Returns401_WhenAnonymous_And403_ForTrainersAndMembers()
    {
        var club = NewClubName();
        var (member, _) = await _f.SignupAsync("Member", club);
        var (trainer, _) = await _f.ApprovedTrainerAsync();
        var id = await ClubIdAsync(club);

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync(Members(id))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(Members(id))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await trainer.GetAsync(Members(id))).StatusCode);
    }

    [Fact]
    public async Task List_HidesAnotherClub_FromItsManager_AndAnUnknownClubFromEveryone()
    {
        var mine = NewClubName();
        var theirs = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(mine);
        await _f.SignupAsync("Member", theirs);
        var theirId = await ClubIdAsync(theirs);

        Assert.Equal(HttpStatusCode.NotFound, (await manager.GetAsync(Members(theirId))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await manager.GetAsync(Members(999999))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await _f.AdminAsync()).GetAsync(Members(999999))).StatusCode);
    }

    [Fact]
    public async Task List_GroupsTheClubByRole_WithTheTeamsATrainerLooksAfter()
    {
        var club = NewClubName();
        var (manager, boss) = await _f.ApprovedManagerAsync(club);
        var trainer = await ApprovedTrainerInAsync(club);
        var (_, member) = await _f.SignupAsync("Member", club);
        var arena = await _f.CreateArenaAsync(2);
        var clubId = await ClubIdAsync(club);
        await _f.WithDbAsync(async db =>
        {
            foreach (var teamId in arena.TeamIds)
            {
                var team = await db.Teams.SingleAsync(t => t.Id == teamId);
                team.ClubId = clubId;
                team.TrainerUserId = trainer.User.Id;
            }
            await db.SaveChangesAsync();
        });

        var list = await ReadAsync(manager, clubId);

        Assert.Equal(club, list.ClubName);
        Assert.Equal(Roles.Manager, list.Members.Single(m => m.UserId == boss.User.Id).Role);
        var coach = list.Members.Single(m => m.UserId == trainer.User.Id);
        Assert.Equal(Roles.Trainer, coach.Role);
        Assert.Equal(2, coach.Teams.Count);
        var plain = list.Members.Single(m => m.UserId == member.User.Id);
        Assert.Equal(Roles.Member, plain.Role);
        Assert.Empty(plain.Teams);
        Assert.Empty(list.Pending);
    }

    [Fact]
    public async Task List_ShowsTrainerRequestsToTheManager_ButManagerRequestsOnlyToAdmins()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var (_, wantsTrainer) = await _f.SignupAsync("Trainer", club);
        var (_, wantsManager) = await _f.SignupAsync("Manager", club);
        var clubId = await ClubIdAsync(club);

        var asManager = await ReadAsync(manager, clubId);
        var asAdmin = await ReadAsync(await _f.AdminAsync(), clubId);

        Assert.Equal(new[] { wantsTrainer.User.Id }, asManager.Pending.Select(p => p.UserId));
        Assert.Equal(Roles.Trainer, asManager.Pending.Single().RequestedRole);
        Assert.Equal(new[] { wantsManager.User.Id, wantsTrainer.User.Id }.Order(), asAdmin.Pending.Select(p => p.UserId).Order());
        Assert.Equal(Roles.Manager, asAdmin.Pending.Single(p => p.UserId == wantsManager.User.Id).RequestedRole);
        // Neither is a member yet; the manager still sees the other as a member waiting on an admin.
        Assert.DoesNotContain(asAdmin.Members, m => m.UserId == wantsTrainer.User.Id || m.UserId == wantsManager.User.Id);
        Assert.True(asManager.Members.Single(m => m.UserId == wantsManager.User.Id).AwaitingAdmin);
    }

    [Fact]
    public async Task List_NeverListsAnAdmin()
    {
        var club = NewClubName();
        var (_, user) = await _f.SignupAsync("Member", club);
        var clubId = await ClubIdAsync(club);
        await _f.WithDbAsync(async db =>
        {
            var role = await db.Roles.SingleAsync(r => r.Name == Roles.Admin);
            db.UserRoles.Add(new Microsoft.AspNetCore.Identity.IdentityUserRole<string> { UserId = user.User.Id, RoleId = role.Id });
            await db.SaveChangesAsync();
        });

        var list = await ReadAsync(await _f.AdminAsync(), clubId);

        Assert.DoesNotContain(list.Members, m => m.UserId == user.User.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await SetRoleAsync(await _f.AdminAsync(), clubId, user.User.Id, "Trainer")).StatusCode);
    }

    [Fact]
    public async Task AManagerWhoIsNoLongerOne_LosesAccessAtOnce_EvenWithTheOldToken()
    {
        var club = NewClubName();
        var (staleManager, boss) = await _f.ApprovedManagerAsync(club);
        var clubId = await ClubIdAsync(club);
        Assert.Equal(HttpStatusCode.OK, (await staleManager.GetAsync(Members(clubId))).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await SetRoleAsync(await _f.AdminAsync(), clubId, boss.User.Id, "Trainer")).StatusCode);

        // Revoked roles are removed from old JWTs before the controller's role gate runs.
        Assert.Equal(HttpStatusCode.Forbidden, (await staleManager.GetAsync(Members(clubId))).StatusCode);
    }

    // ---- changing a role ----

    [Fact]
    public async Task ChangeRole_Returns401_403_AndHidesOtherClubs()
    {
        var club = NewClubName();
        var other = NewClubName();
        var (member, memberAuth) = await _f.SignupAsync("Member", club);
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var (otherManager, _) = await _f.ApprovedManagerAsync(other);
        var clubId = await ClubIdAsync(club);

        Assert.Equal(HttpStatusCode.Unauthorized, (await SetRoleAsync(_f.CreateClient(), clubId, memberAuth.User.Id, "Trainer")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await SetRoleAsync(member, clubId, memberAuth.User.Id, "Trainer")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await SetRoleAsync(otherManager, clubId, memberAuth.User.Id, "Trainer")).StatusCode);
        // A person from another club isn't reachable through this club's URL either.
        var (_, stranger) = await _f.SignupAsync("Member", other);
        Assert.Equal(HttpStatusCode.NotFound, (await SetRoleAsync(manager, clubId, stranger.User.Id, "Trainer")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await SetRoleAsync(manager, clubId, "no-such-user", "Trainer")).StatusCode);
        Assert.Equal(new[] { Roles.Member }, await RolesOfAsync(memberAuth.User.Id));
    }

    [Fact]
    public async Task ChangeRole_LetsAManagerMakeATrainer_AndPutThemBackToMember()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var (_, member) = await _f.SignupAsync("Member", club);
        var clubId = await ClubIdAsync(club);

        var up = await (await SetRoleAsync(manager, clubId, member.User.Id, "trainer")).ReadAsync<ChangeMemberRoleResponse>();
        Assert.Equal(new ChangeMemberRoleResponse(Roles.Trainer, false), up);
        Assert.Equal(new[] { Roles.Trainer }, await RolesOfAsync(member.User.Id));

        var arena = await _f.CreateArenaAsync(1);
        await _f.WithDbAsync(async db =>
        {
            var team = await db.Teams.SingleAsync(t => t.Id == arena.TeamIds[0]);
            team.ClubId = clubId;
            team.TrainerUserId = member.User.Id;
            await db.SaveChangesAsync();
        });

        var down = await (await SetRoleAsync(manager, clubId, member.User.Id, "Member")).ReadAsync<ChangeMemberRoleResponse>();
        Assert.Equal(new ChangeMemberRoleResponse(Roles.Member, false), down);
        Assert.Equal(new[] { Roles.Member }, await RolesOfAsync(member.User.Id));
        Assert.Null(await _f.WithDbAsync(db => db.Teams.Where(t => t.Id == arena.TeamIds[0]).Select(t => t.TrainerUserId).SingleAsync()));
    }

    [Fact]
    public async Task ChangeRole_FromAManager_ToTeamManager_AsksAnAdminInsteadOfApplying()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var trainer = await ApprovedTrainerInAsync(club);
        var clubId = await ClubIdAsync(club);

        var first = await (await SetRoleAsync(manager, clubId, trainer.User.Id, "Manager")).ReadAsync<ChangeMemberRoleResponse>();
        var again = await (await SetRoleAsync(manager, clubId, trainer.User.Id, "Manager")).ReadAsync<ChangeMemberRoleResponse>();

        Assert.Equal(new ChangeMemberRoleResponse(Roles.Trainer, true), first);
        Assert.Equal(first, again);
        Assert.Equal(new[] { Roles.ManagerRequest, Roles.Trainer }, await RolesOfAsync(trainer.User.Id));
        Assert.True((await ReadAsync(manager, clubId)).Members.Single(m => m.UserId == trainer.User.Id).AwaitingAdmin);
        var admin = await _f.AdminAsync();
        var queue = await (await admin.GetAsync("/api/admin/trainer-requests")).ReadAsync<List<TrainerRequestDto>>();
        Assert.Equal(Roles.Manager, queue.Single(p => p.UserId == trainer.User.Id).RequestedRole);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/admin/trainer-requests/{trainer.User.Id}/approve", null)).StatusCode);
        Assert.Contains(Roles.Manager, await RolesOfAsync(trainer.User.Id));
        Assert.DoesNotContain(Roles.ManagerRequest, await RolesOfAsync(trainer.User.Id));
    }

    [Fact]
    public async Task ChangeRole_LetsAnAdminMakeATeamManager_AtOnce_AndStepOneDown()
    {
        var club = NewClubName();
        var (_, member) = await _f.SignupAsync("Member", club);
        var clubId = await ClubIdAsync(club);
        var admin = await _f.AdminAsync();

        var made = await (await SetRoleAsync(admin, clubId, member.User.Id, "Manager")).ReadAsync<ChangeMemberRoleResponse>();
        Assert.Equal(new ChangeMemberRoleResponse(Roles.Manager, false), made);
        Assert.Equal(new[] { Roles.Manager }, await RolesOfAsync(member.User.Id));

        var stepped = await (await SetRoleAsync(admin, clubId, member.User.Id, "Trainer")).ReadAsync<ChangeMemberRoleResponse>();
        Assert.Equal(Roles.Trainer, stepped.Role);
        Assert.Equal(new[] { Roles.Trainer }, await RolesOfAsync(member.User.Id));
    }

    [Fact]
    public async Task ChangeRole_KeepsTeamManagersAndYourselfOutOfAManagersReach()
    {
        var club = NewClubName();
        var (manager, boss) = await _f.ApprovedManagerAsync(club);
        var (second, secondAuth) = await _f.ApprovedManagerAsync(club);
        var clubId = await ClubIdAsync(club);

        Assert.Equal(HttpStatusCode.Forbidden, (await SetRoleAsync(manager, clubId, secondAuth.User.Id, "Trainer")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await SetRoleAsync(manager, clubId, boss.User.Id, "Trainer")).StatusCode);
        Assert.Contains(Roles.Manager, await RolesOfAsync(secondAuth.User.Id));
        Assert.Equal(HttpStatusCode.OK, (await ReadAsyncStatus(second, clubId)));
    }

    private static async Task<HttpStatusCode> ReadAsyncStatus(HttpClient c, int clubId) => (await c.GetAsync(Members(clubId))).StatusCode;

    [Fact]
    public async Task ChangeRole_Refuses_ABadRole_APendingRequest_AndDoesNothingForTheSameRole()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var (_, wantsTrainer) = await _f.SignupAsync("Trainer", club);
        var (_, wantsManager) = await _f.SignupAsync("Manager", club);
        var (_, member) = await _f.SignupAsync("Member", club);
        var clubId = await ClubIdAsync(club);

        Assert.Equal(HttpStatusCode.BadRequest, (await SetRoleAsync(manager, clubId, member.User.Id, "Admin")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SetRoleAsync(manager, clubId, member.User.Id, "")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await SetRoleAsync(manager, clubId, wantsTrainer.User.Id, "Member")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await SetRoleAsync(await _f.AdminAsync(), clubId, wantsManager.User.Id, "Member")).StatusCode);
        var same = await (await SetRoleAsync(manager, clubId, member.User.Id, "Member")).ReadAsync<ChangeMemberRoleResponse>();
        Assert.Equal(new ChangeMemberRoleResponse(Roles.Member, false), same);
        Assert.Equal(new[] { Roles.Member, Roles.TrainerRequest }, await RolesOfAsync(wantsTrainer.User.Id));
    }

    // ---- removing someone ----

    [Fact]
    public async Task Remove_Returns401_403_AndHidesOtherClubs()
    {
        var club = NewClubName();
        var (member, memberAuth) = await _f.SignupAsync("Member", club);
        var (otherManager, _) = await _f.ApprovedManagerAsync(NewClubName());
        var clubId = await ClubIdAsync(club);
        var url = $"/api/clubs/{clubId}/members/{memberAuth.User.Id}";

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().DeleteAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.DeleteAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await otherManager.DeleteAsync(url)).StatusCode);
        Assert.Equal(clubId, await _f.WithDbAsync(db => db.Users.Where(u => u.Id == memberAuth.User.Id).Select(u => u.ClubId).SingleAsync()));
    }

    [Fact]
    public async Task Remove_TakesTheTrainerOutOfTheClub_ButKeepsTheirSavedRidersAndLosesTheirTeams()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var trainer = await ApprovedTrainerInAsync(club);
        var clubId = await ClubIdAsync(club);
        var arena = await _f.CreateArenaAsync(1);
        var riderName = $"Kept {Guid.NewGuid():N}"[..16];
        await _f.WithDbAsync(async db =>
        {
            var team = await db.Teams.SingleAsync(t => t.Id == arena.TeamIds[0]);
            team.ClubId = clubId;
            team.TrainerUserId = trainer.User.Id;
            db.SavedRiders.Add(new SavedRider { ClubId = clubId, CreatedByUserId = trainer.User.Id, FullName = riderName });
            await db.SaveChangesAsync();
        });

        var r = await manager.DeleteAsync($"/api/clubs/{clubId}/members/{trainer.User.Id}");

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.Null(await _f.WithDbAsync(db => db.Users.Where(u => u.Id == trainer.User.Id).Select(u => u.ClubId).SingleAsync()));
        Assert.Equal(new[] { Roles.Member }, await RolesOfAsync(trainer.User.Id));
        Assert.Null(await _f.WithDbAsync(db => db.Teams.Where(t => t.Id == arena.TeamIds[0]).Select(t => t.TrainerUserId).SingleAsync()));
        Assert.True(await _f.WithDbAsync(db => db.SavedRiders.AnyAsync(s => s.ClubId == clubId && s.FullName == riderName)));
        Assert.DoesNotContain((await ReadAsync(manager, clubId)).Members, m => m.UserId == trainer.User.Id);
    }

    [Fact]
    public async Task Remove_Declines_APendingRequest_Too_AndOnlyAnAdminRemovesATeamManager()
    {
        var club = NewClubName();
        var (manager, boss) = await _f.ApprovedManagerAsync(club);
        var (_, second) = await _f.ApprovedManagerAsync(club);
        var (_, wants) = await _f.SignupAsync("Trainer", club);
        var clubId = await ClubIdAsync(club);

        Assert.Equal(HttpStatusCode.NoContent, (await manager.DeleteAsync($"/api/clubs/{clubId}/members/{wants.User.Id}")).StatusCode);
        Assert.Equal(new[] { Roles.Member }, await RolesOfAsync(wants.User.Id));
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.DeleteAsync($"/api/clubs/{clubId}/members/{second.User.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await manager.DeleteAsync($"/api/clubs/{clubId}/members/{boss.User.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await (await _f.AdminAsync()).DeleteAsync($"/api/clubs/{clubId}/members/{second.User.Id}")).StatusCode);
        Assert.Null(await _f.WithDbAsync(db => db.Users.Where(u => u.Id == second.User.Id).Select(u => u.ClubId).SingleAsync()));
    }

    [Fact]
    public async Task Remove_Returns404_ForSomeoneNotInTheClub()
    {
        var club = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(club);
        var clubId = await ClubIdAsync(club);

        Assert.Equal(HttpStatusCode.NotFound, (await manager.DeleteAsync($"/api/clubs/{clubId}/members/no-such-user")).StatusCode);
    }

    // ---- signing up with a name ----

    [Fact]
    public async Task Signup_UsesTheNameGiven_AndFallsBackToTheStartOfTheEmail()
    {
        var club = NewClubName();
        var email = $"sam{Guid.NewGuid():N}"[..12] + "@example.com";

        var named = await _f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(email, "Passw0rd!x", "Member", club, "  Sam Lee "));
        var unnamed = await _f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest("two" + email, "Passw0rd!x", "Member", club));

        Assert.Equal("Sam Lee", (await named.ReadAsync<AuthResponse>()).User.FullName);
        Assert.Equal("two" + email.Split('@')[0], (await unnamed.ReadAsync<AuthResponse>()).User.FullName);
    }

    [Fact]
    public async Task Signup_Returns400_ForAnOverlongName()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest($"u{Guid.NewGuid():N}"[..12] + "@example.com", "Passw0rd!x", "Member", NewClubName(), new string('x', 101)));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }
}
