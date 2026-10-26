using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Email;
using MountedGames.Api.Tests.Calendar;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Signups;

/// <summary>Admin custom emails: blocks, preview, test, batched sending that survives a scale-to-zero API, and unsubscribing.</summary>
public class CustomEmailTests : IClassFixture<EmailApiFactory>
{
    private readonly EmailApiFactory _f;
    public CustomEmailTests(EmailApiFactory f) => _f = f;

    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
    private static readonly Regex Unsubscribe = new(@"/unsubscribe\?token=([^\s""<>]+)", RegexOptions.Compiled);

    private static EmailBlockDto Text(string text) => new(EmailBlockType.Text, Text: text);
    private static CustomEmailContentRequest Content(CustomEmailAudience audience = CustomEmailAudience.News, params EmailBlockDto[] blocks)
        => new("Spring news", audience, blocks.Length == 0 ? [Text("Hello from the team.")] : blocks);

    private async Task<HttpClient> AdminAsync() => await _f.AdminAsync();

    private async Task OptInsAsync(params string[] addresses)
    {
        await _f.InDbAsync(async db =>
        {
            db.EmailOptIns.RemoveRange(db.EmailOptIns);
            foreach (var a in addresses)
                db.EmailOptIns.Add(new EmailOptIn { Email = a, WordingVersion = "w", Source = "signup-form", UnsubscribeTokenHash = Guid.NewGuid().ToString("N") });
            await db.SaveChangesAsync();
        });
    }

