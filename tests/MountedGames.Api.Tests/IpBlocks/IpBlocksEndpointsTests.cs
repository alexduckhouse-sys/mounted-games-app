using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.IpBlocks;

public class IpBlocksEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public IpBlocksEndpointsTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task List_ReturnsNewestFirst()
    {
        var admin = await _f.AdminAsync();
        await _f.WithDbAsync(async db =>
        {
            db.IpBlocks.Add(new IpBlock { IpAddress = "192.0.2.1", CreatedAt = DateTime.UtcNow.AddDays(-2) });
            db.IpBlocks.Add(new IpBlock { IpAddress = "192.0.2.2", CreatedAt = DateTime.UtcNow.AddDays(-1), Reason = "spam" });
            await db.SaveChangesAsync();
        });

        var r = await admin.GetAsync("/api/ip-blocks");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var list = (await r.ReadAsync<List<IpBlockDto>>()).Where(b => b.IpAddress.StartsWith("192.0.2.")).ToList();
        Assert.Equal(new[] { "192.0.2.2", "192.0.2.1" }, list.Select(b => b.IpAddress));
        Assert.Equal("spam", list[0].Reason);
    }

    [Fact]
    public async Task Create_TrimsValues_AndRecordsAdmin()
    {
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync("/api/ip-blocks", new CreateIpBlockRequest("  198.51.100.7 ", "  trolling  "));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<IpBlockDto>();
        Assert.Equal("198.51.100.7", dto.IpAddress);
        Assert.Equal("trolling", dto.Reason);
        Assert.NotNull(dto.CreatedByUserId);
        Assert.True(await _f.WithDbAsync(db => db.IpBlocks.AnyAsync(b => b.Id == dto.Id)));
    }

    [Fact]
    public async Task Create_AllowsMissingReason()
    {
        var admin = await _f.AdminAsync();
        var dto = await (await admin.PostAsJsonAsync("/api/ip-blocks", new CreateIpBlockRequest("198.51.100.8", null))).ReadAsync<IpBlockDto>();
        Assert.Null(dto.Reason);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Create_Returns400_WhenAddressBlank(string ip)
    {
        var admin = await _f.AdminAsync();
        var r = await admin.PostAsJsonAsync("/api/ip-blocks", new CreateIpBlockRequest(ip, null));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_Returns409_WhenAlreadyBlocked_EvenWithSurroundingSpaces()
    {
        var admin = await _f.AdminAsync();
        await admin.PostAsJsonAsync("/api/ip-blocks", new CreateIpBlockRequest("198.51.100.9", null));

        var r = await admin.PostAsJsonAsync("/api/ip-blocks", new CreateIpBlockRequest(" 198.51.100.9 ", null));

        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        Assert.Equal("IP already blocked.", doc.RootElement.GetProperty("message").GetString());
        Assert.Equal(1, await _f.WithDbAsync(db => db.IpBlocks.CountAsync(b => b.IpAddress == "198.51.100.9")));
    }

    [Fact]
    public async Task Delete_RemovesBlock()
    {
        var admin = await _f.AdminAsync();
        var dto = await (await admin.PostAsJsonAsync("/api/ip-blocks", new CreateIpBlockRequest("198.51.100.10", null))).ReadAsync<IpBlockDto>();

        var r = await admin.DeleteAsync($"/api/ip-blocks/{dto.Id}");

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.IpBlocks.AnyAsync(b => b.Id == dto.Id)));
    }

    [Fact]
    public async Task Delete_Returns404_WhenMissing()
    {
        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync("/api/ip-blocks/999999")).StatusCode);
    }

    [Fact]
    public async Task Mine_ReturnsCallerIp_ToAnonymousUsers()
    {
        var client = _f.CreateClient();
        client.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "203.0.113.5");

        var r = await client.GetAsync("/api/ip-blocks/mine");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        Assert.Equal("203.0.113.5", doc.RootElement.GetProperty("ip").GetString());
    }

    [Fact]
    public async Task Mine_ReturnsEmptyString_WhenAddressUnknown()
    {
        var r = await _f.CreateClient().GetAsync("/api/ip-blocks/mine");

        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        Assert.Equal("", doc.RootElement.GetProperty("ip").GetString());
    }

    public static IEnumerable<object[]> AdminOnly() => new[]
    {
        new object[] { "GET", "/api/ip-blocks" },
        new object[] { "POST", "/api/ip-blocks" },
        new object[] { "DELETE", "/api/ip-blocks/1" },
    };

    private static HttpRequestMessage Req(string method, string path)
        => new(new HttpMethod(method), path) { Content = JsonContent.Create(new { ipAddress = "1.1.1.1" }) };

    [Theory]
    [MemberData(nameof(AdminOnly))]
    public async Task Returns401_WhenAnonymous(string method, string path)
        => Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().SendAsync(Req(method, path))).StatusCode);

    [Theory]
    [MemberData(nameof(AdminOnly))]
    public async Task Returns403_WhenTrainer(string method, string path)
        => Assert.Equal(HttpStatusCode.Forbidden, (await (await _f.TrainerAsync()).SendAsync(Req(method, path))).StatusCode);
}
