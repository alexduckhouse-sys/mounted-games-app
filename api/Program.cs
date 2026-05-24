using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? "Data Source=mg.db";

builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseSqlite(connectionString));

builder.Services
    .AddIdentity<AppUser, IdentityRole>(o =>
    {
        o.Password.RequireDigit = true;
        o.Password.RequireLowercase = true;
        o.Password.RequireUppercase = false;
        o.Password.RequireNonAlphanumeric = true;
        o.Password.RequiredLength = 8;
        o.User.RequireUniqueEmail = true;
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

builder.Services.AddHttpClient("weather", c =>
{
    c.Timeout = TimeSpan.FromSeconds(8);
});
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

builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.AddSignalR();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// In production, the Vite SPA is copied into wwwroot by the Dockerfile.
// Serve it as static files and fall back to index.html so React Router
// handles client-side routes (e.g. /admin/rules, /competitions/3/arena).
var wwwroot = Path.Combine(app.Environment.ContentRootPath, "wwwroot");
if (Directory.Exists(wwwroot))
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
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