    /// <summary>An approved trainer whose account has a real, confirmed mailbox (sign-ups by username get a made-up one).</summary>
    private async Task<string> MailableOrganiserAsync(bool confirmed = true)
    {
        var (_, auth) = await _f.ApprovedTrainerAsync();
        var address = $"organiser-{Guid.NewGuid():N}@example.org";
        await _f.InDbAsync(async db =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == auth.User.Id);
            user.Email = address;
            user.NormalizedEmail = address.ToUpperInvariant();
            user.EmailConfirmed = confirmed;
            await db.SaveChangesAsync();
        });
        return address;
    }

    private static string[] Addresses(int count, string prefix = "news") => Enumerable.Range(0, count).Select(i => $"{prefix}{i}-{Guid.NewGuid():N}@example.org").ToArray();

    private async Task<int> CountAsync(HttpClient admin, CustomEmailAudience audience)
        => (await (await admin.GetAsync("/api/admin/custom-emails/audiences")).ReadAsync<List<CustomEmailAudienceDto>>()).Single(a => a.Audience == audience).Recipients;

    private async Task<CustomEmailDto> StartAsync(HttpClient admin, CustomEmailContentRequest content, int? expected = null)
    {
        // Tests share one database and the daily limit is real, so start each send from an empty history.
        await _f.InDbAsync(async db => { db.CustomEmails.RemoveRange(db.CustomEmails); await db.SaveChangesAsync(); });
        var count = expected ?? await CountAsync(admin, content.Audience);
        var response = await admin.PostAsJsonAsync("/api/admin/custom-emails", new SendCustomEmailRequest(content.Subject, content.Audience, content.Blocks, true, count));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<CustomEmailDto>();
    }

    private async Task<CustomEmailDto> BatchAsync(HttpClient admin, int id)
    {
        var response = await admin.PostAsync($"/api/admin/custom-emails/{id}/send-batch", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<CustomEmailDto>();
    }

    private async Task<CustomEmailDto> FinishAsync(HttpClient admin, int id)
    {
        CustomEmailDto dto;
        var calls = 0;
        do { dto = await BatchAsync(admin, id); calls++; } while (dto.Remaining > 0 && calls < 100);
        return dto;
    }

    private List<EmailApiFactory.SentMessage> SentTo(IEnumerable<string> addresses)
    {
        var set = addresses.ToHashSet();
        return _f.Sent.Where(m => set.Contains(m.To)).ToList();
    }

    // ---- who can ----

    [Fact]
    public async Task EveryAdminEndpointNeedsAnAdmin_ButPicturesAreOpenToAnyoneWithTheLink()
    {
        var (member, _) = await _f.SignupAsync("Member");
        var (organiser, _) = await _f.ApprovedTrainerAsync();
        var anonymous = _f.CreateClient();
        var content = Content();
        foreach (var client in new[] { anonymous, member, organiser })
        {
            var expected = ReferenceEquals(client, anonymous) ? HttpStatusCode.Unauthorized : HttpStatusCode.Forbidden;
            Assert.Equal(expected, (await client.GetAsync("/api/admin/custom-emails")).StatusCode);
            Assert.Equal(expected, (await client.GetAsync("/api/admin/custom-emails/audiences")).StatusCode);
            Assert.Equal(expected, (await client.GetAsync("/api/admin/custom-emails/1")).StatusCode);
            Assert.Equal(expected, (await client.PostAsJsonAsync("/api/admin/custom-emails/preview", content)).StatusCode);
            Assert.Equal(expected, (await client.PostAsJsonAsync("/api/admin/custom-emails/test", content)).StatusCode);
            Assert.Equal(expected, (await client.PostAsJsonAsync("/api/admin/custom-emails", new SendCustomEmailRequest("s", CustomEmailAudience.News, content.Blocks, true, 1))).StatusCode);
            Assert.Equal(expected, (await client.PostAsync("/api/admin/custom-emails/1/send-batch", null)).StatusCode);
            Assert.Equal(expected, (await client.PostAsync("/api/admin/custom-emails/1/cancel", null)).StatusCode);
            Assert.Equal(expected, (await client.PostAsync("/api/admin/custom-emails/1/retry-failed", null)).StatusCode);
            var upload = new ByteArrayContent(Png);
            upload.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            Assert.Equal(expected, (await client.PostAsync("/api/admin/custom-email-images", upload)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"/api/email-images/{Guid.NewGuid()}")).StatusCode);
    }

    // ---- audiences ----

    [Fact]
    public async Task AudiencesCountTheRightPeople()
    {
        var admin = await AdminAsync();
        var kept = Addresses(2, "kept");
        await OptInsAsync(kept[0], kept[1]);
        await _f.InDbAsync(async db =>
        {
            db.EmailOptIns.Add(new EmailOptIn { Email = kept[0], WordingVersion = "w", Source = "second", UnsubscribeTokenHash = Guid.NewGuid().ToString("N") }); // same address again
            db.EmailOptIns.Add(new EmailOptIn { Email = "gone@example.org", WordingVersion = "w", Source = "s", UnsubscribeTokenHash = Guid.NewGuid().ToString("N"), UnsubscribedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        });
        Assert.Equal(2, await CountAsync(admin, CustomEmailAudience.News));

        var trainersBefore = await CountAsync(admin, CustomEmailAudience.Trainers);
        var bothBefore = await CountAsync(admin, CustomEmailAudience.OrganisersAndAdmins);
        await MailableOrganiserAsync(confirmed: false);      // an organiser whose address is not confirmed
        Assert.Equal(trainersBefore, await CountAsync(admin, CustomEmailAudience.Trainers));
        await MailableOrganiserAsync();
        Assert.Equal(trainersBefore + 1, await CountAsync(admin, CustomEmailAudience.Trainers));
        Assert.Equal(bothBefore + 1, await CountAsync(admin, CustomEmailAudience.OrganisersAndAdmins));

        // A made-up username address can't receive mail, so it isn't mailed even when "confirmed".
        var (_, made) = await _f.ApprovedTrainerAsync();
        await _f.InDbAsync(async db =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == made.User.Id);
            user.Email = "someone@trainer.mg.local";
            user.EmailConfirmed = true;
            await db.SaveChangesAsync();
        });
        Assert.Equal(trainersBefore + 1, await CountAsync(admin, CustomEmailAudience.Trainers));
        var labels = (await (await admin.GetAsync("/api/admin/custom-emails/audiences")).ReadAsync<List<CustomEmailAudienceDto>>()).Select(a => a.Label);
        Assert.Contains("People who said yes to news", labels);
    }

    // ---- preview ----

    [Fact]
    public async Task PreviewRendersEveryBlockSafely()
    {
        var admin = await AdminAsync();
        var competitionId = await _f.SeedCompetitionAsync(name: "Spring <b>Show</b>", start: new DateTime(2037, 5, 2, 9, 0, 0, DateTimeKind.Utc), end: new DateTime(2037, 5, 3, 9, 0, 0, DateTimeKind.Utc));
        await _f.InDbAsync(async db => { (await db.Competitions.SingleAsync(c => c.Id == competitionId)).Location = "Home Farm, Kent"; await db.SaveChangesAsync(); });
        var imageId = await UploadAsync(admin);
        var blocks = new[]
        {
            Text("Hello <script>alert(1)</script>\nsecond line\n\nNew paragraph & more"),
            new EmailBlockDto(EmailBlockType.Picture, ImageId: imageId, Alt: "A \"flag\" race"),
            new EmailBlockDto(EmailBlockType.Button, Label: "See details", Url: "https://example.org/info?a=1&b=2"),
            new EmailBlockDto(EmailBlockType.Competition, CompetitionId: competitionId),
        };

        var response = await admin.PostAsJsonAsync("/api/admin/custom-emails/preview", Content(CustomEmailAudience.News, blocks));
        var preview = await response.ReadAsync<CustomEmailPreviewDto>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Spring news", preview.Subject);
        Assert.DoesNotContain("<script>", preview.Html);
        Assert.Contains("&lt;script&gt;alert(1)&lt;/script&gt;<br>second line", preview.Html);
        Assert.Contains("New paragraph &amp; more", preview.Html);
        Assert.Contains($"{EmailApiFactory.SiteUrl}/api/email-images/{imageId:D}", preview.Html);
        Assert.Contains("alt=\"A &quot;flag&quot; race\"", preview.Html);
        Assert.Contains("https://example.org/info?a=1&amp;b=2", preview.Html);
        Assert.Contains("Spring &lt;b&gt;Show&lt;/b&gt;", preview.Html);
        Assert.Contains("Home Farm, Kent", preview.Html);
        Assert.Contains($"{EmailApiFactory.SiteUrl}/competitions/{competitionId}/enter", preview.Html);
        Assert.Contains("/unsubscribe?token=preview", preview.Html);
        Assert.False((preview.Html + preview.Text).Contains('\u0001'));
        Assert.Contains("See details: https://example.org/info?a=1&b=2", preview.Text);
        Assert.Contains("[Picture: A \"flag\" race]", preview.Text);
        Assert.Contains($"Enter: {EmailApiFactory.SiteUrl}/competitions/{competitionId}/enter", preview.Text);
        Assert.Contains("Spring <b>Show</b>", preview.Text);
        // Nothing was sent or saved.
        Assert.Empty(_f.Sent.Where(m => m.Html?.Contains("Home Farm") == true));
    }

    [Fact]
    public async Task OnlyTheNewsAudienceGetsAnUnsubscribeFooter()
    {
        var admin = await AdminAsync();
        var news = await (await admin.PostAsJsonAsync("/api/admin/custom-emails/preview", Content(CustomEmailAudience.News))).ReadAsync<CustomEmailPreviewDto>();
        var trainers = await (await admin.PostAsJsonAsync("/api/admin/custom-emails/preview", Content(CustomEmailAudience.Trainers))).ReadAsync<CustomEmailPreviewDto>();
        Assert.Contains("Unsubscribe", news.Html);
        Assert.DoesNotContain("nsubscribe", trainers.Html + trainers.Text);
        Assert.Contains("you run or help run competitions", trainers.Text);
    }

    [Fact]
    public async Task PreviewListsEveryProblem()
    {
        var admin = await AdminAsync();
        var many = Enumerable.Range(0, CustomEmailService.MaxBlocks + 1).Select(_ => Text("x")).ToArray();
        async Task<List<string>> ProblemsAsync(CustomEmailContentRequest request)
        {
            var response = await admin.PostAsJsonAsync("/api/admin/custom-emails/preview", request);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            return (await response.ReadAsync<ProblemList>()).Problems;
        }

        Assert.Contains("Add a subject.", await ProblemsAsync(new CustomEmailContentRequest("  ", CustomEmailAudience.News, [Text("x")])));
        Assert.Contains(await ProblemsAsync(new CustomEmailContentRequest(new string('s', 151), CustomEmailAudience.News, [Text("x")])), p => p.Contains("subject"));
        Assert.Contains(await ProblemsAsync(new CustomEmailContentRequest("Line\r\nBcc: x@example.org", CustomEmailAudience.News, [Text("x")])), p => p.Contains("line breaks"));
        Assert.Contains("Add at least one block.", await ProblemsAsync(new CustomEmailContentRequest("s", CustomEmailAudience.News, [])));
        Assert.Contains(await ProblemsAsync(new CustomEmailContentRequest("s", CustomEmailAudience.News, many)), p => p.Contains("30 blocks"));
        Assert.Contains(await ProblemsAsync(new CustomEmailContentRequest("s", (CustomEmailAudience)9, [Text("x")])), p => p.Contains("who it goes to"));
        Assert.Contains(await ProblemsAsync(Content(blocks: Text(" "))), p => p.StartsWith("Block 1"));
        Assert.Contains(await ProblemsAsync(Content(blocks: Text(new string('t', 5001)))), p => p.Contains("5000"));
        Assert.Contains(await ProblemsAsync(Content(blocks: Text("bad \u0001 text"))), p => p.Contains("characters that can't be sent"));
        var longText = Enumerable.Range(0, 7).Select(_ => Text(new string('a', 4900))).ToArray();
        Assert.Contains(await ProblemsAsync(Content(blocks: longText)), p => p.Contains("30000"));
        Assert.Contains(await ProblemsAsync(Content(blocks: new EmailBlockDto(EmailBlockType.Picture, ImageId: Guid.NewGuid()))), p => p.Contains("upload the picture again"));
        Assert.Contains(await ProblemsAsync(Content(blocks: new EmailBlockDto(EmailBlockType.Picture))), p => p.Contains("upload the picture again"));
        var imageId = await UploadAsync(admin);
        Assert.Contains(await ProblemsAsync(Content(blocks: new EmailBlockDto(EmailBlockType.Picture, ImageId: imageId, Alt: new string('a', 201)))), p => p.Contains("description"));
        Assert.Contains(await ProblemsAsync(Content(blocks: new EmailBlockDto(EmailBlockType.Button, Label: "Go", Url: "http://example.org"))), p => p.Contains("https://"));
        Assert.Contains(await ProblemsAsync(Content(blocks: new EmailBlockDto(EmailBlockType.Button, Label: "Go", Url: "javascript:alert(1)"))), p => p.Contains("https://"));
        Assert.Contains(await ProblemsAsync(Content(blocks: new EmailBlockDto(EmailBlockType.Button, Label: "Go", Url: "https://user:pw@example.org/"))), p => p.Contains("https://"));
        Assert.Contains(await ProblemsAsync(Content(blocks: new EmailBlockDto(EmailBlockType.Button, Label: "", Url: "https://example.org"))), p => p.Contains("label"));
        Assert.Contains(await ProblemsAsync(Content(blocks: new EmailBlockDto(EmailBlockType.Button, Label: new string('l', 61), Url: "https://example.org"))), p => p.Contains("label"));
        Assert.Contains(await ProblemsAsync(Content(blocks: new EmailBlockDto(EmailBlockType.Competition, CompetitionId: 999999))), p => p.Contains("choose a competition"));
        Assert.Contains(await ProblemsAsync(Content(blocks: new EmailBlockDto((EmailBlockType)9))), p => p.Contains("unknown block type"));
        // Several mistakes at once are all reported.
        var all = await ProblemsAsync(new CustomEmailContentRequest("", CustomEmailAudience.News, [Text(""), new EmailBlockDto(EmailBlockType.Button, Label: "", Url: "x")]));
        Assert.True(all.Count >= 3);
    }

    private sealed record ProblemList(string Message, List<string> Problems);

    // ---- test send ----

    [Fact]
    public async Task ATestGoesOnlyToTheAdmin_AndNothingIsRecorded()
    {
        var admin = await AdminAsync();
        await OptInsAsync(Addresses(3));
        var before = _f.Sent.Count;
        var emailsBefore = await _f.WithDbAsync(db => db.CustomEmails.CountAsync());

        var response = await admin.PostAsJsonAsync("/api/admin/custom-emails/test", Content());
        var dto = await response.ReadAsync<CustomEmailTestDto>();

        Assert.Equal(EmailDeliveryStatus.Sent, dto.Status);
        var message = Assert.Single(_f.Sent.Skip(before));
        Assert.Equal(TestClients.AdminEmail, message.To);
        Assert.Equal("[Test] Spring news", message.Subject);
        Assert.Contains("/unsubscribe?token=test", message.Text);
        Assert.Equal(emailsBefore, await _f.WithDbAsync(db => db.CustomEmails.CountAsync()));
    }

    // ---- create ----

    [Fact]
    public async Task CreatingNeedsConfirmationAndTheNumberTheAdminSaw()
    {
        var admin = await AdminAsync();
        await OptInsAsync(Addresses(4));
        var blocks = Content().Blocks;

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/admin/custom-emails", new SendCustomEmailRequest("s", CustomEmailAudience.News, blocks, false, 4))).StatusCode);

        var wrong = await admin.PostAsJsonAsync("/api/admin/custom-emails", new SendCustomEmailRequest("s", CustomEmailAudience.News, blocks, true, 3));
        Assert.Equal(HttpStatusCode.Conflict, wrong.StatusCode);
        Assert.Contains("now has 4 people, not 3", await wrong.Content.ReadAsStringAsync());

        await OptInsAsync();
        var emailsBefore = await _f.WithDbAsync(db => db.CustomEmails.CountAsync());
        var empty = await admin.PostAsJsonAsync("/api/admin/custom-emails", new SendCustomEmailRequest("s", CustomEmailAudience.News, blocks, true, 0));
        Assert.Equal(HttpStatusCode.Conflict, empty.StatusCode);
        Assert.Equal(emailsBefore, await _f.WithDbAsync(db => db.CustomEmails.CountAsync()));
    }

    [Fact]
    public async Task TheDailyLimitStopsARunawayAccount()
    {
        var admin = await AdminAsync();
        await OptInsAsync(Addresses(1));
        await _f.InDbAsync(async db =>
        {
            for (var i = 0; i < CustomEmail.MaxSendsPerDay; i++)
                db.CustomEmails.Add(new CustomEmail { Subject = "old", HtmlBody = "h", TextBody = "t", Status = CustomEmailStatus.Done, CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        });
        var response = await admin.PostAsJsonAsync("/api/admin/custom-emails", new SendCustomEmailRequest("s", CustomEmailAudience.News, Content().Blocks, true, 1));
        Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
        await _f.InDbAsync(async db => { db.CustomEmails.RemoveRange(db.CustomEmails.Where(e => e.Subject == "old")); await db.SaveChangesAsync(); });
    }

    // ---- sending ----

    [Fact]
    public async Task SendsInBatches_EachPersonOnce_WithTheirOwnUnsubscribeLink_AndKeepsNoAddressesAfterwards()
    {
        var admin = await AdminAsync();
        var people = Addresses(25);
        await OptInsAsync(people);
        var content = Content(blocks: Text("Entries open for the summer show."));

        var started = await StartAsync(admin, content);
        Assert.Equal((CustomEmailStatus.Sending, 25, 25, 0), (started.Status, started.Total, started.Remaining, started.Sent));
        Assert.Empty(SentTo(people));

        var first = await BatchAsync(admin, started.Id);
        Assert.Equal((10, 15), (first.Sent, first.Remaining));
        var second = await BatchAsync(admin, started.Id);
        Assert.Equal((20, 5), (second.Sent, second.Remaining));
        var done = await BatchAsync(admin, started.Id);
        Assert.Equal((CustomEmailStatus.Done, 25, 0, 0), (done.Status, done.Sent, done.Remaining, done.Failed));
        Assert.NotNull(done.CompletedAt);

        var messages = SentTo(people);
        Assert.Equal(25, messages.Count);
        Assert.Equal(people.OrderBy(x => x), messages.Select(m => m.To).OrderBy(x => x));
        Assert.Equal(25, messages.Select(m => m.IdempotencyKey).Distinct().Count());
        Assert.All(messages, m =>
        {
            Assert.Equal("Spring news", m.Subject);
            Assert.Contains("Entries open for the summer show.", m.Text);
            Assert.False((m.Text + m.Html).Contains('\u0001'));
            var token = Unsubscribe.Match(m.Text).Groups[1].Value;
            Assert.StartsWith("n1.", Uri.UnescapeDataString(token));
            Assert.Contains(Uri.EscapeDataString(Uri.UnescapeDataString(token)), m.Html);
            var headers = m.Body.GetProperty("headers");
            Assert.Equal("List-Unsubscribe=One-Click", headers.GetProperty("List-Unsubscribe-Post").GetString());
            var listUnsubscribe = headers.GetProperty("List-Unsubscribe").GetString()!;
            Assert.StartsWith($"<{EmailApiFactory.SiteUrl}/api/email/unsubscribe-one-click?token=n1.", listUnsubscribe);
            Assert.Contains($"{EmailApiFactory.SiteUrl}/unsubscribe?token=n1.", listUnsubscribe);
        });
        // Each person's link is their own.
        Assert.Equal(25, messages.Select(m => Unsubscribe.Match(m.Text).Groups[1].Value).Distinct().Count());
        // Nothing left to remember about who was mailed.
        Assert.Empty(await _f.WithDbAsync(db => db.CustomEmailRecipients.Where(r => r.CustomEmailId == started.Id).ToListAsync()));
        // Calling again after it is done changes nothing.
        Assert.Equal(25, (await BatchAsync(admin, started.Id)).Sent);
        Assert.Equal(25, SentTo(people).Count);
    }

    [Fact]
    public async Task TheUnsubscribeLinkInTheEmailWorks_AndAForgedOneDoesNot()
    {
        var admin = await AdminAsync();
        var people = Addresses(2);
        await OptInsAsync(people);
        var started = await StartAsync(admin, Content());
        await FinishAsync(admin, started.Id);
        var message = SentTo(people).First(m => m.To == people[0]);
        var token = Uri.UnescapeDataString(Unsubscribe.Match(message.Text).Groups[1].Value);
        var client = _f.CreateClient();

        await client.PostAsJsonAsync("/api/email/unsubscribe", new UnsubscribeRequest(token[..^1] + (token[^1] == 'A' ? 'B' : 'A')));
        Assert.Equal(2, await CountAsync(admin, CustomEmailAudience.News));

        var forged = "n1." + (await _f.WithDbAsync(db => db.EmailOptIns.Where(o => o.Email == people[1]).Select(o => o.Id).SingleAsync())) + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        await client.PostAsJsonAsync("/api/email/unsubscribe", new UnsubscribeRequest(forged));
        Assert.Equal(2, await CountAsync(admin, CustomEmailAudience.News));

        var ok = await client.PostAsJsonAsync("/api/email/unsubscribe", new UnsubscribeRequest(token));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(1, await CountAsync(admin, CustomEmailAudience.News));
        Assert.NotNull((await _f.WithDbAsync(db => db.EmailOptIns.SingleAsync(o => o.Email == people[0]))).UnsubscribedAt);
        Assert.Null((await _f.WithDbAsync(db => db.EmailOptIns.SingleAsync(o => o.Email == people[1]))).UnsubscribedAt);
    }

    [Fact]
    public async Task OneClickUnsubscribeWorksFromTheHeaderLinkWithAFormPost()
    {
        var admin = await AdminAsync();
        var people = Addresses(2);
        await OptInsAsync(people);
        await FinishAsync(admin, (await StartAsync(admin, Content())).Id);
        var message = SentTo(people).First(m => m.To == people[0]);
        var link = Regex.Match(message.Body.GetProperty("headers").GetProperty("List-Unsubscribe").GetString()!, @"<([^>]*one-click[^>]*)>").Groups[1].Value;
        var path = new Uri(link).PathAndQuery;

        var response = await _f.CreateClient().PostAsync(path, new FormUrlEncodedContent([new("List-Unsubscribe", "One-Click")]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull((await _f.WithDbAsync(db => db.EmailOptIns.SingleAsync(o => o.Email == people[0]))).UnsubscribedAt);
        Assert.Null((await _f.WithDbAsync(db => db.EmailOptIns.SingleAsync(o => o.Email == people[1]))).UnsubscribedAt);
        // A forged token does nothing, and says the same.
        var forged = await _f.CreateClient().PostAsync("/api/email/unsubscribe-one-click?token=n1.1.AAAA", new FormUrlEncodedContent([new("List-Unsubscribe", "One-Click")]));
        Assert.Equal(HttpStatusCode.OK, forged.StatusCode);
    }

    [Fact]
    public async Task TheSharedAdminAccountAndMadeUpAddressesAreNeverMailed_NorAreLockedOrBlockedAccounts()
    {
        var admin = await AdminAsync();
        // The shared admin-key account is confirmed, but has no mailbox.
        await OptInsAsync("admin@mg.local", "x@trainer.mg.local", "real-" + Guid.NewGuid().ToString("N") + "@example.org");
        Assert.Equal(1, await CountAsync(admin, CustomEmailAudience.News));
        Assert.DoesNotContain(await _f.WithDbAsync(db => CustomEmailAudiences.ResolveAsync(db, CustomEmailAudience.OrganisersAndAdmins, default)), r => r.Address == "admin@mg.local");

        var kept = await MailableOrganiserAsync();
        var locked = await MailableOrganiserAsync();
        var blocked = await MailableOrganiserAsync();
        await _f.InDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Email == locked)).LockedAt = DateTime.UtcNow;
            (await db.Users.SingleAsync(u => u.Email == blocked)).BlockedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        });
        var addresses = (await _f.WithDbAsync(db => CustomEmailAudiences.ResolveAsync(db, CustomEmailAudience.Trainers, default))).Select(r => r.Address).ToList();
        Assert.Contains(kept, addresses);
        Assert.DoesNotContain(locked, addresses);
        Assert.DoesNotContain(blocked, addresses);
    }

    [Fact]
    public async Task SomeoneWhoUnsubscribesMidSendIsNotMailed()
    {
        var admin = await AdminAsync();
        var people = Addresses(15);
        await OptInsAsync(people);
        var started = await StartAsync(admin, Content());
        await BatchAsync(admin, started.Id);
        var late = (await _f.WithDbAsync(db => db.CustomEmailRecipients.Where(r => r.CustomEmailId == started.Id).OrderBy(r => r.Id).Select(r => r.Address).ToListAsync())).First();
        await _f.InDbAsync(async db =>
        {
            foreach (var o in db.EmailOptIns.Where(o => o.Email == late)) o.UnsubscribedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        });

        var done = await FinishAsync(admin, started.Id);

        Assert.Equal((14, 1, 0), (done.Sent, done.Skipped, done.Failed));
        Assert.Empty(SentTo([late]));
    }

    [Fact]
    public async Task TheSentCountIsForThisEmailAlone_NotARunningTotalAcrossEmails()
    {
        // The admin page's "Sent to N people" toast reads `sent` from the last batch, so a second email must start from zero.
        var admin = await AdminAsync();
        await OptInsAsync(Addresses(3, "first"));
        var first = await FinishAsync(admin, (await StartAsync(admin, Content())).Id);
        Assert.Equal((3, 3), (first.Sent, first.Total));

        await OptInsAsync(Addresses(2, "second"));
        var count = await CountAsync(admin, CustomEmailAudience.News);
        var response = await admin.PostAsJsonAsync("/api/admin/custom-emails",
            new SendCustomEmailRequest("Second news", CustomEmailAudience.News, [Text("Another one.")], true, count));
        var second = await FinishAsync(admin, (await response.ReadAsync<CustomEmailDto>()).Id);

        Assert.Equal((2, 2, 0), (second.Sent, second.Total, second.Failed));
    }

    [Fact]
    public async Task TrainersAreMailedAtTheirAccountAddress_WithNoUnsubscribeLink()
    {
        var admin = await AdminAsync();
        await OptInsAsync();
        var organiserAddress = await MailableOrganiserAsync();
        var content = Content(CustomEmailAudience.Trainers);

        var started = await StartAsync(admin, content);
        Assert.True(started.Total >= 1);
        var done = await FinishAsync(admin, started.Id);

        Assert.Equal(done.Total, done.Sent);
        var message = Assert.Single(SentTo([organiserAddress]), m => m.Subject == "Spring news");
        Assert.DoesNotContain("nsubscribe", message.Text);
        Assert.False(message.Body.TryGetProperty("headers", out _));
    }

    [Fact]
    public async Task WhatWasPreviewedIsWhatIsSent_EvenIfACompetitionChangesAfterwards()
    {
        var admin = await AdminAsync();
        var people = Addresses(12);
        await OptInsAsync(people);
        var competitionId = await _f.SeedCompetitionAsync(name: "Original Name Show");
        var blocks = new[] { new EmailBlockDto(EmailBlockType.Competition, CompetitionId: competitionId) };
        var started = await StartAsync(admin, Content(blocks: blocks));
        await _f.InDbAsync(async db => { (await db.Competitions.SingleAsync(c => c.Id == competitionId)).Name = "Renamed Afterwards"; await db.SaveChangesAsync(); });

        await FinishAsync(admin, started.Id);

        Assert.All(SentTo(people), m =>
        {
            Assert.Contains("Original Name Show", m.Text);
            Assert.DoesNotContain("Renamed Afterwards", m.Text);
        });
    }

    // ---- failures, retries, cancelling, crashes ----

    [Fact]
    public async Task AFailedMessageIsCountedAndCanBeRetried()
    {
        var admin = await AdminAsync();
        var people = Addresses(3);
        await OptInsAsync(people);
        var started = await StartAsync(admin, Content());
        _f.Fail = () => new HttpResponseMessage(HttpStatusCode.InternalServerError);
        CustomEmailDto done;
        try { done = await FinishAsync(admin, started.Id); }
        finally { _f.Fail = null; }
        Assert.Equal((CustomEmailStatus.Done, 0, 3, 0), (done.Status, done.Sent, done.Failed, done.Remaining));
        Assert.Equal(3, await _f.WithDbAsync(db => db.CustomEmailRecipients.CountAsync(r => r.CustomEmailId == started.Id && r.Status == CustomEmailRecipientStatus.Failed)));

        var reopened = await (await admin.PostAsync($"/api/admin/custom-emails/{started.Id}/retry-failed", null)).ReadAsync<CustomEmailDto>();
        Assert.Equal((CustomEmailStatus.Sending, 0, 3), (reopened.Status, reopened.Failed, reopened.Remaining));
        var again = await FinishAsync(admin, started.Id);
        Assert.Equal((CustomEmailStatus.Done, 3, 0), (again.Status, again.Sent, again.Failed));
        Assert.Empty(await _f.WithDbAsync(db => db.CustomEmailRecipients.Where(r => r.CustomEmailId == started.Id).ToListAsync()));
        // A retry with nothing failed changes nothing.
        Assert.Equal(CustomEmailStatus.Done, (await (await admin.PostAsync($"/api/admin/custom-emails/{started.Id}/retry-failed", null)).ReadAsync<CustomEmailDto>()).Status);
    }

    [Fact]
    public async Task CancellingStopsTheSend_AndForgetsTheAddresses()
    {
        var admin = await AdminAsync();
        var people = Addresses(15);
        await OptInsAsync(people);
        var started = await StartAsync(admin, Content());
        await BatchAsync(admin, started.Id);

        var cancelled = await (await admin.PostAsync($"/api/admin/custom-emails/{started.Id}/cancel", null)).ReadAsync<CustomEmailDto>();

        Assert.Equal((CustomEmailStatus.Cancelled, 10, 0), (cancelled.Status, cancelled.Sent, cancelled.Remaining));
        Assert.Empty(await _f.WithDbAsync(db => db.CustomEmailRecipients.Where(r => r.CustomEmailId == started.Id).ToListAsync()));
        var count = SentTo(people).Count;
        await BatchAsync(admin, started.Id);
        Assert.Equal(count, SentTo(people).Count);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"/api/admin/custom-emails/{started.Id}/retry-failed", null)).StatusCode);
        // Cancelling again is harmless.
        Assert.Equal(CustomEmailStatus.Cancelled, (await (await admin.PostAsync($"/api/admin/custom-emails/{started.Id}/cancel", null)).ReadAsync<CustomEmailDto>()).Status);
    }

    [Fact]
    public async Task ASendThatWasAbandonedMidBatchIsPickedUpByTheNextCall_ButAFreshClaimIsLeftAlone()
    {
        var admin = await AdminAsync();
        var people = Addresses(6);
        await OptInsAsync(people);
        var started = await StartAsync(admin, Content());
        var rows = await _f.WithDbAsync(db => db.CustomEmailRecipients.Where(r => r.CustomEmailId == started.Id).OrderBy(r => r.Id).ToListAsync());
        // The instance that claimed the first two died long ago; another is still working on the next two.
        await _f.InDbAsync(async db =>
        {
            foreach (var row in await db.CustomEmailRecipients.Where(r => r.CustomEmailId == started.Id).OrderBy(r => r.Id).ToListAsync())
            {
                var index = rows.FindIndex(x => x.Id == row.Id);
                if (index < 2) { row.Status = CustomEmailRecipientStatus.Claimed; row.ClaimedAt = DateTime.UtcNow.AddMinutes(-10); row.ClaimToken = Guid.NewGuid(); }
                else if (index < 4) { row.Status = CustomEmailRecipientStatus.Claimed; row.ClaimedAt = DateTime.UtcNow; row.ClaimToken = Guid.NewGuid(); }
            }
            await db.SaveChangesAsync();
        });

        var batch = await BatchAsync(admin, started.Id);

        // The stale two and the two untouched are mailed; the fresh claims wait.
        Assert.Equal((4, 2), (batch.Sent, batch.Remaining));
        Assert.Equal(new[] { rows[2].Address, rows[3].Address }.OrderBy(x => x),
            await _f.WithDbAsync(db => db.CustomEmailRecipients.Where(r => r.CustomEmailId == started.Id).Select(r => r.Address).OrderBy(x => x).ToListAsync()));
    }

    [Fact]
    public async Task TwoBatchesAtOnceNeverMailAnyoneTwice()
    {
        var admin = await AdminAsync();
        var people = Addresses(20);
        await OptInsAsync(people);
        var started = await StartAsync(admin, Content());

        await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => admin.PostAsync($"/api/admin/custom-emails/{started.Id}/send-batch", null)));
        await FinishAsync(admin, started.Id);

        var messages = SentTo(people);
        Assert.Equal(20, messages.Select(m => m.To).Distinct().Count());
        Assert.Equal(20, messages.Count);
    }

    [Fact]
    public async Task NeitherAddressesNorBodiesAreLogged()
    {
        var admin = await AdminAsync();
        var people = Addresses(3);
        await OptInsAsync(people);
        var phrase = $"unique-body-phrase-{Guid.NewGuid():N}";
        var started = await StartAsync(admin, Content(blocks: Text(phrase)));
        await FinishAsync(admin, started.Id);
        await admin.PostAsJsonAsync("/api/admin/custom-emails/test", Content(blocks: Text(phrase)));

        var logs = string.Join('\n', _f.Logs);
        Assert.DoesNotContain(phrase, logs);
        foreach (var person in people) Assert.DoesNotContain(person, logs, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(TestClients.AdminEmail, logs, StringComparison.OrdinalIgnoreCase);
        Assert.Contains($"Custom email {started.Id}", logs);
    }

    // ---- reading ----

    [Fact]
    public async Task ListAndDetailShowTheSentEmailsWithCounts()
    {
        var admin = await AdminAsync();
        var people = Addresses(11);
        await OptInsAsync(people);
        var blocks = new[] { Text("Hello"), new EmailBlockDto(EmailBlockType.Button, Label: "Go", Url: "https://example.org/") };
        var started = await StartAsync(admin, Content(blocks: blocks));
        await BatchAsync(admin, started.Id);

        var list = await (await admin.GetAsync("/api/admin/custom-emails")).ReadAsync<List<CustomEmailDto>>();
        var row = list.Single(e => e.Id == started.Id);
        Assert.Equal(("Spring news", CustomEmailAudience.News, CustomEmailStatus.Sending, 11, 10, 1), (row.Subject, row.Audience, row.Status, row.Total, row.Sent, row.Remaining));
        Assert.False(string.IsNullOrEmpty(row.CreatedByName));

        var detail = await (await admin.GetAsync($"/api/admin/custom-emails/{started.Id}")).ReadAsync<CustomEmailDetailDto>();
        Assert.Equal(2, detail.Blocks.Count);
        Assert.Equal("https://example.org/", detail.Blocks[1].Url);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/admin/custom-emails/999999")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync("/api/admin/custom-emails/999999/send-batch", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync("/api/admin/custom-emails/999999/cancel", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync("/api/admin/custom-emails/999999/retry-failed", null)).StatusCode);
    }

    [Fact]
    public async Task FailedAddressesAreDroppedAfterAWeek()
    {
        var admin = await AdminAsync();
        var people = Addresses(2);
        await OptInsAsync(people);
        var started = await StartAsync(admin, Content());
        _f.Fail = () => new HttpResponseMessage(HttpStatusCode.InternalServerError);
        try { await FinishAsync(admin, started.Id); } finally { _f.Fail = null; }
        await _f.InDbAsync(async db =>
        {
            (await db.CustomEmails.SingleAsync(e => e.Id == started.Id)).CompletedAt = DateTime.UtcNow.AddDays(-8);
            await db.SaveChangesAsync();
        });

        await admin.GetAsync("/api/admin/custom-emails");

        Assert.Empty(await _f.WithDbAsync(db => db.CustomEmailRecipients.Where(r => r.CustomEmailId == started.Id).ToListAsync()));
        var row = (await (await admin.GetAsync("/api/admin/custom-emails")).ReadAsync<List<CustomEmailDto>>()).Single(e => e.Id == started.Id);
        Assert.Equal(2, row.Failed);
    }

    // ---- pictures ----

    private async Task<Guid> UploadAsync(HttpClient admin)
    {
        var upload = new ByteArrayContent(Png);
        upload.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        var response = await admin.PostAsync("/api/admin/custom-email-images", upload);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.ReadAsync<CustomEmailImageDto>()).Id;
    }

    [Fact]
    public async Task PicturesAreCheckedByTheirBytes_AndServedPubliclyAsTheTypeTheyReallyAre()
    {
        var admin = await AdminAsync();
        var id = await UploadAsync(admin);

        var served = await _f.CreateClient().GetAsync($"/api/email-images/{id}");
        Assert.Equal(HttpStatusCode.OK, served.StatusCode);
        Assert.Equal("image/png", served.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Png, await served.Content.ReadAsByteArrayAsync());
        Assert.Equal("nosniff", served.Headers.GetValues("X-Content-Type-Options").Single());

        ByteArrayContent Body(byte[] bytes, string type) { var c = new ByteArrayContent(bytes); c.Headers.ContentType = new MediaTypeHeaderValue(type); return c; }
        var svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"u8.ToArray();
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await admin.PostAsync("/api/admin/custom-email-images", Body(svg, "image/svg+xml"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/api/admin/custom-email-images", Body(svg, "image/png"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/api/admin/custom-email-images", Body([], "image/png"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/api/admin/custom-email-images", Body(Png, "image/webp"))).StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await admin.PostAsync("/api/admin/custom-email-images", Body(Png, "text/html"))).StatusCode);
        var big = new byte[CustomEmailImage.MaxBytes + 1];
        Png.CopyTo(big, 0);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await admin.PostAsync("/api/admin/custom-email-images", Body(big, "image/png"))).StatusCode);
    }

    [Fact]
    public async Task AnUnusedPictureIsTidiedAwayButOneInASentEmailStays()
    {
        var admin = await AdminAsync();
        await OptInsAsync(Addresses(1));
        var unused = await UploadAsync(admin);
        var used = await UploadAsync(admin);
        var started = await StartAsync(admin, Content(blocks: new EmailBlockDto(EmailBlockType.Picture, ImageId: used)));
        Assert.Equal(started.Id, (await _f.WithDbAsync(db => db.CustomEmailImages.SingleAsync(i => i.Id == used))).UsedByEmailId);
        await _f.InDbAsync(async db =>
        {
            foreach (var image in db.CustomEmailImages) image.CreatedAt = DateTime.UtcNow.AddDays(-3);
            await db.SaveChangesAsync();
        });

        await UploadAsync(admin);

        Assert.False(await _f.WithDbAsync(db => db.CustomEmailImages.AnyAsync(i => i.Id == unused)));
        Assert.True(await _f.WithDbAsync(db => db.CustomEmailImages.AnyAsync(i => i.Id == used)));
    }

    // ---- tokens, schema ----

    [Fact]
    public void UnsubscribeTokensAreSignedAndNeedNothingStored()
    {
        var config = _f.Services.GetRequiredService<IConfiguration>();
        var token = EmailUnsubscribeTokens.Create(config, 42);
        Assert.True(EmailUnsubscribeTokens.TryRead(config, token, out var id));
        Assert.Equal(42, id);
        Assert.False(EmailUnsubscribeTokens.TryRead(config, token.Replace("n1.42.", "n1.43."), out _));
        Assert.False(EmailUnsubscribeTokens.TryRead(config, "n1.42.", out _));
        Assert.False(EmailUnsubscribeTokens.TryRead(config, "n1.x.abc", out _));
        Assert.False(EmailUnsubscribeTokens.TryRead(config, "n1.0.abc", out _));
        Assert.False(EmailUnsubscribeTokens.TryRead(config, "n2.42." + token[(token.LastIndexOf('.') + 1)..], out _));
        Assert.False(EmailUnsubscribeTokens.TryRead(config, new string('n', 200), out _));
        Assert.False(EmailUnsubscribeTokens.TryRead(config, null, out _));
        Assert.DoesNotContain("@", token);
    }

    [Fact]
    public async Task ExistingSqliteDatabaseGainsTheCustomEmailTables()
    {
        var admin = await AdminAsync();
        await OptInsAsync(Addresses(1));
        using var scope = _f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MountedGames.Api.Data.AppDbContext>();
        await db.Database.ExecuteSqlRawAsync("DROP TABLE CustomEmailRecipients; DROP TABLE CustomEmails; DROP TABLE CustomEmailImages;");

        await MountedGames.Api.Services.DbInitializer.SeedAsync(_f.Services);

        var started = await StartAsync(admin, Content());
        Assert.Equal(1, started.Total);
    }

    // ---- links, picture links and the footer ----

    private async Task<CustomEmailPreviewDto> PreviewOkAsync(HttpClient admin, CustomEmailContentRequest request)
    {
        var response = await admin.PostAsJsonAsync("/api/admin/custom-emails/preview", request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<CustomEmailPreviewDto>();
    }

    private async Task<List<string>> PreviewProblemsAsync(HttpClient admin, CustomEmailContentRequest request)
    {
        var response = await admin.PostAsJsonAsync("/api/admin/custom-emails/preview", request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return (await response.ReadAsync<ProblemList>()).Problems;
    }

    [Fact]
    public async Task LinkedWordsBecomeLinksOnTheFirstPlaceTheyAppear_AndTheMessageStaysPlain()
    {
        var admin = await AdminAsync();
        var competitionId = await _f.SeedCompetitionAsync(name: "Links Show");
        var text = new EmailBlockDto(EmailBlockType.Text, Text: "Enter now & win.\n\nNo, enter now <b>today</b>. Results are up.", Links:
        [
            new EmailLinkDto("enter now", CompetitionId: competitionId, Page: EmailPage.Entry),
            new EmailLinkDto("Results", CompetitionId: competitionId, Page: EmailPage.Results),
            new EmailLinkDto("today", Url: "https://example.org/a?x=1&y=2"),
        ]);
        var preview = await PreviewOkAsync(admin, Content(CustomEmailAudience.Trainers, text));
        var entry = $"{EmailApiFactory.SiteUrl}/competitions/{competitionId}/enter";
        Assert.Contains($"<a href=\"{entry}\" style=\"color:#1f5fbf;text-decoration:underline;\">Enter now</a> &amp; win.", preview.Html);
        // Only the first "enter now" is linked; markup typed into the message stays text.
        Assert.Single(Regex.Matches(preview.Html, Regex.Escape(entry)));
        Assert.Contains("No, enter now &lt;b&gt;", preview.Html);
        Assert.Contains(">Results</a> are up", preview.Html);
        Assert.Contains($"{EmailApiFactory.SiteUrl}/competitions/{competitionId}/toplists", preview.Html);
        Assert.Contains("href=\"https://example.org/a?x=1&amp;y=2\"", preview.Html);
        Assert.Contains($"Enter now ({entry}) & win.", preview.Text);
        Assert.DoesNotContain("Mounted Games</div>", preview.Html);
        Assert.DoesNotContain("<b>", preview.Html);

        foreach (var (page, path) in new[] { (EmailPage.Competition, ""), (EmailPage.Timetable, "/timetable") })
        {
            var p = await PreviewOkAsync(admin, Content(CustomEmailAudience.Trainers, new EmailBlockDto(EmailBlockType.Text, Text: "See it", Links: [new EmailLinkDto("it", CompetitionId: competitionId, Page: page)])));
            Assert.Contains($"href=\"{EmailApiFactory.SiteUrl}/competitions/{competitionId}{path}\"", p.Html);
        }
    }

    [Fact]
    public async Task BadLinksAreRefused()
    {
        var admin = await AdminAsync();
        EmailBlockDto With(params EmailLinkDto[] links) => new(EmailBlockType.Text, Text: "Hello there", Links: links);
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: With(new EmailLinkDto("Hello", Url: "http://example.org")))), p => p.Contains("https://"));
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: With(new EmailLinkDto("Hello", Url: "javascript:alert(1)")))), p => p.Contains("https://"));
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: With(new EmailLinkDto("missing", Url: "https://example.org")))), p => p.Contains("aren't in the message"));
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: With(new EmailLinkDto("  ", Url: "https://example.org")))), p => p.Contains("words to link"));
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: With(new EmailLinkDto("Hello")))), p => p.Contains("links to"));
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: With(new EmailLinkDto("Hello", CompetitionId: 999999, Page: EmailPage.Entry)))), p => p.Contains("event and page"));
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: With(new EmailLinkDto("Hello", CompetitionId: 1)))), p => p.Contains("event and page"));
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: With(new EmailLinkDto("Hello", CompetitionId: 1, Page: (EmailPage)9)))), p => p.Contains("event and page"));
        var many = Enumerable.Range(0, CustomEmailService.MaxLinksPerText + 1).Select(_ => new EmailLinkDto("Hello", Url: "https://example.org")).ToArray();
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: With(many))), p => p.Contains("links or fewer"));
    }

    [Fact]
    public async Task APictureCanBeTheWholeEmail_AndLinkAnywhere()
    {
        var admin = await AdminAsync();
        var imageId = await UploadAsync(admin);
        var competitionId = await _f.SeedCompetitionAsync(name: "Poster Show");
        var plain = await PreviewOkAsync(admin, Content(CustomEmailAudience.Trainers, new EmailBlockDto(EmailBlockType.Picture, ImageId: imageId, Alt: "Poster")));
        Assert.Contains("<img ", plain.Html);
        Assert.DoesNotContain("<a href=\"https://", plain.Html.Split("<img ")[0]);
        var site = await PreviewOkAsync(admin, Content(CustomEmailAudience.Trainers, new EmailBlockDto(EmailBlockType.Picture, ImageId: imageId, CompetitionId: competitionId, Page: EmailPage.Entry)));
        Assert.Contains($"<a href=\"{EmailApiFactory.SiteUrl}/competitions/{competitionId}/enter\"><img ", site.Html);
        Assert.Contains($"{EmailApiFactory.SiteUrl}/competitions/{competitionId}/enter", site.Text);
        var web = await PreviewOkAsync(admin, Content(CustomEmailAudience.Trainers, new EmailBlockDto(EmailBlockType.Picture, ImageId: imageId, Url: "https://example.org/poster")));
        Assert.Contains("<a href=\"https://example.org/poster\"><img ", web.Html);
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: new EmailBlockDto(EmailBlockType.Picture, ImageId: imageId, Url: "http://example.org"))), p => p.Contains("https://"));
    }

    [Fact]
    public async Task TheFooterCanHaveItsOwnTextAndPicture_AndTheUnsubscribeLinkStaysForTheNewsList()
    {
        var admin = await AdminAsync();
        var imageId = await UploadAsync(admin);
        var footer = new EmailBlockDto(EmailBlockType.Footer, Text: "From the <team> at the club.", ImageId: imageId, Alt: "Club logo");
        var news = await PreviewOkAsync(admin, Content(CustomEmailAudience.News, Text("Hi"), footer));
        Assert.Contains("From the &lt;team&gt; at the club. <a href=\"", news.Html);
        Assert.Contains("/unsubscribe?token=preview", news.Html);
        Assert.Contains($"/api/email-images/{imageId:D}\" alt=\"Club logo\"", news.Html);
        Assert.DoesNotContain("asked to hear about new competitions", news.Html);
        Assert.Contains("Unsubscribe:", news.Text);

        var admins = await PreviewOkAsync(admin, Content(CustomEmailAudience.Admins, Text("Hi"), footer));
        Assert.Contains("From the &lt;team&gt; at the club.", admins.Html);
        Assert.DoesNotContain("nsubscribe", admins.Html + admins.Text);

        // A footer with only a picture keeps the usual line.
        var pictureOnly = await PreviewOkAsync(admin, Content(CustomEmailAudience.Trainers, Text("Hi"), new EmailBlockDto(EmailBlockType.Footer, ImageId: imageId)));
        Assert.Contains("you run or help run competitions", pictureOnly.Html);
        Assert.Contains("<img ", pictureOnly.Html);
    }

    [Fact]
    public async Task BadFootersAreRefused()
    {
        var admin = await AdminAsync();
        var imageId = await UploadAsync(admin);
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: [Text("Hi"), new EmailBlockDto(EmailBlockType.Footer, Text: new string('f', 1001))])), p => p.Contains("footer"));
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: [Text("Hi"), new EmailBlockDto(EmailBlockType.Footer, Text: "bad \u0001")])), p => p.Contains("footer"));
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: [Text("Hi"), new EmailBlockDto(EmailBlockType.Footer, ImageId: Guid.NewGuid())])), p => p.Contains("footer picture"));
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: [Text("Hi"), new EmailBlockDto(EmailBlockType.Footer, ImageId: imageId, Alt: new string('a', 201))])), p => p.Contains("description"));
        Assert.Contains(await PreviewProblemsAsync(admin, Content(blocks: [Text("Hi"), new EmailBlockDto(EmailBlockType.Footer), new EmailBlockDto(EmailBlockType.Footer)])), p => p.Contains("one footer"));
    }

    [Fact]
    public async Task AdminsAreTheirOwnAudience_AndASentEmailKeepsItsLinksAndFooter()
    {
        var admin = await AdminAsync();
        var labels = (await (await admin.GetAsync("/api/admin/custom-emails/audiences")).ReadAsync<List<CustomEmailAudienceDto>>()).Select(a => a.Label);
        Assert.Contains("Admins", labels);
        Assert.True(await CountAsync(admin, CustomEmailAudience.Admins) <= await CountAsync(admin, CustomEmailAudience.OrganisersAndAdmins));

        var imageId = await UploadAsync(admin);
        var organiser = await MailableOrganiserAsync();
        var blocks = new[]
        {
            new EmailBlockDto(EmailBlockType.Text, Text: "Read the rules please", Links: [new EmailLinkDto("rules", Url: "https://example.org/rules")]),
            new EmailBlockDto(EmailBlockType.Footer, Text: "Sent by the club", ImageId: imageId),
        };
        var started = await StartAsync(admin, Content(CustomEmailAudience.Trainers, blocks));
        await FinishAsync(admin, started.Id);
        var message = SentTo([organiser]).Single();
        Assert.Contains("href=\"https://example.org/rules\"", message.Html);
        Assert.Contains("Sent by the club", message.Html);
        var detail = await (await admin.GetAsync($"/api/admin/custom-emails/{started.Id}")).ReadAsync<CustomEmailDetailDto>();
        Assert.Equal("rules", detail.Blocks[0].Links![0].Words);
        Assert.Equal(EmailBlockType.Footer, detail.Blocks[1].Type);
    }
}

