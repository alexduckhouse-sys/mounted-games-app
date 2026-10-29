using System.Net;
using MountedGames.Api.Tests.Infrastructure;
namespace MountedGames.Api.Tests;
public class CertificationPrivacySecurityTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task GlobalCertificateLookupNoLongerDisclosesExistenceOrPrivateData()
    {
        using var anonymous = f.CreateClient();
        using var admin = await f.AdminAsync();
        var (member, _) = await f.SignupAsync("Member");
        const string url = "/api/event-tools/certified-horses/lookup?passportCode=FAKE-TEST&ponyName=Fake&ownerFullName=Fake";
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(url)).StatusCode);
        foreach (var client in new[] { member, admin })
        {
            var response = await client.GetAsync(url);
            Assert.Equal(HttpStatusCode.Gone, response.StatusCode);
            var body = await response.Content.ReadAsStringAsync();
            Assert.DoesNotContain("officialNotes", body); Assert.DoesNotContain("found", body); Assert.DoesNotContain("FAKE-TEST", body);
        }
    }
}
