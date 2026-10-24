using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Clubs;

public class ClubsEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ClubsEndpointsTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task AdminCanUpdateAndDeleteUnusedClub_ButCannotDeleteLinkedProfiles()
    {
        var admin = await _f.AdminAsync();
        var id = await _f.SeedClubAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PutAsJsonAsync($"/api/clubs/{id}", new { name = "Test" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await _f.TrainerAsync()).DeleteAsync($"/api/clubs/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/clubs/{id}", new { name = new string('x', 151) })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/clubs/{id}", new { name = $"Test renamed {Guid.NewGuid()}" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/clubs/{id}")).StatusCode);
        var linkedId = await _f.SeedClubAsync();
        var ownerId = await _f.TrainerIdAsync();
        await _f.WithDbAsync(async db => {
            db.Set<Api.Entities.Seasons.TeamProfile>().Add(new() { ClubId = linkedId, DisplayName = "Test profile", OwnerUserId = ownerId });
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.Conflict, (await admin.DeleteAsync($"/api/clubs/{linkedId}")).StatusCode);
    }

    [Fact]
    public async Task List_ReturnsSeededClubsAlphabetically()
    {
        var clubs = await (await _f.CreateClient().GetAsync("/api/clubs")).ReadAsync<List<ClubDto>>();

        Assert.True(clubs.Count > 100);
        Assert.Contains(clubs, c => c.Name == "Warwickshire Hunt");
        Assert.Equal(clubs.Select(c => c.Name).OrderBy(n => n, StringComparer.Ordinal), clubs.Select(c => c.Name));
    }

    [Fact]
    public async Task Get_Returns404_WhenClubMissing()
    {
        var r = await _f.CreateClient().GetAsync("/api/clubs/999999");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Get_ReturnsClub()
    {
        var id = await _f.SeedClubAsync("Get Me Club", "Green");

        var dto = await (await _f.CreateClient().GetAsync($"/api/clubs/{id}")).ReadAsync<ClubDto>();

        Assert.Equal("Get Me Club", dto.Name);
        Assert.Equal("Green", dto.BibColour);
    }

    private async Task<int> SeedRidersAsync()
    {
        var club = await _f.SeedClubAsync();
        var other = await _f.SeedClubAsync();
        var trainerId = await _f.TrainerIdAsync();
        await _f.WithDbAsync(async db =>
        {
            db.SavedRiders.AddRange(
                new Api.Entities.SavedRider { ClubId = club, FullName = "Zoe", HorseName = "Z-horse", CreatedByUserId = trainerId },
                new Api.Entities.SavedRider { ClubId = club, FullName = "Abi", HorseName = "A-horse", CreatedByUserId = trainerId },
                new Api.Entities.SavedRider { ClubId = club, FullName = "Legacy" },
                new Api.Entities.SavedRider { ClubId = other, FullName = "Not mine", CreatedByUserId = trainerId });
            await db.SaveChangesAsync();
        });
        return club;
    }

    [Fact]
    public async Task SavedRiders_ReturnsOnlyTheCallersRidersInThatClub_SortedByName()
    {
        var club = await SeedRidersAsync();
        var trainer = await _f.TrainerAsync();

        var riders = await (await trainer.GetAsync($"/api/clubs/{club}/saved-riders")).ReadAsync<List<SavedRiderDto>>();

        Assert.Equal(new[] { "Abi", "Zoe" }, riders.Select(r => r.FullName));
        Assert.Equal("A-horse", riders[0].HorseName);
    }

    [Fact]
    public async Task SavedRiders_AdminSeesEveryRiderInTheClub_IncludingUnownedLegacyOnes()
    {
        var club = await SeedRidersAsync();
        var admin = await _f.AdminAsync();

        var riders = await (await admin.GetAsync($"/api/clubs/{club}/saved-riders")).ReadAsync<List<SavedRiderDto>>();

        Assert.Equal(new[] { "Abi", "Legacy", "Zoe" }, riders.Select(r => r.FullName));
    }

    [Fact]
    public async Task SavedRiders_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().GetAsync($"/api/clubs/{await SeedRidersAsync()}/saved-riders");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task SavedRiders_ReturnsEmpty_ForUnknownClub()
    {
        var trainer = await _f.TrainerAsync();
        var riders = await (await trainer.GetAsync("/api/clubs/999999/saved-riders")).ReadAsync<List<SavedRiderDto>>();
        Assert.Empty(riders);
    }

    [Fact]
    public async Task Create_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/clubs", new { name = "x" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Create_Returns403_ForTrainer()
    {
        var trainer = await _f.TrainerAsync();
        var r = await trainer.PostAsJsonAsync("/api/clubs", new { name = "x" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Create_Returns400_WhenNameBlank(string name)
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/clubs", new { name });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_Returns400_WhenNameMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/clubs", new { });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_PersistsTrimmedFields()
    {
        var admin = await _f.AdminAsync();
        var name = $"New Club {Guid.NewGuid():N}";

        var r = await admin.PostAsJsonAsync("/api/clubs", new { name = $"  {name} ", region = " North ", bibColour = " Purple " });

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<ClubDto>();
        Assert.Equal(name, dto.Name);
        Assert.Equal("North", dto.Region);
        Assert.Equal("Purple", dto.BibColour);
        Assert.True(await _f.WithDbAsync(db => db.Clubs.AnyAsync(c => c.Id == dto.Id)));
    }

    [Fact]
    public async Task Create_DefaultsRegionToCustom_AndNullsBlankBib()
    {
        var admin = await _f.AdminAsync();

        var dto = await (await admin.PostAsJsonAsync("/api/clubs",
            new { name = $"Plain {Guid.NewGuid():N}", region = " ", bibColour = "" })).ReadAsync<ClubDto>();

        Assert.Equal("Custom", dto.Region);
        Assert.Null(dto.BibColour);
    }

    [Fact]
    public async Task Create_ReturnsExistingClub_WhenNameAlreadyUsed()
    {
        var admin = await _f.AdminAsync();
        var existing = await _f.SeedClubAsync($"Dup {Guid.NewGuid():N}");
        var name = await _f.WithDbAsync(db => db.Clubs.Where(c => c.Id == existing).Select(c => c.Name).SingleAsync());
        var before = await _f.WithDbAsync(db => db.Clubs.CountAsync());

        var dto = await (await admin.PostAsJsonAsync("/api/clubs", new { name = $" {name} " })).ReadAsync<ClubDto>();

        Assert.Equal(existing, dto.Id);
        Assert.Equal(before, await _f.WithDbAsync(db => db.Clubs.CountAsync()));
    }
}
