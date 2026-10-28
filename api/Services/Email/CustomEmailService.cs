using System.Diagnostics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Sponsors;

namespace MountedGames.Api.Services.Email;

/// <summary>Who is on each custom-email list. One place, so the count an admin sees is the list that gets mailed.</summary>
public static class CustomEmailAudiences
{
    public sealed record Recipient(string Address, int? OptInId);

    public static string Label(CustomEmailAudience audience) => audience switch
    {
        CustomEmailAudience.News => "People who said yes to news",
        CustomEmailAudience.Trainers => "Trainers",
        CustomEmailAudience.OrganisersAndAdmins => "Organisers and admins",
        CustomEmailAudience.Admins => "Admins",
        _ => audience.ToString(),
    };

    /// <summary>
    /// News: everyone still opted in, one row per address. The others: accounts holding the role whose address is confirmed,
    /// that haven't been emptied by account deletion or locked or blocked by an admin, and are a real mailbox (not a made-up username address).
    /// Duplicates are removed, ignoring case.
    /// </summary>
    public static async Task<List<Recipient>> ResolveAsync(AppDbContext db, CustomEmailAudience audience, CancellationToken ct)
    {
        var found = new Dictionary<string, Recipient>(StringComparer.OrdinalIgnoreCase);
        void Add(string? raw, int? optInId)
        {
            // Never the shared admin-key account, nor any made-up address under mg.local: they have no mailbox.
            if (EmailAddresses.TryNormalise(raw, out var address) && address != "admin@mg.local"
                && !address.EndsWith("@mg.local", StringComparison.Ordinal) && !address.EndsWith(".mg.local", StringComparison.Ordinal))
                found.TryAdd(address, new Recipient(address, optInId));
        }

        if (audience == CustomEmailAudience.News)
        {
            var rows = await db.EmailOptIns.AsNoTracking().Where(o => o.UnsubscribedAt == null)
                .OrderBy(o => o.Id).Select(o => new { o.Id, o.Email }).ToListAsync(ct);
            foreach (var row in rows) Add(row.Email, row.Id);
        }
        else
        {
            var roleNames = audience switch
            {
                CustomEmailAudience.Trainers => new[] { Roles.Trainer },
                CustomEmailAudience.Admins => [Roles.Admin],
                _ => [Roles.Trainer, Roles.Admin],
            };
            var holders = from ur in db.UserRoles join r in db.Roles on ur.RoleId equals r.Id where roleNames.Contains(r.Name!) select ur.UserId;
            var people = await db.Users.AsNoTracking()
                .Where(u => holders.Contains(u.Id) && u.EmailConfirmed && u.Email != null && u.LockedAt == null && u.BlockedAt == null)
                .OrderBy(u => u.Id).Select(u => new { u.Email, u.LockoutEnd }).ToListAsync(ct);
            foreach (var person in people.Where(p => p.LockoutEnd != DateTimeOffset.MaxValue)) Add(person.Email, null);
        }
        return found.Values.ToList();
    }
}

