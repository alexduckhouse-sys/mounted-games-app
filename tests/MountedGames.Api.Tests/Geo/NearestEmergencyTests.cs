using System.Net;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Geo;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Geo;

/// <summary>The nearest-A&amp;E lookup for the emergency poster, with Overpass and postcodes.io stubbed.</summary>
public class NearestEmergencyTests : IClassFixture<ApiFactory>
{
    private const string Overpass = "overpass-api.de";
    private const string ReverseLookup = "postcodes?lon=";

    private readonly ApiFactory _f;
    public NearestEmergencyTests(ApiFactory f) => _f = f;

    private async Task<int> VenueAsync(double? lat, double? lon, string? postcode = null, bool ownedByTrainer = true)
        => await _f.WithDbAsync(async db =>
        {
            var owner = ownedByTrainer ? await _f.TrainerIdAsync() : null;
            var c = new Competition
            {
                Name = $"A&E venue {Guid.NewGuid():N}",
                StartDate = DateTime.UtcNow.Date.AddDays(30),
                CreatedByUserId = owner,
                Latitude = lat,
                Longitude = lon,
                Postcode = postcode,
            };
            db.Competitions.Add(c);
            await db.SaveChangesAsync();
            return c.Id;
        });

    private async Task<(HttpStatusCode Status, NearestEmergencyDto Body)> AskAsync(int competitionId)
    {
        var admin = await _f.AdminAsync();
        var response = await admin.GetAsync($"/api/competitions/{competitionId}/nearest-emergency");
        return (response.StatusCode, response.IsSuccessStatusCode ? await response.ReadAsync<NearestEmergencyDto>() : null!);
    }

    private int OverpassCalls => _f.Http.Requests.Count(r => r.Contains(Overpass));

    private static string Hospitals(params string[] elements) => "{\"version\":0.6,\"elements\":[" + string.Join(",", elements) + "]}";

    private static string Node(long id, string name, double lat, double lon, string extraTags = "")
        => FormattableString.Invariant($"{{\"type\":\"node\",\"id\":{id},\"lat\":{lat},\"lon\":{lon},\"tags\":{{\"amenity\":\"hospital\",\"emergency\":\"yes\",\"name\":\"{name}\"{extraTags}}}}}");

    private static double Miles(double lat1, double lon1, double lat2, double lon2)
        => Math.Round(new GeoPoint(lat1, lon1).MilesTo(lat2, lon2), 1);

    [Fact]
    public async Task PicksTheNearestNamedHospital_ByStraightLineDistance_AndFillsInItsDetails()
    {
        _f.Http.Reset();
        _f.Http.RespondJson(ReverseLookup, """{"status":200,"result":[{"postcode":"cv2 2dx"}]}""");
        _f.Http.RespondJson(Overpass, Hospitals(
            Node(1, "Far General", 52.30, -1.30, ",\"addr:postcode\":\"FA1 1AA\""),
            // Closest of all, but nameless, so it can't be used.
            """{"type":"node","id":9,"lat":52.101,"lon":-1.101,"tags":{"amenity":"hospital","emergency":"yes"}}""",
            // A way without a centre has no position.
            """{"type":"way","id":8,"tags":{"name":"Nowhere Hospital","amenity":"hospital"}}""",
            // A way is placed by its centre.
            """{"type":"way","id":2,"center":{"lat":52.12,"lon":-1.12},"tags":{"amenity":"hospital","emergency":"yes","name":"Near General","addr:housenumber":"1","addr:street":"High Street","addr:city":"Townsville","phone":"01234 567890; 01234 000000"}}"""));
        var id = await VenueAsync(52.1, -1.1);

        var (status, body) = await AskAsync(id);

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.True(body.Available);
        var hospital = Assert.IsType<NearestHospitalDto>(body.Hospital);
        Assert.Equal("Near General", hospital.Name);
        Assert.Equal("1 High Street, Townsville", hospital.Address);
        Assert.Equal("01234 567890", hospital.Phone);
        // OpenStreetMap had no postcode for it, so postcodes.io supplied one.
        Assert.Equal("CV2 2DX", hospital.Postcode);
        Assert.Equal(Miles(52.1, -1.1, 52.12, -1.12), hospital.DistanceMiles);
        Assert.Equal((52.12, -1.12), (hospital.Latitude, hospital.Longitude));
    }

