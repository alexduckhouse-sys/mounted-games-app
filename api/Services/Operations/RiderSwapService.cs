using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Services.Operations;

public sealed class DeclarationLockedException(string message) : InvalidOperationException(message);

/// <summary>
/// An organiser brings a reserve in for a rider on a team's current declaration. The two riders trade places
/// (the one coming out becomes a reserve, so it can be reversed) and the captain badge follows the seat.
/// Every swap is written to <see cref="RiderSwapEvent"/> with the before and after, who did it and why.
/// </summary>
public class RiderSwapService(AppDbContext db)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public const int MaxReasonLength = 500;

    public async Task<RiderSwapDto> SwapAsync(
        int competitionId, int formId, SwapRiderRequest request, string? actorUserId,
        CancellationToken ct = default)
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
            var inRider = form.Riders.FirstOrDefault(r => r.Id == request.InRiderEntryId)
                ?? throw new EntryValidationException("The reserve to bring in isn't on this declaration.");
            if (outRider.IsReserve) throw new EntryValidationException("The rider to take out is already a reserve.");
            if (!inRider.IsReserve) throw new EntryValidationException("The rider to bring in isn't a reserve.");

            if (form.IsLocked)
            {
                if (!request.OverrideLock)
                    throw new DeclarationLockedException(
                        "This declaration is locked. Confirm the override and give a reason to change it.");
                if (reason.Length == 0)
                    throw new EntryValidationException("Give a reason to override a locked declaration.");
            }

            var before = Snapshot(form);
            (outRider.IsReserve, inRider.IsReserve) = (true, false);
            if (outRider.IsCaptain)
            {
                outRider.IsCaptain = false;
                inRider.IsCaptain = true;
            }
            (outRider.OrderIndex, inRider.OrderIndex) = (inRider.OrderIndex, outRider.OrderIndex);
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
