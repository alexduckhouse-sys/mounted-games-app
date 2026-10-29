using System.Net;
using System.Net.Http.Json;
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
    public async Task SameNamedPoniesStaySeparateAndLegacyInspectionIsOnlyHistory()
    {
        var (arena, owner) = await WorldAsync();
        var board = await EnableAsync(owner, arena);
        Assert.Equal((0, 4), (board.Checked, board.Total));
        Assert.Equal(3, board.Sections.Single().Teams.Single(t => t.TeamId == arena.TeamIds[0]).Ponies.Count);
        Assert.Equal(HttpStatusCode.Conflict, (await TickAsync(owner, arena, arena.TeamIds[0], "Bramble")).StatusCode);
        await _f.WithDbAsync(async db =>
        {
            db.Add(new PassportCheck { CompetitionId = arena.CompetitionId, TeamId = arena.TeamIds[1], PonyKey = "bramble", PonyName = "Bramble", OfficialNotes = "Fake legacy inspection" }); await db.SaveChangesAsync();
        });
        board = await (await owner.GetAsync($"{Base(arena.CompetitionId)}/passport-check")).ReadAsync<PassportCheckBoardDto>();
        var pony = board.Sections.Single().Teams.Single(t => t.TeamId == arena.TeamIds[1]).Ponies.Single();
        Assert.False(pony.Certified); Assert.Equal("LegacyManualInspection", pony.Status); Assert.Equal("Fake legacy inspection", pony.OfficialNotes);
        Assert.Equal(0, board.Checked);
        Assert.False((await EnableAsync(owner, arena, false)).Enabled);
        Assert.Equal("LegacyManualInspection", (await EnableAsync(owner, arena)).Sections.Single().Teams.Single(t => t.TeamId == arena.TeamIds[1]).Ponies.Single().Status);
    }

    [Theory]
    [InlineData("Bramble", "bramble")]
    [InlineData("  Little   Star ", "little star")]
    public void PonyKey_IgnoresCaseAndSpacing(string name, string key) => Assert.Equal(key, PassportCheckService.KeyOf(name));
}
