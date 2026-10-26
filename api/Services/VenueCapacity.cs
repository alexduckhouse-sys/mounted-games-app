using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;

namespace MountedGames.Api.Services;

public record VenueCapacitySnapshot(
    int? MaxStables,
    int? MaxHookups,
    int StablesBooked,
    int HookupsBooked,
    int? StablesRemaining,
    int? HookupsRemaining);

public static class VenueCapacity
{
    public static bool IsStableTitle(string? title)
    {
        if (string.IsNullOrWhiteSpace(title)) return false;
        var hasStable = title.Contains("stable", StringComparison.OrdinalIgnoreCase)
            || title.Contains("stabling", StringComparison.OrdinalIgnoreCase);
        if (!hasStable) return false;
        return !title.Contains("shaving", StringComparison.OrdinalIgnoreCase)
            && !title.Contains("hay", StringComparison.OrdinalIgnoreCase)
            && !title.Contains("bedding", StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsHookupTitle(string? title)
    {
        if (string.IsNullOrWhiteSpace(title)) return false;
        return title.Contains("hook-up", StringComparison.OrdinalIgnoreCase)
            || title.Contains("hook up", StringComparison.OrdinalIgnoreCase)
            || title.Contains("hookup", StringComparison.OrdinalIgnoreCase)
            || title.Contains("electric", StringComparison.OrdinalIgnoreCase);
    }

    public static async Task<VenueCapacitySnapshot> GetCapacityAsync(
        AppDbContext db,
        int competitionId,
        int? excludeSignupId = null,
        int? excludeOrderId = null,
        CancellationToken ct = default)
    {
        var settings = await db.Set<CompetitionEntrySettings>()
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CompetitionId == competitionId, ct);

        var signupRows = await (
            from s in db.SectionSignups.AsNoTracking()
            join sec in db.CompetitionSections.AsNoTracking() on s.CompetitionSectionId equals sec.Id
            join e in db.Set<SignupExtras>().AsNoTracking() on s.Id equals e.SignupId
            join m in db.Set<SignupMatchmaking>().AsNoTracking() on s.Id equals m.SignupId into mj
            from m in mj.DefaultIfEmpty()
            where sec.CompetitionId == competitionId
                && (!excludeSignupId.HasValue || s.Id != excludeSignupId.Value)
                && (s.Status == SignupPaymentStatus.Paid || s.Status == SignupPaymentStatus.Pending)
                && !e.IsWithdrawn
                && !e.IsWaitlist
                && (m == null || !m.WaitingForGuestSpot)
            select new { e.StablesCount, e.HookupsCount }
        ).ToListAsync(ct);

        var entryStables = signupRows.Sum(x => Math.Max(0, x.StablesCount));
        var entryHookups = signupRows.Sum(x => Math.Max(0, x.HookupsCount));

        var orderLines = await (
            from line in db.Set<EventOrderLine>().AsNoTracking()
            join order in db.Set<EventOrder>().AsNoTracking() on line.EventOrderId equals order.Id
            where order.CompetitionId == competitionId
                && (!excludeOrderId.HasValue || order.Id != excludeOrderId.Value)
                && (order.Status == CommerceOrderStatus.AwaitingManualPayment
                    || order.Status == CommerceOrderStatus.AwaitingTestPayment
                    || order.Status == CommerceOrderStatus.Paid)
            select new { line.TitleSnapshot, line.Quantity }
        ).ToListAsync(ct);

        var shopStables = 0;
        var shopHookups = 0;
        foreach (var line in orderLines)
        {
            var qty = Math.Max(0, line.Quantity);
            if (IsStableTitle(line.TitleSnapshot)) shopStables += qty;
            if (IsHookupTitle(line.TitleSnapshot)) shopHookups += qty;
        }

        var stablesBooked = entryStables + shopStables;
        var hookupsBooked = entryHookups + shopHookups;
        int? stablesRemaining = settings?.MaxStables is int maxS ? Math.Max(0, maxS - stablesBooked) : null;
        int? hookupsRemaining = settings?.MaxHookups is int maxH ? Math.Max(0, maxH - hookupsBooked) : null;

        return new VenueCapacitySnapshot(
            settings?.MaxStables,
            settings?.MaxHookups,
            stablesBooked,
            hookupsBooked,
            stablesRemaining,
            hookupsRemaining);
    }

    public static string? CheckCapacityError(
        VenueCapacitySnapshot capacity,
        int requestedStables,
        int requestedHookups)
    {
        if (requestedStables > 0 && capacity.MaxStables is int maxStables)
        {
            var available = Math.Max(0, maxStables - capacity.StablesBooked);
            if (requestedStables > available)
            {
                return available == 0
                    ? "All stables are booked at this venue."
                    : $"Only {available} {(available == 1 ? "stable" : "stables")} remaining at this venue.";
            }
        }

        if (requestedHookups > 0 && capacity.MaxHookups is int maxHookups)
        {
            var available = Math.Max(0, maxHookups - capacity.HookupsBooked);
            if (requestedHookups > available)
            {
                return available == 0
                    ? "All electric hook-ups are booked."
                    : $"Only {available} electric {(available == 1 ? "hook-up" : "hook-ups")} remaining at this venue.";
            }
        }

        return null;
    }
}
