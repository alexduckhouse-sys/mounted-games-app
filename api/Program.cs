using System.Security.Claims;
using System.IO.Compression;
using System.Text;
using MountedGames.Api.Security;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services;
using MountedGames.Api.Services.EventTools;
using MountedGames.Api.Services.Streaming;

var builder = WebApplication.CreateBuilder(args);
SecurityConfiguration.Validate(builder.Configuration, builder.Environment);
builder.WebHost.ConfigureKestrel(options =>
{
    options.AddServerHeader = false;
    options.Limits.MaxRequestBodySize = 1024 * 1024;
});

var migrateDatabase = args.Contains("--migrate-database");

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? "Data Source=mg.db";

builder.Services.AddDbContext<AppDbContext>(opt =>
    DatabaseConfiguration.Configure(opt, builder.Configuration, migrateDatabase));

builder.Services
    .AddIdentity<AppUser, IdentityRole>(o =>
    {
        // Keep in step with web/src/lib/passwordRules.ts (a test on each side pins them).
        o.Password.RequireDigit = true;
        o.Password.RequireLowercase = true;
        o.Password.RequireUppercase = false;
        o.Password.RequireNonAlphanumeric = true;
        o.Password.RequiredLength = 8;
        o.User.RequireUniqueEmail = true;
        o.Lockout.MaxFailedAccessAttempts = 5;
        o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
    })
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();

var jwtKey = builder.Configuration["Jwt:Key"] ?? "dev-only-secret-please-change-me-256-bit-min!!";
var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "MountedGames.Api";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "MountedGames.Web";

builder.Services
    .AddAuthentication(o =>
    {
        o.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
        o.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
        };
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var accessToken = ctx.Request.Query["access_token"];
                var path = ctx.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                    ctx.Token = accessToken;
                return Task.CompletedTask;
            },
            OnTokenValidated = async ctx =>
            {
                var uid = ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
                var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                // One uncached round trip per request (and per live-hub connection): the account's state and its roles. A
                // deleted, emptied, locked or blocked account, or a token from before its sessions were ended (a password
                // reset or change), is refused at once on every instance.
                var account = uid is null ? null : await LiveAccounts.StateAsync(db, uid, ctx.HttpContext.RequestAborted);
                if (account is null || !account.Accepts(LiveAccounts.SessionVersionOf(ctx.Principal)))
                {
                    ctx.Fail("This account no longer exists.");
                    return;
                }
                // Revoked roles stop working on existing tokens. Newly granted roles still require a fresh sign-in.
                // Preserve the token's identity, including the shared-key display name.
                foreach (var identity in ctx.Principal!.Identities)
                    foreach (var claim in identity.FindAll(identity.RoleClaimType).Where(c => !account.Roles.Contains(c.Value)).ToArray())
                        identity.RemoveClaim(claim);
            }
        };
    });

builder.Services.AddAuthorizationWithCompetitionStaff();
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<LiveAccounts>();
// Sign in with Google / Apple / Facebook: fetches only the providers' fixed signing-key addresses (see ExternalProviders)
// and Facebook's Graph API. Facebook's debug_token call carries the token being checked in the query string
// (input_token, as Facebook requires; the app's own token goes in the Authorization header), so the factory's request
// logging is off for this client.
builder.Services.AddHttpClient(ExternalTokenValidator.HttpClientName, c =>
    {
        c.Timeout = TimeSpan.FromSeconds(10);
        c.MaxResponseContentBufferSize = 256 * 1024;
    })
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false })
    .RemoveAllLoggers();
builder.Services.AddSingleton<ExternalTokenReplayGuard>();
builder.Services.AddSingleton<ExternalSignupTickets>();
builder.Services.AddSingleton<FacebookApp>();
builder.Services.AddSingleton<FacebookTokenVerifier>();
builder.Services.AddSingleton<IExternalTokenValidator, ExternalTokenValidator>();
builder.Services.AddSingleton<LiveConnections>();
builder.Services.AddHostedService<LiveSessionSweeper>();

