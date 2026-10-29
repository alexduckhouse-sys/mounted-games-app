using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using MountedGames.Api.Controllers;
namespace MountedGames.Api.Services;

public sealed class WindConflictFilterAttribute : ExceptionFilterAttribute
{
    public override void OnException(ExceptionContext context)
    {
        if (!ScoringController.IsScoringConcurrency(context.Exception)) return;
        context.Result = new ConflictObjectResult(new { message = "The programme changed on another device. Reload it and review your change again." });
        context.ExceptionHandled = true;
    }
}
