using System.Net;
using System.Net.Http.Json;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Sessions;

public class SessionsAuthTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public SessionsAuthTests(ApiFactory f) => _f = f;

    public static IEnumerable<object[]> AdminOnly() => new[]
    {
        new object[] { "POST", "/api/competitions/1/sessions" },
        new object[] { "PUT", "/api/competitions/1/sessions/1/status" },
        new object[] { "DELETE", "/api/competitions/1/sessions/1" },
        new object[] { "POST", "/api/competitions/1/sessions/1/heats" },
        new object[] { "POST", "/api/competitions/1/sessions/1/generate-race-finals" },
        new object[] { "POST", "/api/competitions/1/sessions/1/heats/1/populate-race-final" },
        new object[] { "PUT", "/api/competitions/1/sessions/1/heats/1/scheduled-start" },
        new object[] { "PUT", "/api/competitions/1/sessions/1/stream" },
        new object[] { "PUT", "/api/competitions/1/sessions/1/heat-assignments" },
        new object[] { "PUT", "/api/competitions/1/sessions/1/settings" },
        new object[] { "PUT", "/api/competitions/1/sessions/1/lanes" },
        new object[] { "POST", "/api/competitions/1/sessions/1/generate-heats" },
    };

    private static HttpRequestMessage Req(string method, string path)
        => new(new HttpMethod(method), path) { Content = JsonContent.Create(new { }) };

    [Theory]
    [MemberData(nameof(AdminOnly))]
    public async Task Returns401_WhenAnonymous(string method, string path)
    {
        var r = await _f.CreateClient().SendAsync(Req(method, path));
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Theory]
    [MemberData(nameof(AdminOnly))]
    public async Task Returns403_WhenTrainer(string method, string path)
    {
        var trainer = await _f.TrainerAsync();
        var r = await trainer.SendAsync(Req(method, path));
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }
}