/// <summary>
/// Custom emails from admins to an audience. The API scales to zero and has no queue, so nothing here relies on a process
/// staying alive: creating a send freezes the email and the recipient list in the database, and the admin's page then calls
/// <see cref="SendBatchAsync"/> repeatedly (a few people at a time, well inside one request) until nobody is left. Any
/// instance can take the next call, a closed browser just pauses it, and the same call resumes it. A person is claimed
/// before they are mailed, a claim that goes stale is taken again, and every message carries a stable idempotency key so the
/// provider drops an accidental repeat. Recipient rows are deleted as soon as a message is accepted, so addresses sit in the
/// table only while they are still needed. Addresses, bodies and links are never logged: only ids and counts.
/// </summary>
public sealed class CustomEmailService(
    AppDbContext db, IEmailSender sender, IOptions<EmailOptions> options, IConfiguration configuration, TimeProvider time,
    ILogger<CustomEmailService> log)
{
    public const int MaxBlocks = 30;
    public const int MaxTextLength = 5000;
    public const int MaxTotalText = 30000;
    public const int MaxRecipients = 10000;
    public const int MaxLinksPerText = 20;
    public const int MaxFooterLength = 1000;
    public const int MaxAttempts = 3;
    private static readonly TimeSpan ClaimIsStale = TimeSpan.FromMinutes(2);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private int BatchSize => Math.Clamp(configuration.GetValue("Email:CustomBatchSize", 10), 1, 50);
    private TimeSpan BatchBudget => TimeSpan.FromSeconds(Math.Clamp(configuration.GetValue("Email:CustomBatchSeconds", 20), 0, 40));

    // ---- audiences ----

    public async Task<List<CustomEmailAudienceDto>> AudiencesAsync(CancellationToken ct)
    {
        var result = new List<CustomEmailAudienceDto>();
        foreach (var audience in Enum.GetValues<CustomEmailAudience>())
            result.Add(new CustomEmailAudienceDto(audience, CustomEmailAudiences.Label(audience),
                (await CustomEmailAudiences.ResolveAsync(db, audience, ct)).Count));
        return result;
    }

    // ---- images ----

    public async Task<CustomEmailImage> AddImageAsync(byte[] bytes, string declaredType, string? userId, CancellationToken ct)
    {
        if (bytes.Length == 0) throw new CustomEmailException("Choose a picture to upload.", 400);
        if (bytes.Length > CustomEmailImage.MaxBytes) throw new CustomEmailException("The picture must be 500 KB or smaller.", 413);
        var actual = SponsorLogos.Detect(bytes);
        if (actual is null || actual != declaredType) throw new CustomEmailException("That file isn't a PNG, JPEG or WebP image.", 400);
        var now = time.GetUtcNow().UtcDateTime;
        // Pictures nobody used in an email are not kept.
        await db.CustomEmailImages.Where(i => i.UsedByEmailId == null && i.CreatedAt < now.AddDays(-2)).ExecuteDeleteAsync(ct);
        var image = new CustomEmailImage { Id = Guid.NewGuid(), Bytes = bytes, ContentType = actual, UploadedByUserId = userId, CreatedAt = now };
        db.CustomEmailImages.Add(image);
        await db.SaveChangesAsync(ct);
        return image;
    }

    // ---- check and render ----

    /// <summary>Checks the content and reads each competition's details once. Throws a 400 listing every problem.</summary>
    public async Task<(List<ResolvedBlock> Blocks, string Site)> ResolveAsync(CustomEmailContentRequest request, CancellationToken ct)
    {
        var problems = new List<string>();
        var subject = request.Subject?.Trim() ?? string.Empty;
        if (subject.Length == 0) problems.Add("Add a subject.");
        else if (subject.Length > CustomEmail.MaxSubjectLength) problems.Add($"Keep the subject to {CustomEmail.MaxSubjectLength} characters.");
        else if (HasControl(subject, allowLineBreaks: false)) problems.Add("The subject can't contain line breaks or control characters.");
        if (!Enum.IsDefined(request.Audience)) problems.Add("Choose who it goes to.");
        var blocks = request.Blocks ?? [];
        if (blocks.Count == 0) problems.Add("Add at least one block.");
        if (blocks.Count > MaxBlocks) problems.Add($"Use {MaxBlocks} blocks or fewer.");

        var site = EmailSite.Origin(options.Value, configuration);
        var resolved = new List<ResolvedBlock>();
        var totalText = 0;
        if (blocks.Count(b => b.Type == EmailBlockType.Footer) > 1) problems.Add("Use one footer.");
        for (var i = 0; i < Math.Min(blocks.Count, MaxBlocks); i++)
        {
            var block = blocks[i];
            var at = $"Block {i + 1}";
            switch (block.Type)
            {
                case EmailBlockType.Text:
                    var text = block.Text?.Trim() ?? string.Empty;
                    totalText += text.Length;
                    if (text.Length == 0) problems.Add($"{at}: write some text or remove it.");
                    else if (text.Length > MaxTextLength) problems.Add($"{at}: keep text to {MaxTextLength} characters.");
                    else if (HasControl(text, allowLineBreaks: true)) problems.Add($"{at}: the text has characters that can't be sent.");
                    else
                    {
                        var links = await ResolveLinksAsync(block.Links, site, at, problems, ct);
                        if (links is not null && links.Count > 0)
                        {
                            try { CustomEmailRenderer.LinkedParagraphs(text, links, strict: true); }
                            catch (KeyNotFoundException missing) { problems.Add($"{at}: the words \"{missing.Message}\" aren't in the message, so they can't be a link."); links = null; }
                        }
                        if (links is not null) resolved.Add(new ResolvedBlock(EmailBlockType.Text, Text: text, Links: links));
                    }
                    break;
                case EmailBlockType.Picture:
                    var alt = block.Alt?.Trim();
                    if (block.ImageId is not { } imageId || !await db.CustomEmailImages.AnyAsync(x => x.Id == imageId, ct))
                        problems.Add($"{at}: upload the picture again.");
                    else if (alt is { Length: > 200 } || (alt is not null && HasControl(alt, allowLineBreaks: false)))
                        problems.Add($"{at}: keep the description to 200 characters, on one line.");
                    else
                    {
                        var (pictureLinked, pictureUrl) = await ResolveTargetAsync(block.Url, block.CompetitionId, block.Page, site, at + " link", problems, ct);
                        if (pictureLinked) resolved.Add(new ResolvedBlock(EmailBlockType.Picture, ImageId: imageId, Alt: alt, Url: pictureUrl));
                    }
                    break;
                case EmailBlockType.Footer:
                    var footerText = block.Text?.Trim();
                    var footerAlt = block.Alt?.Trim();
                    if (footerText is { Length: > MaxFooterLength } || (footerText is not null && HasControl(footerText, allowLineBreaks: true)))
                        problems.Add($"{at}: keep the footer to {MaxFooterLength} characters.");
                    else if (block.ImageId is { } footerImage && !await db.CustomEmailImages.AnyAsync(x => x.Id == footerImage, ct))
                        problems.Add($"{at}: upload the footer picture again.");
                    else if (footerAlt is { Length: > 200 } || (footerAlt is not null && HasControl(footerAlt, allowLineBreaks: false)))
                        problems.Add($"{at}: keep the description to 200 characters, on one line.");
                    else resolved.Add(new ResolvedBlock(EmailBlockType.Footer, Text: string.IsNullOrEmpty(footerText) ? null : footerText, ImageId: block.ImageId, Alt: footerAlt));
                    break;
                case EmailBlockType.Button:
                    var label = block.Label?.Trim() ?? string.Empty;
                    if (label.Length == 0 || label.Length > 60 || HasControl(label, allowLineBreaks: false))
                        problems.Add($"{at}: the button needs a label of up to 60 characters.");
                    else if (!SponsorLogos.TryNormaliseLink(block.Url, out var link) || link is null)
                        problems.Add($"{at}: the button link must be a full https:// address.");
                    else resolved.Add(new ResolvedBlock(EmailBlockType.Button, Label: label, Url: link));
                    break;
                case EmailBlockType.Competition:
                    var competition = block.CompetitionId is { } cid
                        ? await db.Competitions.AsNoTracking().Where(c => c.Id == cid)
                            .Select(c => new { c.Id, c.Name, c.StartDate, c.EndDate, c.Location }).FirstOrDefaultAsync(ct)
                        : null;
                    if (competition is null) problems.Add($"{at}: choose a competition.");
                    else resolved.Add(new ResolvedBlock(EmailBlockType.Competition, CompetitionId: competition.Id, CompetitionName: competition.Name,
                        CompetitionDates: SignupConfirmationEmail.FormatDates(competition.StartDate, competition.EndDate),
                        CompetitionVenue: competition.Location?.Trim()));
                    break;
                default:
                    problems.Add($"{at}: unknown block type.");
                    break;
            }
        }
        if (totalText > MaxTotalText) problems.Add($"Keep the text to {MaxTotalText} characters in all.");
        if (problems.Count > 0) throw new CustomEmailException("The email can't be made yet.", 400, problems);

        if (site is null)
            throw new CustomEmailException("The website address isn't set (Email:SiteUrl), so links and pictures can't be made.", 409);
        return (resolved, site);
    }

    /// <summary>The path on the site for each page an event's link can open.</summary>
    private static string PagePath(EmailPage page, int competitionId) => page switch
    {
        EmailPage.Entry => $"/competitions/{competitionId}/enter",
        EmailPage.Timetable => $"/competitions/{competitionId}/timetable",
        EmailPage.Results => $"/competitions/{competitionId}/toplists",
        _ => $"/competitions/{competitionId}",
    };

    /// <summary>
    /// Where a link goes: an https address, or one of the site's pages for a competition, or nowhere (all blank). Adds to
    /// <paramref name="problems"/> and returns false when it can't be made.
    /// </summary>
    private async Task<(bool Ok, string? Url)> ResolveTargetAsync(string? url, int? competitionId, EmailPage? page, string? site, string at,
        List<string> problems, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(url))
        {
            if (SponsorLogos.TryNormaliseLink(url, out var link) && link is not null) return (true, link);
            problems.Add($"{at}: the link must be a full https:// address.");
            return (false, null);
        }
        if (competitionId is null && page is null) return (true, null);
        if (competitionId is not { } id || page is not { } p || !Enum.IsDefined(p)
            || !await db.Competitions.AsNoTracking().AnyAsync(c => c.Id == id, ct))
        {
            problems.Add($"{at}: choose the event and page to link to.");
            return (false, null);
        }
        return (true, site is null ? "https://placeholder.invalid" : site + PagePath(p, id));
    }

    private async Task<List<ResolvedLink>?> ResolveLinksAsync(IReadOnlyList<EmailLinkDto>? links, string? site, string at, List<string> problems, CancellationToken ct)
    {
        var result = new List<ResolvedLink>();
        if (links is null) return result;
        if (links.Count > MaxLinksPerText) { problems.Add($"{at}: use {MaxLinksPerText} links or fewer."); return null; }
        var ok = true;
        foreach (var link in links)
        {
            var words = link.Words?.Trim() ?? string.Empty;
            if (words.Length == 0 || words.Length > 100 || HasControl(words, allowLineBreaks: false))
            {
                problems.Add($"{at}: the words to link need 1 to 100 characters, on one line.");
                ok = false;
                continue;
            }
            if (string.IsNullOrWhiteSpace(link.Url) && link.CompetitionId is null && link.Page is null)
            {
                problems.Add($"{at}: say where \"{words}\" links to.");
                ok = false;
                continue;
            }
            var (good, url) = await ResolveTargetAsync(link.Url, link.CompetitionId, link.Page, site, $"{at} (\"{words}\")", problems, ct);
            if (good && url is not null) result.Add(new ResolvedLink(words, url)); else ok = false;
        }
        return ok ? result : null;
    }

    public async Task<CustomEmailPreviewDto> PreviewAsync(CustomEmailContentRequest request, CancellationToken ct)
    {
        var (blocks, site) = await ResolveAsync(request, ct);
        var rendered = CustomEmailRenderer.Render(blocks, site, request.Audience);
        var sample = $"{site}/unsubscribe?token=preview";
        return new CustomEmailPreviewDto(request.Subject.Trim(),
            CustomEmailRenderer.ForRecipient(rendered.Html, sample), CustomEmailRenderer.ForRecipient(rendered.Text, sample));
    }

    /// <summary>Sends the email once, to the address given (the signed-in admin's own). Nobody on the list is touched.</summary>
    public async Task<EmailDeliveryStatus> SendTestAsync(CustomEmailContentRequest request, string? toAddress, CancellationToken ct)
    {
        if (!EmailAddresses.TryNormalise(toAddress, out var to))
            throw new CustomEmailException("Your account has no email address to send a test to.", 409);
        var (blocks, site) = await ResolveAsync(request, ct);
        var rendered = CustomEmailRenderer.Render(blocks, site, request.Audience);
        var sample = $"{site}/unsubscribe?token=test";
        return await sender.SendAsync(new EmailMessage(to, SignupConfirmationEmail.OneLine($"[Test] {request.Subject.Trim()}"),
            CustomEmailRenderer.ForRecipient(rendered.Text, sample), CustomEmailRenderer.ForRecipient(rendered.Html, sample),
            $"custom-email-test-{Guid.NewGuid():N}"), ct);
    }

    // ---- send ----

    public async Task<CustomEmail> CreateAsync(SendCustomEmailRequest request, string? userId, CancellationToken ct)
    {
        if (!request.Confirm) throw new CustomEmailException("Confirm that you want to send this email.", 400);
        if (!options.Value.IsConfigured)
            throw new CustomEmailException("Email sending is switched off on this server, so nothing can be sent.", 409);
        var now = time.GetUtcNow().UtcDateTime;
        var today = now.Date;
        if (await db.CustomEmails.CountAsync(e => e.CreatedAt >= today, ct) >= CustomEmail.MaxSendsPerDay)
            throw new CustomEmailException($"Up to {CustomEmail.MaxSendsPerDay} custom emails can be sent a day. Try again tomorrow.", 429);

        var content = new CustomEmailContentRequest(request.Subject, request.Audience, request.Blocks);
        var (blocks, site) = await ResolveAsync(content, ct);
        var recipients = await CustomEmailAudiences.ResolveAsync(db, request.Audience, ct);
        if (recipients.Count == 0) throw new CustomEmailException("No one is on that list yet.", 409);
        if (recipients.Count > MaxRecipients) throw new CustomEmailException($"That list has more than {MaxRecipients} people, which is more than can be sent from here.", 409);
        if (recipients.Count != request.ExpectedRecipients)
            throw new CustomEmailException($"The list has changed: it now has {recipients.Count} {(recipients.Count == 1 ? "person" : "people")}, not {request.ExpectedRecipients}. Check and confirm again.", 409);

        var rendered = CustomEmailRenderer.Render(blocks, site, request.Audience);
        var email = new CustomEmail
        {
            Subject = request.Subject.Trim(), Audience = request.Audience,
            BlocksJson = JsonSerializer.Serialize(request.Blocks, Json),
            HtmlBody = rendered.Html, TextBody = rendered.Text,
            CreatedByUserId = userId, CreatedAt = now, Status = CustomEmailStatus.Sending, Total = recipients.Count,
        };
        foreach (var r in recipients)
            email.Recipients.Add(new CustomEmailRecipient { Address = r.Address, OptInId = r.OptInId });
        db.CustomEmails.Add(email);
        await db.SaveChangesAsync(ct);
        var imageIds = blocks.Where(b => b.ImageId.HasValue).Select(b => b.ImageId!.Value).Distinct().ToList();
        if (imageIds.Count > 0)
            await db.CustomEmailImages.Where(i => imageIds.Contains(i.Id)).ExecuteUpdateAsync(s => s.SetProperty(i => i.UsedByEmailId, email.Id), ct);
        log.LogInformation("Custom email {Id} started for {Count} recipients.", email.Id, recipients.Count);
        return email;
    }

    /// <summary>
    /// Mails the next few people. Safe to call again at any time, from any instance, by more than one browser at once. Always
    /// handles at least one person, then stops when the time budget is used up, handing the rest back for the next call.
    /// </summary>
    public async Task<CustomEmail> SendBatchAsync(int id, CancellationToken ct)
    {
        var email = await db.CustomEmails.FirstOrDefaultAsync(e => e.Id == id, ct)
            ?? throw new CustomEmailException("Email not found.", 404);
        if (email.Status != CustomEmailStatus.Sending) return email;

        var clock = Stopwatch.StartNew();
        var now = time.GetUtcNow().UtcDateTime;
        var stale = now - ClaimIsStale;
        // A claim abandoned too often (the instance died each time) is given up on, not retried for ever.
        var gaveUp = await db.CustomEmailRecipients
            .Where(r => r.CustomEmailId == id && r.Status == CustomEmailRecipientStatus.Claimed && r.ClaimedAt < stale && r.Attempts >= MaxAttempts)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, CustomEmailRecipientStatus.Failed), ct);
        if (gaveUp > 0)
            await db.CustomEmails.Where(e => e.Id == id).ExecuteUpdateAsync(s => s.SetProperty(e => e.Failed, e => e.Failed + gaveUp), ct);
        var claimable = db.CustomEmailRecipients.Where(r => r.CustomEmailId == id
            && (r.Status == CustomEmailRecipientStatus.Pending
                || (r.Status == CustomEmailRecipientStatus.Claimed && r.ClaimedAt < stale && r.Attempts < MaxAttempts)));
        var ids = await claimable.OrderBy(r => r.Id).Select(r => r.Id).Take(BatchSize).ToListAsync(ct);
        var token = Guid.NewGuid();
        if (ids.Count > 0)
            await claimable.Where(r => ids.Contains(r.Id)).ExecuteUpdateAsync(s => s
                .SetProperty(r => r.Status, CustomEmailRecipientStatus.Claimed)
                .SetProperty(r => r.ClaimedAt, now).SetProperty(r => r.ClaimToken, token).SetProperty(r => r.Attempts, r => r.Attempts + 1), ct);
        var mine = await db.CustomEmailRecipients.AsNoTracking()
            .Where(r => r.CustomEmailId == id && r.ClaimToken == token && r.Status == CustomEmailRecipientStatus.Claimed)
            .OrderBy(r => r.Id).ToListAsync(ct);

        // Someone who unsubscribed since the send began is left out.
        HashSet<string>? stillOptedIn = null;
        if (email.Audience == CustomEmailAudience.News && mine.Count > 0)
        {
            var addresses = mine.Select(r => r.Address).ToList();
            stillOptedIn = (await db.EmailOptIns.AsNoTracking().Where(o => o.UnsubscribedAt == null && addresses.Contains(o.Email))
                .Select(o => o.Email).ToListAsync(ct)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        var site = EmailSite.Origin(options.Value, configuration);
        var handled = 0;
        int sent = 0, failed = 0, skipped = 0;
        for (var i = 0; i < mine.Count; i++)
        {
            var recipient = mine[i];
            if (stillOptedIn is not null && !stillOptedIn.Contains(recipient.Address))
            {
                await SettleAsync(email.Id, recipient, token, CustomEmailRecipientStatus.Sent, 0, 0, 1, ct);
                skipped++;
                continue;
            }
            // Out of time: hand the rest back untouched for the next call (after at least one has been mailed).
            if (handled > 0 && clock.Elapsed >= BatchBudget)
            {
                var back = mine.Skip(i).Select(r => r.Id).ToList();
                await db.CustomEmailRecipients.Where(r => back.Contains(r.Id) && r.ClaimToken == token)
                    .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, CustomEmailRecipientStatus.Pending).SetProperty(r => r.ClaimToken, (Guid?)null)
                        .SetProperty(r => r.Attempts, r => r.Attempts - 1), ct);
                break;
            }
            // An admin may have cancelled while this batch was in memory: stop mailing the moment that happens.
            if (!await db.CustomEmails.AsNoTracking().AnyAsync(e => e.Id == id && e.Status == CustomEmailStatus.Sending, ct)) break;
            handled++;
            var status = site is null || !options.Value.IsConfigured
                ? EmailDeliveryStatus.NotSent
                : await sender.SendAsync(MessageFor(email, recipient, site), ct);
            if (status == EmailDeliveryStatus.Sent)
            {
                await SettleAsync(email.Id, recipient, token, CustomEmailRecipientStatus.Sent, 1, 0, 0, ct);
                sent++;
            }
            else
            {
                await SettleAsync(email.Id, recipient, token, CustomEmailRecipientStatus.Failed, 0, 1, 0, ct);
                failed++;
            }
        }

        var remaining = await db.CustomEmailRecipients.CountAsync(r => r.CustomEmailId == id
            && (r.Status == CustomEmailRecipientStatus.Pending || r.Status == CustomEmailRecipientStatus.Claimed), ct);
        if (remaining == 0)
        {
            await db.CustomEmails.Where(e => e.Id == id && e.Status == CustomEmailStatus.Sending)
                .ExecuteUpdateAsync(s => s.SetProperty(e => e.Status, CustomEmailStatus.Done).SetProperty(e => e.CompletedAt, time.GetUtcNow().UtcDateTime), ct);
        }
        log.LogInformation("Custom email {Id}: batch sent {Sent}, failed {Failed}, skipped {Skipped}, {Remaining} to go.", id, sent, failed, skipped, remaining);
        db.ChangeTracker.Clear();
        return await db.CustomEmails.AsNoTracking().FirstAsync(e => e.Id == id, ct);
    }

    public async Task<CustomEmail> CancelAsync(int id, CancellationToken ct)
    {
        var email = await db.CustomEmails.FirstOrDefaultAsync(e => e.Id == id, ct) ?? throw new CustomEmailException("Email not found.", 404);
        if (email.Status == CustomEmailStatus.Sending)
        {
            email.Status = CustomEmailStatus.Cancelled;
            email.CompletedAt = time.GetUtcNow().UtcDateTime;
            await db.SaveChangesAsync(ct);
        }
        // Nobody left to mail, and no addresses kept for a send that has stopped.
        await db.CustomEmailRecipients.Where(r => r.CustomEmailId == id).ExecuteDeleteAsync(ct);
        return email;
    }

    /// <summary>Puts everyone whose message failed back in the queue and reopens the send.</summary>
    public async Task<CustomEmail> RetryFailedAsync(int id, CancellationToken ct)
    {
        var email = await db.CustomEmails.FirstOrDefaultAsync(e => e.Id == id, ct) ?? throw new CustomEmailException("Email not found.", 404);
        if (email.Status == CustomEmailStatus.Cancelled) throw new CustomEmailException("This send was cancelled.", 409);
        var back = await db.CustomEmailRecipients.Where(r => r.CustomEmailId == id && r.Status == CustomEmailRecipientStatus.Failed)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, CustomEmailRecipientStatus.Pending).SetProperty(r => r.ClaimToken, (Guid?)null), ct);
        if (back > 0)
            await db.CustomEmails.Where(e => e.Id == id).ExecuteUpdateAsync(s => s
                .SetProperty(e => e.Failed, e => e.Failed - back).SetProperty(e => e.Status, CustomEmailStatus.Sending)
                .SetProperty(e => e.CompletedAt, (DateTime?)null), ct);
        db.ChangeTracker.Clear();
        return await db.CustomEmails.AsNoTracking().FirstAsync(e => e.Id == id, ct);
    }

    // ---- reading ----

    public async Task<List<CustomEmailDto>> ListAsync(CancellationToken ct)
    {
        // Addresses of people whose message failed are kept for a week, so the failures can be retried, then dropped.
        var cutoff = time.GetUtcNow().UtcDateTime.AddDays(-7);
        await db.CustomEmailRecipients.Where(r => r.Status == CustomEmailRecipientStatus.Failed
            && r.CustomEmail!.Status != CustomEmailStatus.Sending && r.CustomEmail.CompletedAt < cutoff).ExecuteDeleteAsync(ct);
        var emails = await db.CustomEmails.AsNoTracking().OrderByDescending(e => e.CreatedAt).ThenByDescending(e => e.Id).Take(100).ToListAsync(ct);
        return await ToDtosAsync(emails, ct);
    }

    public async Task<(CustomEmailDto Email, IReadOnlyList<EmailBlockDto> Blocks)> GetAsync(int id, CancellationToken ct)
    {
        var email = await db.CustomEmails.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id, ct) ?? throw new CustomEmailException("Email not found.", 404);
        var blocks = JsonSerializer.Deserialize<List<EmailBlockDto>>(email.BlocksJson, Json) ?? [];
        return ((await ToDtosAsync([email], ct))[0], blocks);
    }

    public async Task<List<CustomEmailDto>> ToDtosAsync(IReadOnlyList<CustomEmail> emails, CancellationToken ct)
    {
        var ids = emails.Select(e => e.Id).ToList();
        var remaining = await db.CustomEmailRecipients.AsNoTracking()
            .Where(r => ids.Contains(r.CustomEmailId) && (r.Status == CustomEmailRecipientStatus.Pending || r.Status == CustomEmailRecipientStatus.Claimed))
            .GroupBy(r => r.CustomEmailId).Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);
        var creatorIds = emails.Select(e => e.CreatedByUserId).Where(x => x != null).Distinct().ToList();
        var names = await db.Users.AsNoTracking().Where(u => creatorIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.FullName, ct);
        return emails.Select(e => new CustomEmailDto(e.Id, e.Subject, e.Audience, e.Status, e.Total, e.Sent, e.Failed, e.Skipped,
            remaining.GetValueOrDefault(e.Id), DateTime.SpecifyKind(e.CreatedAt, DateTimeKind.Utc),
            e.CompletedAt.HasValue ? DateTime.SpecifyKind(e.CompletedAt.Value, DateTimeKind.Utc) : null,
            e.CreatedByUserId is not null ? names.GetValueOrDefault(e.CreatedByUserId) : null)).ToList();
    }

    // ---- internals ----

    private EmailMessage MessageFor(CustomEmail email, CustomEmailRecipient recipient, string site)
    {
        string? unsubscribe = null;
        Dictionary<string, string>? headers = null;
        if (email.Audience == CustomEmailAudience.News && recipient.OptInId is { } optInId)
        {
            unsubscribe = $"{site}/unsubscribe?token={Uri.EscapeDataString(EmailUnsubscribeTokens.Create(configuration, optInId))}";
            // RFC 8058 one-click: a mail app POSTs to the first address without opening a page.
            var token = Uri.EscapeDataString(EmailUnsubscribeTokens.Create(configuration, optInId));
            headers = new Dictionary<string, string>
            {
                ["List-Unsubscribe"] = $"<{site}/api/email/unsubscribe-one-click?token={token}>, <{unsubscribe}>",
                ["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click",
            };
        }
        return new EmailMessage(recipient.Address, SignupConfirmationEmail.OneLine(email.Subject),
            CustomEmailRenderer.ForRecipient(email.TextBody, unsubscribe), CustomEmailRenderer.ForRecipient(email.HtmlBody, unsubscribe),
            $"custom-email-{email.Id}-{recipient.Id}", headers);
    }

    /// <summary>
    /// Records what happened to one person. A delivered or skipped person's row is deleted; a failed one stays, marked failed.
    /// The row change and the count move together, and only if this batch still holds the claim.
    /// </summary>
    private async Task SettleAsync(int emailId, CustomEmailRecipient recipient, Guid token, CustomEmailRecipientStatus outcome,
        int sent, int failed, int skipped, CancellationToken ct)
    {
        await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var mine = db.CustomEmailRecipients.Where(r => r.Id == recipient.Id && r.ClaimToken == token && r.Status == CustomEmailRecipientStatus.Claimed);
            var changed = outcome == CustomEmailRecipientStatus.Failed
                ? await mine.ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, CustomEmailRecipientStatus.Failed), ct)
                : await mine.ExecuteDeleteAsync(ct);
            if (changed == 1)
                await db.CustomEmails.Where(e => e.Id == emailId).ExecuteUpdateAsync(s => s
                    .SetProperty(e => e.Sent, e => e.Sent + sent).SetProperty(e => e.Failed, e => e.Failed + failed)
                    .SetProperty(e => e.Skipped, e => e.Skipped + skipped), ct);
            await transaction.CommitAsync(ct);
        });
    }

    private static bool HasControl(string value, bool allowLineBreaks)
        => value.Any(c => char.IsControl(c) && !(allowLineBreaks && c is '\n' or '\r' or '\t'));
}
