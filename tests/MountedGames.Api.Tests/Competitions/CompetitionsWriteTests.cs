using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Competitions;

public class CompetitionsWriteTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public CompetitionsWriteTests(ApiFactory f) => _f = f;

    private static readonly DateTime Start = new(2031, 5, 4, 0, 0, 0, DateTimeKind.Utc);

    private static object CreateBody(string name = "Created comp", double? lat = null, double? lon = null,
        string? apple = null, string? postcode = null, string? w3w = null, string? icon = null,
        string? stream = null, string? organiser = null, string? payment = null) => new
    {
        name,
        location = "Somewhere",
        description = "Desc",
        latitude = lat,
        longitude = lon,
        what3Words = w3w,
        appleMapsUrl = apple,
        startDate = Start,
        endDate = Start.AddDays(1),
        postcode,
        streamUrl = stream,
        organiserName = organiser,
        paymentDestination = payment,
        icon,
    };

    private static object UpdateBody(string name = "Updated comp", double? lat = null, double? lon = null,
        string? apple = null, string? postcode = null, string? w3w = null, string? icon = null,
        string? stream = null, string? organiser = null, string? payment = null,
        bool isActive = true, bool isArchived = false) => new
    {
        name,
        location = "Elsewhere",
        description = "New desc",
        latitude = lat,
        longitude = lon,
        what3Words = w3w,
        appleMapsUrl = apple,
        startDate = Start,
        endDate = (DateTime?)null,
        isActive,
        isArchived,
        postcode,
        streamUrl = stream,
        organiserName = organiser,
        paymentDestination = payment,
        icon,
    };

    private async Task<Competition> LoadAsync(int id)
        => await _f.WithDbAsync(db => db.Competitions.AsNoTracking().SingleAsync(c => c.Id == id));

    // ---- create ----

    [Fact]
    public async Task Create_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/competitions", CreateBody());
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Create_Returns403_ForMember()
    {
        var (member, _) = await _f.SignupAsync("Member");
        var r = await member.PostAsJsonAsync("/api/competitions", CreateBody());
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Create_Returns400_WhenIconInvalid()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/competitions", CreateBody(icon: "banana"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Theory]
    [InlineData("xx")]
    [InlineData("../x")]
    public async Task Create_Returns400_WhenIconUnknown(string icon)
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/competitions", CreateBody(icon: icon));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_AcceptsFlagImageIcon()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/competitions", CreateBody(icon: "gb-sct"));
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
    }

    [Fact]
    public async Task Create_Returns400_WhenNameMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/competitions", new { startDate = Start });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_PersistsTrimmedFieldsAndCreator_ForTrainer()
    {
        var auth = await _f.LoginAsync(TestClients.TrainerEmail, TestClients.TrainerPassword);
        var client = _f.WithToken(auth.Token);

        var r = await client.PostAsJsonAsync("/api/competitions", CreateBody(
            name: "Trainer comp", lat: 51.5, lon: -0.1, icon: "gb",
            stream: "  https://stream.example/live  ", organiser: " Org ", payment: " Pay me ",
            w3w: "  a.b.c ", apple: "  https://maps.apple.com/?ll=1,2  "));

        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        var summary = await r.ReadAsync<CompetitionSummary>();
        var c = await LoadAsync(summary.Id);
        Assert.Equal("Trainer comp", c.Name);
        Assert.Equal("gb", c.Icon);
        Assert.Equal(51.5, c.Latitude);
        Assert.Equal(-0.1, c.Longitude);
        Assert.Equal("https://stream.example/live", c.StreamUrl);
        Assert.Equal("Org", c.OrganiserName);
        Assert.Equal("Pay me", c.PaymentDestination);
        Assert.Equal("a.b.c", c.What3Words);
        Assert.Equal("https://maps.apple.com/?ll=1,2", c.AppleMapsUrl);
        Assert.Equal(auth.User.Id, c.CreatedByUserId);
        Assert.Contains($"/api/competitions/{summary.Id}", r.Headers.Location!.ToString());
    }

    [Fact]
    public async Task Create_DefaultsIconAndNullsBlankOptionals()
    {
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync("/api/competitions",
            CreateBody(stream: "  ", organiser: "", payment: " ", w3w: " ", apple: " "));

        var c = await LoadAsync((await r.ReadAsync<CompetitionSummary>()).Id);
        Assert.Equal("flag", c.Icon);
        Assert.Null(c.StreamUrl);
        Assert.Null(c.OrganiserName);
        Assert.Null(c.PaymentDestination);
        Assert.Null(c.What3Words);
        Assert.Null(c.AppleMapsUrl);
        Assert.Null(c.Latitude);
    }

    [Theory]
    [InlineData("https://maps.apple.com/?ll=51.5,-0.12", 51.5, -0.12)]
    [InlineData("https://maps.apple.com/?q=52.25, -1.5", 52.25, -1.5)]
    [InlineData("https://maps.apple.com/place/@53.1,-2.2,15z", 53.1, -2.2)]
    public async Task Create_TakesCoordinatesFromAppleMapsUrl(string url, double lat, double lon)
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/competitions", CreateBody(apple: url));
        var c = await LoadAsync((await r.ReadAsync<CompetitionSummary>()).Id);
        Assert.Equal(lat, c.Latitude);
        Assert.Equal(lon, c.Longitude);
    }

    [Theory]
    [InlineData("not a url at all")]
    [InlineData("https://maps.apple.com/?q=Some%20Pub")]
    [InlineData("https://maps.apple.com/?ll=abc,def")]
    [InlineData("https://maps.apple.com/place/nowhere")]
    public async Task Create_LeavesCoordinatesEmpty_WhenAppleMapsUrlHasNone(string url)
    {
        _f.Http.Reset();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/competitions", CreateBody(apple: url));
        var c = await LoadAsync((await r.ReadAsync<CompetitionSummary>()).Id);
        Assert.Null(c.Latitude);
        Assert.Null(c.Longitude);
    }

    [Fact]
    public async Task Create_KeepsSuppliedLatitude_AndFillsLongitudeFromAppleMaps()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/competitions",
            CreateBody(lat: 10, apple: "https://maps.apple.com/?ll=20,30"));
        var c = await LoadAsync((await r.ReadAsync<CompetitionSummary>()).Id);
        Assert.Equal(10, c.Latitude);
        Assert.Equal(30, c.Longitude);
    }

    [Fact]
    public async Task Create_GeocodesPostcode_WhenNoCoordinatesGiven()
    {
        _f.Http.Reset();
        _f.Http.RespondJson("postcodes.io", """{"result":{"latitude":52.5,"longitude":-1.9}}""");
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync("/api/competitions", CreateBody(postcode: "B1 1AA"));

        var c = await LoadAsync((await r.ReadAsync<CompetitionSummary>()).Id);
        Assert.Equal(52.5, c.Latitude);
        Assert.Equal(-1.9, c.Longitude);
    }

    // ---- update ----

    [Fact]
    public async Task Update_Returns401_WhenAnonymous()
    {
        var comp = await _f.SeedCompetitionAsync();
        var r = await _f.CreateClient().PutAsJsonAsync($"/api/competitions/{comp}", UpdateBody());
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Update_Returns403_ForMember()
    {
        var comp = await _f.SeedCompetitionAsync();
        var (member, _) = await _f.SignupAsync("Member");
        var r = await member.PutAsJsonAsync($"/api/competitions/{comp}", UpdateBody());
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Update_Returns404_WhenCompetitionMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync("/api/competitions/999999", UpdateBody());
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Update_AppliesAllFields_AndKeepsIconWhenOmitted()
    {
        var comp = await _f.SeedCompetitionAsync(ownerUserId: await _f.TrainerIdAsync());
        await _f.WithDbAsync(async db =>
        {
            var c = await db.Competitions.SingleAsync(x => x.Id == comp);
            c.Icon = "trophy";
            await db.SaveChangesAsync();
        });
        var trainer = await _f.TrainerAsync();

        var r = await trainer.PutAsJsonAsync($"/api/competitions/{comp}", UpdateBody(
            lat: 1.5, lon: 2.5, stream: " s ", organiser: " o ", payment: " p ", w3w: " w ",
            apple: " https://maps.apple.com/ ", isActive: false, isArchived: true));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var summary = await r.ReadAsync<CompetitionSummary>();
        Assert.True(summary.IsArchived);
        Assert.False(summary.IsActive);
        var c2 = await LoadAsync(comp);
        Assert.Equal("Updated comp", c2.Name);
        Assert.Equal("trophy", c2.Icon);
        Assert.Equal("Elsewhere", c2.Location);
        Assert.Equal(1.5, c2.Latitude);
        Assert.Equal(2.5, c2.Longitude);
        Assert.Equal("s", c2.StreamUrl);
        Assert.Equal("o", c2.OrganiserName);
        Assert.Equal("p", c2.PaymentDestination);
        Assert.Equal("w", c2.What3Words);
        Assert.Equal("https://maps.apple.com/", c2.AppleMapsUrl);
        Assert.Null(c2.EndDate);
    }

    [Fact]
    public async Task Update_ChangesIcon_WhenSupplied()
    {
        var comp = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/competitions/{comp}", UpdateBody(icon: "world"));
        Assert.Equal("world", (await LoadAsync(comp)).Icon);
    }

    [Fact]
    public async Task Update_ClearsBlankOptionals()
    {
        var comp = await _f.SeedCompetitionAsync();
        await _f.WithDbAsync(async db =>
        {
            var c = await db.Competitions.SingleAsync(x => x.Id == comp);
            c.StreamUrl = "x"; c.OrganiserName = "x"; c.PaymentDestination = "x"; c.What3Words = "x"; c.AppleMapsUrl = "x";
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();

        await admin.PutAsJsonAsync($"/api/competitions/{comp}",
            UpdateBody(stream: " ", organiser: "", payment: " ", w3w: "", apple: " "));

        var c2 = await LoadAsync(comp);
        Assert.Null(c2.StreamUrl);
        Assert.Null(c2.OrganiserName);
        Assert.Null(c2.PaymentDestination);
        Assert.Null(c2.What3Words);
        Assert.Null(c2.AppleMapsUrl);
    }

    [Fact]
    public async Task Update_TakesCoordinatesFromAppleMapsUrl()
    {
        var comp = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync($"/api/competitions/{comp}", UpdateBody(apple: "https://maps.apple.com/?ll=40.5,-3.5"));
        var c = await LoadAsync(comp);
        Assert.Equal(40.5, c.Latitude);
        Assert.Equal(-3.5, c.Longitude);
    }

    [Fact]
    public async Task Update_GeocodesPostcode_WhenNoCoordinatesAvailable()
    {
        _f.Http.Reset();
        _f.Http.RespondJson("postcodes.io", """{"result":{"latitude":53.5,"longitude":-2.5}}""");
        var comp = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();

        await admin.PutAsJsonAsync($"/api/competitions/{comp}", UpdateBody(postcode: "M1 1AA"));

        var c = await LoadAsync(comp);
        Assert.Equal(53.5, c.Latitude);
        Assert.Equal(-2.5, c.Longitude);
    }

    [Fact]
    public async Task Update_ChangesIcon_ToFlagImage()
    {
        var comp = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync($"/api/competitions/{comp}", UpdateBody(icon: "gb-sct"));
        Assert.True(r.IsSuccessStatusCode);
        Assert.Equal("gb-sct", (await LoadAsync(comp)).Icon);
    }

    [Theory]
    [InlineData("xx")]
    [InlineData("../x")]
    public async Task Update_Returns400_WhenIconUnknown(string icon)
    {
        var comp = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync($"/api/competitions/{comp}", UpdateBody(icon: icon));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Update_Returns400_WhenIconInvalid()
    {
        var comp = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync($"/api/competitions/{comp}", UpdateBody(icon: "nope"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    // ---- signups-locked ----

    [Fact]
    public async Task SignupsLocked_Returns401_WhenAnonymous()
    {
        var comp = await _f.SeedCompetitionAsync();
        var r = await _f.CreateClient().PostAsJsonAsync($"/api/competitions/{comp}/signups-locked", new { locked = true });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task SignupsLocked_Returns403_ForMember()
    {
        var comp = await _f.SeedCompetitionAsync();
        var (member, _) = await _f.SignupAsync("Member");
        var r = await member.PostAsJsonAsync($"/api/competitions/{comp}/signups-locked", new { locked = true });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task SignupsLocked_Returns404_WhenCompetitionMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/competitions/999999/signups-locked", new { locked = true });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task OrganiserWrites_Return404_ForTrainerWhoDidNotCreateTheCompetition()
    {
        var comp = await _f.SeedCompetitionAsync();
        var trainer = await _f.TrainerAsync();

        var locked = await trainer.PostAsJsonAsync($"/api/competitions/{comp}/signups-locked", new { locked = true });
        var section = await trainer.PostAsJsonAsync($"/api/competitions/{comp}/sections", new { format = 2, ageGroup = "U9" });

        Assert.Equal((HttpStatusCode.NotFound, HttpStatusCode.NotFound), (locked.StatusCode, section.StatusCode));
        Assert.False((await LoadAsync(comp)).SignupsLocked);
    }

    [Fact]
    public async Task SignupsLocked_TogglesFlag()
    {
        var comp = await _f.SeedCompetitionAsync(ownerUserId: await _f.TrainerIdAsync());
        var trainer = await _f.TrainerAsync();

        var locked = await trainer.PostAsJsonAsync($"/api/competitions/{comp}/signups-locked", new { locked = true });
        Assert.True((await locked.ReadAsync<JsonElement>()).GetProperty("signupsLocked").GetBoolean());
        Assert.True((await LoadAsync(comp)).SignupsLocked);

        await trainer.PostAsJsonAsync($"/api/competitions/{comp}/signups-locked", new { locked = false });
        Assert.False((await LoadAsync(comp)).SignupsLocked);
    }

    // ---- add section ----

    [Fact]
    public async Task AddSection_Returns401_WhenAnonymous()
    {
        var comp = await _f.SeedCompetitionAsync();
        var r = await _f.CreateClient().PostAsJsonAsync($"/api/competitions/{comp}/sections", new { format = 2, ageGroup = "U9" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task AddSection_Returns403_ForMember()
    {
        var comp = await _f.SeedCompetitionAsync();
        var (member, _) = await _f.SignupAsync("Member");
        var r = await member.PostAsJsonAsync($"/api/competitions/{comp}/sections", new { format = 2, ageGroup = "U9" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task AddSection_Returns404_WhenCompetitionMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/competitions/999999/sections", new { format = 2, ageGroup = "U9" });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task AddSection_BuildsDisplayName_WhenNoneGiven()
    {
        var comp = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/sections", new { format = 1, ageGroup = "Under 15" });

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<CompetitionSectionDto>();
        Assert.Equal("Under 15 Pairs", dto.DisplayName);
        Assert.Equal(comp, dto.CompetitionId);
        Assert.Equal(0, dto.PriceMinor);
        Assert.Null(dto.MaxParticipants);
        Assert.False(dto.UsesRaceFinals);
    }

    [Fact]
    public async Task AddSection_PersistsSuppliedOptions()
    {
        var comp = await _f.SeedCompetitionAsync(ownerUserId: await _f.TrainerIdAsync());
        var trainer = await _f.TrainerAsync();

        var r = await trainer.PostAsJsonAsync($"/api/competitions/{comp}/sections", new
        {
            format = 2, ageGroup = "Open", displayName = "Custom name", runoffRaceName = "  Bending  ",
            usesRaceFinals = true, priceMinor = 1500, maxParticipants = 12, finalistCount = 6,
        });

        var dto = await r.ReadAsync<CompetitionSectionDto>();
        Assert.Equal("Open", dto.DisplayName);
        Assert.Equal("Bending", dto.RunoffRaceName);
        Assert.True(dto.UsesRaceFinals);
        Assert.Equal(1500, dto.PriceMinor);
        Assert.Equal(12, dto.MaxParticipants);
        Assert.Equal(6, dto.FinalistCount);
    }

    [Fact]
    public async Task AddSection_ClampsNegativePriceAndNonPositiveMax()
    {
        var comp = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/sections",
            new { format = 2, ageGroup = "U9", priceMinor = -500, maxParticipants = 0, runoffRaceName = " " });

        var dto = await r.ReadAsync<CompetitionSectionDto>();
        Assert.Equal(0, dto.PriceMinor);
        Assert.Null(dto.MaxParticipants);
        Assert.Null(dto.RunoffRaceName);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(51)]
    public async Task AddSection_Returns400_WhenFinalistCountOutOfRange(int finalists)
    {
        var comp = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync($"/api/competitions/{comp}/sections",
            new { format = 2, ageGroup = "U9", finalistCount = finalists });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    // ---- update section ----

    [Fact]
    public async Task UpdateSection_Returns401_WhenAnonymous()
    {
        var comp = await _f.SeedCompetitionAsync();
        var sec = await _f.SeedSectionAsync(comp);
        var r = await _f.CreateClient().PutAsJsonAsync($"/api/competitions/{comp}/sections/{sec}", new { runoffRaceName = "x" });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task UpdateSection_Returns403_ForMember()
    {
        var comp = await _f.SeedCompetitionAsync();
        var sec = await _f.SeedSectionAsync(comp);
        var (member, _) = await _f.SignupAsync("Member");
        var r = await member.PutAsJsonAsync($"/api/competitions/{comp}/sections/{sec}", new { runoffRaceName = "x" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task UpdateSection_Returns404_WhenSectionBelongsToAnotherCompetition()
    {
        var comp = await _f.SeedCompetitionAsync();
        var other = await _f.SeedCompetitionAsync();
        var sec = await _f.SeedSectionAsync(other);
        var admin = await _f.AdminAsync();
        var r = await admin.PutAsJsonAsync($"/api/competitions/{comp}/sections/{sec}", new { runoffRaceName = "x" });
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task UpdateSection_AppliesProvidedFields()
    {
        var comp = await _f.SeedCompetitionAsync();
        var sec = await _f.SeedSectionAsync(comp);
        var admin = await _f.AdminAsync();

        var r = await admin.PutAsJsonAsync($"/api/competitions/{comp}/sections/{sec}", new
        {
            runoffRaceName = " Tie-break ", usesRaceFinals = true, priceMinor = 2000, maxParticipants = 8, finalistCount = 4,
        });

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<CompetitionSectionDto>();
        Assert.Equal("Tie-break", dto.RunoffRaceName);
        Assert.True(dto.UsesRaceFinals);
        Assert.Equal(2000, dto.PriceMinor);
        Assert.Equal(8, dto.MaxParticipants);
        Assert.Equal(4, dto.FinalistCount);
    }

    [Fact]
    public async Task UpdateSection_LeavesOptionalFieldsAlone_ButClearsOmittedFinalistCountAndRunoff()
    {
        var comp = await _f.SeedCompetitionAsync();
        var sec = await _f.SeedSectionAsync(comp);
        await _f.WithDbAsync(async db =>
        {
            var s = await db.CompetitionSections.SingleAsync(x => x.Id == sec);
            s.UsesRaceFinals = true; s.PriceMinor = 700; s.MaxParticipants = 5; s.FinalistCount = 3; s.RunoffRaceName = "old";
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();

        await admin.PutAsJsonAsync($"/api/competitions/{comp}/sections/{sec}", new { });

        var s2 = await _f.WithDbAsync(db => db.CompetitionSections.AsNoTracking().SingleAsync(x => x.Id == sec));
        Assert.True(s2.UsesRaceFinals);
        Assert.Equal(700, s2.PriceMinor);
        Assert.Equal(5, s2.MaxParticipants);
        Assert.Null(s2.FinalistCount);
        Assert.Null(s2.RunoffRaceName);
    }

    [Fact]
    public async Task UpdateSection_ClampsNegativePrice_AndClearsNonPositiveMax()
    {
        var comp = await _f.SeedCompetitionAsync();
        var sec = await _f.SeedSectionAsync(comp);
        await _f.WithDbAsync(async db =>
        {
            (await db.CompetitionSections.SingleAsync(x => x.Id == sec)).MaxParticipants = 9;
            await db.SaveChangesAsync();
        });
        var admin = await _f.AdminAsync();

        var r = await admin.PutAsJsonAsync($"/api/competitions/{comp}/sections/{sec}", new { priceMinor = -1, maxParticipants = 0 });

        var dto = await r.ReadAsync<CompetitionSectionDto>();
        Assert.Equal(0, dto.PriceMinor);
        Assert.Null(dto.MaxParticipants);
    }

    // ---- delete ----

    [Fact]
    public async Task Delete_Returns401_WhenAnonymous()
    {
        var comp = await _f.SeedCompetitionAsync();
        var r = await _f.CreateClient().DeleteAsync($"/api/competitions/{comp}");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Delete_Returns403_ForTrainer()
    {
        var comp = await _f.SeedCompetitionAsync();
        var trainer = await _f.TrainerAsync();
        var r = await trainer.DeleteAsync($"/api/competitions/{comp}");
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Delete_Returns404_WhenCompetitionMissing()
    {
        var admin = await _f.AdminAsync();
        var r = await admin.DeleteAsync("/api/competitions/999999");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    private async Task<(int Comp, int Section, int Team, int Session, int Form)> BuildFullGraphAsync()
    {
        var comp = await _f.SeedCompetitionAsync();
        var section = await _f.SeedSectionAsync(comp);
        var club = await _f.SeedClubAsync();
        var team = await _f.SeedTeamAsync(comp, section, club);
        var session = await _f.SeedScoredRaceAsync(comp, section, new (int, int?, bool, int)[] { (team, 1, false, 3) });
        var form = await _f.WithDbAsync(async db =>
        {
            var heat = await db.Heats.FirstAsync(h => h.SessionId == session);
            db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = team, LaneIndex = 1 });
            db.ChatMessages.Add(new ChatMessage { CompetitionId = comp, AuthorName = "x", Body = "hello" });
            var f = new DeclarationForm { TeamId = team };
            f.Riders.Add(new RiderEntry { FullName = "Rider One", OrderIndex = 0 });
            db.DeclarationForms.Add(f);
            await db.SaveChangesAsync();
            return f.Id;
        });
        return (comp, section, team, session, form);
    }

    [Fact]
    public async Task Delete_RemovesCompetitionAndEveryDependentRow()
    {
        var (comp, section, team, session, form) = await BuildFullGraphAsync();
        var admin = await _f.AdminAsync();

        var r = await admin.DeleteAsync($"/api/competitions/{comp}");

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        await _f.WithDbAsync(async db =>
        {
            Assert.False(await db.Competitions.AnyAsync(c => c.Id == comp));
            Assert.False(await db.CompetitionSections.AnyAsync(s => s.Id == section));
            Assert.False(await db.Teams.AnyAsync(t => t.Id == team));
            Assert.False(await db.Sessions.AnyAsync(s => s.Id == session));
            Assert.False(await db.DeclarationForms.AnyAsync(d => d.Id == form));
            Assert.False(await db.ChatMessages.AnyAsync(m => m.CompetitionId == comp));
            Assert.False(await db.Results.AnyAsync(x => x.TeamId == team));
            Assert.False(await db.HeatEntries.AnyAsync(x => x.TeamId == team));
            Assert.False(await db.RiderEntries.AnyAsync(x => x.FullName == "Rider One" && x.DeclarationFormId == form));
        });
    }

    // ---- delete section ----

    [Fact]
    public async Task DeleteSection_Returns401_WhenAnonymous()
    {
        var comp = await _f.SeedCompetitionAsync();
        var sec = await _f.SeedSectionAsync(comp);
        var r = await _f.CreateClient().DeleteAsync($"/api/competitions/{comp}/sections/{sec}");
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task DeleteSection_Returns403_ForTrainer()
    {
        var comp = await _f.SeedCompetitionAsync();
        var sec = await _f.SeedSectionAsync(comp);
        var trainer = await _f.TrainerAsync();
        var r = await trainer.DeleteAsync($"/api/competitions/{comp}/sections/{sec}");
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task DeleteSection_Returns404_WhenSectionInOtherCompetition()
    {
        var comp = await _f.SeedCompetitionAsync();
        var other = await _f.SeedCompetitionAsync();
        var sec = await _f.SeedSectionAsync(other);
        var admin = await _f.AdminAsync();
        var r = await admin.DeleteAsync($"/api/competitions/{comp}/sections/{sec}");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task DeleteSection_RemovesSectionTeamsSessionsAndForms_ButKeepsCompetition()
    {
        var (comp, section, team, session, form) = await BuildFullGraphAsync();
        var admin = await _f.AdminAsync();

        var withoutForce = await admin.DeleteAsync($"/api/competitions/{comp}/sections/{section}");
        Assert.Equal(HttpStatusCode.BadRequest, withoutForce.StatusCode);

        var r = await admin.DeleteAsync($"/api/competitions/{comp}/sections/{section}?force=true");

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        await _f.WithDbAsync(async db =>
        {
            Assert.True(await db.Competitions.AnyAsync(c => c.Id == comp));
            Assert.False(await db.CompetitionSections.AnyAsync(s => s.Id == section));
            Assert.False(await db.Teams.AnyAsync(t => t.Id == team));
            Assert.False(await db.Sessions.AnyAsync(s => s.Id == session));
            Assert.False(await db.DeclarationForms.AnyAsync(d => d.Id == form));
            Assert.False(await db.Results.AnyAsync(x => x.TeamId == team));
        });
    }
}
