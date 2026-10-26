using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Email;

namespace MountedGames.Api.Services.Accounts;

/// <summary>A refused invitation step. The message is safe to show.</summary>
public sealed class AccountInviteException(string message, int statusCode) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

/// <summary>The random token in an invitation link. Only its SHA-256 is stored.</summary>
public static class InviteTokens
{
    private const string Prefix = "mgi_";
    private const int MaxLength = 64;

    /// <summary>256 bits from the system random generator.</summary>
    public static string Generate() => Prefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>Cheap shape check, so junk never reaches the database.</summary>
    public static bool LooksValid(string? token) =>
        token is { Length: > 4 and <= MaxLength } && token.StartsWith(Prefix, StringComparison.Ordinal)
        && token.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-');
}

/// <summary>
/// Invites a person to make an account as an organiser (an approved Trainer) or a site admin. The link goes to
/// <c>{site}/invite#t=TOKEN</c>: the token is in the fragment, so it never reaches a server log. Accepting needs only a name
/// and a password, creates the account with a confirmed email (the link proved the mailbox) and signs the person in.
/// The email is sent inline with a short timeout, like every email here, because the API scales to zero and has no queue.
/// It never throws on a mail failure, never logs the address or the link, and carries no text an admin typed.
/// </summary>
public sealed class AccountInviteService(
    AppDbContext db, UserManager<AppUser> users, IEmailSender sender,
    IOptions<EmailOptions> emailOptions, IConfiguration configuration, TimeProvider time, ILogger<AccountInviteService> log)
{
    public async Task<(AccountInvite Invite, EmailDeliveryStatus Status)> CreateAsync(
        string? email, InviteAccess access, string invitedByUserId, CancellationToken ct)
    {
        if (!EmailValidation.TryNormalise(email, out var address))
            throw new AccountInviteException(EmailValidation.Message(EmailProblem.Format), 400);
        if (!Enum.IsDefined(access)) throw new AccountInviteException("Choose Organiser or Site admin.", 400);
        if (await users.FindByEmailAsync(address) is not null)
            throw new AccountInviteException("That address already has an account.", 409);
        var now = Now();
        if (await db.AccountInvites.AnyAsync(i => i.Email == address && i.AcceptedAt == null && i.CancelledAt == null && i.ExpiresAt > now, ct))
            throw new AccountInviteException("That address already has a pending invitation. Resend or cancel it instead.", 409);

        var token = InviteTokens.Generate();
        var invite = new AccountInvite
        {
            Email = address, Access = access, TokenHash = InviteTokens.Hash(token), InvitedByUserId = invitedByUserId,
            CreatedAt = now, ExpiresAt = now.AddDays(AccountInvite.Days),
        };
        db.AccountInvites.Add(invite);
        await db.SaveChangesAsync(ct);
        var status = await SendAsync(invite, token, ct);
        return (invite, status);
    }

    /// <summary>Issues a fresh link (the old one stops working) and sends it again. At most once a minute, ten times in all.</summary>
    public async Task<(AccountInvite Invite, EmailDeliveryStatus Status)> ResendAsync(int id, CancellationToken ct)
    {
        var now = Now();
        var invite = await db.AccountInvites.FirstOrDefaultAsync(i => i.Id == id, ct)
            ?? throw new AccountInviteException("Invitation not found.", 404);
        if (invite.AcceptedAt is not null) throw new AccountInviteException("This invitation has already been accepted.", 409);
        if (invite.CancelledAt is not null) throw new AccountInviteException("This invitation was cancelled. Invite the person again.", 409);
        if (invite.SendCount >= AccountInvite.MaxSends)
            throw new AccountInviteException("This invitation has been sent as many times as it can be. Cancel it and invite again.", 429);
        if (invite.LastSentAt is { } last && now - last < AccountInvite.MinResendGap)
            throw new AccountInviteException("It was sent a moment ago. Wait a minute before sending it again.", 429);

        var token = InviteTokens.Generate();
        invite.TokenHash = InviteTokens.Hash(token);
        invite.ExpiresAt = now.AddDays(AccountInvite.Days);
        await db.SaveChangesAsync(ct);
        var status = await SendAsync(invite, token, ct);
        return (invite, status);
    }

    public async Task CancelAsync(int id, CancellationToken ct)
    {
        var invite = await db.AccountInvites.FirstOrDefaultAsync(i => i.Id == id, ct)
            ?? throw new AccountInviteException("Invitation not found.", 404);
        if (invite.AcceptedAt is not null) throw new AccountInviteException("This invitation has already been accepted.", 409);
        invite.CancelledAt ??= Now();
        await db.SaveChangesAsync(ct);
    }

    /// <summary>What the accept page shows: who it is for and what they become. Null for any token that isn't usable.</summary>
    public async Task<AccountInvite?> FindUsableAsync(string? token, CancellationToken ct)
    {
        if (!InviteTokens.LooksValid(token)) return null;
        var hash = InviteTokens.Hash(token!);
        var now = Now();
        return await db.AccountInvites.AsNoTracking().FirstOrDefaultAsync(i =>
            i.TokenHash == hash && i.AcceptedAt == null && i.CancelledAt == null && i.ExpiresAt > now, ct);
    }

    /// <summary>
    /// Makes the account. The invitation is claimed and the account created in one transaction, so a second click, or two at
    /// once, can't make two accounts, and a password that is refused leaves the invitation open for another try.
    /// </summary>
    public async Task<(AppUser? User, IdentityResult? Failure)> AcceptAsync(string token, string fullName, string password, CancellationToken ct)
    {
        if (!InviteTokens.LooksValid(token)) throw new AccountInviteException("This invitation is not valid.", 404);
        var name = fullName?.Trim() ?? string.Empty;
        if (name.Length == 0) throw new AccountInviteException("Your name is required.", 400);
        if (name.Length > 100) throw new AccountInviteException("Your name must be 100 characters or fewer.", 400);
        if (string.IsNullOrEmpty(password)) throw new AccountInviteException("A password is required.", 400);

        var hash = InviteTokens.Hash(token);
        var known = await db.AccountInvites.AsNoTracking().FirstOrDefaultAsync(i => i.TokenHash == hash, ct)
            ?? throw new AccountInviteException("This invitation is not valid.", 404);
        if (known.AcceptedAt is not null || known.CancelledAt is not null || known.ExpiresAt <= Now())
            throw new AccountInviteException("This invitation has expired or was cancelled. Ask for a new one.", 410);

        return await db.Database.CreateExecutionStrategy().ExecuteAsync<(AppUser?, IdentityResult?)>(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var now = Now();
            var claimed = await db.AccountInvites.Where(i => i.Id == known.Id && i.AcceptedAt == null && i.CancelledAt == null && i.ExpiresAt > now)
                .ExecuteUpdateAsync(s => s.SetProperty(i => i.AcceptedAt, now), ct);
            if (claimed == 0) throw new AccountInviteException("This invitation has expired or was cancelled. Ask for a new one.", 410);
            if (await users.FindByEmailAsync(known.Email) is not null)
                throw new AccountInviteException("That address already has an account. Sign in instead.", 409);

            var user = new AppUser { UserName = known.Email, Email = known.Email, FullName = name, EmailConfirmed = true };
            var created = await users.CreateAsync(user, password);
            if (!created.Succeeded) return (null, created);
            var role = known.Access == InviteAccess.SiteAdmin ? Roles.Admin : Roles.Trainer;
            var granted = await users.AddToRoleAsync(user, role);
            if (!granted.Succeeded) return (null, granted);
            await db.AccountInvites.Where(i => i.Id == known.Id).ExecuteUpdateAsync(s => s.SetProperty(i => i.AcceptedUserId, user.Id), ct);
            await transaction.CommitAsync(ct);
            return (user, null);
        });
    }

    private async Task<EmailDeliveryStatus> SendAsync(AccountInvite invite, string token, CancellationToken ct)
    {
        EmailDeliveryStatus status;
        try
        {
            var site = EmailSite.Origin(emailOptions.Value, configuration);
            if (site is null) status = EmailDeliveryStatus.NotSent;
            else
            {
                var link = $"{site}/invite#t={token}";
                var what = invite.Access == InviteAccess.SiteAdmin
                    ? "a site admin, who can see and run every competition"
                    : "an organiser, who can create and run their own competitions";
                var text = $"""
                    Hello,

                    A Mounted Games administrator has invited you to join as {what}. Choose your name and a password to set up your account. This link works for {AccountInvite.Days} days and can be used once:

                    {link}

                    If you weren't expecting this, you can ignore this email and nothing will happen.

                    Mounted Games
                    """;
                var html = EmailHtml.Wrap($"""
                    <p style="margin:0 0 12px;">Hello,</p>
                    <p style="margin:0 0 16px;">A Mounted Games administrator has invited you to join as {EmailHtml.Encode(what)}. Choose your name and a password to set up your account. This link works for {AccountInvite.Days} days and can be used once.</p>
                    {EmailHtml.Button(link, "Set up your account")}
                    <p style="margin:16px 0 0;color:#475569;font-size:13px;">If you weren't expecting this, you can ignore this email and nothing will happen.</p>
                    """);
                status = await sender.SendAsync(new EmailMessage(invite.Email, "You're invited to Mounted Games", text, html,
                    $"account-invite-{invite.Id}-{invite.SendCount + 1}"), ct);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning("Could not build the invitation email: {Reason}", ex.GetType().Name);
            status = EmailDeliveryStatus.Failed;
        }
        invite.LastSentAt = Now();
        invite.LastEmailStatus = status;
        invite.SendCount++;
        await db.SaveChangesAsync(ct);
        return status;
    }

    private DateTime Now() => time.GetUtcNow().UtcDateTime;
}
