using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Auth;

/// <summary>
/// The role gate in front of per-competition work: Admins and Trainers as before, plus anyone an owner has
/// added to a competition's team (a Member can be a ring scorer). Always pair it with
/// <see cref="CompetitionAccessAttribute"/>, which decides access to the particular competition.
/// </summary>
public static class CompetitionStaff
{
    public const string Policy = "CompetitionStaff";

    /// <summary>Authorization with this policy registered; used by the app and by test hosts.</summary>
    public static IServiceCollection AddAuthorizationWithCompetitionStaff(this IServiceCollection services)
    {
        services.AddAuthorization(options =>
            options.AddPolicy(Policy, policy => policy.RequireAuthenticatedUser().AddRequirements(new Requirement())));
        return services.AddScoped<IAuthorizationHandler, Handler>();
    }

    public sealed class Requirement : IAuthorizationRequirement;

    public sealed class Handler(AppDbContext db) : AuthorizationHandler<Requirement>
    {
        protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, Requirement requirement)
        {
            var user = context.User;
            var uid = user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (user.IsInRole(Roles.Admin) || user.IsInRole(Roles.Trainer)
                || (!string.IsNullOrEmpty(uid) && await db.CompetitionCollaborators.AnyAsync(c => c.UserId == uid)))
                context.Succeed(requirement);
        }
    }
}