/// <summary>With sending switched off a send can't be started, and a test just reports that nothing went.</summary>
public class CustomEmailEmailOffTests : IClassFixture<EmailOffApiFactory>
{
    private readonly EmailOffApiFactory _f;
    public CustomEmailEmailOffTests(EmailOffApiFactory f) => _f = f;

    [Fact]
    public async Task NothingCanBeSentWhileSendingIsOff()
    {
        var admin = await _f.AdminAsync();
        await _f.InDbAsync(async db =>
        {
            db.EmailOptIns.Add(new EmailOptIn { Email = "someone@example.org", WordingVersion = "w", Source = "s", UnsubscribeTokenHash = Guid.NewGuid().ToString("N") });
            await db.SaveChangesAsync();
        });
        var blocks = new[] { new EmailBlockDto(EmailBlockType.Text, Text: "Hi") };

        var start = await admin.PostAsJsonAsync("/api/admin/custom-emails", new SendCustomEmailRequest("s", CustomEmailAudience.News, blocks, true, 1));
        Assert.Equal(HttpStatusCode.Conflict, start.StatusCode);
        Assert.Contains("switched off", await start.Content.ReadAsStringAsync());

        var test = await (await admin.PostAsJsonAsync("/api/admin/custom-emails/test", new CustomEmailContentRequest("s", CustomEmailAudience.News, blocks))).ReadAsync<CustomEmailTestDto>();
        Assert.Equal(EmailDeliveryStatus.NotSent, test.Status);
        Assert.Empty(_f.Sent);
    }
}

