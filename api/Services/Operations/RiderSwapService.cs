using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Services.Operations;

public sealed class DeclarationLockedException(string message) : InvalidOperationException(message);

public record EmergencyReplacementInput(
    string? ReplacementRiderName = null,
    string? ReplacementHorseName = null
);

/// <summary>
/// An organiser brings a reserve in for a rider on a team's current declaration, or records an emergency
/// rider/pony replacement (e.g. Referee-approved when no declared reserve exists). The two riders trade places
/// (the one coming out becomes a reserve, so it can be reversed) and the captain badge follows the seat.
/// Every swap is written to <see cref="RiderSwapEvent"/> with the before and after, who did it and why.
/// </summary>
public class RiderSwapService(AppDbContext db)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public const int MaxReasonLength = 500;

    private static (string? RiderName, string? HorseName) ParseEmergencyHeader(string reason, EmergencyReplacementInput? explicitInput)
    {
        if (explicitInput is not null && (!string.IsNullOrWhiteSpace(explicitInput.ReplacementRiderName) || !string.IsNullOrWhiteSpace(explicitInput.ReplacementHorseName)))
        {
            return (explicitInput.ReplacementRiderName?.Trim(), explicitInput.ReplacementHorseName?.Trim());
        }
        // Supports "[Emergency: Rider Name | Pony Name] Reason" or "[Emergency: Rider Name] Reason"
        if (reason.StartsWith("[Emergency:", StringComparison.OrdinalIgnoreCase))
        {
            var close = reason.IndexOf(']');
            if (close > 11)
            {
                var inner = reason[11..close].Trim();
                var parts = inner.Split('|', 2, StringSplitOptions.TrimEntries);
                var rName = parts.Length > 0 && !string.IsNullOrWhiteSpace(parts[0]) ? parts[0] : null;
                var hName = parts.Length > 1 && !string.IsNullOrWhiteSpace(parts[1]) ? parts[1] : null;
                return (rName, hName);
            }
        }
        return (null, null);
    }

    public async Task<RiderSwapDto> SwapAsync(
        int competitionId, int formId, SwapRiderRequest request, string? actorUserId,
        CancellationToken ct = default, EmergencyReplacementInput? emergency = null)
    {
        var requestId = (request.RequestId ?? string.Empty).Trim();
        if (requestId.Length is 0 or > 100) throw new EntryValidationException("A request id of up to 100 characters is required.");
        var reason = (request.Reason ?? string.Empty).Trim();
        if (reason.Length > MaxReasonLength)
            throw new EntryValidationException($"The reason must be {MaxReasonLength} characters or fewer.");
        if (request.OutRiderEntryId == request.InRiderEntryId)
            throw new EntryValidationException("Choose two different riders.");

        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);

            var form = await db.DeclarationForms.Include(f => f.Riders).Include(f => f.Team)
                .FirstOrDefaultAsync(f => f.Id == formId && f.Team!.CompetitionId == competitionId, ct)
                ?? throw new KeyNotFoundException("Declaration not found.");

            var earlier = await db.Set<RiderSwapEvent>().AsNoTracking()
                .FirstOrDefaultAsync(e => e.DeclarationFormId == formId && e.RequestId == requestId, ct);
            if (earlier is not null) return ToDto(earlier) with { Replayed = true };

            var latestId = await db.DeclarationForms.Where(f => f.TeamId == form.TeamId)
                .OrderByDescending(f => f.SubmittedAt).ThenByDescending(f => f.Id).Select(f => f.Id).FirstAsync(ct);
            if (latestId != form.Id)
                throw new DrawValidationException("This isn't the team's current declaration.");

            var outRider = form.Riders.FirstOrDefault(r => r.Id == request.OutRiderEntryId)
                ?? throw new EntryValidationException("The rider to take out isn't on this declaration.");
            if (outRider.IsReserve) throw new EntryValidationException("The rider to take out is already a reserve.");

            if (form.IsLocked)
            {
                if (!request.OverrideLock)
                    throw new DeclarationLockedException(
                        "This declaration is locked. Confirm the override and give a reason to change it.");
                if (reason.Length == 0)
                    throw new EntryValidationException("Give a reason to override a locked declaration.");
            }

            var before = Snapshot(form);
            RiderEntry inRider;

            if (request.InRiderEntryId <= 0)
            {
                // Emergency replacement (Referee-approved replacement rider and/or pony when no reserve is used).
                if (reason.Length == 0)
                    throw new EntryValidationException("Give a reason (e.g. Referee approval) for an emergency replacement.");
                var (repRider, repHorse) = ParseEmergencyHeader(reason, emergency);
                if (string.IsNullOrWhiteSpace(repRider) && string.IsNullOrWhiteSpace(repHorse))
                    throw new EntryValidationException("Provide a replacement rider name or replacement pony name for an emergency replacement.");

                if (string.IsNullOrWhiteSpace(repRider) && !string.IsNullOrWhiteSpace(repHorse))
                {
                    // Pony-only swap: the rider keeps their place in the team on the replacement pony.
                    outRider.HorseName = repHorse;
                    outRider.PonyHeightHands = null;
                    outRider.PonyPassportNumber = null;
                    outRider.PonyOwnerFullName = null;
                    outRider.PonyAge = null;
                    // Saved riders describe a rider/pony pairing; retain the rider's own details and privacy here.
                    outRider.SavedRiderId = null;
                    inRider = outRider;
                    await db.SaveChangesAsync(ct);
                }
                else
                {
                    var seatOrder = outRider.OrderIndex;
                    var wasCaptain = outRider.IsCaptain;
                    outRider.IsReserve = true;
                    outRider.IsCaptain = false;
                    outRider.OrderIndex = form.Riders.Count > 0 ? form.Riders.Max(r => r.OrderIndex) + 1 : 5;

                    SavedRider? replacementSaved = null;
                    if (!string.IsNullOrWhiteSpace(repRider) && form.Team?.ClubId is { } clubId)
                    {
                        var trimmedRider = repRider.Trim();
                        var candidates = await db.SavedRiders.AsNoTracking()
                            .Where(s => s.ClubId == clubId)
                            .ToListAsync(ct);
                        var matches = candidates
                            .Where(s => string.Equals(s.FullName.Trim(), trimmedRider, StringComparison.OrdinalIgnoreCase))
                            .ToList();
                        replacementSaved = !string.IsNullOrWhiteSpace(repHorse)
                            ? matches.FirstOrDefault(s => string.Equals(s.HorseName?.Trim(), repHorse.Trim(), StringComparison.OrdinalIgnoreCase))
                              ?? matches.FirstOrDefault()
                            : matches.FirstOrDefault();
                    }

                    inRider = new RiderEntry
                    {
                        DeclarationFormId = form.Id,
                        SavedRiderId = replacementSaved?.Id,
                        FullName = !string.IsNullOrWhiteSpace(repRider) ? repRider : outRider.FullName,
                        DateOfBirth = string.IsNullOrWhiteSpace(repRider) ? outRider.DateOfBirth : replacementSaved?.DateOfBirth,
                        HorseName = !string.IsNullOrWhiteSpace(repHorse) ? repHorse : outRider.HorseName,
                        PonyHeightHands = string.IsNullOrWhiteSpace(repHorse) ? outRider.PonyHeightHands : null,
                        BibColour = outRider.BibColour,
                        IsCaptain = wasCaptain,
                        IsReserve = false,
                        IsGuestRider = !string.IsNullOrWhiteSpace(repRider) && replacementSaved is null,
                        OrderIndex = seatOrder,
                        UseInitialOnly = !string.IsNullOrWhiteSpace(repRider)
                            ? ((replacementSaved?.UseInitialOnly ?? false) || MountedGames.Api.Services.DecForms.DecFormRules.HasSingleLetterSurnameInitial(repRider))
                            : outRider.UseInitialOnly,
                        NoFilming = !string.IsNullOrWhiteSpace(repRider)
                            ? ((replacementSaved?.NoFilming ?? false) || MountedGames.Api.Services.DecForms.DecFormRules.HasSingleLetterSurnameInitial(repRider))
                            : outRider.NoFilming,
                    };
                    form.Riders.Add(inRider);
                    await db.SaveChangesAsync(ct);
                }
            }
            else
            {
                inRider = form.Riders.FirstOrDefault(r => r.Id == request.InRiderEntryId)
                    ?? throw new EntryValidationException("The reserve to bring in isn't on this declaration.");
                if (!inRider.IsReserve) throw new EntryValidationException("The rider to bring in isn't a reserve.");

                (outRider.IsReserve, inRider.IsReserve) = (true, false);
                if (outRider.IsCaptain)
                {
                    outRider.IsCaptain = false;
                    inRider.IsCaptain = true;
                }
                (outRider.OrderIndex, inRider.OrderIndex) = (inRider.OrderIndex, outRider.OrderIndex);
            }
            var after = Snapshot(form);

            var swap = new RiderSwapEvent
            {
                CompetitionId = competitionId,
                DeclarationFormId = form.Id,
                TeamId = form.TeamId,
                OutRiderEntryId = outRider.Id,
                InRiderEntryId = inRider.Id,
                BeforeJson = JsonSerializer.Serialize(before, Json),
                AfterJson = JsonSerializer.Serialize(after, Json),
                ActorUserId = actorUserId,
                Reason = reason,
                OverrodeLock = form.IsLocked,
                RequestId = requestId,
                CreatedAt = DateTime.UtcNow,
            };
            db.Set<RiderSwapEvent>().Add(swap);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return ToDto(swap);
        });
    }

    public async Task<IReadOnlyList<RiderSwapDto>> HistoryAsync(
        int competitionId, int formId, CancellationToken ct = default)
    {
        if (!await db.DeclarationForms.AnyAsync(f => f.Id == formId && f.Team!.CompetitionId == competitionId, ct))
            throw new KeyNotFoundException("Declaration not found.");
        var events = await db.Set<RiderSwapEvent>().AsNoTracking()
            .Where(e => e.DeclarationFormId == formId).OrderBy(e => e.Id).ToListAsync(ct);
        return events.Select(e => ToDto(e)).ToList();
    }

    private static List<RiderSwapSnapshotDto> Snapshot(DeclarationForm form) => form.Riders
        .OrderBy(r => r.OrderIndex).ThenBy(r => r.Id)
        .Select(r => new RiderSwapSnapshotDto(r.Id, r.FullName, r.IsReserve, r.IsCaptain, r.OrderIndex))
        .ToList();

    private static RiderSwapDto ToDto(RiderSwapEvent e) => new(
        e.Id, e.DeclarationFormId, e.TeamId, e.OutRiderEntryId, e.InRiderEntryId,
        JsonSerializer.Deserialize<List<RiderSwapSnapshotDto>>(e.BeforeJson, Json) ?? [],
        JsonSerializer.Deserialize<List<RiderSwapSnapshotDto>>(e.AfterJson, Json) ?? [],
        e.ActorUserId, e.Reason, e.OverrodeLock, e.CreatedAt);
}
