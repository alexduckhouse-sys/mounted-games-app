using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>A host with the email sender switched on, pointed at a fake Resend. Never touches the network.</summary>
public class EmailApiFactory : ApiFactory
{
    public const string ApiKey = "re_test_key_do_not_log_0123456789";
    public const string SiteUrl = "https://mg.example.org";

    public sealed record SentMessage(string Url, string? Bearer, string? IdempotencyKey, JsonElement Body)
    {
        public string To => Body.GetProperty("to")[0].GetString()!;
        public string Subject => Body.GetProperty("subject").GetString()!;
        public string Text => Body.GetProperty("text").GetString()!;
    }

    public ConcurrentQueue<SentMessage> Sent { get; } = new();
    public ConcurrentQueue<string> Logs { get; } = new();

    /// <summary>Set to make the fake provider misbehave. Null means it accepts everything.</summary>
    public Func<HttpResponseMessage>? Fail { get; set; }

    protected virtual bool EmailOn => true;

    public EmailApiFactory()
    {
        Http.Respond("api.resend.com", request =>
        {
            var body = JsonDocument.Parse(request.Content!.ReadAsStringAsync().GetAwaiter().GetResult()).RootElement.Clone();
            Sent.Enqueue(new SentMessage(
                request.RequestUri!.ToString(),
                request.Headers.Authorization?.Parameter,
                request.Headers.TryGetValues("Idempotency-Key", out var v) ? v.FirstOrDefault() : null,
                body));
            return Fail?.Invoke() ?? new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"id\":\"fake\"}", System.Text.Encoding.UTF8, "application/json"),
            };
        });
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        if (EmailOn)
        {
            builder.UseSetting("Email:Enabled", "true");
            builder.UseSetting("Email:ApiKey", ApiKey);
            builder.UseSetting("Email:From", "Mounted Games <entries@example.org>");
        }
        builder.UseSetting("Email:SiteUrl", SiteUrl);
        builder.ConfigureServices(services => services.AddSingleton<ILoggerProvider>(new CapturingLogs(Logs)));
    }

    public sealed class CapturingLogs(ConcurrentQueue<string> sink) : ILoggerProvider
    {
        public ILogger CreateLogger(string categoryName) => new Capture(sink);
        public void Dispose() { }

        private sealed class Capture(ConcurrentQueue<string> sink) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;
            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
                Func<TState, Exception?, string> formatter)
                => sink.Enqueue(formatter(state, exception) + (exception is null ? "" : " " + exception));
        }
    }
}

/// <summary>The same host with no Email settings except the site address: sending must stay off.</summary>
public sealed class EmailOffApiFactory : EmailApiFactory
{
    protected override bool EmailOn => false;
}
