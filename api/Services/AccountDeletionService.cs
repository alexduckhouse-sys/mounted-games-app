using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Entities.Seasons;

namespace MountedGames.Api.Services;

public enum AccountDeletionOutcome
{
    /// <summary>The account row was removed.</summary>
    Deleted,
    /// <summary>
    /// The account owns records the database will not let go (seasons, team profiles, catalogue items, orders), or an
    /// admin had blocked it, so the row was kept as an emptied, locked-out shell. Nothing in it identifies the person; a
    /// blocked one keeps its block, so it stays on the blocked list and its networks stay blocked until an admin lifts it.
    /// </summary>
    Anonymised,
}

/// <summary>
/// Removes a person's account, private data and authored chat/marketplace content, and detaches retained event records.
/// The per-relation choices are written up in <c>docs/decisions.md</c>. Every step is explicit rather than left to
/// foreign-key cascades, so a local SQLite file built from guard SQL behaves the same as Postgres.
/// </summary>
public sealed class AccountDeletionService(AppDbContext db, UserManager<AppUser> users)
{
    public const string DeletedName = "Deleted user";

    /// <summary>True when the account is the only one in the Admin role.</summary>
    public async Task<bool> IsLastAdminAsync(AppUser user, string adminRole)
        => await users.IsInRoleAsync(user, adminRole) && (await users.GetUsersInRoleAsync(adminRole)).Count <= 1;

    public Task<AccountDeletionOutcome> DeleteAsync(AppUser user, CancellationToken ct = default)
        => db.Database.CreateExecutionStrategy().ExecuteAsync(() => DeleteOnceAsync(user, ct));

