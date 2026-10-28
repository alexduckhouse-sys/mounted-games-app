using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Auth;

/// <summary>
/// Whether a provider sign-in (one that runs the mailbox, see <see cref="ExternalIdentity.MayLinkByEmail"/>) may be added to
/// an existing account found by its address, on top of the checks <c>AuthController.ExternalLogin</c> makes first (a
/// confirmed address, not an admin, not stopped, no other identity from the same provider).
/// <para>The worry is an account made before its address's owner arrived (pre-account takeover). Someone signs up with a
/// victim's address, by password or with a Facebook account whose address nobody checked, and waits. If the owner's own
/// Google or Apple sign-in were then linked to that account, the squatter's password or Facebook would still open it. So an
/// account is linked by email only when nobody else can already be holding a way in:</para>
/// <list type="bullet">
/// <item>it has no Google, Apple or Facebook sign-in at all (a second provider is added from My account, signed in);</item>
/// <item>and it has no password, or its password was set through a link mailed to the address (an invitation or a reset:
/// the <see cref="PasswordFromMailbox"/> claim). A password chosen at sign-up proves nothing about the mailbox.</item>
/// </list>
/// Anyone refused can reset the password first: the reset ends every session, removes every provider sign-in and records
/// the claim, after which the provider links.
/// </summary>
public static class LinkByEmail
{
    /// <summary>User claim: the account's current password was set through a link sent to its address.</summary>
    public const string PasswordFromMailbox = "password_from_mailbox";

    /// <summary>Claim value: the password was chosen when accepting an emailed invitation.</summary>
    public const string FromInvite = "invite";

    /// <summary>Claim value: the password was set with an emailed reset link.</summary>
    public const string FromReset = "reset";

    /// <summary>True when the account holds no way in that someone other than the mailbox's owner could have set up.</summary>
    public static async Task<bool> MayLinkAsync(UserManager<AppUser> users, AppUser user)
    {
        if ((await users.GetLoginsAsync(user)).Count > 0) return false;
        if (!await users.HasPasswordAsync(user)) return true;
        return (await users.GetClaimsAsync(user)).Any(c => c.Type == PasswordFromMailbox);
    }

    /// <summary>
    /// Records that the account's password came through the mailbox, once (a later reset or invitation leaves one row). Saves
    /// on <paramref name="db"/>, so inside the caller's transaction when there is one.
    /// </summary>
    public static async Task RecordPasswordFromMailboxAsync(AppDbContext db, string userId, string how, CancellationToken ct)
    {
        if (await db.UserClaims.AnyAsync(c => c.UserId == userId && c.ClaimType == PasswordFromMailbox, ct)) return;
        db.UserClaims.Add(new IdentityUserClaim<string> { UserId = userId, ClaimType = PasswordFromMailbox, ClaimValue = how });
        await db.SaveChangesAsync(ct);
    }
}
