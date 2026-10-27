using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Email;

namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>
/// The email-enabled host with a clock the test sets and a small batch size, for the "entries are open" digest. Tests share one
/// database, so each starts with <see cref="ResetAsync"/>: no runs, no opt-ins, every existing competition archived.
/// </summary>
public sealed class DigestApiFactory : EmailApiFactory
{
    public ManualTimeProvider Clock { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Email:DigestBatchSize", "3");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);
        });
    }

    /// <summary>Moves the clock to this UTC instant (forwards or back).</summary>
    public void At(int year, int month, int day, int hour, int minute = 0)
        => Clock.Advance(new DateTimeOffset(year, month, day, hour, 0, 0, TimeSpan.Zero).AddMinutes(minute) - Clock.GetUtcNow());

    public async Task ResetAsync()
    {
        Sent.Clear();
        Fail = null;
        await this.InDbAsync(async db =>
        {
            await db.EntriesDigestRuns.ExecuteDeleteAsync();
            await db.EmailOptIns.ExecuteDeleteAsync();
            await db.Competitions.ExecuteUpdateAsync(s => s.SetProperty(c => c.IsArchived, true));
        });
    }

    public async Task<int> OpenEventAsync(string name, int daysAhead = 10, double? lat = null, double? lon = null, string? venue = null,
        bool locked = false, bool demo = false, bool sections = true, DateTime? closeAt = null, bool archived = false)
    {
        var start = Clock.GetUtcNow().UtcDateTime.Date.AddDays(daysAhead);
        return await this.InDbAsync(async db =>
        {
            var c = new Competition
            {
                Name = name, StartDate = start, Location = venue, Latitude = lat, Longitude = lon,
                SignupsLocked = locked, IsArchived = archived,
            };
            db.Competitions.Add(c);
            await db.SaveChangesAsync();
            if (sections)
            {
                db.CompetitionSections.Add(new CompetitionSection { CompetitionId = c.Id, Format = SectionFormat.Teams, AgeGroup = "Under 12", DisplayName = "Under 12" });
                await db.SaveChangesAsync();
            }
            if (demo) db.Set<MountedGames.Api.Entities.Commerce.EventCommerceSettings>().Add(new() { CompetitionId = c.Id, IsDemo = true });
            if (closeAt is { } close) db.Set<CompetitionEntrySettings>().Add(new CompetitionEntrySettings { CompetitionId = c.Id, EntriesCloseAt = close });
            await db.SaveChangesAsync();
            return c.Id;
        });
    }

    public async Task<List<int>> OptInsAsync(params string[] addresses)
    {
        return await this.InDbAsync(async db =>
        {
            var rows = addresses.Select(a => new EmailOptIn { Email = a, WordingVersion = "w", Source = "signup-form", UnsubscribeTokenHash = Guid.NewGuid().ToString("N") }).ToList();
            db.EmailOptIns.AddRange(rows);
            await db.SaveChangesAsync();
            return rows.Select(r => r.Id).ToList();
        });
    }

    public async Task TickAsync(bool allowBaseline = false)
    {
        using var scope = Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<EntriesDigestService>().TickAsync(allowBaseline, CancellationToken.None);
    }

    public List<SentMessage> SentTo(string address) => Sent.Where(m => m.To == address).ToList();
}
