using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Email;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Signups;

/// <summary>The entry confirmation: sent once, to the adult, and never allowed to break the sign-up.</summary>
public class EntryEmailTests : IClassFixture<EmailApiFactory>
{
    private readonly EmailApiFactory _f;
    public EntryEmailTests(EmailApiFactory f) => _f = f;

    private static string Url(CompetitionSection s) => $"/api/competitions/{s.CompetitionId}/sections/{s.Id}/signups";

    private static CreateSectionSignupRequest Entry(string? email, string name = "Alice Rider", string? requestId = null,
        bool optIn = false, string? version = null)
        => new(name, "Cheshire PC", "07700 900123", null, false,
            AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion,
            ContactEmail: email, EmailOptIn: optIn,
            EmailOptInVersion: optIn ? version ?? EmailOptInWording.Version : null, RequestId: requestId);

    private string NewEmail() => $"parent.{Guid.NewGuid():N}@Example.org";

    private async Task<(CompetitionSection Section, string Name)> PaidSectionAsync(string? payment = "Bank: 12-34-56 / 12345678, ref ALICE")
    {
        var section = await _f.NewSectionAsync(priceMinor: 1500);
        await _f.InDbAsync(async db =>
        {
            var c = await db.Competitions.SingleAsync(x => x.Id == section.CompetitionId);
            c.PaymentDestination = payment;
            c.Location = "Tatton Park, Knutsford";
            await db.SaveChangesAsync();
        });
        var name = await _f.InDbAsync(db => db.Competitions.Where(x => x.Id == section.CompetitionId).Select(x => x.Name).SingleAsync());
        return (section, name);
    }

    private async Task<int> SentCountAsync(string to)
    {
        await Task.Yield();
        return _f.Sent.Count(m => m.To == to);
    }

    // ---- the confirmation itself ----