    // Postgres runs with a retrying execution strategy, which refuses a transaction started outside it. Run the whole
    // deletion inside the strategy, starting from a clean change tracker in case it is retried.
    private async Task<AccountDeletionOutcome> DeleteOnceAsync(AppUser user, CancellationToken ct)
    {
        var id = user.Id;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Read fresh: a block outlives the account. Deleting must not be a way to lift it.
        var blocked = await db.Users.AsNoTracking().AnyAsync(u => u.Id == id && u.BlockedAt != null, ct);

        // --- Private to the person: removed. ---
        await db.TrainerNotes.Where(n => n.UserId == id).ExecuteDeleteAsync(ct);
        await db.StartingPoints.Where(p => p.OwnerUserId == id).ExecuteDeleteAsync(ct);
        // The networks it signed in from, and the ones blocked because of it. A blocked account keeps both: the blocks stay
        // in force, and unblocking (or another blocked account inheriting a network) still needs to know which they are.
        if (!blocked)
        {
            await db.AccountIps.Where(a => a.UserId == id).ExecuteDeleteAsync(ct);
            await db.IpBlocks.Where(b => b.BlockedAccountUserId == id).ExecuteDeleteAsync(ct);
        }
        // Reset links, including the hashed network each was asked for from.
        await db.PasswordResetTokens.Where(t => t.UserId == id).ExecuteDeleteAsync(ct);
        await db.PushSubscriptions.Where(p => p.UserId == id).ExecuteDeleteAsync(ct);
        await db.OverlayLooks.Where(l => l.OwnerUserId == id).ExecuteDeleteAsync(ct);
        await db.TeamSupporters.Where(s => s.UserId == id).ExecuteDeleteAsync(ct);
        await db.CompetitionCollaborators.Where(c => c.UserId == id).ExecuteDeleteAsync(ct);
        // The rider roster holds other people's children; entries already made from it keep their own copy of the details.
        var riders = db.SavedRiders.Where(r => r.CreatedByUserId == id);
        await db.RiderEntries.Where(e => e.SavedRiderId != null && riders.Select(r => r.Id).Contains(e.SavedRiderId.Value))
            .ExecuteUpdateAsync(s => s.SetProperty(e => e.SavedRiderId, (int?)null), ct);
        await riders.ExecuteDeleteAsync(ct);
        // Explicit cleanup also applies when accounting records keep an emptied account row alive.
        await db.ChatUserBlocks.Where(b => b.UserId == id || b.BlockedUserId == id).ExecuteDeleteAsync(ct);
        await db.ChatReports.Where(r => r.ReporterUserId == id || r.Message.UserId == id).ExecuteDeleteAsync(ct);
        // Authored content is removed, including announcements, private messages and previously hidden comments.
        await db.ChatMessages.Where(m => m.UserId == id).ExecuteDeleteAsync(ct);
        await db.ChatMessages.Where(m => m.RecipientUserId == id)
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.RecipientUserId, (string?)null), ct);
        await db.ShopComments.Where(c => c.AuthorUserId == id).ExecuteDeleteAsync(ct);
        // Messages written by other people stay, no longer addressed to the deleted account.
        await db.ShopComments.Where(c => c.ToUserId == id)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.ToUserId, (string?)null), ct);

        // Volunteer duties they signed up for, with the name and phone number they gave. A claim can't exist without its
        // account (the row would take it anyway), so it goes either way and the duty is open again.
        await db.VolunteerClaims.Where(c => c.UserId == id).ExecuteDeleteAsync(ct);
        // Duties they checked people in to keep the check-in, not who did it.
        await db.VolunteerShifts.Where(v => v.CheckedInByUserId == id).ExecuteUpdateAsync(s => s
            .SetProperty(v => v.CheckedInByUserId, (string?)null)
            .SetProperty(v => v.CheckedInByName, DeletedName), ct);

        // Keep empty post shells so deleting one seller cannot cascade through other people's comments or reports.
        var deletedAt = DateTime.UtcNow;
        await db.ShopPosts.Where(p => p.AuthorUserId == id).ExecuteUpdateAsync(s => s
            .SetProperty(p => p.AuthorUserId, (string?)null)
            .SetProperty(p => p.AuthorName, DeletedName)
            .SetProperty(p => p.PonyClubName, (string?)null)
            .SetProperty(p => p.Title, string.Empty)
            .SetProperty(p => p.Body, string.Empty)
            .SetProperty(p => p.PriceMinor, (int?)null)
            .SetProperty(p => p.ContactInfo, (string?)null)
            .SetProperty(p => p.ImageBase64, (string?)null)
            .SetProperty(p => p.IsDeleted, true)
            .SetProperty(p => p.DeletedAt, p => p.DeletedAt ?? deletedAt)
            .SetProperty(p => p.IpAddress, (string?)null), ct);
        await db.ShopPosts.Where(p => p.DeletedByUserId == id)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.DeletedByUserId, (string?)null), ct);
        await db.ShopReports.Where(r => r.ReporterUserId == id).ExecuteUpdateAsync(s => s
            .SetProperty(r => r.ReporterUserId, (string?)null)
            .SetProperty(r => r.Reason, (string?)null)
            .SetProperty(r => r.IpAddress, (string?)null), ct);

        // --- Event and accounting history: kept, with the account link removed. ---
        await db.DeclarationForms.Where(d => d.SubmittedByUserId == id)
            .ExecuteUpdateAsync(s => s.SetProperty(d => d.SubmittedByUserId, (string?)null), ct);
        // A signup is also a payment record, so it stays with the name the organiser took payment from; the contact details go.
        await db.SectionSignups.Where(x => x.UserId == id).ExecuteUpdateAsync(s => s
            .SetProperty(x => x.UserId, (string?)null)
            .SetProperty(x => x.ContactInfo, (string?)null)
            .SetProperty(x => x.ContactEmail, (string?)null), ct);

        // --- Ownership links: cleared, so the competition or team carries on without an owner. ---
        await db.Competitions.Where(c => c.CreatedByUserId == id)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.CreatedByUserId, (string?)null), ct);
        await db.Teams.Where(t => t.TrainerUserId == id)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.TrainerUserId, (string?)null), ct);

        // --- Sign-in data. ---
        await db.UserRoles.Where(r => r.UserId == id).ExecuteDeleteAsync(ct);
        await db.UserClaims.Where(c => c.UserId == id).ExecuteDeleteAsync(ct);
        await db.UserLogins.Where(l => l.UserId == id).ExecuteDeleteAsync(ct);
        await db.UserTokens.Where(t => t.UserId == id).ExecuteDeleteAsync(ct);

        // Records the database can't detach from a user (non-nullable, restricted keys).
        var pinned = await db.Set<Season>().AnyAsync(x => x.OwnerUserId == id, ct)
            || await db.Set<TeamProfile>().AnyAsync(x => x.OwnerUserId == id, ct)
            || await db.Set<EventTeamProfileLink>().AnyAsync(x => x.LinkedByUserId == id, ct)
            || await db.Set<SeasonRoundPublication>().AnyAsync(x => x.PublishedByUserId == id, ct)
            || await db.Set<CatalogueItem>().AnyAsync(x => x.SellerUserId == id, ct)
            || await db.Set<EventOrder>().AnyAsync(x => x.BuyerUserId == id, ct);

        AccountDeletionOutcome outcome;
        if (pinned || blocked)
        {
            // Stop selling, then empty the account in place.
            await db.Set<CatalogueItem>().Where(x => x.SellerUserId == id)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsActive, false), ct);
            db.ChangeTracker.Clear();
            var shell = await users.FindByIdAsync(id) ?? throw new InvalidOperationException("Account disappeared during deletion.");
            shell.UserName = $"deleted-{id}";
            shell.Email = $"deleted-{id}@deleted.invalid";
            shell.EmailConfirmed = false;
            shell.FullName = DeletedName;
            shell.PhoneNumber = null;
            shell.PhoneNumberConfirmed = false;
            shell.ClubId = null;
            shell.PasswordHash = null;
            shell.TwoFactorEnabled = false;
            shell.LockoutEnabled = true;
            shell.LockoutEnd = DateTimeOffset.MaxValue;
            shell.SecurityStamp = Guid.NewGuid().ToString("N");
            var updated = await users.UpdateAsync(shell);
            if (!updated.Succeeded) throw new InvalidOperationException("The account could not be emptied.");
            outcome = AccountDeletionOutcome.Anonymised;
        }
        else
        {
            db.ChangeTracker.Clear();
            var deleted = await users.DeleteAsync(await users.FindByIdAsync(id) ?? user);
            if (!deleted.Succeeded) throw new InvalidOperationException("The account could not be deleted.");
            outcome = AccountDeletionOutcome.Deleted;
        }

        await tx.CommitAsync(ct);
        return outcome;
    }
}
