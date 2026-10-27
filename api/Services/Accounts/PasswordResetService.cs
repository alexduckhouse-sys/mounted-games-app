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

public enum PasswordResetOutcome
{
    Changed, Invalid, Expired, Used, PasswordRequired, PasswordRules,
    /// <summary>The account was changed by something else (a lock, a block) while the new password was being saved. Nothing was saved and the link still works.</summary>
    Conflict,
}

public sealed record PasswordResetResult(PasswordResetOutcome Outcome, IReadOnlyList<IdentityError>? Errors = null);

/// <summary>
/// "Forgot your password?" by email. A request mails a link to <c>{site}/reset-password#t=TOKEN</c> (the fragment never
/// reaches a server log) when the address belongs to an account that can be reset, and does nothing otherwise; the caller
/// gives the same answer either way. The link works once, for 30 minutes, and asking again ends earlier links at least five minutes old. Using it
/// sets the new password under the usual Identity rules (or the first one, for an account that only signed in with Google
/// or Apple), clears the wrong-password lockout, confirms the address (the link proved the mailbox), raises
/// <see cref="AppUser.SessionVersion"/> so every existing sign-in stops working (<see cref="LiveAccounts"/>), disconnects
/// any Google or Apple sign-in (one an intruder linked would otherwise survive), takes away <see cref="Roles.MasterAdmin"/> (the key holder gets it back with the key, so
/// a stolen mailbox can't reach it), and sends a "your password was changed" notice. Emails never throw and never log the
/// address or the link; the reset link's send may finish after the request has been answered (see <see cref="RequestAsync"/>).
/// </summary>
public sealed class PasswordResetService(
    AppDbContext db, UserManager<AppUser> users, IEmailSender sender, IOptions<EmailOptions> emailOptions,
    IConfiguration configuration, LiveAccounts liveAccounts, TimeProvider time, ILogger<PasswordResetService> log)
{
    /// <summary>Per account: at most one link a minute and five an hour, counted in the database so it holds across instances.</summary>
    public static readonly TimeSpan MinGap = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan CapWindow = TimeSpan.FromHours(1);
    public const int MaxPerWindow = 5;
    /// <summary>
    /// A new request never ends a link younger than this, so someone asking for links for another person's address over and
    /// over can't keep killing the one that person has just been sent.
    /// </summary>
    public static readonly TimeSpan ProtectedFor = TimeSpan.FromMinutes(5);
    /// <summary>Old links (and the hashed network each came from) are deleted after this.</summary>
    public static readonly TimeSpan KeepFor = TimeSpan.FromDays(30);
    public const int DefaultMinimumResponseMilliseconds = 1500;

    /// <summary>
    /// Every reset request is answered at this point (<c>PasswordReset:MinResponseMilliseconds</c>), not before and not later
    /// because of the email, so a known address can't be told from an unknown one by the time the answer takes. Zero turns the
    /// guard off, and the request then waits for the email (tests and local runs).
    /// </summary>
    public TimeSpan MinimumResponse => TimeSpan.FromMilliseconds(
        Math.Clamp(configuration.GetValue("PasswordReset:MinResponseMilliseconds", DefaultMinimumResponseMilliseconds), 0, 10_000));

    /// <summary>
    /// The first test for a reset link: a real mailbox, and not deleted, locked or blocked. The shared admin-key account and
    /// made-up <c>*.mg.local</c> usernames have no mailbox. <see cref="MayResetAsync"/> adds the rules that need roles.
    /// </summary>
    public static bool CanReset(AppUser user) =>
        !user.IsAccessStopped && user.LockoutEnd != DateTimeOffset.MaxValue && HasMailbox(user.Email);

    /// <summary>Roles whose holders only get a link once their address is confirmed, because the mailbox would then control more than the person's own entries.</summary>
    private static readonly string[] NeedConfirmedAddress = [Roles.Admin, Roles.MasterAdmin, Roles.Trainer, Roles.Manager];

    /// <summary>
    /// <see cref="CanReset"/>, plus:
    /// <list type="bullet">
    /// <item>an organiser, team manager or admin needs a confirmed address: an unconfirmed one may belong to someone other
    /// than the person who uses the account (an admin-key admin can type any address);</item>
    /// <item>an account with no password (one that only signs in with Google or Apple) gets its first password this way only
    /// with a confirmed address, and never an admin, so the link can't add a second way into an admin account.</item>
    /// </list>
    /// </summary>
    private async Task<bool> MayResetAsync(AppUser user)
    {
        if (!CanReset(user)) return false;
        var hasPassword = !string.IsNullOrEmpty(user.PasswordHash);
        if (hasPassword && user.EmailConfirmed) return true;
        var roles = await users.GetRolesAsync(user);
        if (!hasPassword) return user.EmailConfirmed && !roles.Any(role => role is Roles.Admin or Roles.MasterAdmin);
        return !roles.Any(role => NeedConfirmedAddress.Contains(role));
    }

    private static bool HasMailbox(string? email)
    {
        if (string.IsNullOrEmpty(email)) return false;
        var domain = email[(email.LastIndexOf('@') + 1)..];
        return !domain.Equals("mg.local", StringComparison.OrdinalIgnoreCase) && !domain.EndsWith(".mg.local", StringComparison.OrdinalIgnoreCase)
            && !domain.Equals("invalid", StringComparison.OrdinalIgnoreCase) && !domain.EndsWith(".invalid", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Makes a reset link if <paramref name="address"/> belongs to an account that may have one, and starts emailing it.
    /// Silent either way. The returned task is the send: it never throws, logs a failure, and uses neither this request's
    /// database context nor its cancellation, so the caller can answer before it finishes.
    /// </summary>
    public async Task<Task> RequestAsync(string address, string? ip, CancellationToken ct)
    {
        var user = await users.FindByEmailAsync(address);
        if (user is null || !await MayResetAsync(user)) return Task.CompletedTask;
        var site = EmailSite.Origin(emailOptions.Value, configuration);
        if (site is null) return Task.CompletedTask;
        var issued = await IssueAsync(user.Id, ip, ct);
        if (issued is not { } link) return Task.CompletedTask;
        return SendAsync(user.Email!, "Reset your Mounted Games password", ResetText(site, link.Token), ResetHtml(site, link.Token),
            $"password-reset-{link.Id}", "reset link", CancellationToken.None);
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
        var (outcome, notice) = await db.Database.CreateExecutionStrategy().ExecuteAsync<(PasswordResetOutcome, ChangeNotice?)>(async () =>
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
                return (usedAt is null ? PasswordResetOutcome.Expired : PasswordResetOutcome.Used, null);
            }
            var account = await users.FindByIdAsync(userId);
            if (account is null || !await MayResetAsync(account)) return (PasswordResetOutcome.Invalid, null);
            var firstPassword = string.IsNullOrEmpty(account.PasswordHash);

            // Whoever reads the mailbox must not become master admin by it: the role goes, and its owner gets it back
            // with the master admin key (POST /api/auth/master-admin).
            var master = await users.IsInRoleAsync(account, Roles.MasterAdmin);
            if (master && !(await users.RemoveFromRoleAsync(account, Roles.MasterAdmin)).Succeeded) return (PasswordResetOutcome.Conflict, null);

            account.PasswordHash = users.PasswordHasher.HashPassword(account, newPassword);
            account.EmailConfirmed = true;
            account.AccessFailedCount = 0;
            account.LockoutEnd = null;
            account.SessionVersion++;
            // Saves everything above under Identity's concurrency check, with a new security stamp (which also ends
            // outstanding email-confirmation links). A lock or block saved in the meantime changes the account's
            // ConcurrencyStamp (AccountAccessService), so this fails rather than write LockedAt or BlockedAt back to empty;
            // the transaction then rolls back, the link included.
            if (!(await users.UpdateSecurityStampAsync(account)).Succeeded) return (PasswordResetOutcome.Conflict, null);
            // A Google or Apple sign-in someone else linked would outlive the reset, so they all go; the owner can link
            // theirs again once signed in.
            var signInsRemoved = await db.UserLogins.Where(l => l.UserId == userId).ExecuteDeleteAsync(ct);
            // Any other link still open for the account stops working too.
            await db.PasswordResetTokens.Where(t => t.UserId == userId && t.Id != linkId && t.UsedAt == null && t.ExpiresAt > now)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.ExpiresAt, now), ct);
            await transaction.CommitAsync(ct);
            return (PasswordResetOutcome.Changed, new ChangeNotice(firstPassword, signInsRemoved > 0, master));
        });
        if (outcome != PasswordResetOutcome.Changed) return new(outcome);

        // Old tokens are already refused on every instance (LiveAccounts reads SessionVersion on each request); this closes
        // the live-hub connections they opened.
        await liveAccounts.SessionsEndedAsync(userId);
        db.ChangeTracker.Clear();
        var changed = await users.FindByIdAsync(userId);
        if (changed is not null && EmailSite.Origin(emailOptions.Value, configuration) is { } site)
        {
            var told = notice! with { Admin = await users.IsInRoleAsync(changed, Roles.Admin) };
            await SendAsync(changed.Email!, told.Subject, ChangedText(site, told), ChangedHtml(site, told),
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
        if (user is null || !await MayResetAsync(user)) return (PasswordResetLinkState.Invalid, null, null);
        if (row.UsedAt is not null) return (PasswordResetLinkState.Used, row, user);
        if (row.ExpiresAt <= Now()) return (PasswordResetLinkState.Expired, row, user);
        return (PasswordResetLinkState.Valid, row, user);
    }

    /// <summary>
    /// Makes a new link unless the account has had one in the last minute or five in the last hour, and ends the account's
    /// earlier unused links that are at least <see cref="ProtectedFor"/> old. One account's requests are serialised (a Postgres advisory lock; SQLite's write lock), so two at
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

            var protectedFrom = now - ProtectedFor;
            await db.PasswordResetTokens.Where(t => t.UserId == userId && t.UsedAt == null && t.ExpiresAt > now && t.CreatedAt <= protectedFrom)
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

    /// <summary>Never throws: a failure, or a sender that misbehaves, is logged with a masked address and nothing else.</summary>
    private async Task SendAsync(string to, string subject, string text, string html, string idempotencyKey, string what, CancellationToken ct)
    {
        try
        {
            var status = await sender.SendAsync(new EmailMessage(to, subject, text, html, idempotencyKey), ct);
            if (status == EmailDeliveryStatus.Failed) log.LogWarning("The password {What} for {Recipient} was not delivered.", what, EmailAddresses.Mask(to));
        }
        catch (Exception ex)
        {
            log.LogWarning("The password {What} for {Recipient} was not delivered: {Reason}.", what, EmailAddresses.Mask(to), ex.GetType().Name);
        }
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

    /// <summary>Only a master admin can lock a site admin account, so that is who to ask.</summary>
    private const string AdminNote =
        "This is a site admin account. If you didn't change the password and a reset doesn't get you back in, ask a master admin to lock the account.";

    /// <summary>Nobody can lock a master admin, so there is no lock to suggest; the reset has already taken the role away.</summary>
    private const string FormerMasterNote =
        "This account was a master admin. A password reset takes that role away, so someone who gets into your email can't use it. To get it back, sign in and enter the master admin key again.";

    /// <summary>What the "password changed" notice needs to say.</summary>
    private sealed record ChangeNotice(bool FirstPassword, bool SignInsRemoved, bool WasMaster, bool Admin = false)
    {
        public string Subject => FirstPassword ? "A password was set on your Mounted Games account" : "Your Mounted Games password was changed";

        public string Opening => (FirstPassword
                ? "A password has just been set for the Mounted Games account that uses this email address, with a reset link."
                : "The password for the Mounted Games account that uses this email address has just been changed with a reset link.")
            + " We've signed the account out on every device, so the new password is needed to sign in again."
            + (SignInsRemoved
                ? " We've also disconnected any Google or Apple sign-in. Once you've signed in with your password, you can connect it again from your account page."
                : string.Empty);

        public string? Note => WasMaster ? FormerMasterNote : Admin ? AdminNote : null;
    }

    private static string ChangedText(string site, ChangeNotice notice) => $"""
        Hello,

        {notice.Opening}

        If this was you, there's nothing else to do.

        If it wasn't you, reset your password straight away: {site}/forgot-password
        {(notice.Note is null ? string.Empty : $"\n{notice.Note}\n")}
        Mounted Games
        """;

    private static string ChangedHtml(string site, ChangeNotice notice) => EmailHtml.Wrap($"""
        <p style="margin:0 0 12px;">Hello,</p>
        <p style="margin:0 0 12px;">{EmailHtml.Encode(notice.Opening)}</p>
        <p style="margin:0 0 12px;">If this was you, there's nothing else to do.</p>
        <p style="margin:0 0 12px;">If it wasn't you, reset your password straight away.</p>
        {EmailHtml.Button($"{site}/forgot-password", "Reset my password")}
        {(notice.Note is null ? string.Empty : $"<p style=\"margin:16px 0 0;\">{EmailHtml.Encode(notice.Note)}</p>")}
        """);

    private DateTime Now() => time.GetUtcNow().UtcDateTime;
}
