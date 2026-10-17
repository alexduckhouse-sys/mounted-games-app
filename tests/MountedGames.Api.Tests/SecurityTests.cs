using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using MountedGames.Api.Hubs;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MountedGames.Api.Auth;
using MountedGames.Api.Controllers;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Security;
using MountedGames.Api.Services;

namespace MountedGames.Api.Tests;

public class SecurityTests
{
    [Theory]
    [InlineData(null, null, 401)]
    [InlineData("other", Roles.Trainer, 404)]
    [InlineData("owner", Roles.Manager, 403)]
    [InlineData("owner", Roles.Trainer, 200)]
    [InlineData("other", Roles.Admin, 200)]
    public async Task SignupDetailsRequireTheStoredCompetitionOwner(string? uid, string? role, int expected)
    {
        await using var server = await SecurityServer.Start();
        using var response = await server.Send(HttpMethod.Get, "/api/competitions/1/signups", uid, role);
        Assert.Equal(expected, (int)response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
    }

    [Fact]
    public async Task ForeignSignupCannotBeChangedByGuessingItsId()
    {
        await using var server = await SecurityServer.Start();
        using var response = await server.Send(HttpMethod.Put, "/api/signups/1/status", "other", Roles.Trainer, new { status = 3 });
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        using var scope = server.App.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(SignupPaymentStatus.Pending, (await db.SectionSignups.SingleAsync()).Status);
        using var allowed = await server.Send(HttpMethod.Put, "/api/signups/1/status", "owner", Roles.Trainer, new { status = 3 });
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
    }

    [Fact]
    public async Task DeclarationsRedactPrivateFieldsAndHideDraftsOnBothReadPaths()
    {
        await using var server = await SecurityServer.Start();
        using var response = await server.Send(HttpMethod.Get, "/api/declaration-forms/1");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, body.GetProperty("submittedByPhone").ValueKind);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("notes").ValueKind);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("riders")[0].GetProperty("dateOfBirth").ValueKind);
        using var draft = await server.Send(HttpMethod.Get, "/api/declaration-forms/2");
        Assert.Equal(HttpStatusCode.NotFound, draft.StatusCode);
        using var list = await server.Send(HttpMethod.Get, "/api/declaration-forms");
        Assert.Single((await list.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray());
        using var owner = await server.Send(HttpMethod.Get, "/api/declaration-forms/2", "owner", Roles.Trainer);
        Assert.Equal(HttpStatusCode.OK, owner.StatusCode);
        var privateBody = await owner.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Fake private note", privateBody.GetProperty("notes").GetString());
        using var ownerList = await server.Send(HttpMethod.Get, "/api/declaration-forms", "owner", Roles.Trainer);
        Assert.Equal(2, (await ownerList.Content.ReadFromJsonAsync<JsonElement>()).GetArrayLength());
    }

    [Fact]
    public async Task SavedRidersAreRestrictedByOwnerNotSelfDeclaredClub()
    {
        await using var server = await SecurityServer.Start();
        using var anonymous = await server.Send(HttpMethod.Get, "/api/clubs/1/saved-riders");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var stranger = await server.Send(HttpMethod.Get, "/api/clubs/1/saved-riders", "other", Roles.Trainer);
        Assert.Empty((await stranger.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray());
        using var owner = await server.Send(HttpMethod.Get, "/api/clubs/1/saved-riders", "owner", Roles.Trainer);
        Assert.Single((await owner.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray());
        using var admin = await server.Send(HttpMethod.Get, "/api/clubs/1/saved-riders", "other", Roles.Admin);
        Assert.Equal(2, (await admin.Content.ReadFromJsonAsync<JsonElement>()).GetArrayLength());
    }

    [Fact]
    public async Task AnonymousWriteFloodDoesNotConsumeTheOrganisersQuota()
    {
        await using var server = await SecurityServer.Start();
        for (var i = 0; i < 60; i++)
        {
            using var response = await server.Send(HttpMethod.Post, "/api/write-test");
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        }
        using var blocked = await server.Send(HttpMethod.Post, "/api/write-test");
        Assert.Equal(HttpStatusCode.TooManyRequests, blocked.StatusCode);
        using var organiser = await server.Send(HttpMethod.Post, "/api/write-test", "owner", Roles.Trainer);
        Assert.Equal(HttpStatusCode.NoContent, organiser.StatusCode);
    }

    [Fact]
    public async Task ForeignCompetitionAndMismatchedChildRoutesCannotBeModified()
    {
        await using var server = await SecurityServer.Start();
        using var competition = await server.Send(HttpMethod.Post, "/api/competitions/2/signups-locked", "owner", Roles.Trainer, new { locked = true });
        Assert.Equal(HttpStatusCode.NotFound, competition.StatusCode);
        using var section = await server.Send(HttpMethod.Put, "/api/competitions/1/sections/2", "owner", Roles.Trainer, new { priceMinor = 900 });
        Assert.Equal(HttpStatusCode.NotFound, section.StatusCode);
        using var team = await server.Send(HttpMethod.Delete, "/api/competitions/1/teams/2", "owner", Roles.Trainer);
        Assert.Equal(HttpStatusCode.NotFound, team.StatusCode);
        using var delete = await server.Send(HttpMethod.Delete, "/api/signups/1", "other", Roles.Trainer);
        Assert.Equal(HttpStatusCode.NotFound, delete.StatusCode);
        using var form = await server.Send(HttpMethod.Post, "/api/competitions/1/sections/1/form-teams", "other", Roles.Trainer,
            new { ridersPerTeam = 4, preview = false, replaceExisting = true });
        Assert.Equal(HttpStatusCode.NotFound, form.StatusCode);
        using var scope = server.App.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False((await db.Competitions.SingleAsync(c => c.Id == 2)).SignupsLocked);
        Assert.Equal(0, (await db.CompetitionSections.SingleAsync(c => c.Id == 2)).PriceMinor);
        Assert.True(await db.Teams.AnyAsync(t => t.Id == 2));
        Assert.Single(await db.SectionSignups.ToListAsync());
    }

    [Theory]
    [InlineData("owner", Roles.Trainer, 1, 200)]
    [InlineData("owner", Roles.Trainer, 2, 400)]
    [InlineData("owner", Roles.Trainer, 3, 400)]
    [InlineData("owner", Roles.Trainer, 4, 400)]
    [InlineData("other", Roles.Admin, 2, 200)]
    public async Task SavedRiderReferencesAreCheckedBeforeDeclarationWrites(string uid, string role, int riderId, int status)
    {
        await using var server = await SecurityServer.Start();
        using (var scope = server.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.SavedRiders.AddRange(new SavedRider { Id = 3, ClubId = 1, CreatedByUserId = "other", FullName = "Fake Other Rider" },
                new SavedRider { Id = 4, Club = new Club { Name = "Second fake club" }, CreatedByUserId = "owner", FullName = "Fake Different Club Rider" });
            await db.SaveChangesAsync();
        }
        using var response = await server.Send(HttpMethod.Post, "/api/declaration-forms", uid, role, new
        {
            teamId = 1, saveToRoster = false,
            riders = new[] { new { savedRiderId = riderId, fullName = "Fake Rider", isCaptain = false, isReserve = false, orderIndex = 0 } },
        });
        Assert.Equal(status, (int)response.StatusCode);
        using var checkScope = server.App.Services.CreateScope();
        Assert.Equal(status == 200 ? 3 : 2, await checkScope.ServiceProvider.GetRequiredService<AppDbContext>().DeclarationForms.CountAsync());
    }

    [Fact]
    public async Task OwnershipMigrationPreservesLegacyRidersWithoutGuessingAnOwner()
    {
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite("Data Source=:memory:").Options);
        await db.Database.OpenConnectionAsync();
        await db.Database.ExecuteSqlRawAsync("CREATE TABLE SavedRiders (Id INTEGER PRIMARY KEY, FullName TEXT NOT NULL)");
        await db.Database.ExecuteSqlRawAsync("INSERT INTO SavedRiders (Id, FullName) VALUES (1, 'Fake legacy rider')");
        var migration = new MountedGames.Api.Data.Migrations.AddSavedRiderOwnership();
        foreach (var command in db.GetService<IMigrationsSqlGenerator>().Generate(migration.UpOperations))
            await db.Database.ExecuteSqlRawAsync(command.CommandText);
        using var query = db.Database.GetDbConnection().CreateCommand();
        query.CommandText = "SELECT FullName, CreatedByUserId FROM SavedRiders WHERE Id = 1";
        using var reader = await query.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal("Fake legacy rider", reader.GetString(0));
        Assert.True(reader.IsDBNull(1));
    }

    [Fact]
    public async Task AnonymousReaderDoesNotMatchNullPrivateMessageRecipients()
    {
        await using var server = await SecurityServer.Start();
        using var response = await server.Send(HttpMethod.Get, "/api/shop/posts/1/comments");
        Assert.Empty((await response.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray());
    }

    [Fact]
    public async Task PasswordFailuresLockTheAccountEvenWhenTheNextPasswordIsCorrect()
    {
        await using var server = await SecurityServer.Start();
        using (var scope = server.App.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = new AppUser { UserName = "fake-login@example.invalid", Email = "fake-login@example.invalid", FullName = "Fake Login" };
            Assert.True((await users.CreateAsync(user, "FakeKnown1!")).Succeeded);
        }
        for (var i = 0; i < 5; i++)
        {
            using var wrong = await server.Send(HttpMethod.Post, "/api/auth/login", body: new { email = "fake-login@example.invalid", password = "FakeWrong1!" });
            Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        }
        using var locked = await server.Send(HttpMethod.Post, "/api/auth/login", body: new { email = "fake-login@example.invalid", password = "FakeKnown1!" });
        Assert.Equal(HttpStatusCode.Unauthorized, locked.StatusCode);
        using var check = server.App.Services.CreateScope();
        var manager = check.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        Assert.True(await manager.IsLockedOutAsync((await manager.FindByEmailAsync("fake-login@example.invalid"))!));
    }

    [Fact]
    public async Task AuthLimiterRejectsRepeatedAttemptsAndIgnoresSpoofedForwardedHeaders()
    {
        await using var server = await SecurityServer.Start();
        for (var i = 0; i < 10; i++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/limit");
            request.Headers.Add("X-Forwarded-For", $"192.0.2.{i + 1}");
            using var response = await server.Client.SendAsync(request);
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        }
        using var refused = await server.Client.PostAsync("/limit", null);
        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        Assert.Equal("60", refused.Headers.GetValues("Retry-After").Single());
        Assert.True(refused.Headers.Contains("Content-Security-Policy"));
    }

    [Fact]
    public async Task HeadersCoverAssetsFallbackAndErrors()
    {
        await using var server = await SecurityServer.Start();
        foreach (var path in new[] { "/asset.js", "/spa-route", "/fail", "/api/missing" })
        {
            using var response = await server.Client.GetAsync(path);
            foreach (var (key, value) in SecurityHeadersMiddleware.Headers)
                Assert.Equal(value, response.Headers.GetValues(key).Single());
        }
        using var failure = await server.Client.GetAsync("/fail");
        Assert.Equal(HttpStatusCode.InternalServerError, failure.StatusCode);
        Assert.DoesNotContain("Fake internal detail", await failure.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task HeadersMatchVercel()
    {
        var repo = FindRepo();
        using var document = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(repo, "web/vercel.json")));
        var headers = document.RootElement.GetProperty("headers").EnumerateArray()
            .Single(h => h.GetProperty("source").GetString() == "/(.*)").GetProperty("headers")
            .EnumerateArray().ToDictionary(h => h.GetProperty("key").GetString()!, h => h.GetProperty("value").GetString());
        foreach (var (key, value) in SecurityHeadersMiddleware.Headers) Assert.Equal(value, headers[key]);
    }

    [Theory]
    [InlineData("https://fcm.googleapis.com/fcm/send/fake", true)]
    [InlineData("https://updates.push.services.mozilla.com/wpush/v2/fake", true)]
    [InlineData("https://web.push.apple.com/fake", true)]
    [InlineData("https://wns2.notify.windows.com/fake", true)]
    [InlineData("http://127.0.0.1/", false)]
    [InlineData("https://169.254.169.254/", false)]
    [InlineData("https://fcm.googleapis.com.evil.invalid/fake", false)]
    [InlineData("https://fcm.googleapis.com@evil.invalid/fake", false)]
    [InlineData("https://fcm.googleapis.com:8443/fake", false)]
    [InlineData("https://fcm.googleapis.com/fake#fragment", false)]
    public void PushEndpointsCannotTargetArbitraryServers(string endpoint, bool allowed) =>
        Assert.Equal(allowed, PushEndpointPolicy.IsAllowed(endpoint));

    [Fact]
    public void ProductionCspDoesNotAllowInlineScriptsOrArbitraryOrigins()
    {
        var directives = SecurityHeadersMiddleware.ContentSecurityPolicy.Split("; ")
            .ToDictionary(d => d.Split(' ', 2)[0], d => d);
        Assert.Equal("default-src 'none'", directives["default-src"]);
        Assert.Equal("script-src 'self'", directives["script-src"]);
        Assert.Equal("script-src-attr 'none'", directives["script-src-attr"]);
        Assert.Equal("style-src-elem 'self'", directives["style-src-elem"]);
        Assert.Equal("frame-ancestors 'none'", directives["frame-ancestors"]);
        Assert.Equal("object-src 'none'", directives["object-src"]);
        Assert.Equal("base-uri 'none'", directives["base-uri"]);
        Assert.Equal("frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.twitch.tv", directives["frame-src"]);
        Assert.Equal("camera=(self), microphone=(self), geolocation=(), payment=(), browsing-topics=()",
            SecurityHeadersMiddleware.Headers["Permissions-Policy"]);
        Assert.DoesNotContain("unsafe-eval", SecurityHeadersMiddleware.ContentSecurityPolicy);
        Assert.DoesNotContain("*", SecurityHeadersMiddleware.ContentSecurityPolicy);
    }

    [Fact]
    public async Task ProductionRejectsSecretsFromAnAppsettingsFile()
    {
        var path = Path.GetTempFileName();
        try
        {
            await File.WriteAllTextAsync(path, JsonSerializer.Serialize(new { Jwt = new { Key = new string('x', 40) } }));
            var config = new ConfigurationBuilder().AddJsonFile(path).Build();
            Assert.Throws<InvalidOperationException>(() => SecurityConfiguration.Validate(config, new TestEnvironment()));
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void ProductionRefusesMissingSecretsAndDemoSeeding()
    {
        var environment = new TestEnvironment { EnvironmentName = Environments.Production };
        Assert.Throws<InvalidOperationException>(() => SecurityConfiguration.Validate(new ConfigurationBuilder().Build(), environment));
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:Key"] = new string('x', 40), ["Admin:Key"] = new string('y', 32), ["Database:SeedDemoData"] = "true",
        }).Build();
        Assert.Throws<InvalidOperationException>(() => SecurityConfiguration.Validate(config, environment));
        config["Database:SeedDemoData"] = "false";
        SecurityConfiguration.Validate(config, environment);
    }

    [Fact]
    public void PostgresMigrationSnapshotMatchesTheOwnershipModel()
    {
        using var db = new AppDbContextFactory().CreateDbContext([]);
        Assert.False(db.Database.HasPendingModelChanges());
        Assert.Contains("20261015220000_AddSavedRiderOwnership", db.Database.GetMigrations());
    }

    internal static string FindRepo()
    {
        var path = new DirectoryInfo(AppContext.BaseDirectory);
        while (path != null && !File.Exists(Path.Combine(path.FullName, "web/vercel.json"))) path = path.Parent;
        return path?.FullName ?? throw new InvalidOperationException("Repository not found.");
    }
}

internal sealed class SecurityServer(WebApplication app, HttpClient client, string directory) : IAsyncDisposable
{
    public WebApplication App => app;
    public HttpClient Client => client;

    public static async Task<SecurityServer> Start()
    {
        var directory = Directory.CreateTempSubdirectory("mg-security-").FullName;
        var webroot = Directory.CreateDirectory(Path.Combine(directory, "wwwroot")).FullName;
        await File.WriteAllTextAsync(Path.Combine(webroot, "index.html"), "<!doctype html><title>Fake test page</title>");
        await File.WriteAllTextAsync(Path.Combine(webroot, "asset.js"), "void 0;");
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            ContentRootPath = directory, WebRootPath = webroot, EnvironmentName = Environments.Production,
        });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));
        builder.Services.AddDbContext<AppDbContext>(options => options.UseSqlite($"Data Source={Path.Combine(directory, "test.db")};Pooling=False"));
        builder.Services.AddIdentityCore<AppUser>().AddRoles<IdentityRole>().AddEntityFrameworkStores<AppDbContext>().AddSignInManager();
        builder.Services.AddScoped<TokenService>();
        builder.Services.AddAuthentication("test").AddScheme<AuthenticationSchemeOptions, TestAuthentication>("test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddHttpClient();
        builder.Services.AddScoped<GeocodingService>();
        builder.Services.AddSignalR();
        builder.Services.AddSingleton<ILiveBroadcaster, LiveBroadcaster>();
        builder.Services.AddControllers().AddApplicationPart(typeof(SignupController).Assembly);
        builder.Services.AddRequestLimits(builder.Configuration);
        builder.Services.AddTrustedProxies(builder.Configuration);
        builder.Services.AddProblemDetails();
        var app = builder.Build();
        app.UseForwardedHeaders();
        app.UseMiddleware<SecurityHeadersMiddleware>();
        app.UseExceptionHandler();
        app.UseRouting();
        app.UseAuthentication();
        app.UseRateLimiter();
        app.UseAuthorization();
        app.UseStaticFiles();
        app.MapControllers();
        app.MapPost("/api/write-test", () => Results.NoContent());
        app.MapPost("/limit", () => Results.NoContent()).RequireRateLimiting("auth");
        app.MapGet("/fail", (Func<IResult>)(() => throw new InvalidOperationException("Fake internal detail")));
        app.MapFallbackToFile("index.html");
        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.EnsureCreatedAsync();
            db.Users.AddRange(new AppUser { Id = "owner", UserName = "fake-owner", FullName = "Fake Owner", PhoneNumber = "FAKE-PHONE" },
                new AppUser { Id = "other", UserName = "fake-other", FullName = "Fake Other" });
            var competition = new Competition { Id = 1, Name = "Fake event", CreatedByUserId = "owner" };
            var section = new CompetitionSection { Id = 1, Competition = competition, DisplayName = "Fake section" };
            var club = new Club { Id = 1, Name = "Fake club" };
            var team = new Team { Id = 1, Competition = competition, Section = section, Club = club, TrainerUserId = "owner" };
            db.Teams.Add(team);
            var foreignCompetition = new Competition { Id = 2, Name = "Other fake event", CreatedByUserId = "other" };
            var foreignSection = new CompetitionSection { Id = 2, Competition = foreignCompetition, DisplayName = "Other fake section" };
            db.Teams.Add(new Team { Id = 2, Competition = foreignCompetition, Section = foreignSection, Club = club });
            db.SectionSignups.Add(new SectionSignup { Id = 1, Section = section, FullName = "Fake Entrant", ContactInfo = "FAKE-CONTACT" });
            db.DeclarationForms.AddRange(new DeclarationForm { Id = 1, Team = team, SubmittedByUserId = "owner", IsLocked = true,
                Notes = "Fake private note", Riders = [new RiderEntry { FullName = "Fake Rider", DateOfBirth = new DateTime(2000, 1, 1) }] },
                new DeclarationForm { Id = 2, Team = team, SubmittedByUserId = "owner", Notes = "Fake private note", IsLocked = false });
            db.SavedRiders.AddRange(new SavedRider { Club = club, CreatedByUserId = "owner", FullName = "Fake Owned Rider" },
                new SavedRider { Club = club, FullName = "Fake Legacy Rider" });
            db.ShopPosts.Add(new ShopPost { Id = 1, Title = "Fake listing", AuthorUserId = "owner",
                Comments = [new ShopComment { IsPrivate = true, ToUserId = null, AuthorUserId = "owner", Body = "Fake private message" }] });
            await db.SaveChangesAsync();
        }
        await app.StartAsync();
        return new SecurityServer(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()) }, directory);
    }

    public async Task<HttpResponseMessage> Send(HttpMethod method, string url, string? uid = null, string? role = null, object? body = null)
    {
        using var request = new HttpRequestMessage(method, url);
        if (uid != null) request.Headers.Add("Test-User", uid);
        if (role != null) request.Headers.Add("Test-Role", role);
        if (body != null) request.Content = JsonContent.Create(body);
        return await client.SendAsync(request);
    }

    public async ValueTask DisposeAsync()
    {
        client.Dispose();
        await app.StopAsync();
        await app.DisposeAsync();
        Directory.Delete(directory, recursive: true);
    }
}

internal sealed class TestAuthentication(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var uid = Request.Headers["Test-User"].ToString();
        if (string.IsNullOrEmpty(uid)) return Task.FromResult(AuthenticateResult.NoResult());
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, uid), new Claim(ClaimTypes.Role, Request.Headers["Test-Role"].ToString()) };
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, "test")), "test")));
    }
}

internal sealed class TestEnvironment : IHostEnvironment
{
    public string EnvironmentName { get; set; } = Environments.Production;
    public string ApplicationName { get; set; } = "SecurityTests";
    public string ContentRootPath { get; set; } = "/unused";
    public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
}
