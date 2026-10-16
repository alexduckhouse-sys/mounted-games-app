using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Streaming;

namespace MountedGames.Api.Tests.Infrastructure;

public sealed class StreamingApiFactory : ApiFactory
{
    public ManualTimeProvider Clock { get; } = new();
    public Dictionary<string, string> Settings { get; } = new();
    public ConcurrentQueue<(string Url, string Method, JsonElement Body, string? Token)> SfuRequests { get; } = new();
    public string? FailPath { get; set; }
    public string FailureBody { get; set; } = "{}";
    public HttpStatusCode FailureStatus { get; set; } = HttpStatusCode.BadGateway;
    public bool ThrowFailure { get; set; }
    public Action<string>? OnRequest { get; set; }
    private int _session;

    public StreamingApiFactory()
    {
        Http.Respond("https://sfu.test/", request =>
        {
            var url = request.RequestUri!.AbsolutePath;
            var body = JsonDocument.Parse(request.Content!.ReadAsStringAsync().GetAwaiter().GetResult()).RootElement.Clone();
            SfuRequests.Enqueue((url, request.Method.Method, body, request.Headers.Authorization?.Parameter));
            OnRequest?.Invoke(url);
            if (FailPath is not null && url.Contains(FailPath))
            {
                if (ThrowFailure) throw new HttpRequestException("Fake upstream failure");
                return new HttpResponseMessage(FailureStatus) { Content = new StringContent(FailureBody, System.Text.Encoding.UTF8, "application/json") };
            }
            if (url.EndsWith("/sessions/new")) return Json(new { sessionId = $"fake-sfu-{Interlocked.Increment(ref _session)}" });
            if (url.EndsWith("/tracks/new"))
            {
                var publisher = body.TryGetProperty("sessionDescription", out _);
                var tracks = body.GetProperty("tracks").EnumerateArray().Select((t, i) => new
                {
                    mid = publisher ? t.GetProperty("mid").GetString() : i.ToString(), trackName = t.GetProperty("trackName").GetString()
                }).ToArray();
                return Json(new { requiresImmediateRenegotiation = !publisher,
                    sessionDescription = new { type = publisher ? "answer" : "offer", sdp = publisher ? "fake-answer" : "fake-offer" }, tracks });
            }
            if (url.Contains("/turn/")) return Json(new { iceServers = new object[] {
                new { urls = new[] { "turn:relay.invalid:3478", "turn:relay.invalid:53", "turns:relay.invalid:443" }, username = "fake-user", credential = "fake-turn-credential" },
                new { urls = "stun:relay.invalid:53" }, new { urls = "stun:relay.invalid:3478" } } }, HttpStatusCode.Created);
            return Json(new { });
        });
    }

    private static HttpResponseMessage Json(object body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = JsonContent.Create(body) };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Streaming:Cloudflare:AppId", "fake-app");
        builder.UseSetting("Streaming:Cloudflare:AppToken", "fake-app-token");
        builder.UseSetting("Streaming:Cloudflare:BaseUrl", "https://sfu.test/v1");
        foreach (var (key, value) in Settings) builder.UseSetting($"Streaming:{key}", value);
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);
            services.AddSingleton<StreamSweeper>();
        });
    }

    public ViewerRegistry Viewers => Services.GetRequiredService<ViewerRegistry>();
    public StreamSweeper Sweeper => Services.GetRequiredService<StreamSweeper>();
    public const string VideoOffer = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\n";
    public const string SimulcastOffer = VideoOffer + "a=simulcast:send f;h;q\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:1\r\n";

    public static string Path(int competition, int? stream = null, string suffix = "") =>
        $"/api/competitions/{competition}/streams" + (stream is null ? "" : $"/{stream}") + suffix;

    public async Task<PublishResponse> StartAsync(HttpClient client, int competition, string angle = "Main", bool takeover = false,
        bool audio = true, bool simulcast = true)
    {
        var result = await client.PostAsJsonAsync(Path(competition), new StartStreamRequest("Arena", angle,
            simulcast ? SimulcastOffer : VideoOffer, "0", audio ? "1" : null, takeover));
        result.EnsureSuccessStatusCode();
        return await result.ReadAsync<PublishResponse>();
    }

    public async Task<LiveStreamDto> ReadyAsync(HttpClient client, int competition, PublishResponse attempt)
    {
        var result = await client.PostAsJsonAsync(Path(competition, attempt.StreamId, "/ready"), new ReadyRequest(attempt.Attempt));
        result.EnsureSuccessStatusCode();
        return await result.ReadAsync<LiveStreamDto>();
    }

    public Task<LiveStream> StreamAsync(int id) => this.WithDbAsync(db => db.LiveStreams.AsNoTracking().SingleAsync(s => s.Id == id));

    public async Task<HubConnection> ConnectAsync(int? competition = null)
    {
        CreateClient();
        var connection = new HubConnectionBuilder().WithUrl(new Uri(Server.BaseAddress, "/hubs/live"), o =>
        {
            o.HttpMessageHandlerFactory = _ => Server.CreateHandler();
            o.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.LongPolling;
        }).Build();
        await connection.StartAsync();
        if (competition.HasValue) await connection.InvokeAsync("JoinCompetition", competition.Value);
        return connection;
    }

    public static (Task<T> Task, IDisposable Subscription) Next<T>(HubConnection connection, string method)
    {
        var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        var subscription = connection.On<T>(method, payload => completion.TrySetResult(payload));
        return (completion.Task.WaitAsync(TimeSpan.FromSeconds(15)), subscription);
    }
}
