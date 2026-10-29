using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Entities.Apple;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Privacy;

public class EventDayPrivacyTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Export_IsPrivateAndOwnerScoped_AndAccountDeletionRemovesBookings()
    {
        var arena = await factory.CreateArenaAsync();
        var (client, auth) = await factory.SignupAsync("Member");
        var (_, other) = await factory.SignupAsync("Member");
        await factory.WithDbAsync(async db => {
            db.AddRange(new ArrivalBooking { Id = Guid.NewGuid(), CompetitionId = arena.CompetitionId, OwnerUserId = auth.User.Id,
                Reference = "fake-own-capability", VehicleRegistration = "EXAMPLE OWN", UpdatedAt = DateTime.UtcNow },
                new ArrivalBooking { Id = Guid.NewGuid(), CompetitionId = arena.CompetitionId, OwnerUserId = other.User.Id,
                Reference = "fake-other-capability", VehicleRegistration = "EXAMPLE OTHER", UpdatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("/api/auth/me/event-day-data")).StatusCode);
        var response = await client.GetAsync("/api/auth/me/event-day-data"); response.EnsureSuccessStatusCode();
        Assert.True(response.Headers.CacheControl!.NoStore);
        var text = await response.Content.ReadAsStringAsync();
        Assert.Contains("EXAMPLE OWN", text); Assert.DoesNotContain("EXAMPLE OTHER", text); Assert.DoesNotContain("capability", text);
        var deleted = await client.SendAsync(new HttpRequestMessage(HttpMethod.Delete, "/api/auth/me") {
            Content = JsonContent.Create(new { password = "Passw0rd!x" }) });
        deleted.EnsureSuccessStatusCode();
        await factory.WithDbAsync(async db => {
            Assert.False(await db.Set<ArrivalBooking>().AnyAsync(x => x.OwnerUserId == auth.User.Id));
            Assert.True(await db.Set<ArrivalBooking>().AnyAsync(x => x.OwnerUserId == other.User.Id));
        });
    }
}