/// <summary>One recipient per call, however many are due: the time budget is spent after the first.</summary>
public class CustomEmailBudgetTests : IClassFixture<CustomEmailBudgetTests.TightBudgetFactory>
{
    public sealed class TightBudgetFactory : EmailApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("Email:CustomBatchSeconds", "0");
        }
    }

    private readonly TightBudgetFactory _f;
    public CustomEmailBudgetTests(TightBudgetFactory f) => _f = f;

    [Fact]
    public async Task ABatchThatRunsOutOfTimeHandsTheRestBack_ButAlwaysMakesProgress()
    {
        var admin = await _f.AdminAsync();
        var people = Enumerable.Range(0, 3).Select(i => $"budget{i}-{Guid.NewGuid():N}@example.org").ToArray();
        await _f.InDbAsync(async db =>
        {
            foreach (var a in people)
                db.EmailOptIns.Add(new EmailOptIn { Email = a, WordingVersion = "w", Source = "s", UnsubscribeTokenHash = Guid.NewGuid().ToString("N") });
            await db.SaveChangesAsync();
        });
        var blocks = new[] { new EmailBlockDto(EmailBlockType.Text, Text: "Hi") };
        var count = (await (await admin.GetAsync("/api/admin/custom-emails/audiences")).ReadAsync<List<CustomEmailAudienceDto>>()).Single(a => a.Audience == CustomEmailAudience.News).Recipients;
        var started = await (await admin.PostAsJsonAsync("/api/admin/custom-emails", new SendCustomEmailRequest("Budget", CustomEmailAudience.News, blocks, true, count))).ReadAsync<CustomEmailDto>();

        var first = await (await admin.PostAsync($"/api/admin/custom-emails/{started.Id}/send-batch", null)).ReadAsync<CustomEmailDto>();
        Assert.Equal((1, count - 1), (first.Sent, first.Remaining));
        CustomEmailDto last = first;
        for (var i = 0; i < count && last.Remaining > 0; i++)
            last = await (await admin.PostAsync($"/api/admin/custom-emails/{started.Id}/send-batch", null)).ReadAsync<CustomEmailDto>();
        Assert.Equal((CustomEmailStatus.Done, count), (last.Status, last.Sent));
    }
}

/// <summary>The anonymous picture endpoint is limited per address like the other public reads.</summary>
public class CustomEmailImageRateLimitTests : IClassFixture<LowPublicLimitFactory>
{
    private readonly LowPublicLimitFactory _f;
    public CustomEmailImageRateLimitTests(LowPublicLimitFactory f) => _f = f;

    [Fact]
    public async Task PicturesAreLimitedPerAddress()
    {
        var admin = await _f.AdminAsync();
        var upload = new ByteArrayContent([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
        upload.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        var id = (await (await admin.PostAsync("/api/admin/custom-email-images", upload)).ReadAsync<CustomEmailImageDto>()).Id;
        HttpResponseMessage last = null!;
        for (var i = 0; i < 4; i++)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, $"/api/email-images/{id}");
            request.Headers.Add("X-Test-Ip", "198.51.100.9");
            last = await _f.CreateClient().SendAsync(request);
        }
        Assert.Equal(HttpStatusCode.TooManyRequests, last.StatusCode);
    }
}