    [Fact]
    public async Task UsesTheHospitalsOwnPostcode_WithoutAskingPostcodesIo()
    {
        _f.Http.Reset();
        _f.Http.RespondJson(Overpass, Hospitals(Node(1, "Tagged Hospital", 53.21, -2.31, ",\"addr:postcode\":\"ab1 2cd\",\"contact:phone\":\"+44 1234 111222\",\"addr:full\":\"Hospital Lane, Elsewhere\"")));
        var id = await VenueAsync(53.2, -2.3);

        var (_, body) = await AskAsync(id);

        var hospital = Assert.IsType<NearestHospitalDto>(body.Hospital);
        Assert.Equal(("AB1 2CD", "+44 1234 111222", "Hospital Lane, Elsewhere"), (hospital.Postcode, hospital.Phone, hospital.Address));
        Assert.DoesNotContain(_f.Http.Requests, r => r.Contains(ReverseLookup));
    }

    [Fact]
    public async Task StillAnswers_WhenNoPostcodeCanBeFoundForTheHospital()
    {
        _f.Http.Reset();
        _f.Http.RespondJson(ReverseLookup, """{"status":200,"result":null}""");
        _f.Http.RespondJson(Overpass, Hospitals(Node(1, "No Postcode Hospital", 54.11, -3.11)));
        var noPostcode = await AskAsync(await VenueAsync(54.1, -3.1));

        _f.Http.Reset();
        _f.Http.RespondJson(ReverseLookup, "{}", HttpStatusCode.InternalServerError);
        _f.Http.RespondJson(Overpass, Hospitals(Node(1, "Still Here", 54.61, -3.61)));
        var lookupDown = await AskAsync(await VenueAsync(54.6, -3.6));

        _f.Http.Reset();
        _f.Http.Throw(ReverseLookup);
        _f.Http.RespondJson(Overpass, Hospitals(Node(1, "Still Here Too", 55.11, -3.61)));
        var lookupThrows = await AskAsync(await VenueAsync(55.1, -3.6));

        _f.Http.Reset();
        _f.Http.RespondJson(ReverseLookup, """{"status":200,"result":[{"postcode":" "},{"distance":3}]}""");
        _f.Http.RespondJson(Overpass, Hospitals(Node(1, "Empty List", 55.61, -3.11)));
        var nothingUsable = await AskAsync(await VenueAsync(55.6, -3.1));

        Assert.All(new[] { noPostcode, lookupDown, lookupThrows, nothingUsable }, r =>
        {
            Assert.True(r.Body.Available);
            Assert.Null(Assert.IsType<NearestHospitalDto>(r.Body.Hospital).Postcode);
        });
        Assert.Equal("Still Here Too", lookupThrows.Body.Hospital!.Name);
    }

