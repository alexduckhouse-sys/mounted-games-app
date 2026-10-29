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
    public const string SeasonPolicy = "SeasonStaff";

    /// <summary>Authorization with this policy registered; used by the app and by test hosts.</summary>
    public static IServiceCollection AddAuthorizationWithCompetitionStaff(this IServiceCollection services)
    {
        services.AddAuthorization(options =>
        {
            options.AddPolicy(Policy, policy => policy.AddRequirements(new Requirement()));
            options.AddPolicy(SeasonPolicy, policy => policy.AddRequirements(new Requirement(AllowClubManagers: true)));
        });
        return services.AddScoped<IAuthorizationHandler, Handler>();
    }

    public sealed record Requirement(bool AllowClubManagers = false) : IAuthorizationRequirement;

    public sealed class Handler(AppDbContext db) : AuthorizationHandler<Requirement>
    {
        protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, Requirement requirement)
        {
            var user = context.User;
            if (user.Identity?.IsAuthenticated == true)
            {
                var uid = user.FindFirstValue(ClaimTypes.NameIdentifier);
                if (user.IsInRole(Roles.Admin) || user.IsInRole(Roles.Trainer)
                    || (requirement.AllowClubManagers && user.IsInRole(Roles.Manager))
                    || (!string.IsNullOrEmpty(uid) && await db.CompetitionCollaborators.AnyAsync(c => c.UserId == uid)))
                {
                    context.Succeed(requirement);
                    return;
                }
            }
            if (context.Resource is HttpContext http && await ScorerLinkAccessAttribute.TryAuthenticateStreamLinkAsync(http) is not null)
            {
                context.Succeed(requirement);
            }
        }
    }
}
