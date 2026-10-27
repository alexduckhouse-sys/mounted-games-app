using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Hubs;
using MountedGames.Api.Tests.Auth;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Hubs;

/// <summary>
/// A live-hub connection keeps the identity it opened with, so when an account's sessions end (password reset or change,
/// lock, block, deletion) its signed-in connections are closed. Anonymous connections, the normal case, are left alone.
/// </summary>
public class LiveSessionEndTests : IClassFixture<LiveSessionEndTests.Factory>
{
    public sealed class Factory : EmailApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("PasswordReset:MinResponseMilliseconds", "0");
        }
    }

    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);
    private readonly Factory _f;
    public LiveSessionEndTests(Factory f) => _f = f;

    private LiveConnections Registry => _f.Services.GetRequiredService<LiveConnections>();

    public sealed record Live(HubConnection Connection, Task Closed) : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => Connection.DisposeAsync();
    }

    /// <summary>Connects (signed in when given a token) and joins a competition, which runs after OnConnectedAsync has finished.</summary>
    public static async Task<Live> ConnectAsync(ApiFactory f, string? token = null)
    {
        f.CreateClient(); // starts the in-memory server
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(f.Server.BaseAddress, "/hubs/live"), o =>
            {
                o.HttpMessageHandlerFactory = _ => f.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
                if (token is not null) o.AccessTokenProvider = () => Task.FromResult<string?>(token);
            })
            .Build();
        var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.Closed += _ => { closed.TrySetResult(); return Task.CompletedTask; };
        await connection.StartAsync();
        await connection.InvokeAsync("JoinCompetition", 1);
        return new Live(connection, closed.Task);
    }

    private static async Task StillOpenAsync(Live live)
    {
        Assert.Equal(HubConnectionState.Connected, live.Connection.State);
        await live.Connection.InvokeAsync("JoinCompetition", 2).WaitAsync(Timeout);
    }

    [Fact]
    public async Task AResetClosesThatAccountsConnections_AndNobodyElses()
    {
        var account = await _f.AccountAsync();
        var other = await _f.AccountAsync();
        await using var mine = await ConnectAsync(_f, account.Token);
        await using var myOtherDevice = await ConnectAsync(_f, (await _f.LoginAsync(account.User.Email, ResetSteps.Password)).Token);
        await using var spectator = await ConnectAsync(_f);
        await using var someoneElse = await ConnectAsync(_f, other.Token);
        Assert.Equal(2, Registry.CountFor(account.User.Id));

        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(account.User.Email))).StatusCode);

        await mine.Closed.WaitAsync(Timeout);
        await myOtherDevice.Closed.WaitAsync(Timeout);
        await StillOpenAsync(spectator);
        await StillOpenAsync(someoneElse);
        await ResetSteps.EventuallyAsync(() => Registry.CountFor(account.User.Id) == 0, "the closed connections to be forgotten");
        Assert.Equal(1, Registry.CountFor(other.User.Id));
    }

    [Fact]
    public async Task ALockClosesTheAccountsConnections()
    {
        var (_, organiser) = await _f.ApprovedTrainerAsync();
        await using var live = await ConnectAsync(_f, organiser.Token);
        await using var spectator = await ConnectAsync(_f);

        (await (await _f.AdminAsync()).PostAsync($"/api/admin/users/{organiser.User.Id}/account-lock", null)).EnsureSuccessStatusCode();

        await live.Closed.WaitAsync(Timeout);
        await StillOpenAsync(spectator);
    }

    [Fact]
    public async Task ABlockClosesTheAccountsConnections()
    {
        var account = await _f.AccountAsync();
        await using var live = await ConnectAsync(_f, account.Token);
        await using var spectator = await ConnectAsync(_f);

        (await (await _f.AdminAsync()).PostAsJsonAsync($"/api/admin/users/{account.User.Id}/block", new BlockAccountRequest("Test"))).EnsureSuccessStatusCode();

        await live.Closed.WaitAsync(Timeout);
        await StillOpenAsync(spectator);
    }

    [Fact]
    public async Task DeletingTheAccountClosesItsConnections()
    {
        var account = await _f.AccountAsync();
        await using var live = await ConnectAsync(_f, account.Token);

        var deleted = await _f.WithToken(account.Token).SendAsync(new HttpRequestMessage(HttpMethod.Delete, "/api/auth/me")
        {
            Content = JsonContent.Create(new DeleteAccountRequest(ResetSteps.Password)),
        });

        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        await live.Closed.WaitAsync(Timeout);
    }

    [Fact]
    public async Task ChangingThePasswordClosesOlderConnections_AndTheNewTokenConnects()
    {
        var account = await _f.AccountAsync();
        await using var old = await ConnectAsync(_f, account.Token);

        var changed = await _f.WithToken(account.Token).PostAsJsonAsync("/api/auth/change-password",
            new { currentPassword = ResetSteps.Password, newPassword = ResetSteps.NewPassword });
        var fresh = await changed.ReadAsync<AuthResponse>();

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        await old.Closed.WaitAsync(Timeout);
        await using var current = await ConnectAsync(_f, fresh.Token);
        Assert.Equal(1, Registry.CountFor(account.User.Id));
        await StillOpenAsync(current);
    }

    [Fact]
    public async Task ATokenRefusedAtConnectGivesAnAnonymousConnection_NotALoop()
    {
        var account = await _f.AccountAsync();
        Assert.Equal(HttpStatusCode.OK, (await _f.ConfirmAsync(await _f.LinkAsync(account.User.Email))).StatusCode);

        // The connect request runs the same per-request check, which refuses the old token, and the hub allows anonymous
        // callers, so the client gets an ordinary spectator's connection: nothing to retry, nothing of the account's.
        await using var live = await ConnectAsync(_f, account.Token);

        Assert.Equal(0, Registry.CountFor(account.User.Id));
        await StillOpenAsync(live);
    }

    [Fact]
    public async Task AConnectionClosesWhenItsTokenExpires()
    {
        var account = await _f.AccountAsync();
        var shortLived = Token(account.User.Id, DateTime.UtcNow.AddSeconds(3));
        await using var live = await ConnectAsync(_f, shortLived);
        Assert.Equal(1, Registry.CountFor(account.User.Id));

        await live.Closed.WaitAsync(Timeout);
    }

    [Fact]
    public async Task MessagesFromOtherInstancesCloseOnlyOlderConnectionsOfTheNamedAccount()
    {
        var account = await _f.AccountAsync();
        await using var live = await ConnectAsync(_f, account.Token);
        await using var spectator = await ConnectAsync(_f);

        // Junk, this instance's own echo and a version the connection already meets change nothing.
        foreach (var message in new[] { null, "", "nonsense", "elsewhere|1|", $"{Registry.InstanceId}||{account.User.Id}", $"elsewhere|0|{account.User.Id}" })
            Registry.OnMessage(message);
        await StillOpenAsync(live);

        Registry.OnMessage($"elsewhere|1|{account.User.Id}");

        await live.Closed.WaitAsync(Timeout);
        await StillOpenAsync(spectator);
    }

    [RedisFact]
    public async Task ASessionEndedOnOneInstanceClosesConnectionsOnAnother()
    {
        using var first = new RedisApiFactory();
        using var second = new RedisApiFactory();
        var (_, auth) = await first.SignupAsync("Member");
        await using var live = await ConnectAsync(first, auth.Token);
        await using var spectator = await ConnectAsync(first);

        await second.Services.GetRequiredService<LiveConnections>().EndSessionsAsync(auth.User.Id);

        await live.Closed.WaitAsync(Timeout);
        await StillOpenAsync(spectator);
    }

    private static string Token(string userId, DateTime expires)
    {
        var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes("test-jwt-key-0123456789-0123456789-0123456789")),
            SecurityAlgorithms.HmacSha256);
        var jwt = new JwtSecurityToken("MountedGames.Api", "MountedGames.Web", [new Claim(JwtRegisteredClaimNames.Sub, userId)],
            notBefore: DateTime.UtcNow.AddMinutes(-1), expires: expires, signingCredentials: credentials);
        return new JwtSecurityTokenHandler().WriteToken(jwt);
    }
}
