using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.TackCheck;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.EventTools;

/// <summary>The passport and vaccination check on arrival: off by default, staff only, ponies matched within a team only.</summary>
public class PassportCheckTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public PassportCheckTests(ApiFactory f) => _f = f;

    private static string Base(int id) => $"/api/event-tools/competitions/{id}";

    /// <summary>Three teams owned by a fresh trainer. Teams 1 and 2 both have a pony called Bramble; team 3 has no declaration.</summary>
    private async Task<(Arena Arena, HttpClient Owner)> WorldAsync()
    {
        var (owner, auth) = await _f.ApprovedTrainerAsync();
        var arena = await _f.CreateArenaAsync(3);
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(arena.CompetitionId))!.CreatedByUserId = auth.User.Id;
            db.DeclarationForms.Add(new DeclarationForm
            {
                TeamId = arena.TeamIds[0], SubmittedAt = DateTime.UtcNow,
                Riders =
                {
                    new RiderEntry { FullName = "Amy Archer", HorseName = "Bramble", OrderIndex = 0 },
                    new RiderEntry { FullName = "Ben Brook", HorseName = "bramble ", OrderIndex = 1 },
                    new RiderEntry { FullName = "Cat Cole", HorseName = "Pepper", OrderIndex = 2 },
                    new RiderEntry { FullName = "Dan Dale", HorseName = " ", OrderIndex = 3 },
                },
            });
            db.DeclarationForms.Add(new DeclarationForm
            {
                TeamId = arena.TeamIds[1], SubmittedAt = DateTime.UtcNow,
                Riders = { new RiderEntry { FullName = "Eve Ely", HorseName = "Bramble" } },
            });
            await db.SaveChangesAsync();
        });
        return (arena, owner);
    }

    private static Task<HttpResponseMessage> TickAsync(HttpClient client, Arena arena, int teamId, string pony, bool on = true)
        => client.PutAsJsonAsync($"{Base(arena.CompetitionId)}/passport-check/teams/{teamId}", new SetPassportCheckRequest(pony, on));

    private static async Task<PassportCheckBoardDto> EnableAsync(HttpClient client, Arena arena, bool on = true)
    {
        var response = await client.PutAsJsonAsync($"{Base(arena.CompetitionId)}/passport-check/settings", new SavePassportCheckSettingsRequest(on));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<PassportCheckBoardDto>();
    }

    [Fact]
    public async Task Endpoints_AreForTheCompetitionsStaffOnly()
    {
        var (arena, owner) = await WorldAsync();
        var id = arena.CompetitionId;
        var (member, _) = await _f.SignupAsync("Member");
        var other = await _f.TrainerAsync();
        var anonymous = _f.CreateClient();
        var board = $"{Base(id)}/passport-check";
        var settings = $"{board}/settings";
        var body = new SavePassportCheckSettingsRequest(true);

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(board)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(board)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(board)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PutAsJsonAsync(settings, body)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync(settings, body)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await TickAsync(anonymous, arena, arena.TeamIds[0], "Bramble")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await TickAsync(other, arena, arena.TeamIds[0], "Bramble")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync(board)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await _f.AdminAsync()).PutAsJsonAsync(settings, body)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await _f.AdminAsync()).GetAsync($"{Base(999999)}/passport-check")).StatusCode);
    }

    [Fact]
    public async Task WhenOff_TheBoardIsHidden_AndTicksAreRefused()
    {
        var (arena, owner) = await WorldAsync();
        var board = await (await owner.GetAsync($"{Base(arena.CompetitionId)}/passport-check")).ReadAsync<PassportCheckBoardDto>();
        Assert.False(board.Enabled);
        Assert.Empty(board.Sections);
        Assert.Equal(HttpStatusCode.Conflict, (await TickAsync(owner, arena, arena.TeamIds[0], "Bramble")).StatusCode);
    }

    [Fact]
    public async Task Board_ListsEachTeamsPonies_AndSameNamedPoniesInOtherTeamsAreSeparate()
    {
        var (arena, owner) = await WorldAsync();
        var board = await EnableAsync(owner, arena);
        Assert.True(board.Enabled);
        Assert.Equal((0, 3), (board.Checked, board.Total));
        var teams = Assert.Single(board.Sections).Teams;
        var first = teams.Single(t => t.TeamId == arena.TeamIds[0]);
        Assert.True(first.HasDeclaration);
        // Two riders share Bramble within the team; the rider with no pony name is left off.
        Assert.Equal(["Bramble", "Pepper"], first.Ponies.Select(p => p.PonyName));
        Assert.Equal(["Amy Archer", "Ben Brook"], first.Ponies[0].Riders);
        Assert.False(teams.Single(t => t.TeamId == arena.TeamIds[2]).HasDeclaration);

        var ticked = await (await TickAsync(owner, arena, arena.TeamIds[0], " BRAMBLE")).ReadAsync<PassportCheckPonyDto>();
        Assert.NotNull(ticked.CheckedAt);
        Assert.False(string.IsNullOrEmpty(ticked.CheckedByName));
        // Ticking twice changes nothing.
        Assert.Equal(HttpStatusCode.OK, (await TickAsync(owner, arena, arena.TeamIds[0], "Bramble")).StatusCode);

        board = await (await owner.GetAsync($"{Base(arena.CompetitionId)}/passport-check")).ReadAsync<PassportCheckBoardDto>();
        Assert.Equal((1, 3), (board.Checked, board.Total));
        Assert.Null(board.Sections[0].Teams.Single(t => t.TeamId == arena.TeamIds[1]).Ponies.Single().CheckedAt);

        var cleared = await (await TickAsync(owner, arena, arena.TeamIds[0], "Bramble", on: false)).ReadAsync<PassportCheckPonyDto>();
        Assert.Null(cleared.CheckedAt);
        Assert.Equal(0, await _f.WithDbAsync(db => db.Set<PassportCheck>().CountAsync(x => x.CompetitionId == arena.CompetitionId)));
    }

    [Fact]
    public async Task Ticks_SurviveADeclarationEdit_AndTurningTheCheckOffAndOn()
    {
        var (arena, owner) = await WorldAsync();
        await EnableAsync(owner, arena);
        (await TickAsync(owner, arena, arena.TeamIds[1], "Bramble")).EnsureSuccessStatusCode();

        // The trainer edits the declaration: riders are written again, the pony keeps its name.
        await _f.WithDbAsync(async db =>
        {
            var form = await db.DeclarationForms.Include(f => f.Riders).SingleAsync(f => f.TeamId == arena.TeamIds[1]);
            db.RiderEntries.RemoveRange(form.Riders);
            form.Riders.Add(new RiderEntry { FullName = "Eve Ely-Smith", HorseName = "Bramble" });
            await db.SaveChangesAsync();
        });
        Assert.False((await EnableAsync(owner, arena, on: false)).Enabled);
        var board = await EnableAsync(owner, arena);
        var pony = board.Sections[0].Teams.Single(t => t.TeamId == arena.TeamIds[1]).Ponies.Single();
        Assert.NotNull(pony.CheckedAt);
        Assert.Equal(["Eve Ely-Smith"], pony.Riders);
    }

    [Fact]
    public async Task Ticks_MustNameAPonyOnTheTeamsDeclaration()
    {
        var (arena, owner) = await WorldAsync();
        await EnableAsync(owner, arena);
        Assert.Equal(HttpStatusCode.NotFound, (await TickAsync(owner, arena, arena.TeamIds[1], "Pepper")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await TickAsync(owner, arena, arena.TeamIds[2], "Bramble")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await TickAsync(owner, arena, (await _f.CreateArenaAsync(1)).TeamIds[0], "Bramble")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await TickAsync(owner, arena, arena.TeamIds[0], "")).StatusCode);
    }

    [Theory]
    [InlineData("Bramble", "bramble")]
    [InlineData("  Little   Star ", "little star")]
    public void PonyKey_IgnoresCaseAndSpacing(string name, string key) => Assert.Equal(key, PassportCheckService.KeyOf(name));
}
