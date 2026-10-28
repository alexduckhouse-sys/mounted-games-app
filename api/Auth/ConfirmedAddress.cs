using Microsoft.AspNetCore.Mvc;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Auth;

/// <summary>
/// Staff can reset their password by email, so whoever reads the address on an account can take it over once it has staff
/// access. Giving an existing account Trainer, Manager or Admin therefore needs its address confirmed first, and refuses
/// the same way, 409 <c>email_unconfirmed</c>, on every such path: approving a Trainer or Manager request
/// (<c>TrainerRequestsController</c>), an admin's role change (<c>TrainerRequestsController</c>), a club manager's role
/// change (<c>ClubMembersController</c>), adding a competition admin (<c>CompetitionTeamController</c>), and the shared
/// organiser key giving Admin to an existing account (<c>AuthController.AdminKey</c>, with <see cref="OwnRefusal"/>,
/// since the person asking is the account's owner).
/// <para>Two paths make a brand-new account with a staff role and an address nobody has confirmed yet, and can't be gated
/// without ending them: an admin's <c>POST /api/auth/register</c> and the organiser key with a new address. Both stay
/// safe because a staff account with an unconfirmed address gets no reset link
/// (<see cref="Services.Accounts.PasswordResetService"/>), and only the signed-in owner can confirm the address
/// (<c>POST /api/auth/confirm-email</c>), so the mailbox alone never reaches the account.</para>
/// </summary>
public static class ConfirmedAddress
{
    public const string Code = "email_unconfirmed";

    public const string Message =
        "This person hasn't confirmed their email address yet. Ask them to open the confirmation email (they can send it again from their profile), then try again.";

    /// <summary>The roles that make an account staff for <see cref="Services.Accounts.PasswordResetService"/>.</summary>
    public static readonly IReadOnlySet<string> StaffRoles = new HashSet<string>(StringComparer.Ordinal)
    {
        Roles.Trainer, Roles.Manager, Roles.Admin,
    };

    /// <summary>True when <paramref name="role"/> is a staff role and the account's address isn't confirmed.</summary>
    public static bool Refuses(AppUser user, string role) => !user.EmailConfirmed && StaffRoles.Contains(role);

    /// <summary>The 409 every staff grant gives an unconfirmed account.</summary>
    public static ConflictObjectResult Refusal() => new(new { code = Code, message = Message });

    public const string OwnMessage =
        "Confirm your email address before using the organiser key. Sign in with your email and password, open the confirmation email (you can send it again from your profile), then try the key again.";

    /// <summary>The same 409, worded for the account's owner asking for the role themselves.</summary>
    public static ConflictObjectResult OwnRefusal() => new(new { code = Code, message = OwnMessage });
}
