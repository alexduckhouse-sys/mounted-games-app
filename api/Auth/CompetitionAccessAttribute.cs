using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Auth;

/// <summary>What the checked argument identifies; the competition is found from it in the database.</summary>
public enum CompetitionResource { Competition, Signup, Session, Heat, Race }

/// <summary>
/// Checks access to one competition using the stored resource, never a caller-supplied owner. Admins reach
/// any competition; a Trainer reaches the ones they created; anyone on a competition's team reaches that one.
/// Others get 404, so a competition's existence isn't revealed.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class CompetitionAccessAttribute(string argument, CompetitionResource resource = CompetitionResource.Competition)
    : Attribute, IAsyncAuthorizationFilter
{
    // An authorization filter, so it runs after the [Authorize] policy but before model binding and validation:
    // someone with no access gets 404, never a 400 that hints the route exists. The id comes from the route.
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var user = context.HttpContext.User;
        if (user.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return;
        }
        if (!context.RouteData.Values.TryGetValue(argument, out var value) || !int.TryParse(value?.ToString(), out var id))
        {
            context.Result = new BadRequestResult();
            return;
        }
        var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var competitions = db.Competitions.AsNoTracking();
        competitions = resource switch
        {
            CompetitionResource.Signup => competitions.Where(c => db.SectionSignups.Any(s => s.Id == id && s.Section!.CompetitionId == c.Id)),
            CompetitionResource.Session => competitions.Where(c => db.Sessions.Any(s => s.Id == id && s.CompetitionId == c.Id)),
            CompetitionResource.Heat => competitions.Where(c => db.Heats.Any(h => h.Id == id && h.Session!.CompetitionId == c.Id)),
            CompetitionResource.Race => competitions.Where(c => db.Races.Any(r => r.Id == id && r.Heat!.Session!.CompetitionId == c.Id)),
            _ => competitions.Where(c => c.Id == id),
        };

        var uid = user.FindFirstValue(ClaimTypes.NameIdentifier);
        var trainer = user.IsInRole(Roles.Trainer);
        var allowed = user.IsInRole(Roles.Admin)
            ? await competitions.AnyAsync(context.HttpContext.RequestAborted)
            : !string.IsNullOrEmpty(uid) && await competitions.AnyAsync(c =>
                (trainer && c.CreatedByUserId == uid) || db.CompetitionCollaborators.Any(k => k.CompetitionId == c.Id && k.UserId == uid),
                context.HttpContext.RequestAborted);
        if (!allowed) context.Result = new NotFoundResult();
    }
}
