using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Sponsors;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Sponsors;

public class SponsorsSchemaTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public SponsorsSchemaTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task AnExistingSqliteDatabaseGainsSponsorsAndKeepsItsOverlays()
    {
        var comp = await _f.SeedCompetitionAsync();
        await _f.InDbAsync(async db =>
        {
            db.StreamOverlays.Add(new StreamOverlay { CompetitionId = comp, BannerText = "Lunch", Revision = 3, SponsorMode = OverlayMode.On });
            await db.SaveChangesAsync();
            await db.Database.ExecuteSqlRawAsync("DROP TABLE SponsorExposures; DROP TABLE Sponsors; ALTER TABLE StreamOverlays DROP COLUMN SponsorMode;");
        });

        await DbInitializer.SeedAsync(_f.Services);

        await _f.InDbAsync(async db =>
        {
            var overlay = await db.StreamOverlays.AsNoTracking().SingleAsync(o => o.CompetitionId == comp);
            Assert.Equal(("Lunch", 3, OverlayMode.Auto), (overlay.BannerText, overlay.Revision, overlay.SponsorMode));
            var sponsor = new Sponsor { CompetitionId = comp, Name = "Acme", ShowOn = SponsorPlacement.Timetable, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
            db.Sponsors.Add(sponsor);
            await db.SaveChangesAsync();
            db.SponsorExposures.Add(new SponsorExposure { SponsorId = sponsor.Id, Day = DateTime.UtcNow.Date, Placement = SponsorPlacement.Timetable, Views = 1 });
            await db.SaveChangesAsync();
            // A second start finds the tables and leaves them alone.
            await SponsorsSqliteSchema.EnsureAsync(db);
            Assert.Equal(1, await db.SponsorExposures.CountAsync(e => e.SponsorId == sponsor.Id));
        });
    }
}
