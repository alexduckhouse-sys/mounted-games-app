using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Email;

namespace MountedGames.Api.Services.Accounts;

/// <summary>The random token in a reset link. Only its SHA-256 is stored.</summary>
public static class PasswordResetTokens
{
    private const string Prefix = "mgr_";
    private const int MaxLength = 64;

    /// <summary>256 bits from the system random generator, base64url.</summary>
    public static string Generate() => Prefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>Cheap shape check, so junk never reaches the database.</summary>
    public static bool LooksValid(string? token) =>
        token is { Length: > 4 and <= MaxLength } && token.StartsWith(Prefix, StringComparison.Ordinal)
        && token.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-');

    /// <summary>
    /// Compares a stored hash with a computed one in constant time. The row is found by its hash (an index lookup on a value
    /// nobody can steer), and this second comparison makes the final yes or no independent of where two hashes differ.
    /// </summary>
    public static bool Matches(string stored, string computed) =>
        CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(stored), Encoding.ASCII.GetBytes(computed));
}

public enum PasswordResetOutcome { Changed, Invalid, Expired, Used, PasswordRequired, PasswordRules }

public sealed record PasswordResetResult(PasswordResetOutcome Outcome, IReadOnlyList<IdentityError>? Errors = null);

/// <summary>
/// "Forgot your password?" by email. A request mails a link to <c>{site}/reset-password#t=TOKEN</c> (the fragment never
/// reaches a server log) when the address belongs to an account that can be reset, and does nothing otherwise; the caller
/// gives the same answer either way. The link works once, for 30 minutes, and asking again ends earlier links. Using it
/// sets the new password under the usual Identity rules, clears the wrong-password lockout, confirms the address (the link
/// proved the mailbox), raises <see cref="AppUser.SessionVersion"/> so every existing sign-in stops working
/// (<see cref="LiveAccounts"/>), and sends a "your password was changed" notice. Emails go inline with a short timeout,
/// like every email here, never throw, and never log the address or the link.
/// </summary>
public sealed class PasswordResetService(
    AppDbContext db, UserManager<AppUser> users, IEmailSender sender, IOptions<EmailOptions> emailOptions,
    IConfiguration configuration, LiveAccounts liveAccounts, TimeProvider time, ILogger<PasswordResetService> log)
{
    /// <summary>Per account: at most one link a minute and five an hour, counted in the database so it holds across instances.</summary>
    public static readonly TimeSpan MinGap = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan CapWindow = TimeSpan.FromHours(1);
    public const int MaxPerWindow = 5;
    /// <summary>Old links (and the hashed network each came from) are deleted after this.</summary>
    public static readonly TimeSpan KeepFor = TimeSpan.FromDays(30);
    public const int DefaultMinimumResponseMilliseconds = 1500;

    /// <summary>
    /// Every reset request takes at least this long (<c>PasswordReset:MinResponseMilliseconds</c>), so a known address, which
    /// sends an email, can't be told from an unknown one by the time the answer takes.
    /// </summary>
    public TimeSpan MinimumResponse => TimeSpan.FromMilliseconds(
        Math.Clamp(configuration.GetValue("PasswordReset:MinResponseMilliseconds", DefaultMinimumResponseMilliseconds), 0, 10_000));

    /// <summary>
    /// Whether an account may be sent a reset link: it has a password and a real mailbox, and isn't deleted, locked or blocked.
    /// The shared admin-key account and made-up <c>*.mg.local</c> usernames have no mailbox.
    /// </summary>
    public static bool CanReset(AppUser user) =>
        !string.IsNullOrEmpty(user.PasswordHash) && !user.IsAccessStopped && user.LockoutEnd != DateTimeOffset.MaxValue
        && HasMailbox(user.Email);

    private static bool HasMailbox(string? email)
    {
        if (string.IsNullOrEmpty(email)) return false;
        var domain = email[(email.LastIndexOf('@') + 1)..];
        return !domain.Equals("mg.local", StringComparison.OrdinalIgnoreCase) && !domain.EndsWith(".mg.local", StringComparison.OrdinalIgnoreCase)
            && !domain.Equals("invalid", StringComparison.OrdinalIgnoreCase) && !domain.EndsWith(".invalid", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Mails a reset link if <paramref name="address"/> belongs to an account that can be reset. Silent either way.</summary>
    public async Task RequestAsync(string address, string? ip, CancellationToken ct)
    {
        var user = await users.FindByEmailAsync(address);
        if (user is null || !CanReset(user)) return;
        var site = EmailSite.Origin(emailOptions.Value, configuration);
        if (site is null) return;
        var issued = await IssueAsync(user.Id, ip, ct);
        if (issued is not { } link) return;
        await SendAsync(user.Email!, "Reset your Mounted Games password", ResetText(site, link.Token), ResetHtml(site, link.Token),
            $"password-reset-{link.Id}", "reset link", ct);
    }

    /// <summary>What a link is, for the page that opens it. Says nothing about whose account it is for.</summary>
    public async Task<(PasswordResetLinkState State, DateTime? ExpiresAt)> CheckAsync(string? token, CancellationToken ct)
    {
        var (state, row, _) = await EvaluateAsync(token, ct);
        return (state, state == PasswordResetLinkState.Valid ? DateTime.SpecifyKind(row!.ExpiresAt, DateTimeKind.Utc) : null);
    }

    /// <summary>
    /// Sets the new password. A password that breaks the rules is refused before the link is touched, so the person can try
    /// again with the same link. The link is then claimed in a single guarded UPDATE inside the transaction that changes the
    /// password, so of two submits at once only one succeeds, and a failure rolls the claim back.
    /// </summary>
    public async Task<PasswordResetResult> ConfirmAsync(string? token, string? newPassword, CancellationToken ct)
    {
        var (state, row, user) = await EvaluateAsync(token, ct);
        if (state != PasswordResetLinkState.Valid) return new(Outcome(state));
        if (string.IsNullOrEmpty(newPassword)) return new(PasswordResetOutcome.PasswordRequired);
        var problems = new List<IdentityError>();
        foreach (var validator in users.PasswordValidators)
        {
            var checkedPassword = await validator.ValidateAsync(users, user!, newPassword);
            if (!checkedPassword.Succeeded) problems.AddRange(checkedPassword.Errors);
        }
        if (problems.Count > 0) return new(PasswordResetOutcome.PasswordRules, problems);

        var linkId = row!.Id;
        var userId = row.UserId;
        var outcome = await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var now = Now();
            var claimed = await db.PasswordResetTokens.Where(t => t.Id == linkId && t.UsedAt == null && t.ExpiresAt > now)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.UsedAt, now), ct);
            if (claimed == 0)
            {
                // Another submit got there first, or the link ran out a moment ago.
                var usedAt = await db.PasswordResetTokens.AsNoTracking().Where(t => t.Id == linkId).Select(t => t.UsedAt).FirstOrDefaultAsync(ct);
                return usedAt is null ? PasswordResetOutcome.Expired : PasswordResetOutcome.Used;
            }
            var account = await users.FindByIdAsync(userId);
            if (account is null || !CanReset(account)) return PasswordResetOutcome.Invalid;

            account.PasswordHash = users.PasswordHasher.HashPassword(account, newPassword);
            account.EmailConfirmed = true;
            account.AccessFailedCount = 0;
            account.LockoutEnd = null;
            account.SessionVersion++;
            // Saves everything above under Identity's concurrency check, with a new security stamp (which also ends
            // outstanding email-confirmation links).
            var saved = await users.UpdateSecurityStampAsync(account);
            if (!saved.Succeeded) throw new InvalidOperationException("The new password could not be saved.");
            // Any other link still open for the account stops working too.
            await db.PasswordResetTokens.Where(t => t.UserId == userId && t.Id != linkId && t.UsedAt == null && t.ExpiresAt > now)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.ExpiresAt, now), ct);
            await transaction.CommitAsync(ct);
            return PasswordResetOutcome.Changed;
        });
        if (outcome != PasswordResetOutcome.Changed) return new(outcome);

        // Old tokens stop working on this instance now, and on the others within LiveAccounts.CacheFor.
        liveAccounts.Forget(userId);
        db.ChangeTracker.Clear();
        var changed = await users.FindByIdAsync(userId);
        if (changed is not null && EmailSite.Origin(emailOptions.Value, configuration) is { } site)
        {
            var admin = await users.IsInRoleAsync(changed, Roles.Admin);
            await SendAsync(changed.Email!, "Your Mounted Games password was changed", ChangedText(site, admin), ChangedHtml(site, admin),
                $"password-changed-{linkId}", "password-changed notice", ct);
        }
        return new(PasswordResetOutcome.Changed);
    }

    private static PasswordResetOutcome Outcome(PasswordResetLinkState state) => state switch
    {
        PasswordResetLinkState.Expired => PasswordResetOutcome.Expired,
        PasswordResetLinkState.Used => PasswordResetOutcome.Used,
        _ => PasswordResetOutcome.Invalid,
    };

    private async Task<(PasswordResetLinkState State, PasswordResetToken? Row, AppUser? User)> EvaluateAsync(string? token, CancellationToken ct)
    {
        if (!PasswordResetTokens.LooksValid(token)) return (PasswordResetLinkState.Invalid, null, null);
        var hash = PasswordResetTokens.Hash(token!);
        var row = await db.PasswordResetTokens.AsNoTracking().FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (row is null || !PasswordResetTokens.Matches(row.TokenHash, hash)) return (PasswordResetLinkState.Invalid, null, null);
        var user = await users.FindByIdAsync(row.UserId);
        if (user is null || !CanReset(user)) return (PasswordResetLinkState.Invalid, null, null);
        if (row.UsedAt is not null) return (PasswordResetLinkState.Used, row, user);
        if (row.ExpiresAt <= Now()) return (PasswordResetLinkState.Expired, row, user);
        return (PasswordResetLinkState.Valid, row, user);
    }

    /// <summary>
    /// Makes a new link unless the account has had one in the last minute or five in the last hour, and ends the account's
    /// earlier unused links. One account's requests are serialised (a Postgres advisory lock; SQLite's write lock), so two at
    /// once can't both get past the cap or both stay valid.
    /// </summary>
    private async Task<(int Id, string Token)?> IssueAsync(string userId, string? ip, CancellationToken ct)
    {
        var ipHash = string.IsNullOrWhiteSpace(ip) ? null : IpRetention.HashFor(configuration, ip);
        return await db.Database.CreateExecutionStrategy().ExecuteAsync<(int Id, string Token)?>(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            if (db.Database.IsNpgsql())
            {
                var lockKey = BinaryPrimitives.ReadInt64BigEndian(SHA256.HashData(Encoding.UTF8.GetBytes($"password-reset:{userId}")));
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({lockKey})", ct);
            }
            var now = Now();
            var windowStart = now - CapWindow;
            var recent = await db.PasswordResetTokens.Where(t => t.UserId == userId && t.CreatedAt > windowStart)
                .Select(t => t.CreatedAt).ToListAsync(ct);
            if (recent.Count >= MaxPerWindow || recent.Any(createdAt => createdAt > now - MinGap)) return null;

            await db.PasswordResetTokens.Where(t => t.UserId == userId && t.UsedAt == null && t.ExpiresAt > now)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.ExpiresAt, now), ct);
            var stale = now - KeepFor;
            await db.PasswordResetTokens.Where(t => t.CreatedAt < stale).ExecuteDeleteAsync(ct);

            var token = PasswordResetTokens.Generate();
            var link = new PasswordResetToken
            {
                UserId = userId, TokenHash = PasswordResetTokens.Hash(token), CreatedAt = now,
                ExpiresAt = now + PasswordResetToken.Lifetime, RequestedIpHash = ipHash,
            };
            db.PasswordResetTokens.Add(link);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return (link.Id, token);
        });
    }

    private async Task SendAsync(string to, string subject, string text, string html, string idempotencyKey, string what, CancellationToken ct)
    {
        var status = await sender.SendAsync(new EmailMessage(to, subject, text, html, idempotencyKey), ct);
        if (status == EmailDeliveryStatus.Failed) log.LogWarning("The password {What} for {Recipient} was not delivered.", what, EmailAddresses.Mask(to));
    }

    private static int Minutes => (int)PasswordResetToken.Lifetime.TotalMinutes;

    private static string ResetText(string site, string token) => $"""
        Hello,

        We've had a request to reset the password for the Mounted Games account that uses this email address. Use this link to choose a new one. It works once, within {Minutes} minutes:

        {site}/reset-password#t={token}

        If you didn't ask for this, you can ignore this email. Your password won't change.

        Mounted Games
        """;

    private static string ResetHtml(string site, string token) => EmailHtml.Wrap($"""
        <p style="margin:0 0 12px;">Hello,</p>
        <p style="margin:0 0 16px;">We've had a request to reset the password for the Mounted Games account that uses this email address. Use this link to choose a new one. It works once, within {Minutes} minutes.</p>
        {EmailHtml.Button($"{site}/reset-password#t={token}", "Choose a new password")}
        <p style="margin:16px 0 0;color:#475569;font-size:13px;">If you didn't ask for this, you can ignore this email. Your password won't change.</p>
        """);

    private const string AdminNote =
        "This is a site admin account. If you didn't change the password, also ask another site admin to lock the account until you've reset it.";

    private static string ChangedText(string site, bool admin) => $"""
        Hello,

        The password for the Mounted Games account that uses this email address has just been changed with a reset link. We've signed the account out on every device, so the new password is needed to sign in again.

        If this was you, there's nothing else to do.

        If it wasn't you, reset your password straight away: {site}/forgot-password
        {(admin ? $"\n{AdminNote}\n" : string.Empty)}
        Mounted Games
        """;

    private static string ChangedHtml(string site, bool admin) => EmailHtml.Wrap($"""
        <p style="margin:0 0 12px;">Hello,</p>
        <p style="margin:0 0 12px;">The password for the Mounted Games account that uses this email address has just been changed with a reset link. We've signed the account out on every device, so the new password is needed to sign in again.</p>
        <p style="margin:0 0 12px;">If this was you, there's nothing else to do.</p>
        <p style="margin:0 0 12px;">If it wasn't you, reset your password straight away.</p>
        {EmailHtml.Button($"{site}/forgot-password", "Reset my password")}
        {(admin ? $"<p style=\"margin:16px 0 0;\">{EmailHtml.Encode(AdminNote)}</p>" : string.Empty)}
        """);

    private DateTime Now() => time.GetUtcNow().UtcDateTime;
}
