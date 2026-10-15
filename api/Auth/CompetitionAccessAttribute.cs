using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Auth;

public enum CompetitionResource { Competition, Signup }

/// <summary>Checks ownership using the stored resource, never a caller-supplied owner.</summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class CompetitionAccessAttribute(string argument, CompetitionResource resource = CompetitionResource.Competition)
    : Attribute, IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var user = context.HttpContext.User;
        if (user.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return;
        }
        if (!context.ActionArguments.TryGetValue(argument, out var value) || value is not int id)
        {
            context.Result = new BadRequestResult();
            return;
        }
        var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var competitions = db.Competitions.AsNoTracking();
        if (resource == CompetitionResource.Signup)
            competitions = competitions.Where(c => db.SectionSignups.Any(s => s.Id == id && s.Section!.CompetitionId == c.Id));
        else
            competitions = competitions.Where(c => c.Id == id);

        var uid = user.FindFirstValue(ClaimTypes.NameIdentifier);
        var allowed = user.IsInRole(Roles.Admin)
            ? await competitions.AnyAsync(context.HttpContext.RequestAborted)
            : user.IsInRole(Roles.Trainer) && !string.IsNullOrEmpty(uid)
                && await competitions.AnyAsync(c => c.CreatedByUserId == uid, context.HttpContext.RequestAborted);
        if (!allowed)
        {
            context.Result = new NotFoundResult();
            return;
        }
        await next();
    }
}
