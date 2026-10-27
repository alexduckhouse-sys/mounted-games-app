using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using MountedGames.Api.Auth;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>
/// Regression from the PR #206 review. An admin-key admin can type any address, and whoever reads that mailbox got the
/// confirmation email. Confirming used to need only the link, so a stranger at a mistyped or hijacked address could confirm
/// it, then reset the password by email and own the admin account. Confirming now needs the account's owner signed in.
/// </summary>
public class EmailConfirmationTakeoverTests(PasswordResetTests.Factory f) : IClassFixture<PasswordResetTests.Factory>
{
    [Fact]
    public async Task AStrangerAtATypedAddressCantConfirmIt_SoCantResetTheAdminAccount()
    {
        var email = ResetSteps.NewEmail();
        var owner = await (await f.CreateClient().PostAsJsonAsync("/api/auth/admin-key",
            new AdminKeyRequest(ApiFactory.AdminKey, "Show Secretary", email, ResetSteps.Password))).ReadAsync<AuthResponse>();
        Assert.Contains(Roles.Admin, owner.User.Roles);

        // The confirmed-address gate holds while unconfirmed.
        await f.RequestResetAsync(email);
        Assert.Empty(f.Mail(email, ResetSteps.ResetSubject));

        // The mailbox holder (not the organiser) opens the confirmation email: signed in as nobody, or as their own account.
        var mail = f.Mail(email, "Confirm your email address").Last();
        Assert.Contains("sign in to that account", mail.Text);
        var link = Regex.Match(mail.Text, @"confirm-email#u=([^&\s]+)&t=([^\s]+)");
        Assert.True(link.Success, mail.Text);
        var request = new ConfirmEmailRequest(Uri.UnescapeDataString(link.Groups[1].Value), Uri.UnescapeDataString(link.Groups[2].Value));
        var (stranger, _) = await f.SignupAsync("Member");

        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().PostAsJsonAsync("/api/auth/confirm-email", request)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.PostAsJsonAsync("/api/auth/confirm-email", request)).StatusCode);

        // So still no reset link, and the password stays the owner's.
        f.Clock.Advance(TimeSpan.FromMinutes(2));
        await f.RequestResetAsync(email);
        Assert.Empty(f.Mail(email, ResetSteps.ResetSubject));
        Assert.False((await f.UserAsync(email)).EmailConfirmed);

        // The owner, signed in, confirms; from then on a reset is theirs to ask for.
        Assert.Equal(HttpStatusCode.OK, (await f.WithToken(owner.Token).PostAsJsonAsync("/api/auth/confirm-email", request)).StatusCode);
        f.Clock.Advance(TimeSpan.FromMinutes(2));
        await f.RequestResetAsync(email);
        Assert.Single(f.Mail(email, ResetSteps.ResetSubject));
    }
}
