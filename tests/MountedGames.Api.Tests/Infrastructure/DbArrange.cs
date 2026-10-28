using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>Direct database access for arranging and asserting state around HTTP calls.</summary>
public static class DbArrange
{
    public static Task<T> InDbAsync<T>(this ApiFactory f, Func<AppDbContext, Task<T>> work) => f.WithDbAsync(work);

    public static Task InDbAsync(this ApiFactory f, Func<AppDbContext, Task> work) => f.WithDbAsync(work);

    /// <summary>Creates a fresh competition with one section, isolated from the seeded data.</summary>
    public static Task<CompetitionSection> NewSectionAsync(
        this ApiFactory f, SectionFormat format = SectionFormat.Teams, int priceMinor = 0,
        int? max = null, bool locked = false)
        => f.InDbAsync(async db =>
        {
            var comp = new Competition
            {
                Name = $"Test comp {Guid.NewGuid():N}",
                StartDate = DateTime.UtcNow.AddDays(10),
                SignupsLocked = locked,
            };
            var section = new CompetitionSection
            {
                Competition = comp,
                Format = format,
                AgeGroup = "U12",
                DisplayName = "U12 test",
                PriceMinor = priceMinor,
                MaxParticipants = max,
            };
            db.CompetitionSections.Add(section);
            await db.SaveChangesAsync();
            return section;
        });

    /// <summary>Marks a section's pending entries paid straight in the database, without forming teams, so form-teams tests start from paid but unformed entries.</summary>
    public static Task PayPendingAsync(this ApiFactory f, int sectionId)
        => f.InDbAsync(async db =>
        {
            foreach (var s in db.SectionSignups.Where(x => x.CompetitionSectionId == sectionId && x.Status == SignupPaymentStatus.Pending))
            {
                s.Status = SignupPaymentStatus.Paid;
                s.PaidAt = DateTime.UtcNow;
            }
            await db.SaveChangesAsync();
        });
}
