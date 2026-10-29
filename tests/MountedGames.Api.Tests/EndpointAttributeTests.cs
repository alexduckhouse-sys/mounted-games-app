using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.RateLimiting;
using MountedGames.Api.Auth;
using MountedGames.Api.Controllers;
using MountedGames.Api.Security;

namespace MountedGames.Api.Tests;

public class EndpointAttributeTests
{
    [Fact]
    public void ControllerActionsDeclareAccess_AndPublicReadsCheckBlockedAddresses()
    {
        var problems = new List<string>();
        foreach (var controller in typeof(WeatherController).Assembly.GetTypes().Where(t => typeof(ControllerBase).IsAssignableFrom(t) && !t.IsAbstract))
        foreach (var action in controller.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
        {
            var verbs = action.GetCustomAttributes<HttpMethodAttribute>().ToArray();
            if (verbs.Length == 0) continue;
            var attributes = action.GetCustomAttributes().Concat(controller.GetCustomAttributes()).ToArray();
            var name = $"{controller.Name}.{action.Name}";
            // Scorer links use their own token access filter, rather than JWT authentication.
            var tokenAccess = attributes.OfType<ScorerLinkAccessAttribute>().Any();
            var anonymous = attributes.OfType<IAllowAnonymous>().Any();
            var authorised = attributes.OfType<IAuthorizeData>().Any();
            if (!anonymous && !authorised && !tokenAccess) problems.Add($"{name}: no explicit access rule");
            // The internal cron runner is secret-authenticated inside the action, not a public read.
            var internalRunner = controller == typeof(NotificationsController) && action.Name == nameof(NotificationsController.Run);
            if (anonymous && verbs.SelectMany(v => v.HttpMethods).Contains("GET") && !internalRunner)
            {
                if (!attributes.OfType<PublicReadAttribute>().Any()) problems.Add($"{name}: missing public IP-block check");
                if (!attributes.OfType<EnableRateLimitingAttribute>().Any()) problems.Add($"{name}: missing read rate limit");
            }
        }
        Assert.True(problems.Count == 0, string.Join(Environment.NewLine, problems));
    }
}
