using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using MountedGames.Api.Auth;

namespace MountedGames.Api.Tests.Infrastructure;

public static class TestClients
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Seeded accounts from DbInitializer.</summary>
    public const string AdminEmail = "admin@mg.local";
    public const string AdminPassword = "Admin!234";
    public const string TrainerEmail = "trainer@mg.local";
    public const string TrainerPassword = "Trainer!234";

    public static async Task<AuthResponse> LoginAsync(this ApiFactory f, string email, string password)
    {
        var resp = await f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, password));
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<AuthResponse>(Json))!;
    }

    public static async Task<HttpClient> AdminAsync(this ApiFactory f)
        => f.WithToken((await f.LoginAsync(AdminEmail, AdminPassword)).Token);

    public static async Task<HttpClient> TrainerAsync(this ApiFactory f)
        => f.WithToken((await f.LoginAsync(TrainerEmail, TrainerPassword)).Token);

    /// <summary>Registers a fresh self-service user (Trainer/Manager/Member) and returns a client signed in as them.</summary>
    public static async Task<(HttpClient Client, AuthResponse Auth)> SignupAsync(
        this ApiFactory f, string? role = null, string? clubName = null)
    {
        var name = $"user{Guid.NewGuid():N}"[..14];
        var resp = await f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(name, "Passw0rd!x", role, clubName));
        resp.EnsureSuccessStatusCode();
        var auth = (await resp.Content.ReadFromJsonAsync<AuthResponse>(Json))!;
        return (f.WithToken(auth.Token), auth);
    }

    public static HttpClient WithToken(this ApiFactory f, string token)
    {
        var c = f.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return c;
    }

    public static async Task<T> ReadAsync<T>(this HttpResponseMessage r)
        => (await r.Content.ReadFromJsonAsync<T>(Json))!;
}