builder.Services.AddScoped<TokenService>();
builder.Services.AddScoped<ScoringService>();
builder.Services.AddSingleton<ScorerTokenGuard>();
builder.Services.AddScoped<RaceFinalService>();
builder.Services.AddScoped<StandingsService>();
builder.Services.AddScoped<MountedGames.Api.Services.EventTools.ResultsBookService>();
builder.Services.AddScoped<MountedGames.Api.Services.EventTools.EventArchiveService>();
builder.Services.AddSingleton<ILiveBroadcaster, LiveBroadcaster>();
builder.Services.AddSingleton<VapidKeyService>();
builder.Services.AddScoped<PushNotifier>();
builder.Services.AddScoped<EquipmentCalculator>();
builder.Services.AddHostedService<NotificationScheduler>();
builder.Services.AddScoped<IpRetention>();
builder.Services.AddScoped<AccountDeletionService>();
builder.Services.AddHostedService<IpRetentionSweeper>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.Configure<StreamingOptions>(builder.Configuration.GetSection("Streaming"));
builder.Services.AddHttpClient(CloudflareSfuClient.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(10))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddSingleton<ISfuClient, CloudflareSfuClient>();
builder.Services.AddSingleton<CompetitionStreamLocks>();
builder.Services.AddSingleton<RedisConnection>();
builder.Services.AddSingleton<SharedViewerCounts>();
builder.Services.AddSingleton<ViewerRegistry>();
builder.Services.AddScoped<StreamLifecycle>();
builder.Services.AddHostedService<StreamSweeper>();

builder.Services.AddHttpClient("weather", c =>
{
    c.Timeout = TimeSpan.FromSeconds(8);
});
// Owns its own size-limited cache (weather keys come from query-string coordinates).
builder.Services.AddSingleton<WeatherCache>(_ => new WeatherCache());
builder.Services.AddHttpClient(PushNotifier.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(10))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
// Email is off unless Email:Enabled, Email:ApiKey and Email:From are all set (see Services/Email).
builder.Services.Configure<MountedGames.Api.Services.Email.EmailOptions>(builder.Configuration.GetSection("Email"));
builder.Services.AddHttpClient(MountedGames.Api.Services.Email.ResendEmailSender.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(15))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddSingleton<MountedGames.Api.Services.Email.LoggingEmailSender>();
builder.Services.AddSingleton<MountedGames.Api.Services.Email.ResendEmailSender>();
builder.Services.AddSingleton<MountedGames.Api.Services.Email.IEmailSender, MountedGames.Api.Services.Email.ConfiguredEmailSender>();
builder.Services.AddScoped<MountedGames.Api.Services.Email.SignupConfirmationService>();
builder.Services.AddScoped<MountedGames.Api.Services.Email.EmailOptInService>();
builder.Services.AddScoped<MountedGames.Api.Services.Email.CustomEmailService>();
builder.Services.AddScoped<MountedGames.Api.Services.Geo.LocationInference>();
builder.Services.AddScoped<MountedGames.Api.Services.Email.EntriesDigestService>();
builder.Services.AddSingleton<MountedGames.Api.Services.Email.EmailConfirmationTokens>();
builder.Services.AddScoped<MountedGames.Api.Services.Email.AccountEmailService>();
builder.Services.AddScoped<MountedGames.Api.Services.Accounts.AccountIpRecorder>();
builder.Services.AddScoped<MountedGames.Api.Services.Accounts.AccountAccessService>();
builder.Services.AddScoped<MountedGames.Api.Services.Accounts.AccountInviteService>();
builder.Services.AddScoped<MountedGames.Api.Services.Accounts.PasswordResetService>();
// Does an address's domain take mail? Short timeout, one retry; a DNS failure lets the sign-up through.
builder.Services.AddSingleton<DnsClient.ILookupClient>(_ => new DnsClient.LookupClient(new DnsClient.LookupClientOptions
{
    Timeout = TimeSpan.FromSeconds(2),
    Retries = 1,
    UseCache = true,
    ThrowDnsErrors = false,
}));
builder.Services.AddSingleton<MountedGames.Api.Services.Email.IEmailDomainChecker, MountedGames.Api.Services.Email.DnsEmailDomainChecker>();
builder.Services.AddHttpClient("geocoding", c =>
{
    c.Timeout = TimeSpan.FromSeconds(6);
});
builder.Services.AddScoped<GeocodingService>();

var corsOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>()
    ?? new[] { "http://localhost:5173", "http://localhost:4173" };
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(corsOrigins)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

// Phones at events are often on one bar of signal: JSON shrinks ~80% compressed.
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<BrotliCompressionProvider>();
    o.Providers.Add<GzipCompressionProvider>();
});
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);
builder.Services.Configure<GzipCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);

