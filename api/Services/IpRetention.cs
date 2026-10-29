using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services;

/// <summary>
/// Raw IP addresses are kept on chat messages and marketplace posts, comments and reports so an admin can block
/// an abusive poster. After <see cref="Days"/> days the address is replaced with a keyed hash
/// (HMAC-SHA256, shortened), so the database no longer holds the address but repeat posters can still be matched
/// by someone who holds the key. Hashed values start with <see cref="HashPrefix"/>, which also keeps the sweep
/// idempotent and tells the block-author action there is no address to block.
/// </summary>
public sealed class IpRetention(AppDbContext db, TimeProvider time, IConfiguration configuration)
{
    public const string HashPrefix = "h1:";
    public const int DefaultDays = 30;
    private const int BatchSize = 500;

    public int Days => Math.Max(1, configuration.GetValue("Privacy:IpRetentionDays", DefaultDays));

    public static bool IsHashed(string? value) => value?.StartsWith(HashPrefix, StringComparison.Ordinal) == true;

    /// <summary>Hashes every stored address older than the retention period. Returns how many rows changed.</summary>
    public async Task<int> SweepAsync(CancellationToken ct = default)
    {
        var cutoff = time.GetUtcNow().UtcDateTime.AddDays(-Days);
        var key = Key();
        const string prefix = HashPrefix;
        var changed = 0;
        changed += await SweepAsync(db.ChatMessages.Where(r => r.CreatedAt < cutoff && r.IpAddress != null && !r.IpAddress.StartsWith(prefix)),
            (r, v) => r.IpAddress = v, r => r.IpAddress!, key, ct);
        changed += await SweepAsync(db.ShopPosts.Where(r => r.CreatedAt < cutoff && r.IpAddress != null && !r.IpAddress.StartsWith(prefix)),
            (r, v) => r.IpAddress = v, r => r.IpAddress!, key, ct);
        changed += await SweepAsync(db.ShopComments.Where(r => r.CreatedAt < cutoff && r.IpAddress != null && !r.IpAddress.StartsWith(prefix)),
            (r, v) => r.IpAddress = v, r => r.IpAddress!, key, ct);
        changed += await SweepAsync(db.ShopReports.Where(r => r.CreatedAt < cutoff && r.IpAddress != null && !r.IpAddress.StartsWith(prefix)),
            (r, v) => r.IpAddress = v, r => r.IpAddress!, key, ct);
        return changed;
    }

    // Each pass takes a batch of rows still holding a raw address, so the query always shrinks.
    private async Task<int> SweepAsync<T>(IQueryable<T> due, Action<T, string> write, Func<T, string> read, byte[] key,
        CancellationToken ct) where T : class
    {
        var total = 0;
        while (true)
        {
            var batch = await due.Take(BatchSize).ToListAsync(ct);
            if (batch.Count == 0) return total;
            foreach (var row in batch) write(row, Hash(read(row), key));
            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
            total += batch.Count;
        }
    }

    internal static string Hash(string ip, byte[] key)
    {
        var mac = HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(ip.Trim()));
        return HashPrefix + Convert.ToHexString(mac, 0, 16).ToLowerInvariant();
    }

    /// <summary>The keyed hash of an address, in the form stored once retention has run (and for account blocks).</summary>
    public static string HashFor(IConfiguration configuration, string ip) => Hash(ip, KeyFor(configuration));

    private byte[] Key() => KeyFor(configuration);

    /// <summary>Its own key (<c>Privacy:IpHashKey</c>) when set; otherwise derived from the JWT key for a different purpose.</summary>
    internal static byte[] KeyFor(IConfiguration configuration)
    {
        var own = configuration["Privacy:IpHashKey"];
        if (!string.IsNullOrWhiteSpace(own)) return Encoding.UTF8.GetBytes(own);
        var jwt = configuration["Jwt:Key"] ?? "dev-only-secret-please-change-me-256-bit-min!!";
        return HMACSHA256.HashData(Encoding.UTF8.GetBytes(jwt), "mg-ip-retention-v1"u8);
    }
}