    [Fact]
    public async Task AsksOverpassForEmergencyHospitalsWithin40km_AsAnIdentifiedPost()
    {
        _f.Http.Reset();
        string? body = null, method = null, agent = null;
        _f.Http.Respond(Overpass, request =>
        {
            method = request.Method.Method;
            agent = request.Headers.UserAgent.ToString();
            body = request.Content!.ReadAsStringAsync().Result;
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Hospitals(), System.Text.Encoding.UTF8, "application/json") };
        });
        var id = await VenueAsync(51.4123, -0.7456);

        await AskAsync(id);

        var query = Uri.UnescapeDataString(body!.Replace('+', ' '));
        Assert.Equal("POST", method);
        Assert.Contains("MountedGamesApp", agent);
        Assert.Contains("\"amenity\"=\"hospital\"", query);
        Assert.Contains("\"emergency\"=\"yes\"", query);
        Assert.Contains("around:40000,51.412,-0.746", query);
        Assert.DoesNotContain("51.4123", query);
    }

    [Fact]
    public async Task NothingInRange_IsAnAnswerAndIsCached()
    {
        _f.Http.Reset();
        _f.Http.RespondJson(Overpass, Hospitals());
        var id = await VenueAsync(58.1, -5.1);

        var first = await AskAsync(id);
        var second = await AskAsync(id);

        Assert.Equal(new NearestEmergencyDto(true, null), first.Body);
        Assert.Equal(first.Body, second.Body);
        Assert.Equal(1, OverpassCalls);
    }

    [Fact]
    public async Task ASecondAsk_IsServedFromTheCache_AndSoIsAVenueRoundedToTheSamePlace()
    {
        _f.Http.Reset();
        _f.Http.RespondJson(Overpass, Hospitals(Node(1, "Cached General", 50.61, -1.61)));
        var id = await VenueAsync(50.6, -1.6);
        var nextDoor = await VenueAsync(50.60004, -1.60004);
        var elsewhere = await VenueAsync(50.7, -1.6);

        var first = await AskAsync(id);
        var again = await AskAsync(id);
        var neighbour = await AskAsync(nextDoor);
        Assert.Equal(1, OverpassCalls);
        await AskAsync(elsewhere);

        Assert.Equal("Cached General", first.Body.Hospital!.Name);
        Assert.Equal(first.Body, again.Body);
        Assert.Equal(first.Body, neighbour.Body);
        Assert.Equal(2, OverpassCalls);
    }

    [Fact]
    public async Task ResolvesThePostcode_WhenTheVenueHasNoPosition()
    {
        _f.Http.Reset();
        _f.Http.RespondJson("postcodes.io/postcodes/CV8", """{"result":{"latitude":52.35,"longitude":-1.55}}""");
        _f.Http.RespondJson(Overpass, Hospitals(Node(1, "Postcode General", 52.36, -1.56, ",\"addr:postcode\":\"CV1 1AA\"")));
        var id = await VenueAsync(null, null, "CV8 2LG");

        var (_, body) = await AskAsync(id);

        Assert.Equal("Postcode General", body.Hospital!.Name);
        Assert.Contains(_f.Http.Requests, r => r.Contains("postcodes.io/postcodes/CV8"));
    }

    [Fact]
    public async Task NoPositionAndNoUsablePostcode_IsOkWithNoHospital_AndAsksNobody()
    {
        _f.Http.Reset();
        var neither = await AskAsync(await VenueAsync(null, null));
        var blank = await AskAsync(await VenueAsync(null, null, "  "));
        var halfAPosition = await AskAsync(await VenueAsync(52.0, null));
        var offTheGlobe = await AskAsync(await VenueAsync(95, 10));
        _f.Http.RespondJson("postcodes.io/postcodes/ZZ", """{"status":404,"error":"Postcode not found"}""", HttpStatusCode.NotFound);
        var unknownPostcode = await AskAsync(await VenueAsync(null, null, "ZZ9 9ZZ"));

        Assert.All(new[] { neither, blank, halfAPosition, offTheGlobe, unknownPostcode }, r =>
        {
            Assert.Equal(HttpStatusCode.OK, r.Status);
            Assert.Equal(new NearestEmergencyDto(false, null), r.Body);
        });
        Assert.Equal(0, OverpassCalls);
    }

    [Fact]
    public async Task WhenOverpassFails_TheAnswerIsStillOk_NotAvailable_AndNotRemembered()
    {
        var bad = new (string Name, Action Arrange)[]
        {
            ("rate limited", () => _f.Http.RespondJson(Overpass, "{}", HttpStatusCode.TooManyRequests)),
            ("gateway timeout", () => _f.Http.RespondJson(Overpass, "<html>timeout</html>", HttpStatusCode.GatewayTimeout)),
            ("network down", () => _f.Http.Throw(Overpass)),
            ("timed out", () => _f.Http.Respond(Overpass, _ => throw new TaskCanceledException("The request timed out."))),
            ("not json", () => _f.Http.RespondJson(Overpass, "<html>busy</html>")),
            ("no elements", () => _f.Http.RespondJson(Overpass, """{"version":0.6}""")),
            ("elements not a list", () => _f.Http.RespondJson(Overpass, """{"elements":{}}""")),
            ("not an object", () => _f.Http.RespondJson(Overpass, "[]")),
            ("ran out of time", () => _f.Http.RespondJson(Overpass, """{"elements":[],"remark":"runtime error: Query timed out"}""")),
        };
        var id = await VenueAsync(56.1, -4.1);

        foreach (var (name, arrange) in bad)
        {
            _f.Http.Reset();
            arrange();
            var (status, body) = await AskAsync(id);
            Assert.True(HttpStatusCode.OK == status && body == new NearestEmergencyDto(false, null), name);
        }

        // Nothing was cached, so the next ask goes back to Overpass and now succeeds.
        _f.Http.Reset();
        _f.Http.RespondJson(Overpass, Hospitals(Node(1, "Back Up", 56.11, -4.11, ",\"addr:postcode\":\"BU1 1AA\"")));
        var recovered = await AskAsync(id);
        Assert.Equal("Back Up", recovered.Body.Hospital!.Name);
    }

    [Fact]
    public async Task SkipsOddlyShapedElements_AndOverlongText()
    {
        _f.Http.Reset();
        var longName = new string('H', 500);
        _f.Http.RespondJson(Overpass, Hospitals(
            "42", "{\"type\":\"node\",\"id\":1,\"lat\":57.1,\"lon\":-2.1}", "{\"id\":2,\"tags\":[]}",
            "{\"id\":3,\"lat\":\"57.1\",\"lon\":-2.1,\"tags\":{\"name\":\"Text position\"}}",
            "{\"id\":4,\"lat\":95,\"lon\":-2.1,\"tags\":{\"name\":\"Off the globe\"}}",
            "{\"id\":5,\"lat\":57.2,\"lon\":-2.2,\"tags\":{\"name\":\"" + longName + "\",\"phone\":\";\",\"addr:street\":\"\",\"addr:postcode\":\"AB1 1AB\"}}"));
        var id = await VenueAsync(57.1, -2.1);

        var (_, body) = await AskAsync(id);

        var hospital = Assert.IsType<NearestHospitalDto>(body.Hospital);
        Assert.Equal(200, hospital.Name.Length);
        Assert.Null(hospital.Phone);
        Assert.Null(hospital.Address);
    }

    [Fact]
    public async Task OnlyTheEventsOrganisers_CanAsk()
    {
        _f.Http.Reset();
        _f.Http.RespondJson(Overpass, Hospitals(Node(1, "Organiser General", 59.11, -4.11, ",\"addr:postcode\":\"OG1 1AA\"")));
        var id = await VenueAsync(59.1, -4.1);
        var url = $"/api/competitions/{id}/nearest-emergency";
        var (member, _) = await _f.SignupAsync("Member");
        var (otherTrainer, _) = await _f.ApprovedTrainerAsync();

        var anonymous = await _f.CreateClient().GetAsync(url);
        var wrongRole = await member.GetAsync(url);
        var someoneElsesEvent = await otherTrainer.GetAsync(url);
        var missing = await (await _f.AdminAsync()).GetAsync("/api/competitions/99999999/nearest-emergency");
        Assert.Equal(
            (HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden, HttpStatusCode.NotFound, HttpStatusCode.NotFound),
            (anonymous.StatusCode, wrongRole.StatusCode, someoneElsesEvent.StatusCode, missing.StatusCode));
        Assert.Equal(0, OverpassCalls);

        var owner = await (await _f.TrainerAsync()).GetAsync(url);
        var admin = await (await _f.AdminAsync()).GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, owner.StatusCode);
        Assert.Equal("Organiser General", (await owner.ReadAsync<NearestEmergencyDto>()).Hospital!.Name);
        Assert.Equal(HttpStatusCode.OK, admin.StatusCode);
    }

    [Fact]
    public async Task IsLimitedPerIp_LikeTheOtherOutsideLookups()
    {
        var limited = _f.WithWebHostBuilder(b => b.UseSetting("RateLimits:GeocodePerMinute", "1"));
        _f.Http.Reset();
        _f.Http.RespondJson(Overpass, Hospitals());
        var id = await VenueAsync(60.1, -1.1);
        var admin = _f.WithToken((await _f.AdminLoginAsync()).Token);
        var client = limited.CreateClient();
        client.DefaultRequestHeaders.Authorization = admin.DefaultRequestHeaders.Authorization;

        var first = await client.GetAsync($"/api/competitions/{id}/nearest-emergency");
        var second = await client.GetAsync($"/api/competitions/{id}/nearest-emergency");

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.TooManyRequests), (first.StatusCode, second.StatusCode));
    }
}
