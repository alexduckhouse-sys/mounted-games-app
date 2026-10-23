using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Security;

/// <summary>
/// For anonymous GET endpoints that anyone, including web crawlers and calendar apps, may call: refuses an
/// address an admin has blocked. Pair it with <c>[EnableRateLimiting("public-read")]</c>.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class PublicReadAttribute : Attribute, IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var ip = context.HttpContext.Connection.RemoteIpAddress?.ToString();
        if (!string.IsNullOrEmpty(ip))
        {
            var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
            if (await db.IpBlocks.AnyAsync(b => b.IpAddress == ip, context.HttpContext.RequestAborted))
            {
                context.Result = new ObjectResult(new { message = "This address has been blocked." }) { StatusCode = StatusCodes.Status403Forbidden };
                return;
            }
        }
        await next();
    }
}