/// <summary>
/// Runs <see cref="IpRetention"/> shortly after start-up and then every few hours. The API can scale to zero,
/// so the start-up run matters as much as the timer.
/// </summary>
public sealed class IpRetentionSweeper(IServiceScopeFactory scopes, TimeProvider time, ILogger<IpRetentionSweeper> log,
    TimeSpan? startupDelay = null, TimeSpan? interval = null) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            // Let migrations and seeding finish before touching the tables.
            var delay = startupDelay ?? TimeSpan.FromSeconds(15);
            if (delay > TimeSpan.Zero) await Task.Delay(delay, time, stoppingToken);
            using var timer = new PeriodicTimer(interval ?? TimeSpan.FromHours(6), time);
            do { await RunOnceAsync(stoppingToken); }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    public async Task RunOnceAsync(CancellationToken ct)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var changed = await scope.ServiceProvider.GetRequiredService<IpRetention>().SweepAsync(ct);
            if (changed > 0) log.LogInformation("Replaced {Count} stored IP addresses older than the retention period with hashes.", changed);
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            log.LogWarning("IP retention sweep could not complete.");
        }
    }
}

/// <summary>Removes event-only personal details while retaining rider identity and competition history.</summary>
public sealed class CompetitionDataRetention(AppDbContext db, TimeProvider time)
{
    public async Task<int> SweepAsync(CancellationToken ct = default)
    {
        var endedBefore = time.GetUtcNow().UtcDateTime.AddDays(-7);
        var startedBefore = time.GetUtcNow().UtcDateTime.AddDays(-14);
        var expired = db.Competitions.Where(c => c.EndDate != null
            ? c.EndDate < endedBefore
            : c.StartDate < startedBefore).Select(c => c.Id);
        // Set-based, idempotent updates avoid loading sensitive values or racing another instance's sweep.
        var riders = db.RiderEntries.Where(r => expired.Contains(r.DeclarationForm!.Team!.CompetitionId)
            && (r.MedicalNotes != null || r.EmergencyContactName != null || r.EmergencyContactPhone != null
                || r.WeightKg != null || r.PonyPassportNumber != null || r.DateOfBirth != null));
        var changed = await riders.ExecuteUpdateAsync(s => s
            .SetProperty(r => r.MedicalNotes, (string?)null)
            .SetProperty(r => r.EmergencyContactName, (string?)null)
            .SetProperty(r => r.EmergencyContactPhone, (string?)null)
            .SetProperty(r => r.WeightKg, (decimal?)null)
            .SetProperty(r => r.PonyPassportNumber, (string?)null)
            .SetProperty(r => r.BirthYear, r => r.DateOfBirth != null ? r.DateOfBirth.Value.Year : r.BirthYear)
            .SetProperty(r => r.DateOfBirth, (DateTime?)null), ct);
        changed += await db.DeclarationForms.Where(d => expired.Contains(d.Team!.CompetitionId) && d.TrainerPhone != null)
            .ExecuteUpdateAsync(s => s.SetProperty(d => d.TrainerPhone, (string?)null), ct);
        var signups = db.SectionSignups.Where(s => expired.Contains(s.Section!.CompetitionId)).Select(s => s.Id);
        // Guest details have no birth-year field. The linked declaration retains the year for results;
        // discard the guest copy instead of substituting a made-up birthday.
        changed += await db.Set<MountedGames.Api.Entities.SignupGuestDetails>()
            .Where(g => signups.Contains(g.SignupId) && (g.EmergencyContactName != null || g.EmergencyContactPhone != null
                || g.GuardianName != null || g.GuardianPhone != null || g.RiderDateOfBirth != null))
            .ExecuteUpdateAsync(s => s
                .SetProperty(g => g.EmergencyContactName, (string?)null)
                .SetProperty(g => g.EmergencyContactPhone, (string?)null)
                .SetProperty(g => g.GuardianName, (string?)null)
                .SetProperty(g => g.GuardianPhone, (string?)null)
                .SetProperty(g => g.RiderDateOfBirth, (DateTime?)null), ct);
        return changed;
    }
}

/// <summary>Runs on startup and daily while an API instance is awake, catching up after scale-to-zero.</summary>
public sealed class CompetitionDataRetentionSweeper(IServiceScopeFactory scopes, TimeProvider time,
    ILogger<CompetitionDataRetentionSweeper> log, TimeSpan? startupDelay = null, TimeSpan? interval = null) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            var delay = startupDelay ?? TimeSpan.FromSeconds(15);
            if (delay > TimeSpan.Zero) await Task.Delay(delay, time, stoppingToken);
            using var timer = new PeriodicTimer(interval ?? TimeSpan.FromDays(1), time);
            do { await RunOnceAsync(stoppingToken); }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }

    public async Task RunOnceAsync(CancellationToken ct)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var changed = await scope.ServiceProvider.GetRequiredService<CompetitionDataRetention>().SweepAsync(ct);
            if (changed > 0) log.LogInformation("Cleared expired event personal details from {Count} records.", changed);
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            log.LogWarning("Competition data retention sweep could not complete.");
        }
    }
}
