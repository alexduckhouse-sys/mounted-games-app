using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Http;
using MountedGames.Api.Services;

namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>
/// Hosts the real API against a throwaway SQLite file. Each factory (one per test class)
/// gets its own database, seeded by the production <see cref="DbInitializer"/>. The background
/// notification scheduler is removed and all outbound HTTP goes through <see cref="StubHttp"/>.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>
{
    public const string AdminKey = "test-admin-key";

    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"mg-test-{Guid.NewGuid():N}.db");

    public StubHttp Http { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, cfg) => cfg.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Default"] = $"Data Source={_dbPath}",
            ["Admin:Key"] = AdminKey,
        }));
        builder.ConfigureServices(services =>
        {
            var scheduler = services.Single(d => d.ImplementationType == typeof(NotificationScheduler));
            services.Remove(scheduler);

            services.ConfigureAll<HttpClientFactoryOptions>(o =>
                o.HttpMessageHandlerBuilderActions.Add(b => b.PrimaryHandler = Http));
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (!disposing) return;
        foreach (var f in new[] { _dbPath, _dbPath + "-shm", _dbPath + "-wal" })
            try { File.Delete(f); } catch (IOException) { }
    }
}
