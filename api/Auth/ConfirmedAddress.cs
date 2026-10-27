using Microsoft.AspNetCore.Mvc;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Auth;

/// <summary>
/// Staff can reset their password by email, so whoever reads the address on an account can take it over once it has staff
/// access. Granting Trainer, Manager or Admin, approving a request for one, or adding a competition admin therefore needs
/// the account's address confirmed first. Every one of those paths refuses the same way: 409 <c>email_unconfirmed</c>.
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
}
