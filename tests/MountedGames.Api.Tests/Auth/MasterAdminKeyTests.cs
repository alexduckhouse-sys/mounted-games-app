using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using MountedGames.Api.Auth;
using MountedGames.Api.Security;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>Becoming master admin with the key whose SHA-256 is the only thing configured.</summary>
public class MasterAdminKeyTests : IClassFixture<MasterAdminKeyTests.KeyedFactory>
{
    public const string Key = "test-master-key-not-a-real-secret";

    public sealed class KeyedFactory : ApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("MasterAdmin:KeyHash", MasterAdminKey.Hash(Key));
        }
    }

    private readonly KeyedFactory _f;
    public MasterAdminKeyTests(KeyedFactory f) => _f = f;

    private async Task<(HttpClient Client, string Email, string Id)> NewAdminAsync()
    {
        var email = $"keyed-{Guid.NewGuid():N}@example.org";
        (await (await _f.AdminAsync()).PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, "Passw0rd!x", "Keyed Admin", Roles.Admin, null))).EnsureSuccessStatusCode();
        var auth = await _f.LoginAsync(email, "Passw0rd!x");
        return (_f.WithToken(auth.Token), email, auth.User.Id);
    }

    [Fact]
    public async Task TheRightKeyMakesTheCallerMasterAdmin_AndGivesAFreshToken()
    {
        var (client, _, _) = await NewAdminAsync();
        var response = await client.PostAsJsonAsync("/api/auth/master-admin", new MasterAdminKeyRequest(Key));
        var auth = await response.ReadAsync<AuthResponse>();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(Roles.MasterAdmin, auth.User.Roles);
        Assert.Contains(Roles.Admin, auth.User.Roles);
        // Doing it again is harmless, and the new token can lock an Admin.
        var again = await _f.WithToken(auth.Token).PostAsJsonAsync("/api/auth/master-admin", new MasterAdminKeyRequest(Key));
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        var victim = await NewAdminAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await _f.WithToken(auth.Token).PostAsync($"/api/admin/users/{victim.Id}/account-lock", null)).StatusCode);
    }

    [Fact]
    public async Task AWrongOrMissingKeyIsRefused_AndNothingIsGranted()
    {
        var (client, email, _) = await NewAdminAsync();
        foreach (var key in new[] { "wrong", "", Key.ToUpperInvariant(), new string('x', 600) })
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/auth/master-admin", new MasterAdminKeyRequest(key))).StatusCode);
        Assert.DoesNotContain(Roles.MasterAdmin, (await _f.LoginAsync(email, "Passw0rd!x")).User.Roles);
        // The hash itself is not the key.
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/auth/master-admin", new MasterAdminKeyRequest(MasterAdminKey.Hash(Key)))).StatusCode);
    }

    [Fact]
    public async Task OnlyASignedInAdminCanTry_AndTheSharedAdminKeyAccountCannotTakeTheRole()
    {
        var body = new MasterAdminKeyRequest(Key);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PostAsJsonAsync("/api/auth/master-admin", body)).StatusCode);
        var (member, _) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync("/api/auth/master-admin", body)).StatusCode);
        var (organiser, _) = await _f.ApprovedTrainerAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await organiser.PostAsJsonAsync("/api/auth/master-admin", body)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await (await _f.AdminAsync()).PostAsJsonAsync("/api/auth/master-admin", body)).StatusCode);
    }

    [Fact]
    public void KeyHelpersAndStartupChecks()
    {
        Assert.True(MasterAdminKey.Matches(Key, MasterAdminKey.Hash(Key).ToUpperInvariant()));
        Assert.False(MasterAdminKey.Matches(null, MasterAdminKey.Hash(Key)));
        Assert.False(MasterAdminKey.Matches(Key, "not-a-hash"));
        Assert.False(MasterAdminKey.IsValidHash(new string('g', 64)));

        IConfiguration Config(string? hash) => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:Key"] = new string('k', 40), ["MasterAdmin:KeyHash"] = hash,
        }).Build();
        var production = new TestEnvironment(Environments.Production);
        SecurityConfiguration.Validate(Config(null), production);
        SecurityConfiguration.Validate(Config(MasterAdminKey.Hash(Key)), production);
        Assert.Throws<InvalidOperationException>(() => SecurityConfiguration.Validate(Config("oops"), production));
        SecurityConfiguration.Validate(Config("oops"), new TestEnvironment(Environments.Development));
    }

    private sealed class TestEnvironment(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "test";
        public string ContentRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }
}

/// <summary>Without the setting the endpoint doesn't exist as far as anyone can tell.</summary>
public class MasterAdminKeyUnsetTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public MasterAdminKeyUnsetTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task AnswersNotFound()
    {
        var email = $"unset-{Guid.NewGuid():N}@example.org";
        (await (await _f.AdminAsync()).PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, "Passw0rd!x", "Admin", Roles.Admin, null))).EnsureSuccessStatusCode();
        var admin = _f.WithToken((await _f.LoginAsync(email, "Passw0rd!x")).Token);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync("/api/auth/master-admin", new MasterAdminKeyRequest("anything"))).StatusCode);
    }
}
