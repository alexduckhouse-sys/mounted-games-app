using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MountedGames.Api.Data;
using System.Threading.Channels;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Privacy;

public class CompetitionDataRetentionTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private sealed record Seed(int CompetitionId, int RiderId, int FormId, int SignupId, int SavedId);

    private async Task<Seed> SeedAsync(DateTime start, DateTime? end)
    {
        var arena = await factory.CreateArenaAsync(1);
        return await factory.WithDbAsync(async db =>
        {
            var competition = await db.Competitions.SingleAsync(c => c.Id == arena.CompetitionId);
            competition.StartDate = start;
            competition.EndDate = end;
            var team = await db.Teams.SingleAsync(t => t.Id == arena.TeamIds[0]);
            var saved = new SavedRider { ClubId = team.ClubId, FullName = "Fake TestSurname", UseInitialOnly = true };
            var rider = new RiderEntry
            {
                FullName = "Fake TestSurname", DateOfBirth = new DateTime(2015, 4, 3), SavedRider = saved,
                UseInitialOnly = true, HorseName = "Fake Pony", MedicalNotes = "FAKE_MEDICAL",
                WeightKg = 40, EmergencyContactName = "Fake Contact", EmergencyContactPhone = "07700900001",
                PonyPassportNumber = "FAKE_PASSPORT",
            };
            var form = new DeclarationForm { TeamId = team.Id, TrainerPhone = "07700900002", IsLocked = true, Riders = [rider] };
            var signup = new SectionSignup { CompetitionSectionId = team.CompetitionSectionId, FullName = "Fake Entrant", TeamId = team.Id };
            db.AddRange(form, signup);
            await db.SaveChangesAsync();
            db.Add(new SignupGuestDetails
            {
                SignupId = signup.Id, RiderName = "Fake TestSurname", PonyName = "Fake Pony", RiderDateOfBirth = new DateTime(2015, 4, 3),
                EmergencyContactName = "Fake Contact", EmergencyContactPhone = "07700900001",
                GuardianName = "Fake Guardian", GuardianPhone = "07700900002",
            });
            await db.SaveChangesAsync();
            return new Seed(competition.Id, rider.Id, form.Id, signup.Id, saved.Id);
        });
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ExpiredDetailsAreCleared_ButIdentityAndResultsRemain(bool hasEndDate)
    {
        var clock = new ManualTimeProvider();
        var now = clock.GetUtcNow().UtcDateTime;
        var seed = await SeedAsync(now.AddDays(-20), hasEndDate ? now.AddDays(-8) : null);
        var originalResults = await factory.WithDbAsync(db => db.Results.CountAsync());

        var changed = await factory.WithDbAsync(db => new CompetitionDataRetention(db, clock).SweepAsync());

        Assert.True(changed >= 3);
        await factory.WithDbAsync(async db =>
        {
            var rider = await db.RiderEntries.SingleAsync(r => r.Id == seed.RiderId);
            Assert.Null(rider.MedicalNotes);
            Assert.Null(rider.WeightKg);
            Assert.Null(rider.EmergencyContactName);
            Assert.Null(rider.EmergencyContactPhone);
            Assert.Null(rider.PonyPassportNumber);
            Assert.Null(rider.DateOfBirth);
            Assert.Equal(2015, rider.BirthYear);
            Assert.Equal("Fake TestSurname", rider.FullName);
            Assert.Equal("Fake Pony", rider.HorseName);
            Assert.Equal(seed.SavedId, rider.SavedRiderId);
            Assert.True(rider.UseInitialOnly);
            var form = await db.DeclarationForms.SingleAsync(d => d.Id == seed.FormId);
            Assert.Null(form.TrainerPhone);
            Assert.True(form.IsLocked);
            var guest = await db.Set<SignupGuestDetails>().SingleAsync(g => g.SignupId == seed.SignupId);
            Assert.Null(guest.EmergencyContactName);
            Assert.Null(guest.EmergencyContactPhone);
            Assert.Null(guest.GuardianName);
            Assert.Null(guest.GuardianPhone);
            Assert.Null(guest.RiderDateOfBirth);
            Assert.Equal("Fake TestSurname", guest.RiderName);
            Assert.Equal("Fake Pony", guest.PonyName);
            Assert.Equal(originalResults, await db.Results.CountAsync());
            return true;
        });
        Assert.Equal(0, await factory.WithDbAsync(db => new CompetitionDataRetention(db, clock).SweepAsync()));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CutoffIsStrict_AndAdvancingTheClockMakesTheRecordDue(bool hasEndDate)
    {
        var clock = new ManualTimeProvider();
        var now = clock.GetUtcNow().UtcDateTime;
        var seed = await SeedAsync(now.AddDays(-14), hasEndDate ? now.AddDays(-7) : null);
        await factory.WithDbAsync(db => new CompetitionDataRetention(db, clock).SweepAsync());
        Assert.Equal("FAKE_MEDICAL", await factory.WithDbAsync(db => db.RiderEntries.Where(r => r.Id == seed.RiderId).Select(r => r.MedicalNotes).SingleAsync()));
        clock.Advance(TimeSpan.FromSeconds(1));
        await factory.WithDbAsync(db => new CompetitionDataRetention(db, clock).SweepAsync());
        Assert.Null(await factory.WithDbAsync(db => db.RiderEntries.Where(r => r.Id == seed.RiderId).Select(r => r.MedicalNotes).SingleAsync()));
    }

    [Fact]
    public async Task AnOldStartDoesNotPurgeAnEventThatIsStillRunning()
    {
        var clock = new ManualTimeProvider();
        var seed = await SeedAsync(clock.GetUtcNow().UtcDateTime.AddDays(-40), clock.GetUtcNow().UtcDateTime.AddDays(1));
        await factory.WithDbAsync(db => new CompetitionDataRetention(db, clock).SweepAsync());
        Assert.Equal("FAKE_MEDICAL", await factory.WithDbAsync(db => db.RiderEntries.Where(r => r.Id == seed.RiderId).Select(r => r.MedicalNotes).SingleAsync()));
    }
    [Fact]
    public async Task SweeperCatchesUpAtStartup_AndRepeatsDailyWithTheAppClock()
    {
        var clock = new ManualTimeProvider();
        var seed = await SeedAsync(clock.GetUtcNow().UtcDateTime.AddDays(-20), null);
        var connection = await factory.WithDbAsync(db => Task.FromResult(db.Database.GetConnectionString()));
        var services = new ServiceCollection();
        services.AddDbContext<AppDbContext>(options => options.UseSqlite(connection));
        services.AddSingleton<TimeProvider>(clock);
        services.AddScoped<CompetitionDataRetention>();
        await using var provider = services.BuildServiceProvider();
        var logger = new SweepLogger();
        using var sweeper = new CompetitionDataRetentionSweeper(provider.GetRequiredService<IServiceScopeFactory>(), clock, logger, TimeSpan.Zero);

        await sweeper.StartAsync(CancellationToken.None);
        await logger.Completed.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Null(await factory.WithDbAsync(db => db.RiderEntries.Where(r => r.Id == seed.RiderId).Select(r => r.MedicalNotes).SingleAsync()));
        await factory.WithDbAsync(db => db.RiderEntries.Where(r => r.Id == seed.RiderId)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.MedicalNotes, "FAKE_LATE_DETAIL")));
        clock.Advance(TimeSpan.FromDays(1));
        await logger.Completed.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(10));
        await sweeper.StopAsync(CancellationToken.None);
        Assert.Null(await factory.WithDbAsync(db => db.RiderEntries.Where(r => r.Id == seed.RiderId).Select(r => r.MedicalNotes).SingleAsync()));
    }

    private sealed class SweepLogger : ILogger<CompetitionDataRetentionSweeper>
    {
        public Channel<bool> Completed { get; } = Channel.CreateUnbounded<bool>();
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (logLevel == LogLevel.Information) Completed.Writer.TryWrite(true);
            else if (logLevel == LogLevel.Warning) Completed.Writer.TryComplete(new InvalidOperationException("Retention sweep failed."));
        }
    }

}
