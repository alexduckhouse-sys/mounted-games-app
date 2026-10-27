using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Http;
using Microsoft.AspNetCore.Identity;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;

namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>
/// Hosts the real API against a throwaway SQLite file. Each factory (one per test class)
/// gets its own database, seeded by the production <see cref="DbInitializer"/>. The background
/// notification scheduler is removed and all outbound HTTP goes through <see cref="StubHttp"/>.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>
{
    public const string AdminKey = "test-admin-key-0123456789";

    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"mg-test-{Guid.NewGuid():N}.db");

    public StubHttp Http { get; } = new();

    /// <summary>Stands in for DNS: every domain has mail unless a test says otherwise.</summary>
    public FakeDomainChecker Domains { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        // UseSetting (not ConfigureAppConfiguration): Program.cs reads the connection string while
        // building, before late configuration callbacks are applied.
        builder.UseSetting("ConnectionStrings:Default", $"Data Source={_dbPath}");
        // Outside Development, SecurityConfiguration rejects secrets that are short or come from
        // appsettings.json, so the test host supplies both the way a deployment would.
        builder.UseSetting("Jwt:Key", "test-jwt-key-0123456789-0123456789-0123456789");
        builder.UseSetting("Admin:Key", AdminKey);
        // Tests sign in far more often than the production limits allow.
        builder.UseSetting("RateLimits:AuthPerMinute", "100000");
        builder.UseSetting("RateLimits:AccountsPerIp", "100000");
        builder.UseSetting("RateLimits:WritesPerMinute", "100000");
        builder.UseSetting("RateLimits:PublicReadsPerMinute", "100000");
        builder.UseSetting("RateLimits:GeocodePerMinute", "100000");
        builder.UseSetting("RateLimits:SponsorExposurePerMinute", "100000");
        builder.UseSetting("RateLimits:StatsPerMinute", "100000");
        builder.UseSetting("RateLimits:EmailResendPerMinute", "100000");
        builder.UseSetting("RateLimits:SignupPerMinute", "100000");
        builder.UseSetting("RateLimits:TeamJoinPerMinute", "100000");
        builder.UseSetting("RateLimits:ShopReportsPerMinute", "100000");
        builder.UseSetting("RateLimits:UnsubscribePerMinute", "100000");
        builder.UseSetting("RateLimits:NearYouPerMinute", "100000");
        builder.UseSetting("RateLimits:ScorerReadsPerMinute", "100000");
        builder.UseSetting("RateLimits:PasswordResetRequestsPerMinute", "100000");
        builder.UseSetting("RateLimits:PasswordResetLinksPerMinute", "100000");
        builder.ConfigureServices(services =>
        {
            var scheduler = services.Single(d => d.ImplementationType == typeof(NotificationScheduler));
            services.Remove(scheduler);
            services.Remove(services.Single(d => d.ImplementationType == typeof(MountedGames.Api.Services.Streaming.StreamSweeper)));

            services.Remove(services.Single(d => d.ImplementationType == typeof(IpRetentionSweeper)));

            services.AddTransient<IStartupFilter, TestIpStartupFilter>();

            // Sign-up checks that an address's domain takes mail; tests never query real DNS.
            services.RemoveAll<MountedGames.Api.Services.Email.IEmailDomainChecker>();
            services.AddSingleton<MountedGames.Api.Services.Email.IEmailDomainChecker>(Domains);

            services.ConfigureAll<HttpClientFactoryOptions>(o =>
                o.HttpMessageHandlerBuilderActions.Add(b => b.PrimaryHandler = Http));
        });
    }

    /// <summary>
    /// Demo data (the seeded admin and trainer accounts, clubs and competitions) is only seeded in
    /// Development, so the "Testing" host seeds it here once the app has started.
    /// </summary>
    protected override IHost CreateHost(IHostBuilder builder)
    {
        var host = base.CreateHost(builder);
        using var scope = host.Services.CreateScope();
        DbInitializer.SeedDemoDataAsync(
            scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>()).GetAwaiter().GetResult();
        return host;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (!disposing) return;
        foreach (var f in new[] { _dbPath, _dbPath + "-shm", _dbPath + "-wal" })
            try { File.Delete(f); } catch (IOException) { }
    }
}