    [Fact]
    public async Task EmailGiven_SendsOneConfirmationToThatAddress_AndRecordsIt()
    {
        var (section, compName) = await PaidSectionAsync();
        var email = NewEmail();

        var resp = await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry(email));

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var dto = await resp.ReadAsync<SectionSignupDto>();
        Assert.Equal(EmailDeliveryStatus.Sent, dto.ConfirmationEmailStatus);
        Assert.NotNull(dto.ConfirmationEmailAt);
        var msg = Assert.Single(_f.Sent, m => m.To == email.ToLowerInvariant());
        Assert.Equal("https://api.resend.com/emails", msg.Url);
        Assert.Equal(EmailApiFactory.ApiKey, msg.Bearer);
        Assert.Equal($"signup-confirmation-{dto.Id}", msg.IdempotencyKey);
        Assert.Contains(compName, msg.Subject);
        Assert.Contains(compName, msg.Text);
        Assert.Contains("U12 test", msg.Text);
        Assert.Contains("£15.00", msg.Text);
        Assert.Contains("Tatton Park, Knutsford", msg.Text);
        Assert.Contains("Bank: 12-34-56 / 12345678, ref ALICE", msg.Text);
        Assert.Contains($"{EmailApiFactory.SiteUrl}/competitions/{section.CompetitionId}", msg.Text);
        var row = await _f.InDbAsync(db => db.SectionSignups.SingleAsync(s => s.Id == dto.Id));
        Assert.Equal((EmailDeliveryStatus.Sent, email.ToLowerInvariant()), (row.ConfirmationEmailStatus, row.ContactEmail));
        Assert.NotNull(row.ConfirmationEmailAt);
    }

    [Fact]
    public async Task PaidEntry_NeverSaysPaymentWasTaken()
    {
        var (section, _) = await PaidSectionAsync();
        var email = NewEmail();
        await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry(email));

        var text = _f.Sent.Single(m => m.To == email.ToLowerInvariant()).Text;
        Assert.Contains("haven't paid yet", text);
        Assert.Contains("no payment has been taken", text);
        Assert.DoesNotContain("receipt", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("card", text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task FreeEntry_SaysThereIsNothingToPay()
    {
        var section = await _f.NewSectionAsync(priceMinor: 0);
        var email = NewEmail();
        await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry(email));

        var msg = _f.Sent.Single(m => m.To == email.ToLowerInvariant());
        Assert.Contains("nothing to pay", msg.Text);
        Assert.StartsWith("You're entered in", msg.Subject);
    }

    [Fact]
    public async Task NoEmailGiven_SendsNothing_AndIsNotRequested()
    {
        var section = await _f.NewSectionAsync(priceMinor: 500);
        var before = _f.Sent.Count;

        var resp = await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry(null));
        var blank = await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry("   "));

        var dto = await resp.ReadAsync<SectionSignupDto>();
        Assert.Equal(EmailDeliveryStatus.NotRequested, dto.ConfirmationEmailStatus);
        Assert.Null(dto.ConfirmationEmailAt);
        Assert.Equal(HttpStatusCode.OK, blank.StatusCode);
        Assert.Equal(before, _f.Sent.Count);
    }

    [Fact]
    public async Task ProviderErrorOrTimeout_StillSavesTheSignup_AndRecordsFailure()
    {
        var section = await _f.NewSectionAsync(priceMinor: 500);
        var trainer = await _f.TrainerAsync();
        try
        {
            _f.Fail = () => new HttpResponseMessage(HttpStatusCode.InternalServerError);
            var refused = await trainer.PostAsJsonAsync(Url(section), Entry(NewEmail(), "Refused"));
            _f.Fail = () => throw new TaskCanceledException("simulated timeout");
            var timedOut = await trainer.PostAsJsonAsync(Url(section), Entry(NewEmail(), "Timed out"));
            _f.Fail = () => throw new HttpRequestException("simulated network failure");
            var down = await trainer.PostAsJsonAsync(Url(section), Entry(NewEmail(), "Down"));

            foreach (var r in new[] { refused, timedOut, down })
            {
                Assert.Equal(HttpStatusCode.OK, r.StatusCode);
                var dto = await r.ReadAsync<SectionSignupDto>();
                Assert.Equal(EmailDeliveryStatus.Failed, dto.ConfirmationEmailStatus);
                Assert.True(await _f.InDbAsync(db => db.SectionSignups.AnyAsync(s => s.Id == dto.Id)));
            }
        }
        finally { _f.Fail = null; }
    }

    [Fact]
    public async Task Retry_WithTheSameRequestId_ReturnsTheSameEntry_AndSendsNothingMore()
    {
        var section = await _f.NewSectionAsync(priceMinor: 500);
        var email = NewEmail();
        var (client, _) = await _f.SignupAsync();
        var requestId = Guid.NewGuid().ToString("N");

        var first = await (await client.PostAsJsonAsync(Url(section), Entry(email, requestId: requestId))).ReadAsync<SectionSignupDto>();
        var second = await (await client.PostAsJsonAsync(Url(section), Entry(email, requestId: requestId))).ReadAsync<SectionSignupDto>();

        Assert.Equal(first.Id, second.Id);
        Assert.Equal(EmailDeliveryStatus.Sent, second.ConfirmationEmailStatus);
        Assert.Equal(1, await SentCountAsync(email.ToLowerInvariant()));
        Assert.Equal(1, await _f.InDbAsync(db => db.SectionSignups.CountAsync(s => s.CompetitionSectionId == section.Id)));
    }

    [Fact]
    public async Task Retry_StillWorksAfterEntriesClose()
    {
        var section = await _f.NewSectionAsync(priceMinor: 500);
        var (client, _) = await _f.SignupAsync();
        var requestId = Guid.NewGuid().ToString("N");
        var first = await (await client.PostAsJsonAsync(Url(section), Entry(NewEmail(), requestId: requestId))).ReadAsync<SectionSignupDto>();
        await _f.InDbAsync(async db =>
        {
            (await db.Competitions.SingleAsync(c => c.Id == section.CompetitionId)).SignupsLocked = true;
            await db.SaveChangesAsync();
        });

        var again = await client.PostAsJsonAsync(Url(section), Entry(NewEmail(), requestId: requestId));

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(first.Id, (await again.ReadAsync<SectionSignupDto>()).Id);
    }

    [Fact]
    public async Task SameRequestId_FromAnotherPerson_IsAnotherEntry()
    {
        var section = await _f.NewSectionAsync(priceMinor: 500);
        var requestId = Guid.NewGuid().ToString("N");
        var (a, _) = await _f.SignupAsync();
        var (b, _) = await _f.SignupAsync();

        var one = await (await a.PostAsJsonAsync(Url(section), Entry(NewEmail(), requestId: requestId))).ReadAsync<SectionSignupDto>();
        var two = await (await b.PostAsJsonAsync(Url(section), Entry(NewEmail(), requestId: requestId))).ReadAsync<SectionSignupDto>();

        Assert.NotEqual(one.Id, two.Id);
    }

    // ---- validation ----

    [Theory]
    [InlineData("not-an-email")]
    [InlineData("two@@example.org")]
    [InlineData("a b@example.org")]
    [InlineData("Alice <alice@example.org>")]
    [InlineData("alice@example")]
    [InlineData("alice@.example.org")]
    [InlineData("a@b.org, c@d.org")]
    public async Task BadEmail_Gets400_AndNothingIsSaved(string email)
    {
        var section = await _f.NewSectionAsync();
        var before = _f.Sent.Count;

        var resp = await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry(email));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.False(await _f.InDbAsync(db => db.SectionSignups.AnyAsync(s => s.CompetitionSectionId == section.Id)));
        Assert.Equal(before, _f.Sent.Count);
    }

    [Fact]
    public async Task OverlongEmail_Gets400()
    {
        var section = await _f.NewSectionAsync();

        var resp = await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry(new string('a', 250) + "@example.org"));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task EmailIsTrimmedAndLowerCased()
    {
        var section = await _f.NewSectionAsync();

        var dto = await (await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry("  Mixed.Case@Example.ORG "))).ReadAsync<SectionSignupDto>();

        Assert.Equal("mixed.case@example.org", dto.ContactEmail);
    }

    [Fact]
    public async Task ThePhoneField_IsStillFreeText()
    {
        var section = await _f.NewSectionAsync();

        var dto = await (await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry(null))).ReadAsync<SectionSignupDto>();

        Assert.Equal("07700 900123", dto.ContactInfo);
    }

    // ---- privacy ----

    [Fact]
    public async Task EmailsAreOnlyVisibleToTheCompetitionsStaff_AndOptInStateNotAtAll()
    {
        var section = await _f.NewSectionAsync(priceMinor: 500);
        var trainerId = await _f.TrainerIdAsync();
        await _f.InDbAsync(async db =>
        {
            (await db.Competitions.SingleAsync(c => c.Id == section.CompetitionId)).CreatedByUserId = trainerId;
            await db.SaveChangesAsync();
        });
        var email = NewEmail();
        var (entrant, _) = await _f.SignupAsync();
        await entrant.PostAsJsonAsync(Url(section), Entry(email, optIn: true));
        var listUrl = $"/api/competitions/{section.CompetitionId}/signups";

        // Public pages never carry it.
        var anon = _f.CreateClient();
        foreach (var path in new[] { $"/api/competitions/{section.CompetitionId}", "/api/competitions", $"/api/competitions/{section.CompetitionId}/sections" })
        {
            var body = await (await anon.GetAsync(path)).Content.ReadAsStringAsync();
            Assert.DoesNotContain(email.ToLowerInvariant(), body, StringComparison.OrdinalIgnoreCase);
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync(listUrl)).StatusCode);

        // The owner sees the address and whether the confirmation went, but nothing about opt-in.
        var ownerBody = await (await (await _f.TrainerAsync()).GetAsync(listUrl)).Content.ReadAsStringAsync();
        Assert.Contains(email.ToLowerInvariant(), ownerBody);
        Assert.Contains("confirmationEmailStatus", ownerBody);
        Assert.DoesNotContain("optin", ownerBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("unsubscribe", ownerBody, StringComparison.OrdinalIgnoreCase);

        // A different trainer is turned away.
        var (stranger, _) = await _f.ApprovedTrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync(listUrl)).StatusCode);
    }

    [Fact]
    public async Task Logs_NeverHoldTheFullAddress_TheBodyOrTheKey()
    {
        var (section, _) = await PaidSectionAsync();
        var email = $"logcheck.{Guid.NewGuid():N}@example.org";
        var trainer = await _f.TrainerAsync();
        await trainer.PostAsJsonAsync(Url(section), Entry(email));
        _f.Fail = () => new HttpResponseMessage(HttpStatusCode.BadGateway)
        { Content = new StringContent($"{{\"message\":\"cannot send to {email}\"}}") };
        try { await trainer.PostAsJsonAsync(Url(section), Entry(email, "Second")); }
        finally { _f.Fail = null; }

        var logs = string.Join('\n', _f.Logs);
        Assert.DoesNotContain(email, logs, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("logcheck", logs, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(EmailApiFactory.ApiKey, logs);
        Assert.DoesNotContain("Entry fee", logs);
        Assert.DoesNotContain("12345678", logs);
        Assert.Contains("l***@e***.org", logs);
    }

    [Fact]
    public async Task DeletingTheAccount_ClearsTheStoredEmail()
    {
        var section = await _f.NewSectionAsync();
        var (client, auth) = await _f.SignupAsync();
        var dto = await (await client.PostAsJsonAsync(Url(section), Entry(NewEmail()))).ReadAsync<SectionSignupDto>();

        var del = await client.SendAsync(new HttpRequestMessage(HttpMethod.Delete, "/api/auth/me")
        { Content = JsonContent.Create(new { password = "Passw0rd!x" }) });

        Assert.True(del.IsSuccessStatusCode);
        var row = await _f.InDbAsync(db => db.SectionSignups.SingleAsync(s => s.Id == dto.Id));
        Assert.Null(row.ContactEmail);
        Assert.Null(row.UserId);
        Assert.NotNull(auth.User.Id);
    }

    // ---- opt-in ----

    [Fact]
    public async Task OptIn_IsUntickedByDefault_AndStoresNothingUntilTicked()
    {
        var section = await _f.NewSectionAsync();
        var email = NewEmail();

        var plain = new CreateSectionSignupRequest("Default Dan", null, null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, ContactEmail: email);
        Assert.False(plain.EmailOptIn);
        await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), plain);

        Assert.False(await _f.InDbAsync(db => db.EmailOptIns.AnyAsync(o => o.Email == email.ToLowerInvariant())));
        Assert.DoesNotContain("new competitions", _f.Sent.Single(m => m.To == email.ToLowerInvariant()).Text);
    }

    [Fact]
    public async Task OptIn_Ticked_StoresConsentWithProof_AndOnlyAHashOfTheToken()
    {
        var section = await _f.NewSectionAsync();
        var email = NewEmail();

        var resp = await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry(email, optIn: true));

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var row = await _f.InDbAsync(db => db.EmailOptIns.SingleAsync(o => o.Email == email.ToLowerInvariant()));
        Assert.Equal((EmailOptInWording.Version, EmailOptInWording.SignupSource), (row.WordingVersion, row.Source));
        Assert.Null(row.UnsubscribedAt);
        Assert.True(row.ConsentedAt > DateTime.UtcNow.AddMinutes(-2));
        var token = TokenFrom(_f.Sent.Single(m => m.To == email.ToLowerInvariant()).Text);
        Assert.NotEqual(token, row.UnsubscribeTokenHash);
        Assert.Equal(EmailOptInService.HashToken(token), row.UnsubscribeTokenHash);
        Assert.True(token.Length >= 40);
    }

    [Fact]
    public async Task OptIn_NeedsAnEmail_AndTheCurrentWording()
    {
        var section = await _f.NewSectionAsync();
        var trainer = await _f.TrainerAsync();

        var noEmail = await trainer.PostAsJsonAsync(Url(section), Entry(null, optIn: true));
        var stale = await trainer.PostAsJsonAsync(Url(section), Entry(NewEmail(), optIn: true, version: "old-wording"));

        Assert.Equal(HttpStatusCode.BadRequest, noEmail.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, stale.StatusCode);
        Assert.False(await _f.InDbAsync(db => db.SectionSignups.AnyAsync(s => s.CompetitionSectionId == section.Id)));
    }

    [Fact]
    public async Task OptIn_ForAnAddressAlreadyOnTheList_AddsNoSecondRow()
    {
        var section = await _f.NewSectionAsync();
        var email = NewEmail();
        var trainer = await _f.TrainerAsync();

        await trainer.PostAsJsonAsync(Url(section), Entry(email, "One", optIn: true));
        await trainer.PostAsJsonAsync(Url(section), Entry(email, "Two", optIn: true));

        Assert.Equal(1, await _f.InDbAsync(db => db.EmailOptIns.CountAsync(o => o.Email == email.ToLowerInvariant())));
        var second = _f.Sent.Where(m => m.To == email.ToLowerInvariant()).Last();
        Assert.Contains("already on our list", second.Text);
        Assert.DoesNotContain("/unsubscribe", second.Text);
    }

    // ---- unsubscribe ----

    private static string TokenFrom(string text)
    {
        const string marker = "/unsubscribe?token=";
        var start = text.IndexOf(marker, StringComparison.Ordinal);
        Assert.True(start >= 0, "the email should carry an unsubscribe link");
        var rest = text[(start + marker.Length)..];
        return new string(rest.TakeWhile(c => !char.IsWhiteSpace(c)).ToArray());
    }

    private async Task<(string Email, string Token)> OptedInAsync()
    {
        var section = await _f.NewSectionAsync();
        var email = NewEmail().ToLowerInvariant();
        await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry(email, optIn: true));
        return (email, TokenFrom(_f.Sent.Single(m => m.To == email).Text));
    }

    private Task<HttpResponseMessage> UnsubscribeAsync(string? token)
        => _f.CreateClient().PostAsJsonAsync("/api/email/unsubscribe", new { token });

    [Fact]
    public async Task Unsubscribe_Works_WithoutSignIn_AndIsIdempotent()
    {
        var (email, token) = await OptedInAsync();

        var first = await UnsubscribeAsync(token);
        var stamp = (await _f.InDbAsync(db => db.EmailOptIns.SingleAsync(o => o.Email == email))).UnsubscribedAt;
        await Task.Delay(20);
        var second = await UnsubscribeAsync(token);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.NotNull(stamp);
        Assert.Equal(stamp, (await _f.InDbAsync(db => db.EmailOptIns.SingleAsync(o => o.Email == email))).UnsubscribedAt);
    }

    [Fact]
    public async Task Unsubscribe_AnswersTheSame_ForRealUsedAndMadeUpTokens()
    {
        var (_, token) = await OptedInAsync();

        var real = await UnsubscribeAsync(token);
        var used = await UnsubscribeAsync(token);
        var bogus = await UnsubscribeAsync("this-token-was-never-issued");
        var empty = await UnsubscribeAsync("");
        var none = await UnsubscribeAsync(null);
        var huge = await UnsubscribeAsync(new string('x', 5000));

        var bodies = new List<string>();
        foreach (var r in new[] { real, used, bogus, empty, none, huge })
        {
            Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            bodies.Add(await r.Content.ReadAsStringAsync());
        }
        Assert.Single(bodies.Distinct());
    }

    [Fact]
    public async Task Unsubscribe_EndsEveryConsentForThatAddress_AndLeavesOthersAlone()
    {
        var (email, token) = await OptedInAsync();
        var (otherEmail, _) = await OptedInAsync();

        await UnsubscribeAsync(token);

        Assert.All(await _f.InDbAsync(db => db.EmailOptIns.Where(o => o.Email == email).ToListAsync()), o => Assert.NotNull(o.UnsubscribedAt));
        Assert.All(await _f.InDbAsync(db => db.EmailOptIns.Where(o => o.Email == otherEmail).ToListAsync()), o => Assert.Null(o.UnsubscribedAt));
    }

    [Fact]
    public async Task OptingInAgainAfterUnsubscribing_MakesANewActiveRecord()
    {
        var (email, token) = await OptedInAsync();
        await UnsubscribeAsync(token);
        var section = await _f.NewSectionAsync();

        await (await _f.TrainerAsync()).PostAsJsonAsync(Url(section), Entry(email, "Back again", optIn: true));

        var rows = await _f.InDbAsync(db => db.EmailOptIns.Where(o => o.Email == email).OrderBy(o => o.Id).ToListAsync());
        Assert.Equal(2, rows.Count);
        Assert.NotNull(rows[0].UnsubscribedAt);
        Assert.Null(rows[1].UnsubscribedAt);
    }

    // ---- export ----

    [Fact]
    public async Task Export_IsAdminOnly()
    {
        const string url = "/api/admin/email-opt-ins.csv";

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await _f.TrainerAsync()).GetAsync(url)).StatusCode);
        var (member, _) = await _f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await _f.AdminAsync()).GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Export_ListsActiveOptInsOnce_WithProofAndNoTokens()
    {
        var (active, _) = await OptedInAsync();
        var (gone, goneToken) = await OptedInAsync();
        await UnsubscribeAsync(goneToken);
        // A second consent for the same address must not double the row.
        await _f.InDbAsync(async db =>
        {
            db.EmailOptIns.Add(new EmailOptIn { Email = active, WordingVersion = "older", Source = "signup-form", UnsubscribeTokenHash = "dup-" + Guid.NewGuid().ToString("N") });
            await db.SaveChangesAsync();
        });

        var resp = await (await _f.AdminAsync()).GetAsync("/api/admin/email-opt-ins.csv");
        var csv = await resp.Content.ReadAsStringAsync();

        Assert.StartsWith("text/csv", resp.Content.Headers.ContentType!.ToString());
        Assert.StartsWith("Email,Consented at (UTC),Wording version,Source", csv);
        Assert.Equal(1, csv.Split("\r\n").Count(l => l.StartsWith(active + ",")));
        Assert.DoesNotContain(gone, csv);
        Assert.Contains($",{EmailOptInWording.Version},signup-form", csv);
        Assert.DoesNotContain(await _f.InDbAsync(db => db.EmailOptIns.Where(o => o.Email == active).Select(o => o.UnsubscribeTokenHash).FirstAsync()), csv);
    }

    [Fact]
    public async Task Export_DefusesSpreadsheetFormulas()
    {
        await _f.InDbAsync(async db =>
        {
            db.EmailOptIns.Add(new EmailOptIn { Email = "=cmd|calc@example.org", WordingVersion = "v,1", Source = "x", UnsubscribeTokenHash = Guid.NewGuid().ToString("N") });
            await db.SaveChangesAsync();
        });

        var csv = await (await (await _f.AdminAsync()).GetAsync("/api/admin/email-opt-ins.csv")).Content.ReadAsStringAsync();

        Assert.Contains("'=cmd|calc@example.org,", csv);
        Assert.Contains("\"v,1\"", csv);
    }

    // ---- admin status & test email ----

    [Fact]
    public async Task EmailStatus_AndTestSend_AreAdminOnly()
    {
        foreach (var client in new[] { _f.CreateClient(), await _f.TrainerAsync(), (await _f.SignupAsync("Member")).Client })
        {
            var expected = client.DefaultRequestHeaders.Authorization is null ? HttpStatusCode.Unauthorized : HttpStatusCode.Forbidden;
            Assert.Equal(expected, (await client.GetAsync("/api/admin/email-status")).StatusCode);
            Assert.Equal(expected, (await client.PostAsync("/api/admin/email-test", null)).StatusCode);
        }
    }

    [Fact]
    public async Task EmailStatus_ReportsActiveConfiguration_WithMaskedSender_AndNeverTheApiKey()
    {
        var resp = await (await _f.AdminAsync()).GetAsync("/api/admin/email-status");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        Assert.DoesNotContain(EmailApiFactory.ApiKey, body);
        Assert.DoesNotContain("entries@example.org", body);
        Assert.Contains("\"enabled\":true", body);
        Assert.Contains("\"configured\":true", body);
        Assert.Contains("\"fromMasked\":\"e***@e***.org\"", body);
    }

    [Fact]
    public async Task EmailTest_SendsToSignedInAdmin_OrExplicitAddress_AndRejectsBadAddress()
    {
        var admin = await _f.AdminAsync();

        var self = await admin.PostAsync("/api/admin/email-test", null);
        Assert.Equal(HttpStatusCode.OK, self.StatusCode);
        var selfBody = await self.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"Sent\"", selfBody);
        Assert.Contains("\"recipientMasked\":\"a***@m***.local\"", selfBody);
        var selfMsg = _f.Sent.Last(m => m.To == TestClients.AdminEmail);
        Assert.Equal("Mounted Games test email", selfMsg.Subject);
        Assert.NotNull(selfMsg.Html);
        Assert.Contains(EmailHtml.HeaderStyle, selfMsg.Html);

        var target = NewEmail();
        var explicitTo = await admin.PostAsJsonAsync("/api/admin/email-test", new { to = target });
        Assert.Equal(HttpStatusCode.OK, explicitTo.StatusCode);
        var explicitBody = await explicitTo.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"Sent\"", explicitBody);
        Assert.Contains("\"recipientMasked\":\"p***@e***.org\"", explicitBody);
        Assert.Contains(_f.Sent, m => m.To == target.ToLowerInvariant());

        var bad = await admin.PostAsJsonAsync("/api/admin/email-test", new { to = "not-an-email" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }
}