builder.Services.AddRequestLimits(builder.Configuration);
builder.Services.AddTrustedProxies(builder.Configuration);
builder.Services.AddProblemDetails();
builder.Services.AddControllers();
builder.Services.AddOpenApi();
var signalR = builder.Services.AddSignalR();
// With several API instances (Vercel scales the container out), Redis carries hub messages between them.
if (RedisBackplane.Options(builder.Configuration) is { } redis)
    signalR.AddStackExchangeRedis(o =>
    {
        o.Configuration = redis;
        o.Configuration.ChannelPrefix = StackExchange.Redis.RedisChannel.Literal("mg-live");
    });

var app = builder.Build();
if (!app.Environment.IsDevelopment() && string.IsNullOrWhiteSpace(app.Configuration["Privacy:IpHashKey"]))
    app.Logger.LogWarning("Privacy:IpHashKey is not set, so stored network hashes are keyed from Jwt:Key. Set Privacy__IpHashKey to a separate secret.");
if (!app.Environment.IsDevelopment()
    && (app.Configuration["VERCEL"] == "1" || app.Environment.IsProduction()
        || app.Configuration.GetValue<bool>("Security:TrustProxyHeaders")
        || (app.Configuration.GetSection("Security:KnownProxies").Get<string[]>()?.Length ?? 0) > 0)
    && string.IsNullOrWhiteSpace(app.Configuration["Security:ProxyKey"]))
{
    app.Logger.LogWarning("Security:ProxyKey is not set. Set Security__ProxyKey so forwarded client IP headers can only come from the trusted edge proxy.");
}

if (args.Contains("--seed-review-competitions"))
{
    await DbInitializer.SeedAsync(app.Services);
    using var scope = app.Services.CreateScope();
    var count = await ReviewCompetitionSeeder.SeedAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), DateTime.UtcNow, DateTime.UtcNow);
    Console.WriteLine($"Created {count} demo competitions with sections, teams, timetables and sample results.");
    return;
}

if (args.Contains("--reseed-review-competitions"))
{
    // Removes only the eight seeder-named events that carry the demo mark, then seeds them again from now.
    await DbInitializer.SeedAsync(app.Services);
    using var scope = app.Services.CreateScope();
    var result = await ReviewCompetitionSeeder.ReseedAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), DateTime.UtcNow);
    Console.WriteLine($"Removed {result.Removed} demo competitions and created {result.Created} fresh ones.");
    foreach (var name in result.Skipped)
        Console.WriteLine($"Left \"{name}\" alone: it does not carry the demo mark, so it was not removed or replaced.");
    return;
}

if (args.Contains("--seed-history"))
{
    // Fictional clubs, riders, past competitions, a season and shop listings. Removes only what an earlier run made.
    await DbInitializer.SeedAsync(app.Services);
    using var scope = app.Services.CreateScope();
    var history = await HistorySeeder.SeedAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), DateTime.UtcNow);
    Console.WriteLine($"Cleared {history.Removed} earlier history competitions, then created {history.Competitions} competitions "
        + $"({history.Teams} teams, {history.Races} races, {history.Results} results), {history.Clubs} clubs, {history.Riders} riders, "
        + $"{history.Ponies} ponies, {history.Seasons} season with {history.TeamProfiles} team profiles, {history.ShopPosts} shop posts "
        + $"and {history.CatalogueItems} event shop items.");
    return;
}

if (args.Contains("--import-competition"))
{
    // A real event from a JSON file kept outside the repo (riders' names never go in source control). Refuses an event that exists;
    // --finals-only adds the file's empty finals heats to it instead.
    var path = args.SkipWhile(a => a != "--import-competition").Skip(1).FirstOrDefault();
    if (string.IsNullOrWhiteSpace(path) || path.StartsWith("--") || !File.Exists(path))
    {
        Console.Error.WriteLine(string.IsNullOrWhiteSpace(path) || path.StartsWith("--")
            ? "Give the event file after --import-competition, for example --import-competition /full/path/west-mids-pairs.json"
            : $"Can't find {Path.GetFullPath(path)}.");
        Environment.ExitCode = 1;
        return;
    }
    await DbInitializer.SeedAsync(app.Services);
    using var scope = app.Services.CreateScope();
    try
    {
        var file = CompetitionFileImport.Parse(await File.ReadAllTextAsync(path));
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var dryRun = args.Contains("--dry-run");
        if (args.Contains("--finals-only"))
        {
            // Adds the file's empty finals heats to the event imported earlier.
            var added = await CompetitionFileImport.AddFinalsAsync(db, file, dryRun);
            Console.WriteLine($"{(added.DryRun ? "Checked (nothing saved)" : "Added")} finals to competition {added.CompetitionId}: "
                + $"{added.Sessions} finals sessions, {added.Heats} finals, {added.Races} races, no teams.");
            return;
        }
        var imported = await CompetitionFileImport.ImportAsync(db, file, dryRun);
        Console.WriteLine($"{(imported.DryRun ? "Checked (nothing saved)" : $"Imported competition {imported.CompetitionId}")}: "
            + $"{imported.Sections} sections, {imported.Sessions} sessions, {imported.Heats} heats, {imported.Teams} teams, "
            + $"{imported.Riders} riders, {imported.Races} races.");
    }
    catch (CompetitionImportException ex)
    {
        Console.Error.WriteLine(ex.Message);
        Environment.ExitCode = 1;
    }
    return;
}

