using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Geo;

namespace MountedGames.Api.Services.Email;

public sealed class EntriesDigestException(string message, int statusCode) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

/// <summary>
/// The daily "entries are open" email to everyone on the new-competition list. The API scales to zero and several
/// instances can be up at once, so nothing here depends on one process staying alive: the day is claimed with a unique
/// <see cref="EntriesDigestRun.RunDate"/>, the competitions and recipients are frozen into rows in the same save, and
/// every tick (or admin click) works through whoever is left, a few people at a time, claiming each batch with a token
/// and sending with a stable idempotency key. A competition is announced once ever (its id is a primary key). Addresses
/// are read from <see cref="EmailOptIn"/> at send time, so an unsubscribe is honoured to the last moment. Addresses, places
/// and bodies are never logged: only ids and counts.
/// </summary>
public sealed class EntriesDigestService(
    AppDbContext db, IEmailSender sender, IOptions<EmailOptions> options, IConfiguration configuration, TimeProvider time,
    LocationInference locations, ILogger<EntriesDigestService> log)
{
    /// <summary>The evening tick may start a run from 18:00 until just before 23:00 UK time.</summary>
    public const int WindowStartHour = 18;
    public const int WindowEndHour = 23;
    public const int MaxAttempts = 3;
    private static readonly TimeSpan ClaimIsStale = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan RetryAfter = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan RunExpiresAfter = TimeSpan.FromDays(2);
    private static readonly TimeSpan TickBudget = TimeSpan.FromSeconds(40);
    private static readonly TimeSpan SendNowBudget = TimeSpan.FromSeconds(20);

    private int BatchSize => Math.Clamp(configuration.GetValue("Email:DigestBatchSize", 10), 1, 50);

    // ---- readiness ----

    private bool Ready(out string? why)
    {
        why = null;
        if (!options.Value.IsConfigured) why = "Email sending is switched off on this server, so nothing can be sent.";
        else if (EmailSite.Origin(options.Value, configuration) is null) why = "The website address isn't set (Email:SiteUrl), so the links can't be made.";
        return why is null;
    }

    // ---- the tick ----

    /// <summary>
    /// What the scheduler calls every minute. Closes runs left too long, carries on any unfinished run, and, in the UK evening,
    /// starts the day's run if something new has opened. With <paramref name="allowBaseline"/> the very first call only
    /// records what is already open, so switching this on never mails a backlog.
    /// </summary>
    public async Task TickAsync(bool allowBaseline, CancellationToken ct)
    {
        if (!Ready(out _)) return;
        var now = time.GetUtcNow().UtcDateTime;
        await ExpireOldRunsAsync(now, ct);

        if (allowBaseline && !await db.EntriesDigestRuns.AnyAsync(ct))
            await ClaimRunAsync(EntriesDigestRun.BaselineKey, EntriesDigestRunStatus.Baseline, manual: false, ct);

        var watch = Stopwatch.StartNew();
        foreach (var id in await db.EntriesDigestRuns.AsNoTracking().Where(r => r.Status == EntriesDigestRunStatus.Sending)
                     .OrderBy(r => r.Id).Select(r => r.Id).ToListAsync(ct))
            await WorkAsync(id, TickBudget - watch.Elapsed, ct);

        var uk = UkTime.ToUk(now);
        if (uk.Hour < WindowStartHour || uk.Hour >= WindowEndHour) return;
        var key = UkTime.DateKey(now);
        if (await db.EntriesDigestRuns.AnyAsync(r => r.RunDate == key, ct)) return;
        var run = await ClaimRunAsync(key, EntriesDigestRunStatus.Sending, manual: false, ct);
        if (run is not null) await WorkAsync(run.Id, TickBudget - watch.Elapsed, ct);
    }

    // ---- the admin's button ----

    /// <summary>
    /// Starts today's run now (or carries on the one already started) and works one stretch of it. The caller repeats it until
    /// the status shows nobody left. Needs the count the admin saw, so a list that changed since is a 409.
    /// </summary>
    public async Task SendNowAsync(int expectedRecipients, CancellationToken ct)
    {
        if (!Ready(out var why)) throw new EntriesDigestException(why!, 409);
        var now = time.GetUtcNow().UtcDateTime;
        var key = UkTime.DateKey(now);
        var existing = await db.EntriesDigestRuns.AsNoTracking().FirstOrDefaultAsync(r => r.RunDate == key, ct);
        if (existing is null)
        {
            var pending = await EntriesOpenRule.OpenAsync(db, now, null, excludeAnnounced: true, ct);
            if (pending.Count == 0) throw new EntriesDigestException("There's nothing new to send. Every open competition has either been announced already or was created less than six hours ago.", 409);
            var people = (await CustomEmailAudiences.ResolveAsync(db, CustomEmailAudience.News, ct)).Count;
            if (people == 0) throw new EntriesDigestException("No one is on the list yet.", 409);
            if (people != expectedRecipients)
                throw new EntriesDigestException($"The list has changed: it now has {people} {(people == 1 ? "person" : "people")}, not {expectedRecipients}. Check and confirm again.", 409);
            existing = await ClaimRunAsync(key, EntriesDigestRunStatus.Sending, manual: true, ct)
                ?? await db.EntriesDigestRuns.AsNoTracking().FirstOrDefaultAsync(r => r.RunDate == key, ct);
        }
        else if (existing.Status == EntriesDigestRunStatus.Done)
            throw new EntriesDigestException("Today's email has already gone out. New competitions go in tomorrow's.", 409);
        if (existing is not null) await WorkAsync(existing.Id, SendNowBudget, ct);
    }

    // ---- status ----

    public async Task<EntriesDigestStatusDto> StatusAsync(CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var can = Ready(out var why);
        var pending = await EntriesOpenRule.OpenAsync(db, now, null, excludeAnnounced: true, ct);
        var people = (await CustomEmailAudiences.ResolveAsync(db, CustomEmailAudience.News, ct)).Count;
        var lastRun = await db.EntriesDigestRuns.AsNoTracking().Where(r => r.Status != EntriesDigestRunStatus.Baseline)
            .OrderByDescending(r => r.Id).FirstOrDefaultAsync(ct);
        var key = UkTime.DateKey(now);
        var claimed = await db.EntriesDigestRuns.AnyAsync(r => r.RunDate == key, ct);

        var uk = UkTime.ToUk(now);
        var windowStart = UkTime.FromUk(uk.Date.AddHours(WindowStartHour));
        var windowEnd = UkTime.FromUk(uk.Date.AddHours(WindowEndHour));
        var next = !claimed && now < windowEnd ? (now > windowStart ? now : windowStart) : UkTime.FromUk(uk.Date.AddDays(1).AddHours(WindowStartHour));

        return new EntriesDigestStatusDto(can, why, people, pending.Count,
            pending.Take(20).Select(c => new DigestPendingCompetitionDto(c.Id, c.Name, c.StartDate, c.Location)).ToList(),
            lastRun is null ? null : await ToDtoAsync(lastRun, ct), claimed, next);
    }

    private async Task<EntriesDigestRunDto> ToDtoAsync(EntriesDigestRun run, CancellationToken ct)
    {
        var counts = await db.EntriesDigestRecipients.AsNoTracking().Where(r => r.RunId == run.Id)
            .GroupBy(r => r.Status).Select(g => new { Status = g.Key, Count = g.Count() }).ToListAsync(ct);
        int Of(EntriesDigestRecipientStatus s) => counts.FirstOrDefault(c => c.Status == s)?.Count ?? 0;
        var retryable = await db.EntriesDigestRecipients.AsNoTracking()
            .CountAsync(r => r.RunId == run.Id && r.Status == EntriesDigestRecipientStatus.Failed && r.Attempts < MaxAttempts, ct);
        var failedForGood = Of(EntriesDigestRecipientStatus.Failed) - retryable;
        return new EntriesDigestRunDto(run.Id, run.RunDate, run.Status, run.Manual, run.Competitions, run.Total,
            Of(EntriesDigestRecipientStatus.Sent), failedForGood, Of(EntriesDigestRecipientStatus.Skipped),
            Of(EntriesDigestRecipientStatus.Pending) + Of(EntriesDigestRecipientStatus.Claimed) + retryable,
            DateTime.SpecifyKind(run.ClaimedAt, DateTimeKind.Utc),
            run.CompletedAt.HasValue ? DateTime.SpecifyKind(run.CompletedAt.Value, DateTimeKind.Utc) : null);
    }

    // ---- claiming a run ----

    /// <summary>
    /// Records the day's run in one save: the run (its date is unique), the competitions it announces (each id is unique across
    /// all runs) and one row per person on the list. If another instance got there first the save fails as a whole and this
    /// returns null, leaving that run to be worked by whoever holds it. Nothing new open means no run at all.
    /// </summary>
    internal async Task<EntriesDigestRun?> ClaimRunAsync(string runDate, EntriesDigestRunStatus status, bool manual, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var open = await EntriesOpenRule.OpenAsync(db, now, null, excludeAnnounced: true, ct);
        // The baseline is recorded even when nothing is open yet, so a competition that opens later is announced, not swallowed.
        if (open.Count == 0 && status != EntriesDigestRunStatus.Baseline) return null;

        var run = new EntriesDigestRun { RunDate = runDate, ClaimedAt = now, Status = status, Manual = manual, Competitions = open.Count };
        foreach (var c in open) run.CompetitionRows.Add(EntriesOpenRule.Freeze(c));
        if (status == EntriesDigestRunStatus.Baseline)
        {
            run.CompletedAt = now;
        }
        else
        {
            var people = await CustomEmailAudiences.ResolveAsync(db, CustomEmailAudience.News, ct);
            if (people.Count == 0) return null;
            foreach (var p in people.Where(p => p.OptInId.HasValue))
                run.Recipients.Add(new EntriesDigestRecipient { OptInId = p.OptInId!.Value });
            run.Total = run.Recipients.Count;
        }

        db.EntriesDigestRuns.Add(run);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Another instance claimed this day, or one of these competitions, first: nothing of ours was saved.
            db.ChangeTracker.Clear();
            return null;
        }
        db.ChangeTracker.Clear();
        log.LogInformation("Entries digest run {Id} ({Status}) claimed for {Competitions} competitions and {People} people.",
            run.Id, status, open.Count, run.Total);
        return run;
    }

    private async Task ExpireOldRunsAsync(DateTime now, CancellationToken ct)
    {
        var cutoff = now - RunExpiresAfter;
        var old = await db.EntriesDigestRuns.AsNoTracking().Where(r => r.Status == EntriesDigestRunStatus.Sending && r.ClaimedAt < cutoff)
            .Select(r => r.Id).ToListAsync(ct);
        foreach (var id in old)
        {
            await db.EntriesDigestRecipients.Where(r => r.RunId == id && r.Status != EntriesDigestRecipientStatus.Sent && r.Status != EntriesDigestRecipientStatus.Skipped)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, EntriesDigestRecipientStatus.Skipped), ct);
            await db.EntriesDigestRuns.Where(r => r.Id == id)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, EntriesDigestRunStatus.Done).SetProperty(r => r.CompletedAt, now), ct);
            log.LogInformation("Entries digest run {Id} was left unfinished for too long and was closed.", id);
        }
    }

    // ---- working through a run ----

    /// <summary>Sends batch after batch until the time is used up or nobody is left. Safe from any instance at any time.</summary>
    internal async Task WorkAsync(int runId, TimeSpan budget, CancellationToken ct)
    {
        var watch = Stopwatch.StartNew();
        while (await SendBatchAsync(runId, watch, budget, ct) > 0 && watch.Elapsed < budget) { }

        var left = await db.EntriesDigestRecipients.CountAsync(r => r.RunId == runId
            && (r.Status == EntriesDigestRecipientStatus.Pending || r.Status == EntriesDigestRecipientStatus.Claimed
                || (r.Status == EntriesDigestRecipientStatus.Failed && r.Attempts < MaxAttempts)), ct);
        if (left == 0)
            await db.EntriesDigestRuns.Where(r => r.Id == runId && r.Status == EntriesDigestRunStatus.Sending)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, EntriesDigestRunStatus.Done)
                    .SetProperty(r => r.CompletedAt, time.GetUtcNow().UtcDateTime), ct);
    }

    /// <summary>Claims and mails the next few people. Returns how many it claimed (0 when nobody is ready).</summary>
    private async Task<int> SendBatchAsync(int runId, Stopwatch watch, TimeSpan budget, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var stale = now - ClaimIsStale;
        var retryBefore = now - RetryAfter;
        // A claim abandoned too often (the instance died each time) is given up on, not retried for ever.
        await db.EntriesDigestRecipients
            .Where(r => r.RunId == runId && r.Status == EntriesDigestRecipientStatus.Claimed && r.ClaimedAt < stale && r.Attempts >= MaxAttempts)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, EntriesDigestRecipientStatus.Failed), ct);
        var claimable = db.EntriesDigestRecipients.Where(r => r.RunId == runId
            && (r.Status == EntriesDigestRecipientStatus.Pending
                || (r.Status == EntriesDigestRecipientStatus.Claimed && r.ClaimedAt < stale && r.Attempts < MaxAttempts)
                || (r.Status == EntriesDigestRecipientStatus.Failed && r.Attempts < MaxAttempts && r.ClaimedAt < retryBefore)));
        var ids = await claimable.OrderBy(r => r.Id).Select(r => r.Id).Take(BatchSize).ToListAsync(ct);
        if (ids.Count == 0) return 0;
        var token = Guid.NewGuid();
        await claimable.Where(r => ids.Contains(r.Id)).ExecuteUpdateAsync(s => s
            .SetProperty(r => r.Status, EntriesDigestRecipientStatus.Claimed)
            .SetProperty(r => r.ClaimedAt, now).SetProperty(r => r.ClaimToken, token).SetProperty(r => r.Attempts, r => r.Attempts + 1), ct);
        var mine = await db.EntriesDigestRecipients.AsNoTracking()
            .Where(r => r.RunId == runId && r.ClaimToken == token && r.Status == EntriesDigestRecipientStatus.Claimed)
            .OrderBy(r => r.Id).ToListAsync(ct);
        if (mine.Count == 0) return ids.Count;

        var optInIds = mine.Select(r => r.OptInId).ToList();
        var addresses = await db.EmailOptIns.AsNoTracking().Where(o => optInIds.Contains(o.Id))
            .Select(o => new { o.Id, o.Email }).ToDictionaryAsync(o => o.Id, o => o.Email, ct);
        var wanted = addresses.Values.ToList();
        var stillOptedIn = (await db.EmailOptIns.AsNoTracking().Where(o => o.UnsubscribedAt == null && wanted.Contains(o.Email))
            .Select(o => o.Email).ToListAsync(ct)).ToHashSet(StringComparer.OrdinalIgnoreCase);

        // What each person can still be told about: competitions of this run that are still open right now, described by the text
        // and dates frozen when the run was claimed (never the organiser's current edits).
        var frozen = await db.EntriesDigestCompetitions.AsNoTracking().Where(c => c.RunId == runId).ToListAsync(ct);
        var stillOpen = (await EntriesOpenRule.OpenAsync(db, now, frozen.Select(c => c.CompetitionId).ToList(), excludeAnnounced: false, ct))
            .Select(c => c.Id).ToHashSet();
        var open = frozen.Where(c => stillOpen.Contains(c.CompetitionId)).Select(EntriesOpenRule.Thaw).ToList();
        var site = EmailSite.Origin(options.Value, configuration);

        var handled = 0;
        for (var i = 0; i < mine.Count; i++)
        {
            var recipient = mine[i];
            if (!addresses.TryGetValue(recipient.OptInId, out var address) || !stillOptedIn.Contains(address)
                || !EmailAddresses.TryNormalise(address, out var to) || open.Count == 0 || site is null)
            {
                // Unsubscribed (or gone) since the run began, or nothing from it is still open: no message.
                await SettleAsync(recipient.Id, token, EntriesDigestRecipientStatus.Skipped, ct);
                continue;
            }
            // Out of time: hand the rest back untouched for the next call (after at least one has been mailed).
            if (handled > 0 && watch.Elapsed >= budget)
            {
                var back = mine.Skip(i).Select(r => r.Id).ToList();
                await db.EntriesDigestRecipients.Where(r => back.Contains(r.Id) && r.ClaimToken == token)
                    .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, EntriesDigestRecipientStatus.Pending)
                        .SetProperty(r => r.ClaimToken, (Guid?)null).SetProperty(r => r.Attempts, r => r.Attempts - 1), ct);
                break;
            }
            handled++;
            GeoPoint? origin = open.Count > 1 ? await locations.ForAddressAsync(to, ct) : null;
            var token64 = Uri.EscapeDataString(EmailUnsubscribeTokens.Create(configuration, recipient.OptInId));
            var message = EntriesDigestEmail.Build(to, EntriesOpenRule.Order(open, origin), site,
                $"{site}/unsubscribe?token={token64}", $"{site}/api/email/unsubscribe-one-click?token={token64}",
                $"entries-digest-{runId}-{recipient.OptInId}");
            var status = await sender.SendAsync(message, ct);
            await SettleAsync(recipient.Id, token,
                status == EmailDeliveryStatus.Sent ? EntriesDigestRecipientStatus.Sent : EntriesDigestRecipientStatus.Failed, ct);
        }
        log.LogInformation("Entries digest run {Id}: handled a batch of {Count}.", runId, mine.Count);
        return ids.Count;
    }

    /// <summary>Records one person's outcome, only if this batch still holds the claim.</summary>
    private Task<int> SettleAsync(long recipientId, Guid token, EntriesDigestRecipientStatus outcome, CancellationToken ct)
        => db.EntriesDigestRecipients
            .Where(r => r.Id == recipientId && r.ClaimToken == token && r.Status == EntriesDigestRecipientStatus.Claimed)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.Status, outcome), ct);
}
