using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using MountedGames.Api.Auth;

namespace MountedGames.Api.Tests.Infrastructure;

public static class TestClients
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Seeded accounts from DbInitializer. The admin password only works in Development.</summary>
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

    /// <summary>
    /// Signs in as the shared admin through the admin key. Outside Development the seeded admin's
    /// password login is refused, and the test host runs as "Testing".
    /// </summary>
    public static async Task<AuthResponse> AdminLoginAsync(this ApiFactory f)
    {
        var resp = await f.CreateClient().PostAsJsonAsync("/api/auth/admin-key", new AdminKeyRequest(ApiFactory.AdminKey));
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<AuthResponse>(Json))!;
    }

    public static async Task<HttpClient> AdminAsync(this ApiFactory f)
        => f.WithToken((await f.AdminLoginAsync()).Token);

    public static async Task<HttpClient> TrainerAsync(this ApiFactory f)
        => f.WithToken((await f.LoginAsync(TrainerEmail, TrainerPassword)).Token);

    /// <summary>Registers a fresh self-service user (pending Trainer/Manager/Member) and signs in as them.</summary>
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

    /// <summary>Creates and approves a fresh trainer, then signs in with the new role.</summary>
    public static async Task<(HttpClient Client, AuthResponse Auth)> ApprovedTrainerAsync(this ApiFactory f)
    {
        var (_, pending) = await f.SignupAsync();
        var admin = await f.AdminAsync();
        var response = await admin.PostAsync($"/api/admin/trainer-requests/{pending.User.Id}/approve", null);
        response.EnsureSuccessStatusCode();
        var auth = await f.LoginAsync(pending.User.Email, "Passw0rd!x");
        return (f.WithToken(auth.Token), auth);
    }

    public static async Task<T> ReadAsync<T>(this HttpResponseMessage r)
        => (await r.Content.ReadFromJsonAsync<T>(Json))!;
}
