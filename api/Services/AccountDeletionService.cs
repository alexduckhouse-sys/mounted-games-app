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
    /// The account owns records the database will not let go (seasons, team profiles, catalogue items, orders), so the
    /// row was kept as an emptied, locked-out shell. Nothing in it identifies the person.
    /// </summary>
    Anonymised,
}

/// <summary>
/// Removes a person's account and what only they could see, and detaches them from everything else.
/// The per-relation choices are written up in <c>docs/decisions.md</c>. Every step is explicit rather than left to
/// foreign-key cascades, so a local SQLite file built from guard SQL behaves the same as Postgres.
/// </summary>
public sealed class AccountDeletionService(AppDbContext db, UserManager<AppUser> users)
{
    public const string DeletedName = "Deleted user";

    /// <summary>True when the account is the only one in the Admin role.</summary>
    public async Task<bool> IsLastAdminAsync(AppUser user, string adminRole)
        => await users.IsInRoleAsync(user, adminRole) && (await users.GetUsersInRoleAsync(adminRole)).Count <= 1;

    public async Task<AccountDeletionOutcome> DeleteAsync(AppUser user, CancellationToken ct = default)
    {
        var id = user.Id;
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        // --- Private to the person: removed. ---
        await db.TrainerNotes.Where(n => n.UserId == id).ExecuteDeleteAsync(ct);
        await db.PushSubscriptions.Where(p => p.UserId == id).ExecuteDeleteAsync(ct);
        await db.OverlayLooks.Where(l => l.OwnerUserId == id).ExecuteDeleteAsync(ct);
        await db.TeamSupporters.Where(s => s.UserId == id).ExecuteDeleteAsync(ct);
        await db.CompetitionCollaborators.Where(c => c.UserId == id).ExecuteDeleteAsync(ct);
        // The rider roster holds other people's children; entries already made from it keep their own copy of the details.
        var riders = db.SavedRiders.Where(r => r.CreatedByUserId == id);
        await db.RiderEntries.Where(e => e.SavedRiderId != null && riders.Select(r => r.Id).Contains(e.SavedRiderId.Value))
            .ExecuteUpdateAsync(s => s.SetProperty(e => e.SavedRiderId, (int?)null), ct);
        await riders.ExecuteDeleteAsync(ct);
        // Private marketplace messages they wrote; ones sent to them stay for the other person, no longer addressed to anyone.
        await db.ShopComments.Where(c => c.IsPrivate && c.AuthorUserId == id).ExecuteDeleteAsync(ct);
        await db.ShopComments.Where(c => c.ToUserId == id)
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.ToUserId, (string?)null), ct);

        // --- Event and community history: kept, with the person removed. ---
        await db.ChatMessages.Where(m => m.UserId == id).ExecuteUpdateAsync(s => s
            .SetProperty(m => m.UserId, (string?)null)
            .SetProperty(m => m.AuthorName, DeletedName)
            .SetProperty(m => m.IpAddress, (string?)null), ct);
        await db.ShopPosts.Where(p => p.AuthorUserId == id).ExecuteUpdateAsync(s => s
            .SetProperty(p => p.AuthorUserId, (string?)null)
            .SetProperty(p => p.AuthorName, DeletedName)
            .SetProperty(p => p.ContactInfo, (string?)null)
            .SetProperty(p => p.IpAddress, (string?)null), ct);
        await db.ShopPosts.Where(p => p.DeletedByUserId == id)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.DeletedByUserId, (string?)null), ct);
        await db.ShopComments.Where(c => c.AuthorUserId == id).ExecuteUpdateAsync(s => s
            .SetProperty(c => c.AuthorUserId, (string?)null)
            .SetProperty(c => c.AuthorName, DeletedName)
            .SetProperty(c => c.IpAddress, (string?)null), ct);
        await db.ShopReports.Where(r => r.ReporterUserId == id).ExecuteUpdateAsync(s => s
            .SetProperty(r => r.ReporterUserId, (string?)null)
            .SetProperty(r => r.IpAddress, (string?)null), ct);
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
        if (pinned)
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
