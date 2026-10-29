using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Data.Sqlite;
using Npgsql;
namespace MountedGames.Api.Services.Apple;

public sealed class AppleConflictFilter : IExceptionFilter
{
    internal static bool IsConflict(Exception error) => error is PostgresException { SqlState: "40001" or "40P01" }
        or SqliteException { SqliteErrorCode: 5 or 6 } || (error.InnerException != null && IsConflict(error.InnerException));
    public void OnException(ExceptionContext context)
    {
        if (!IsConflict(context.Exception)) return;
        context.Result = new ConflictObjectResult(new { message = "Someone else changed this booking. Refresh it and try again." });
        context.ExceptionHandled = true;
    }
}

public sealed class AppleDeliveryWorker(IServiceScopeFactory scopes, AppleOptions options, ILogger<AppleDeliveryWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.LiveReady && !options.WalletReady) return;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try { using var scope = scopes.CreateScope(); await scope.ServiceProvider.GetRequiredService<AppleDeliveryRunner>().RunAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception) { logger.LogWarning("Apple delivery did not complete; durable work will retry."); }
        }
    }
}
