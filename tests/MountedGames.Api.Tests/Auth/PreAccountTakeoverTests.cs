using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>
/// Pre-account takeover, from the PR #245 review. Someone makes an account with a victim's address before the victim
/// arrives, by password or with a Facebook account whose address nobody checked, and waits. The victim's own Google sign-in
/// must never be linked to that account while the squatter's way in still works; instead the victim resets the password by
/// email, which removes every provider sign-in, and Google links after that.
/// </summary>
public class PreAccountTakeoverTests(PreAccountTakeoverTests.Factory f) : IClassFixture<PreAccountTakeoverTests.Factory>
{
    /// <summary>Google, Apple and Facebook as in <see cref="ExternalAuthFactory"/>, with the reset's minimum answer time off.</summary>
    public sealed class Factory : ExternalAuthFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("PasswordReset:MinResponseMilliseconds", "0");
        }
    }

    private static string Gmail() => $"victim.{Guid.NewGuid():N}"[..20] + "@gmail.com";

    private Task<HttpResponseMessage> GoogleAsync(string email, string? subject = null)
    {
        var (token, nonce, _) = f.GoogleSignIn(email, subject);
        return f.CreateClient().PostAsJsonAsync("/api/auth/external", new ExternalAuthRequest("google", token, nonce));
    }

    private Task<HttpResponseMessage> FacebookAsync(string facebookId, string email)
        => f.CreateClient().PostAsJsonAsync("/api/auth/external",
            new ExternalAuthRequest("facebook", f.Facebook.Issue(new FakeFacebookGraph.User(facebookId, "Mallory", email))));

    /// <summary>The squatter signs up with Facebook, which hands over the victim's address unchecked.</summary>
    private async Task<(AuthResponse Auth, string FacebookId)> FacebookSquatAsync(string email, string role = Roles.Member)
    {
        var facebookId = FakeFacebookGraph.NewUserId();
        var asked = await (await FacebookAsync(facebookId, email)).ReadAsync<ExternalAuthResultDto>();
        Assert.True(asked.NeedsSignup);
        var created = await f.CreateClient().PostAsJsonAsync("/api/auth/external/signup",
            new ExternalSignupRequest(asked.SignupTicket!, "Mallory", $"Squat Club {Guid.NewGuid():N}"[..24], role));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var auth = await created.ReadAsync<AuthResponse>();
        Assert.False(auth.User.EmailConfirmed);
        return (auth, facebookId);
    }

    /// <summary>The latest confirmation email's link, applied by whoever holds <paramref name="session"/>.</summary>
    private async Task<HttpStatusCode> ConfirmAddressAsync(string email, string session)
    {
        var mail = f.Mail(email, "Confirm your email address").Last();
        var link = Regex.Match(mail.Text, @"confirm-email#u=([^&\s]+)&t=([^\s]+)");
        Assert.True(link.Success, mail.Text);
        var request = new ConfirmEmailRequest(Uri.UnescapeDataString(link.Groups[1].Value), Uri.UnescapeDataString(link.Groups[2].Value));
        return (await f.WithToken(session).PostAsJsonAsync("/api/auth/confirm-email", request)).StatusCode;
    }

    private async Task<string> SignInWithPasswordAsync(string email, string password)
    {
        var response = await f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, password));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.ReadAsync<AuthResponse>()).Token;
    }

    private Task<List<string>> ProvidersAsync(string userId)
        => f.WithDbAsync(db => db.UserLogins.Where(l => l.UserId == userId).Select(l => l.LoginProvider).ToListAsync());

    private static async Task AssertRefusedAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(code, body.RootElement.GetProperty("code").GetString());
    }

    private static async Task<string> SignedInIdAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.ReadAsync<ExternalAuthResultDto>();
        Assert.False(result.NeedsSignup);
        return result.Auth!.User.Id;
    }

    [Fact]
    public async Task AFacebookSquatWithTheVictimsAddress_IsntOpenedByTheVictimsGoogle_EvenOnceConfirmed()
    {
        var email = Gmail();
        var (squat, facebookId) = await FacebookSquatAsync(email);

        // The worst case: the confirmation email gets used where that account is signed in, so the address is confirmed.
        Assert.Equal(HttpStatusCode.OK, await ConfirmAddressAsync(email, squat.Token));
        Assert.True((await f.UserAsync(email)).EmailConfirmed);

        // The victim's Google sign-in is still not linked, because the squatter's Facebook would keep working beside it.
        var google = await GoogleAsync(email);
        await AssertRefusedAsync(google, HttpStatusCode.Conflict, "external_link_refused");
        Assert.Contains("reset your password first", await google.Content.ReadAsStringAsync());
        Assert.Equal(new[] { "facebook" }, await ProvidersAsync(squat.User.Id));
        Assert.Single(await f.WithDbAsync(db => db.Users.Where(u => u.NormalizedEmail == email.ToUpperInvariant()).ToListAsync()));

        // The victim takes it back by email: the reset removes the Facebook sign-in and ends the squatter's session.
        Assert.Equal(HttpStatusCode.OK, (await f.ConfirmAsync(await f.LinkAsync(email))).StatusCode);
        Assert.Empty(await ProvidersAsync(squat.User.Id));
        Assert.Equal(HttpStatusCode.Unauthorized, await f.MeAsync(squat.Token));
        await AssertRefusedAsync(await FacebookAsync(facebookId, email), HttpStatusCode.Conflict, "external_link_refused");

        // Now Google links, and only Google is there.
        Assert.Equal(squat.User.Id, await SignedInIdAsync(await GoogleAsync(email)));
        Assert.Equal(new[] { "google" }, await ProvidersAsync(squat.User.Id));
    }

    [Fact]
    public async Task APasswordSquatWithTheVictimsAddress_IsntOpenedByTheVictimsGoogle_UntilTheVictimResetsIt()
    {
        var email = Gmail();
        var signup = await f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer",
            new SignupTrainerRequest(email, ResetSteps.Password, Roles.Member, "Squat Club", "Mallory"));
        signup.EnsureSuccessStatusCode();
        var squat = await signup.ReadAsync<AuthResponse>();
        // Even confirmed (the worst case), a password chosen at sign-up says nothing about who reads the mailbox.
        await f.ConfirmAddressAsync(squat.User.Id);

        await AssertRefusedAsync(await GoogleAsync(email), HttpStatusCode.Conflict, "external_link_refused");
        Assert.Empty(await ProvidersAsync(squat.User.Id));

        Assert.Equal(HttpStatusCode.OK, (await f.ConfirmAsync(await f.LinkAsync(email))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await f.SignInAsync(email, ResetSteps.Password));
        Assert.Equal(squat.User.Id, await SignedInIdAsync(await GoogleAsync(email)));
        Assert.Equal(new[] { "google" }, await ProvidersAsync(squat.User.Id));
    }

    [Fact]
    public async Task AnUnconfirmedFacebookSquat_IsResetByTheMailboxOwner_WhoCanThenConfirmItAndLinkGoogle()
    {
        var email = Gmail();
        var (squat, facebookId) = await FacebookSquatAsync(email);
        await AssertRefusedAsync(await GoogleAsync(email), HttpStatusCode.Conflict, "external_link_refused");

        // No password and an unconfirmed address, but only a Member: the mailbox's owner gets a link.
        var token = await f.LinkAsync(email);
        Assert.Equal(HttpStatusCode.OK, (await f.ConfirmAsync(token)).StatusCode);
        Assert.Empty(await ProvidersAsync(squat.User.Id));
        Assert.Equal(HttpStatusCode.Unauthorized, await f.MeAsync(squat.Token));
        await AssertRefusedAsync(await FacebookAsync(facebookId, email), HttpStatusCode.Conflict, "external_link_refused");

        // The reset doesn't confirm the address: the owner does that, signed in, then Google links.
        Assert.False((await f.UserAsync(email)).EmailConfirmed);
        await AssertRefusedAsync(await GoogleAsync(email), HttpStatusCode.Conflict, "external_link_refused");
        var session = await SignInWithPasswordAsync(email, ResetSteps.NewPassword);
        // The reset's new security stamp ended the first confirmation link, so the owner asks for another (a few minutes on).
        await f.InDbAsync(async db =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == squat.User.Id);
            user.LastConfirmationSentAt = DateTime.UtcNow - TimeSpan.FromMinutes(5);
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.OK, (await f.WithToken(session).PostAsync("/api/auth/resend-confirmation", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, await ConfirmAddressAsync(email, session));

        Assert.Equal(squat.User.Id, await SignedInIdAsync(await GoogleAsync(email)));
        Assert.Equal(new[] { "google" }, await ProvidersAsync(squat.User.Id));
    }

    [Fact]
    public async Task AnUnconfirmedFacebookAccountAskingToBeAnOrganiser_GetsNoResetLink()
    {
        var email = Gmail();
        var (squat, _) = await FacebookSquatAsync(email, role: Roles.Trainer);
        Assert.Contains(Roles.TrainerRequest, squat.User.Roles);
        var before = f.Sent.Count;

        var response = await f.RequestResetAsync(email);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(before, f.Sent.Count);
        Assert.False(await f.WithDbAsync(db => db.PasswordResetTokens.AnyAsync(t => t.UserId == squat.User.Id)));
    }
}