/// <summary>Sending is off unless it is set up on purpose; a missing setting must never break a sign-up.</summary>
public class EntryEmailOffTests : IClassFixture<EmailOffApiFactory>
{
    private readonly EmailOffApiFactory _f;
    public EntryEmailOffTests(EmailOffApiFactory f) => _f = f;

    [Fact]
    public async Task WithNoEmailSettings_AdminStatusAndTestSend_ReportOffAndNotSent()
    {
        var admin = await _f.AdminAsync();

        var status = await admin.GetAsync("/api/admin/email-status");
        Assert.Equal(HttpStatusCode.OK, status.StatusCode);
        var statusBody = await status.Content.ReadAsStringAsync();
        Assert.Contains("\"configured\":false", statusBody);

        var test = await admin.PostAsync("/api/admin/email-test", null);
        Assert.Equal(HttpStatusCode.OK, test.StatusCode);
        var testBody = await test.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"NotSent\"", testBody);
        Assert.Empty(_f.Sent);
    }

    [Fact]
    public async Task WithNoEmailSettings_SignupWorks_NothingIsSent_AndTheStatusSaysSo()
    {
        var section = await _f.NewSectionAsync(priceMinor: 500);
        var url = $"/api/competitions/{section.CompetitionId}/sections/{section.Id}/signups";

        var resp = await (await _f.TrainerAsync()).PostAsJsonAsync(url,
            new CreateSectionSignupRequest("Quiet Quentin", null, null, AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, ContactEmail: "Jane.Doe@example.org", EmailOptIn: true,
                EmailOptInVersion: EmailOptInWording.Version));

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var dto = await resp.ReadAsync<SectionSignupDto>();
        Assert.Equal(EmailDeliveryStatus.NotSent, dto.ConfirmationEmailStatus);
        Assert.Empty(_f.Sent);
        Assert.DoesNotContain(_f.Http.Requests, r => r.Contains("resend", StringComparison.OrdinalIgnoreCase));
        // Consent is still recorded, so the list is right whenever sending is switched on.
        var stored = "jane.doe@example.org";
        Assert.True(await _f.InDbAsync(db => db.EmailOptIns.AnyAsync(o => o.Email == stored)));
        var logs = string.Join('\n', _f.Logs);
        Assert.Contains("J***@e***.org".ToLowerInvariant(), logs.ToLowerInvariant());
        Assert.DoesNotContain("jane.doe", logs, StringComparison.OrdinalIgnoreCase);
    }
}
