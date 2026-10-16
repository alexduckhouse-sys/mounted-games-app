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
            }
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddScoped<TokenService>();
builder.Services.AddScoped<ScoringService>();
builder.Services.AddSingleton<ILiveBroadcaster, LiveBroadcaster>();
builder.Services.AddSingleton<VapidKeyService>();
builder.Services.AddScoped<PushNotifier>();
builder.Services.AddScoped<EquipmentCalculator>();
builder.Services.AddHostedService<NotificationScheduler>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.Configure<StreamingOptions>(builder.Configuration.GetSection("Streaming"));
builder.Services.AddHttpClient(CloudflareSfuClient.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(10))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddSingleton<ISfuClient, CloudflareSfuClient>();
builder.Services.AddSingleton<CompetitionStreamLocks>();
builder.Services.AddSingleton<ViewerRegistry>();
builder.Services.AddScoped<StreamLifecycle>();
builder.Services.AddHostedService<StreamSweeper>();

builder.Services.AddHttpClient("weather", c =>
{
    c.Timeout = TimeSpan.FromSeconds(8);
});
builder.Services.AddHttpClient(PushNotifier.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(10))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
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
builder.Services.AddSignalR();

var app = builder.Build();

if (args.Contains("--seed-review-competitions"))
{
    await DbInitializer.SeedAsync(app.Services);
    using var scope = app.Services.CreateScope();
    var count = await ReviewCompetitionSeeder.SeedAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), DateTime.UtcNow);
    Console.WriteLine($"Created {count} demo competitions with sections, teams, timetables and sample results.");
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
app.MapHub<LiveHub>("/hubs/live");

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