if (args.Contains(DemoDataCleaner.Flag))
{
    // One-off: deletes every competition but --keep-competition, with seasons, seeder accounts and unused clubs.
    // A dry run unless --apply. Doesn't run DbInitializer, so a dry run writes nothing. See docs/neon-setup.md.
    Environment.ExitCode = await DemoDataCleaner.RunCommandAsync(app.Services, args, Console.Out, Console.Error);
    return;
}

if (migrateDatabase)
{
    if (!DatabaseConfiguration.UsesPostgres(builder.Configuration))
        throw new InvalidOperationException("The migration command requires PostgreSQL configuration.");
    using var scope = app.Services.CreateScope();
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
    Console.WriteLine("PostgreSQL migrations applied successfully.");
    return;
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseForwardedHeaders();
// Before anything reads the client IP (rate limits, IP blocks, chat and shop records).
app.UseMiddleware<ProxyClientIpMiddleware>();
app.UseMiddleware<SecurityHeadersMiddleware>();
app.UseExceptionHandler();
app.UseRouting();

// Not for sign-in responses (they carry tokens) or the SignalR hub.
app.UseWhen(
    ctx => !ctx.Request.Path.StartsWithSegments("/api/auth") && !ctx.Request.Path.StartsWithSegments("/hubs"),
    branch => branch.UseResponseCompression());

app.UseCors();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

app.UseWhen(
    ctx => HttpMethods.IsGet(ctx.Request.Method) && ctx.Request.Path.StartsWithSegments("/api"),
    branch => branch.UseMiddleware<JsonEtagMiddleware>());

// In production, the Vite SPA is copied into wwwroot by the Dockerfile.
// Serve it as static files and fall back to index.html so React Router
// handles client-side routes (e.g. /admin/rules, /competitions/3/arena).
var wwwroot = Path.Combine(app.Environment.ContentRootPath, "wwwroot");
if (Directory.Exists(wwwroot))
{
    app.UseDefaultFiles();
    app.UseStaticFiles(new StaticFileOptions
    {
        // Vite fingerprints everything under /assets, so phones never need to re-check it.
        OnPrepareResponse = ctx =>
        {
            if (ctx.Context.Request.Path.StartsWithSegments("/assets"))
                ctx.Context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        }
    });
}

app.MapControllers();
// A connection signed in with a token closes when the token expires; ended sessions close theirs at once (LiveConnections).
app.MapHub<LiveHub>("/hubs/live", options => options.CloseOnAuthenticationExpiration = true);

// SPA fallback — anything that isn't an API/hub/static file falls through to index.html.
if (Directory.Exists(wwwroot))
{
    app.MapFallbackToFile("index.html");
}

// Tiny health endpoint for the deployment platform's checks.
app.MapGet("/healthz", () => Results.Ok(new { ok = true })).AllowAnonymous();

// Ensure the SQLite folder exists when the connection string points at /data/mg.db (Fly volume).
if (!DatabaseConfiguration.UsesPostgres(builder.Configuration))
    EnsureSqliteFolderExists(connectionString);

await DbInitializer.SeedAsync(app.Services);

app.Run();

static void EnsureSqliteFolderExists(string connStr)
{
    var marker = "Data Source=";
    var idx = connStr.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
    if (idx < 0) return;
    var path = connStr[(idx + marker.Length)..].Split(';')[0].Trim();
    var dir = Path.GetDirectoryName(path);
    if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
        Directory.CreateDirectory(dir);
}

// Exposed so WebApplicationFactory<Program> can host the app in integration tests.
public partial class Program { }
