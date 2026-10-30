using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Payouts;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Clubs;

/// <summary>A club's or user's payout set-up (Stripe Connect &amp; manual BACS): access, validation, masking, webhooks, and the Ready step.</summary>
public class ClubPayoutsTests : IClassFixture<ClubPayoutsTests.StripePayoutsApiFactory>
{
    public const string StripeTestSecretKey = "sk_test_stripe_step1_0123456789abcdef";
    public const string StripeTestConnectWebhookSecret = "whsec_connect_step1_0123456789abcdef";

    public class StripePayoutsApiFactory : ApiFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("Stripe:SecretKey", StripeTestSecretKey);
            builder.UseSetting("Stripe:ConnectWebhookSecret", StripeTestConnectWebhookSecret);
            builder.UseSetting("Email:SiteUrl", "https://mountedgames.example.org");
        }
    }

    private const string FullAccount = "55779911";
    private const string FullIban = "IE29AIBK93115212345678";
    private const string GoodIban = "GB82WEST12345698765432";

    private readonly StripePayoutsApiFactory _f;
    public ClubPayoutsTests(StripePayoutsApiFactory f) => _f = f;

    private static string NewClubName() => $"Payout Club {Guid.NewGuid():N}";
    private Task<int> ClubIdAsync(string name) => _f.WithDbAsync(db => db.Clubs.Where(c => c.Name == name).Select(c => c.Id).SingleAsync());
    private static string Url(int clubId, string tail = "") => $"/api/clubs/{clubId}/payouts{tail}";

    private async Task<(HttpClient Manager, int ClubId, string UserId)> ManagerWithClubAsync()
    {
        var club = NewClubName();
        var (manager, auth) = await _f.ApprovedManagerAsync(club);
        return (manager, await ClubIdAsync(club), auth.User.Id);
    }

    private static SavePayoutDetailsRequest Complete(PayoutBusinessType type = PayoutBusinessType.Club) => new(
        BusinessType: type, LegalName: "Ashdown Pony Club", AddressLine1: "1 High Street", City: "Reading", Postcode: "rg1  1ab",
        ContactEmail: "treasurer@example.org", ContactPhone: "+44 7700 900123", RegistrationNumber: "1234567",
        PersonFullName: "Ann Smith", PersonDateOfBirth: new DateOnly(1985, 3, 14),
        StatementDescriptor: "ashdown pony club", Schedule: PayoutSchedule.AfterEachEvent);

    private static SavePayoutBankRequest UkBank() => new("Ashdown Pony Club", SortCode: "20-12-34", AccountNumber: FullAccount);

    // ---- who may use it ----

    [Fact]
    public async Task Payouts_AreClosedToAnonymousUsers_ToOtherRoles_AndToAnotherClubsManager()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        var (otherManager, _, _) = await ManagerWithClubAsync();
        var (trainer, _) = await _f.ApprovedTrainerAsync();
        var (member, _) = await _f.SignupAsync("Member", NewClubName());

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync(Url(clubId))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PutAsJsonAsync(Url(clubId), Complete())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await trainer.GetAsync(Url(clubId))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(Url(clubId))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await otherManager.GetAsync(Url(clubId))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await otherManager.PutAsJsonAsync(Url(clubId), Complete())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await otherManager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await otherManager.PostAsync(Url(clubId, "/finish"), null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await manager.GetAsync(Url(clubId))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await manager.GetAsync(Url(999999))).StatusCode);

        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync(Url(clubId))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync(Url(999999))).StatusCode);
    }

    [Fact]
    public async Task Get_ForAClubWithNoSetup_IsNotStarted_AndCreatesNothing()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();

        var dto = await (await manager.GetAsync(Url(clubId))).ReadAsync<ClubPayoutsDto>();

        Assert.Equal(PayoutStatus.NotStarted, dto.Status);
        Assert.Equal("GBP", dto.Currency);
        Assert.Null(dto.Bank);
        Assert.Contains("bank", dto.Missing);
        Assert.Equal(0, await _f.WithDbAsync(db => db.ClubPayoutAccounts.CountAsync(a => a.ClubId == clubId)));
    }

    // ---- details ----

    [Fact]
    public async Task Save_StoresTidiedDetails_AndMovesToInProgress()
    {
        var (manager, clubId, userId) = await ManagerWithClubAsync();

        var dto = await (await manager.PutAsJsonAsync(Url(clubId), Complete())).ReadAsync<ClubPayoutsDto>();

        Assert.Equal(PayoutStatus.InProgress, dto.Status);
        Assert.Equal("RG1 1AB", dto.Postcode);
        Assert.Equal("ASHDOWN PONY CLUB", dto.StatementDescriptor);
        Assert.Equal(PayoutSchedule.AfterEachEvent, dto.Schedule);
        Assert.Equal(new DateOnly(1985, 3, 14), dto.PersonDateOfBirth);
        var row = await _f.WithDbAsync(db => db.ClubPayoutAccounts.AsNoTracking().SingleAsync(a => a.ClubId == clubId));
        Assert.Equal(userId, row.UpdatedByUserId);
        Assert.NotEqual(default, row.CreatedAt);
    }

    [Fact]
    public async Task Save_OnlyChangesTheFieldsSent_AndBlankClearsAnOptionalOne()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        await manager.PutAsJsonAsync(Url(clubId), Complete() with { TradingName = "Ashdown PC", VatNumber = "123456789" });

        var dto = await (await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(City: "Wokingham", TradingName: " "))).ReadAsync<ClubPayoutsDto>();

        Assert.Equal("Wokingham", dto.City);
        Assert.Equal("Ashdown Pony Club", dto.LegalName);
        Assert.Null(dto.TradingName);
        Assert.Equal("GB123456789", dto.VatNumber);
        Assert.Equal(new DateOnly(1985, 3, 14), dto.PersonDateOfBirth);

        var renamed = await (await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(PersonFullName: "Fake Responsible Person"))).ReadAsync<ClubPayoutsDto>();
        Assert.Equal(dto.PersonDateOfBirth, renamed.PersonDateOfBirth);
    }

    [Fact]
    public async Task Save_ExplicitlyClearsDateOfBirth_AndRequiresSetupToBeCompletedAgain()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        var fakeDob = new DateOnly(2000, 1, 1);
        await manager.PutAsJsonAsync(Url(clubId), Complete() with { PersonFullName = "Fake Responsible Person", PersonDateOfBirth = fakeDob });
        await manager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank());
        var ready = await manager.PostAsync(Url(clubId, "/finish"), null);
        Assert.Equal(HttpStatusCode.OK, ready.StatusCode);
        Assert.Equal(PayoutStatus.Ready, (await ready.ReadAsync<ClubPayoutsDto>()).Status);

        var response = await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(ClearPersonDateOfBirth: true));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var cleared = await response.ReadAsync<ClubPayoutsDto>();
        Assert.Null(cleared.PersonDateOfBirth);
        Assert.Equal("Fake Responsible Person", cleared.PersonFullName);
        Assert.Equal(PayoutStatus.InProgress, cleared.Status);
        Assert.Contains("personDateOfBirth", cleared.Missing);
        var stored = await (await manager.GetAsync(Url(clubId))).ReadAsync<ClubPayoutsDto>();
        Assert.Null(stored.PersonDateOfBirth);
        Assert.Equal(HttpStatusCode.BadRequest, (await manager.PostAsync(Url(clubId, "/finish"), null)).StatusCode);
    }

    [Theory]
    [InlineData("contactEmail", "not-an-email")]
    [InlineData("contactPhone", "abc")]
    [InlineData("postcode", "12345")]
    [InlineData("statementDescriptor", "ABC")]
    [InlineData("statementDescriptor", "Bad*Name here")]
    [InlineData("statementDescriptor", "12345 678")]
    [InlineData("registrationNumber", "12")]
    [InlineData("vatNumber", "xyz")]
    public async Task Save_RejectsBadValues_WithAFieldError(string field, string value)
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        var body = new Dictionary<string, string> { [field] = value };

        var response = await manager.PutAsJsonAsync(Url(clubId), body);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(json.RootElement.GetProperty("errors").TryGetProperty(field, out _));
    }

    [Fact]
    public async Task Save_RejectsTooYoungDatesOfBirth_AndLongText_AndUnknownEnums()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        var young = DateOnly.FromDateTime(DateTime.UtcNow).AddYears(-17);

        var r1 = await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(PersonDateOfBirth: young));
        var r2 = await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(PersonDateOfBirth: new DateOnly(1800, 1, 1)));
        var r3 = await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(LegalName: new string('x', 151)));
        var r4 = await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(BusinessType: (PayoutBusinessType)9, Region: (PayoutRegion)9, Schedule: (PayoutSchedule)9));

        Assert.All(new[] { r1, r2, r3, r4 }, r => Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode));
    }

    // ---- bank: validation ----

    [Theory]
    [InlineData("12345", "12345678")]
    [InlineData("12-34-5x", "12345678")]
    [InlineData("123456", "1234567")]
    [InlineData("123456", "123456789")]
    [InlineData("", "")]
    public async Task Bank_RejectsABadSortCodeOrAccountNumber_WithoutEchoingIt(string sortCode, string account)
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();

        var response = await manager.PutAsJsonAsync(Url(clubId, "/bank"), new SavePayoutBankRequest("Holder", SortCode: sortCode, AccountNumber: account));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var text = await response.Content.ReadAsStringAsync();
        if (account.Length > 0) Assert.DoesNotContain(account, text);
    }

    [Fact]
    public async Task Bank_NeedsAHolderName()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();

        var response = await manager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank() with { AccountHolder = " " });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var tooLong = await manager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank() with { AccountHolder = new string('x', 151) });
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
    }

    [Theory]
    [InlineData("IE29AIBK93115212345679")]   // fails the mod-97 check
    [InlineData("IE29AIBK9311521234567")]    // wrong length for Ireland
    [InlineData("1234567890123456")]
    [InlineData("")]
    public async Task Bank_RejectsABadIban_WithoutEchoingIt(string iban)
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(Region: PayoutRegion.Eu));

        var response = await manager.PutAsJsonAsync(Url(clubId, "/bank"), new SavePayoutBankRequest("Holder", Iban: iban));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        if (iban.Length > 0) Assert.DoesNotContain(iban, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Bank_RejectsABadBic_ButAcceptsNone()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(Region: PayoutRegion.Eu));

        var bad = await manager.PutAsJsonAsync(Url(clubId, "/bank"), new SavePayoutBankRequest("Holder", Iban: FullIban, Bic: "nope"));
        var withBic = await manager.PutAsJsonAsync(Url(clubId, "/bank"), new SavePayoutBankRequest("Holder", Iban: FullIban, Bic: "AIBKIE2D"));

        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal(HttpStatusCode.OK, withBic.StatusCode);
    }

    // ---- bank: masking ----

    [Fact]
    public async Task Bank_UkDetails_AreStoredAndReturnedMaskedOnly()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();

        var response = await manager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank());
        var text = await response.Content.ReadAsStringAsync();
        var read = await (await manager.GetAsync(Url(clubId))).Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var bank = JsonSerializer.Deserialize<ClubPayoutsDto>(read, TestClients.Json)!.Bank!;
        Assert.Equal("20-12-34", bank.SortCode);
        Assert.Equal("••••9911", bank.MaskedAccount);
        Assert.Equal("Barclays", bank.BankName);
        Assert.DoesNotContain(FullAccount, text);
        Assert.DoesNotContain(FullAccount, read);
    }

    [Fact]
    public async Task Bank_IbanDetails_KeepOnlyTheCountryAndLastFour()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(Region: PayoutRegion.Eu));

        var response = await manager.PutAsJsonAsync(Url(clubId, "/bank"), new SavePayoutBankRequest("Holder", Iban: "ie29 aibk 9311 5212 3456 78"));
        var dto = await response.ReadAsync<ClubPayoutsDto>();

        Assert.Equal("EUR", dto.Currency);
        Assert.Equal("IE", dto.Bank!.IbanCountry);
        Assert.Equal("••••5678", dto.Bank.MaskedAccount);
        Assert.Null(dto.Bank.SortCode);
        Assert.DoesNotContain(FullIban, JsonSerializer.Serialize(dto, TestClients.Json));
    }

    [Fact]
    public async Task FullNumbers_NeverReachTheDatabase_OrAnyResponse()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        var admin = await _f.AdminAsync();
        var bodies = new List<string>();

        bodies.Add(await (await manager.PutAsJsonAsync(Url(clubId), Complete())).Content.ReadAsStringAsync());
        bodies.Add(await (await manager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank())).Content.ReadAsStringAsync());
        bodies.Add(await (await manager.PostAsync(Url(clubId, "/finish"), null)).Content.ReadAsStringAsync());
        bodies.Add(await (await manager.GetAsync(Url(clubId))).Content.ReadAsStringAsync());
        bodies.Add(await (await admin.GetAsync(Url(clubId))).Content.ReadAsStringAsync());
        // Switch to an IBAN and do it again, then read the event summary too.
        await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(Region: PayoutRegion.Eu));
        bodies.Add(await (await manager.PutAsJsonAsync(Url(clubId, "/bank"), new SavePayoutBankRequest("Holder", Iban: FullIban))).Content.ReadAsStringAsync());
        bodies.Add(await (await manager.GetAsync(Url(clubId))).Content.ReadAsStringAsync());

        foreach (var body in bodies)
        {
            Assert.DoesNotContain(FullAccount, body);
            Assert.DoesNotContain(FullIban, body);
        }
        // Every column of the stored row, as text, must be free of both full numbers.
        var row = await _f.WithDbAsync(db => db.ClubPayoutAccounts.AsNoTracking().SingleAsync(a => a.ClubId == clubId));
        var dump = JsonSerializer.Serialize(row, new JsonSerializerOptions { ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles });
        Assert.DoesNotContain(FullAccount, dump);
        Assert.DoesNotContain(FullIban, dump);
        Assert.DoesNotContain(FullIban[4..], dump);
        // And the raw SQLite row itself.
        var raw = await _f.WithDbAsync(async db =>
        {
            var parts = new List<string>();
            await using var cmd = db.Database.GetDbConnection().CreateCommand();
            cmd.CommandText = "SELECT * FROM ClubPayoutAccounts WHERE ClubId = $c";
            var p = cmd.CreateParameter(); p.ParameterName = "$c"; p.Value = clubId; cmd.Parameters.Add(p);
            if (cmd.Connection!.State != System.Data.ConnectionState.Open) await cmd.Connection.OpenAsync();
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                for (var i = 0; i < reader.FieldCount; i++) parts.Add(Convert.ToString(reader.GetValue(i)) ?? "");
            return string.Join("|", parts);
        });
        Assert.DoesNotContain(FullAccount, raw);
        Assert.DoesNotContain(FullIban, raw);
        Assert.Contains("5678", raw);
    }

    [Fact]
    public async Task ChangingRegion_ClearsTheOldBankDetails()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        await manager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank());

        var dto = await (await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(Region: PayoutRegion.Eu))).ReadAsync<ClubPayoutsDto>();

        Assert.Null(dto.Bank);
        Assert.Equal("EUR", dto.Currency);
    }

    // ---- finish ----

    [Fact]
    public async Task Finish_FailsWithWhatIsMissing_ThenBecomesReady()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await manager.PostAsync(Url(clubId, "/finish"), null)).StatusCode);

        await manager.PutAsJsonAsync(Url(clubId), Complete());
        var early = await manager.PostAsync(Url(clubId, "/finish"), null);
        Assert.Equal(HttpStatusCode.BadRequest, early.StatusCode);
        Assert.Contains("bank", await early.Content.ReadAsStringAsync());

        await manager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank());
        var done = await (await manager.PostAsync(Url(clubId, "/finish"), null)).ReadAsync<ClubPayoutsDto>();

        Assert.Equal(PayoutStatus.Ready, done.Status);
        Assert.Empty(done.Missing);
        // Finishing again changes nothing.
        Assert.Equal(PayoutStatus.Ready, (await (await manager.PostAsync(Url(clubId, "/finish"), null)).ReadAsync<ClubPayoutsDto>()).Status);
    }

    [Fact]
    public async Task Finish_NeedsACharityOrCompanyNumber_ButNotForAClub()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        await manager.PutAsJsonAsync(Url(clubId), Complete(PayoutBusinessType.Charity) with { RegistrationNumber = "" });
        await manager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank());

        var charity = await manager.PostAsync(Url(clubId, "/finish"), null);
        await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(BusinessType: PayoutBusinessType.Club));
        var club = await manager.PostAsync(Url(clubId, "/finish"), null);

        Assert.Equal(HttpStatusCode.BadRequest, charity.StatusCode);
        Assert.Contains("registrationNumber", await charity.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.OK, club.StatusCode);
    }

    [Fact]
    public async Task EditingAReadyAccount_PutsItBackToInProgress_UntilFinishedAgain()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        await manager.PutAsJsonAsync(Url(clubId), Complete());
        await manager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank());
        await manager.PostAsync(Url(clubId, "/finish"), null);

        var same = await (await manager.PutAsJsonAsync(Url(clubId), Complete())).ReadAsync<ClubPayoutsDto>();
        Assert.Equal(PayoutStatus.Ready, same.Status);

        var edited = await (await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(City: "Newbury"))).ReadAsync<ClubPayoutsDto>();
        Assert.Equal(PayoutStatus.InProgress, edited.Status);

        var again = await (await manager.PostAsync(Url(clubId, "/finish"), null)).ReadAsync<ClubPayoutsDto>();
        Assert.Equal(PayoutStatus.Ready, again.Status);
    }

    [Fact]
    public async Task EuClub_FinishesWithAnIban_AndAnAdminMayRunAnyClub()
    {
        var (_, clubId, _) = await ManagerWithClubAsync();
        var admin = await _f.AdminAsync();
        await admin.PutAsJsonAsync(Url(clubId), Complete() with { Region = PayoutRegion.Eu, Postcode = "D02 X285", ContactPhone = "+353 1 234 5678" });
        await admin.PutAsJsonAsync(Url(clubId, "/bank"), new SavePayoutBankRequest("Holder", Iban: GoodIban));

        var response = await admin.PostAsync(Url(clubId, "/finish"), null);

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync(Url(clubId, "/bank"), new SavePayoutBankRequest("Holder", Iban: "GB82WEST12345698765433"))).StatusCode);
        // GB IBAN is well formed, so the details save; the account is ready.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ---- public summary ----

    [Fact]
    public async Task Competition_ShowsAPublicSummary_OnceTheOrganisersClubIsReady()
    {
        var (manager, clubId, userId) = await ManagerWithClubAsync();
        var competitionId = await _f.SeedCompetitionAsync(ownerUserId: userId);
        var anon = _f.CreateClient();

        var before = await (await anon.GetAsync($"/api/competitions/{competitionId}")).ReadAsync<CompetitionDetail>();
        Assert.NotNull(before.PayoutsTo);
        Assert.False(before.PayoutsTo!.Ready);
        Assert.Null(before.PayoutsTo.MaskedAccount);

        await manager.PutAsJsonAsync(Url(clubId), Complete());
        await manager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank());
        var midway = await anon.GetStringAsync($"/api/competitions/{competitionId}");
        Assert.DoesNotContain("9911", midway);
        await manager.PostAsync(Url(clubId, "/finish"), null);

        var raw = await anon.GetStringAsync($"/api/competitions/{competitionId}");
        var after = JsonSerializer.Deserialize<CompetitionDetail>(raw, TestClients.Json)!;
        Assert.True(after.PayoutsTo!.Ready);
        Assert.Equal("••••9911", after.PayoutsTo.MaskedAccount);
        Assert.StartsWith("Payout Club", after.PayoutsTo.ClubName);
        // No personal data or full numbers on the public page.
        Assert.DoesNotContain("Ann Smith", raw);
        Assert.DoesNotContain("1985", raw);
        Assert.DoesNotContain(FullAccount, raw);
        Assert.DoesNotContain("20-12-34", raw);
        var first = await anon.GetStringAsync($"/api/competitions/{competitionId}/first-view");
        Assert.Contains("••••9911", JsonDocument.Parse(first).RootElement.GetProperty("payoutsTo").GetProperty("maskedAccount").GetString());
    }

    [Fact]
    public async Task ClubSummary_IsPublic_AndHoldsNoPersonalData()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        var anon = _f.CreateClient();
        await manager.PutAsJsonAsync(Url(clubId), Complete());
        await manager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank());

        var notReady = await (await anon.GetAsync(Url(clubId, "/summary"))).ReadAsync<PayoutsToDto>();
        await manager.PostAsync(Url(clubId, "/finish"), null);
        var raw = await anon.GetStringAsync(Url(clubId, "/summary"));
        var ready = JsonSerializer.Deserialize<PayoutsToDto>(raw, TestClients.Json)!;

        Assert.False(notReady.Ready);
        Assert.Null(notReady.MaskedAccount);
        Assert.True(ready.Ready);
        Assert.Equal("••••9911", ready.MaskedAccount);
        Assert.DoesNotContain("Ann Smith", raw);
        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync(Url(999999, "/summary"))).StatusCode);
    }

    [Fact]
    public async Task Competition_WithoutAnOrganiserClub_HasNoSummary()
    {
        var none = await _f.SeedCompetitionAsync();
        var admin = await _f.AdminAsync();
        var adminOwned = await _f.SeedCompetitionAsync(ownerUserId: (await _f.WithDbAsync(db => db.Users.Where(u => u.ClubId == null).Select(u => u.Id).FirstAsync())));

        Assert.Null((await (await _f.CreateClient().GetAsync($"/api/competitions/{none}")).ReadAsync<CompetitionDetail>()).PayoutsTo);
        Assert.Null((await (await admin.GetAsync($"/api/competitions/{adminOwned}")).ReadAsync<CompetitionDetail>()).PayoutsTo);
    }

    [Fact]
    public async Task Competition_PinsCreatorClubAtCreation_AndPreservesItWhenOrganiserChangesClubOrUpdatesDecForm()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        var (trainer, trainerAuth) = await _f.ApprovedTrainerAsync();
        var trainerId = trainerAuth.User.Id;
        await _f.WithDbAsync(async db =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == trainerId);
            user.ClubId = clubId;
            await db.SaveChangesAsync();
        });
        await manager.PutAsJsonAsync(Url(clubId), Complete());
        await manager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank());
        await manager.PostAsync(Url(clubId, "/finish"), null);

        var created = await trainer.PostAsJsonAsync("/api/competitions", new CreateCompetitionRequest(
            $"Pinned Payout {Guid.NewGuid():N}", null, null, null, null, null, null, DateTime.UtcNow.AddDays(14), null));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var compId = (await created.ReadAsync<CompetitionSummary>()).Id;

        // Even if the organiser later moves to another club and updates the dec form config, payouts stay pinned to the original club.
        var otherClubId = await _f.SeedClubAsync("Different Club");
        await _f.WithDbAsync(async db =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == trainerId);
            user.ClubId = otherClubId;
            await db.SaveChangesAsync();
        });

        var admin = await _f.AdminAsync();
        var putDecForm = await admin.PutAsJsonAsync($"/api/competitions/{compId}/dec-form-config",
            MountedGames.Api.Services.DecForms.DecFormConfig.Basic);
        Assert.Equal(HttpStatusCode.OK, putDecForm.StatusCode);

        var detail = await (await _f.CreateClient().GetAsync($"/api/competitions/{compId}")).ReadAsync<CompetitionDetail>();
        Assert.NotNull(detail.PayoutsTo);
        Assert.StartsWith("Payout Club", detail.PayoutsTo!.ClubName);
        Assert.Equal("••••9911", detail.PayoutsTo.MaskedAccount);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DecFormResetAndSave_CannotRedirectTheServerSelectedPayoutClub(bool pinned)
    {
        var (trainer, auth) = await _f.ApprovedTrainerAsync();
        var ownerClub = auth.User.ClubId!.Value;
        var otherClub = await _f.SeedClubAsync($"Fake unrelated club {Guid.NewGuid():N}");
        var compId = await _f.SeedCompetitionAsync(ownerUserId: auth.User.Id);
        if (pinned) await _f.InDbAsync(async db =>
        {
            var comp = await db.Competitions.SingleAsync(c => c.Id == compId);
            comp.DecFormConfigJson = (MountedGames.Api.Services.DecForms.DecFormConfig.Basic with { PayoutClubId = ownerClub }).ToJson();
            await db.SaveChangesAsync();
        });
        var url = $"/api/competitions/{compId}/dec-form-config";
        (await trainer.DeleteAsync(url)).EnsureSuccessStatusCode();
        (await trainer.PutAsJsonAsync(url, MountedGames.Api.Services.DecForms.DecFormConfig.Basic with { PayoutClubId = otherClub })).EnsureSuccessStatusCode();
        var stored = await _f.WithDbAsync(db => db.Competitions.Where(c => c.Id == compId).Select(c => c.DecFormConfigJson).SingleAsync());
        Assert.Equal(ownerClub, MountedGames.Api.Services.DecForms.DecFormConfig.Parse(stored)!.PayoutClubId);
        var reset = await trainer.DeleteAsync(url);
        reset.EnsureSuccessStatusCode();
        var dto = await reset.ReadAsync<MountedGames.Api.Controllers.DecFormConfigDto>();
        Assert.True(dto.IsStandard);
        Assert.Equal(ownerClub, dto.Config.PayoutClubId);
    }

    [Fact]
    public async Task IsClubManagerAsync_RechecksDatabaseRoleWhenTokenHasStaleManagerClaim()
    {
        var (_, clubId, userId) = await ManagerWithClubAsync();
        var claims = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
        [
            new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, userId),
            new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Role, MountedGames.Api.Auth.Roles.Manager),
        ], "test"));

        Assert.True(await _f.WithDbAsync(db => MountedGames.Api.Services.ClubAccess.IsClubManagerAsync(db, claims, clubId)));

        await _f.WithDbAsync(async db =>
        {
            var roles = await db.UserRoles.Where(ur => ur.UserId == userId).ToListAsync();
            db.UserRoles.RemoveRange(roles);
            await db.SaveChangesAsync();
        });

        Assert.False(await _f.WithDbAsync(db => MountedGames.Api.Services.ClubAccess.IsClubManagerAsync(db, claims, clubId)));
        Assert.False(await _f.WithDbAsync(db => MountedGames.Api.Services.ClubAccess.SharesClubRosterAsync(db, claims, clubId)));
    }

    // ---- rules ----

    [Theory]
    [InlineData("GB82WEST12345698765432", true)]
    [InlineData("gb82 west 1234 5698 7654 32", true)]
    [InlineData("DE89370400440532013000", true)]
    [InlineData("GB82WEST12345698765433", false)]
    [InlineData("DE8937040044053201300", false)]
    [InlineData("12", false)]
    public void Iban_FormatAndModNinetySevenCheck(string input, bool valid) =>
        Assert.Equal(valid, PayoutRules.NormaliseIban(input) is not null);

    [Fact]
    public void Rules_CoverTheRemainingFormats()
    {
        Assert.Equal("123456", PayoutRules.NormaliseSortCode("12 34 56"));
        Assert.Equal("12-34-56", PayoutRules.FormatSortCode("123456"));
        Assert.Null(PayoutRules.BankNameFor("999999"));
        Assert.Equal("EUR", PayoutRules.CurrencyFor(PayoutRegion.Eu));
        Assert.Equal("GB123456789012", PayoutRules.NormaliseVat("123 456 789 012", PayoutRegion.Uk));
        Assert.Equal("IE1234567A", PayoutRules.NormaliseVat("ie1234567a", PayoutRegion.Eu));
        Assert.Null(PayoutRules.NormaliseVat("12", PayoutRegion.Eu));
        Assert.Null(PayoutRules.ValidatePostcode("D02 X285", PayoutRegion.Eu));
        Assert.NotNull(PayoutRules.ValidatePostcode("!!", PayoutRegion.Eu));
        Assert.Equal(string.Empty, PayoutRules.Masked(null));
        Assert.True(PayoutRules.IsValidBic("AIBKIE2DXXX"));
        Assert.Null(PayoutRules.ValidateDateOfBirth(new DateOnly(1990, 1, 1), new DateOnly(2026, 10, 23)));
        foreach (var prefix in new[] { "07", "09", "11", "20", "30", "40", "60", "77", "83" })
            Assert.NotNull(PayoutRules.BankNameFor(prefix + "0000"));
    }

    [Fact]
    public async Task SqliteSchema_IsCreatedAgain_OnAnExistingDatabase()
    {
        await _f.WithDbAsync(async db =>
        {
            await db.Database.ExecuteSqlRawAsync("DROP TABLE ClubPayoutAccounts");
            await db.Database.ExecuteSqlRawAsync("DROP TABLE UserPayoutAccounts");
            await db.Database.ExecuteSqlRawAsync("DROP TABLE StripeWebhookEvents");
        });

        await DbInitializer_RunAsync();

        Assert.Equal(0, await _f.WithDbAsync(db => db.ClubPayoutAccounts.CountAsync()));
        Assert.Equal(0, await _f.WithDbAsync(db => db.UserPayoutAccounts.CountAsync()));
        Assert.Equal(0, await _f.WithDbAsync(db => db.StripeWebhookEvents.CountAsync()));
    }

    // ---- Step 1: expanded club access, personal /api/me/payouts, Stripe Connect & webhooks ----

    [Fact]
    public async Task ClubPayouts_AreOpenToApprovedClubTrainer_ButNotToCollaboratorsOrOrganisersWhoMovedClub()
    {
        var clubName = NewClubName();
        var (manager, _) = await _f.ApprovedManagerAsync(clubName);
        var clubId = await ClubIdAsync(clubName);

        // Approved Trainer belonging to the same club can view and update payouts.
        var (_, pendingTrainer) = await _f.SignupAsync("Trainer", clubName);
        var admin = await _f.AdminAsync();
        (await admin.PostAsync($"/api/admin/trainer-requests/{pendingTrainer.User.Id}/approve", null)).EnsureSuccessStatusCode();
        var sameClubTrainerAuth = await _f.LoginAsync(pendingTrainer.User.Email, "Passw0rd!x");
        var sameClubTrainer = _f.WithToken(sameClubTrainerAuth.Token);

        Assert.Equal(HttpStatusCode.OK, (await sameClubTrainer.GetAsync(Url(clubId))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await sameClubTrainer.PutAsJsonAsync(Url(clubId), Complete())).StatusCode);

        // A collaborator on a competition pinned to clubId must not be able to change where the club's money goes.
        var (collabClient, collabAuth) = await _f.SignupAsync("Member", NewClubName());
        var compId = await _f.SeedCompetitionAsync(ownerUserId: sameClubTrainerAuth.User.Id);
        await _f.InDbAsync(async db =>
        {
            var comp = await db.Competitions.SingleAsync(c => c.Id == compId);
            comp.DecFormConfigJson = (MountedGames.Api.Services.DecForms.DecFormConfig.Basic with { PayoutClubId = clubId }).ToJson();
            db.CompetitionCollaborators.Add(new CompetitionCollaborator
            {
                CompetitionId = compId,
                UserId = collabAuth.User.Id
            });
            await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.Forbidden, (await collabClient.GetAsync(Url(clubId))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await collabClient.PutAsJsonAsync(Url(clubId, "/bank"), UkBank())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await collabClient.PostAsync(Url(clubId, "/stripe/onboard"), null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await manager.GetAsync(Url(clubId))).StatusCode);

        // The competition's creator loses access once they move to another club, though the competition still pays clubId.
        var movedTo = await _f.SeedClubAsync(NewClubName());
        await _f.InDbAsync(async db =>
        {
            var u = await db.Users.SingleAsync(x => x.Id == sameClubTrainerAuth.User.Id);
            u.ClubId = movedTo;
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.Forbidden, (await sameClubTrainer.GetAsync(Url(clubId))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await sameClubTrainer.PutAsJsonAsync(Url(clubId, "/bank"), UkBank())).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await sameClubTrainer.GetAsync(Url(movedTo))).StatusCode);
    }

    [Fact]
    public async Task MePayouts_AllowAnyAuthenticatedUserToManagePersonalPayouts_AndShowOnClublessCompetition()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync("/api/me/payouts")).StatusCode);

        var (seller, sellerAuth) = await _f.SignupAsync("Member", NewClubName());
        // Detach the user from any club to simulate an independent organiser/seller.
        await _f.InDbAsync(async db =>
        {
            var u = await db.Users.SingleAsync(x => x.Id == sellerAuth.User.Id);
            u.ClubId = null;
            await db.SaveChangesAsync();
        });

        var initial = await (await seller.GetAsync("/api/me/payouts")).ReadAsync<ClubPayoutsDto>();
        Assert.Equal(PayoutStatus.NotStarted, initial.Status);
        Assert.True(initial.StripeConfigured);

        var saved = await (await seller.PutAsJsonAsync("/api/me/payouts", Complete(PayoutBusinessType.Individual) with
        {
            LegalName = "Taylor Rider",
            StatementDescriptor = "TAYLOR RIDER"
        })).ReadAsync<ClubPayoutsDto>();
        Assert.Equal(PayoutStatus.InProgress, saved.Status);

        var withBank = await (await seller.PutAsJsonAsync("/api/me/payouts/bank", UkBank())).ReadAsync<ClubPayoutsDto>();
        Assert.Equal("••••9911", withBank.Bank!.MaskedAccount);

        var finished = await (await seller.PostAsync("/api/me/payouts/finish", null)).ReadAsync<ClubPayoutsDto>();
        Assert.Equal(PayoutStatus.Ready, finished.Status);
        Assert.True(finished.ManualBacsReady);
        Assert.False(finished.StripeChargesEnabled);
        Assert.False(finished.StripePayoutsEnabled);

        // A competition owned by this clubless organiser now surfaces their personal payout summary.
        var compId = await _f.SeedCompetitionAsync(ownerUserId: sellerAuth.User.Id);
        var compDetail = await (await _f.CreateClient().GetAsync($"/api/competitions/{compId}")).ReadAsync<CompetitionDetail>();
        Assert.NotNull(compDetail.PayoutsTo);
        Assert.True(compDetail.PayoutsTo!.Ready);
        Assert.True(compDetail.PayoutsTo.ManualBacsReady);
        Assert.Equal("••••9911", compDetail.PayoutsTo.MaskedAccount);
    }

    [Fact]
    public async Task StripeOnboard_AndSync_CreateStandardAccountOnce_ReturnLink_AndSyncCapabilities()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        var accountId = $"acct_test_{Guid.NewGuid():N}"[..24];
        var accountCreates = 0;

        _f.Http.Reset();
        _f.Http.RespondJson($"/v1/accounts/{accountId}",
            $$"""
            {
              "id": "{{accountId}}",
              "object": "account",
              "charges_enabled": true,
              "payouts_enabled": true,
              "details_submitted": true,
              "default_currency": "gbp",
              "external_accounts": {
                "data": [
                  {
                    "object": "bank_account",
                    "last4": "4321",
                    "routing_number": "20-00-00",
                    "bank_name": "BARCLAYS BANK UK PLC",
                    "account_holder_name": "Ashdown Pony Club",
                    "country": "GB"
                  }
                ]
              }
            }
            """);
        _f.Http.Respond("/v1/accounts", _ =>
        {
            Interlocked.Increment(ref accountCreates);
            return JsonResponse(
                $$"""{"id":"{{accountId}}","object":"account","charges_enabled":false,"payouts_enabled":false,"details_submitted":false}""");
        });
        _f.Http.RespondJson("/v1/account_links",
            """{"object":"account_link","url":"https://connect.stripe.com/setup/s/acct_test/onboarding"}""");

        var onboard1 = await manager.PostAsync(Url(clubId, "/stripe/onboard"), null);
        Assert.Equal(HttpStatusCode.OK, onboard1.StatusCode);
        var linkDto1 = await onboard1.ReadAsync<StripeOnboardResponseDto>();
        Assert.Equal(accountId, linkDto1.StripeAccountId);
        Assert.StartsWith("https://connect.stripe.com/", linkDto1.Url);

        // Calling onboard again reuses the existing StripeAccountId without creating a second Stripe account.
        var onboard2 = await manager.PostAsync(Url(clubId, "/stripe/onboard"), null);
        Assert.Equal(HttpStatusCode.OK, onboard2.StatusCode);
        Assert.Equal(1, accountCreates);

        var syncResp = await manager.PostAsync(Url(clubId, "/stripe/sync"), null);
        Assert.Equal(HttpStatusCode.OK, syncResp.StatusCode);
        var synced = await syncResp.ReadAsync<ClubPayoutsDto>();
        Assert.True(synced.StripeConnected);
        Assert.True(synced.StripeChargesEnabled);
        Assert.True(synced.StripePayoutsEnabled);
        Assert.True(synced.StripeDetailsSubmitted);
        Assert.Equal(PayoutStatus.Ready, synced.Status);
        Assert.NotNull(synced.Bank);
        Assert.Equal("••••4321", synced.Bank!.MaskedAccount);
        Assert.Equal("20-00-00", synced.Bank.SortCode);
    }

    [Fact]
    public async Task DecoupledReadiness_EditingManualBacsDoesNotRevokeStripe_AndFinishNeverEnablesStripe()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        var accountId = $"acct_decouple_{Guid.NewGuid():N}"[..24];

        // 1. Manual BACS finish sets ManualBacsReady = true and Status = Ready, but never sets Stripe flags.
        await manager.PutAsJsonAsync(Url(clubId), Complete());
        await manager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank());
        var bacsReady = await (await manager.PostAsync(Url(clubId, "/finish"), null)).ReadAsync<ClubPayoutsDto>();
        Assert.Equal(PayoutStatus.Ready, bacsReady.Status);
        Assert.True(bacsReady.ManualBacsReady);
        Assert.False(bacsReady.StripeChargesEnabled);
        Assert.False(bacsReady.StripePayoutsEnabled);

        // 2. Now connect Stripe and mark charges & payouts enabled via sync.
        _f.Http.Reset();
        _f.Http.RespondJson($"/v1/accounts/{accountId}",
            $$"""{"id":"{{accountId}}","object":"account","charges_enabled":true,"payouts_enabled":true,"details_submitted":true}""");
        _f.Http.RespondJson("/v1/accounts",
            $$"""{"id":"{{accountId}}","object":"account","charges_enabled":true,"payouts_enabled":true,"details_submitted":true}""");
        _f.Http.RespondJson("/v1/account_links",
            """{"object":"account_link","url":"https://connect.stripe.com/setup/s/acct_decouple"}""");

        (await manager.PostAsync(Url(clubId, "/stripe/onboard"), null)).EnsureSuccessStatusCode();
        var bothReady = await (await manager.PostAsync(Url(clubId, "/stripe/sync"), null)).ReadAsync<ClubPayoutsDto>();
        Assert.True(bothReady.StripeChargesEnabled);
        Assert.True(bothReady.StripePayoutsEnabled);
        Assert.True(bothReady.ManualBacsReady);
        Assert.Equal(PayoutStatus.Ready, bothReady.Status);

        // 3. Editing manual BACS details resets ManualBacsReady = false, but does NOT revoke Stripe or overall Ready status.
        var afterEdit = await (await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(City: "Henley"))).ReadAsync<ClubPayoutsDto>();
        Assert.False(afterEdit.ManualBacsReady);
        Assert.True(afterEdit.StripeChargesEnabled);
        Assert.True(afterEdit.StripePayoutsEnabled);
        Assert.Equal(PayoutStatus.Ready, afterEdit.Status);
    }

    [Fact]
    public async Task StripeConnectWebhook_VerifiesHmac_RejectsBadSignatureAndExpiredTimestamp_UpdatesAccount_AndDeduplicatesReplay()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        var accountId = $"acct_wh_{Guid.NewGuid():N}"[..24];
        await _f.InDbAsync(async db =>
        {
            db.ClubPayoutAccounts.Add(new ClubPayoutAccount
            {
                ClubId = clubId,
                StripeAccountId = accountId,
                Status = PayoutStatus.InProgress,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        });

        var eventId = $"evt_{Guid.NewGuid():N}"[..24];
        var payload = $$"""
        {
          "id": "{{eventId}}",
          "object": "event",
          "type": "account.updated",
          "account": "{{accountId}}",
          "data": {
            "object": {
              "id": "{{accountId}}",
              "object": "account",
              "charges_enabled": true,
              "payouts_enabled": true,
              "details_submitted": true,
              "external_accounts": {
                "data": [
                  {
                    "object": "bank_account",
                    "last4": "8899",
                    "routing_number": "400500",
                    "bank_name": "HSBC UK"
                  }
                ]
              }
            }
          }
        }
        """;

        var anon = _f.CreateClient();
        var nowUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        // 1. Bad signature -> 400 BadRequest
        var badSigReq = BuildWebhookRequest(payload, $"t={nowUnix},v1=deadbeef0123456789");
        Assert.Equal(HttpStatusCode.BadRequest, (await anon.SendAsync(badSigReq)).StatusCode);

        // 2. Expired timestamp (> 300s old) or long.MinValue overflow guard -> 400 BadRequest
        var oldUnix = nowUnix - 360;
        var expiredReq = BuildWebhookRequest(payload, SignStripePayload(payload, oldUnix, StripeTestConnectWebhookSecret));
        Assert.Equal(HttpStatusCode.BadRequest, (await anon.SendAsync(expiredReq)).StatusCode);

        var minLongReq = BuildWebhookRequest(payload, $"t={long.MinValue},v1={new string('a', 64)}");
        Assert.Equal(HttpStatusCode.BadRequest, (await anon.SendAsync(minLongReq)).StatusCode);

        // 3. Valid signature -> 200 OK and account updated to Ready
        var validSig = SignStripePayload(payload, nowUnix, StripeTestConnectWebhookSecret);
        var validResp = await anon.SendAsync(BuildWebhookRequest(payload, validSig));
        Assert.Equal(HttpStatusCode.OK, validResp.StatusCode);

        var dto = await (await manager.GetAsync(Url(clubId))).ReadAsync<ClubPayoutsDto>();
        Assert.Equal(PayoutStatus.Ready, dto.Status);
        Assert.True(dto.StripeChargesEnabled);
        Assert.True(dto.StripePayoutsEnabled);
        Assert.True(dto.StripeDetailsSubmitted);
        Assert.Equal("••••8899", dto.Bank!.MaskedAccount);
        Assert.Equal("40-05-00", dto.Bank.SortCode);

        // 4. Replay of the same evt_... -> 200 OK idempotently without throwing or duplicating
        var replayResp = await anon.SendAsync(BuildWebhookRequest(payload, validSig));
        Assert.Equal(HttpStatusCode.OK, replayResp.StatusCode);
        Assert.Contains("duplicate", await replayResp.Content.ReadAsStringAsync());
        Assert.Equal(1, await _f.WithDbAsync(db => db.StripeWebhookEvents.CountAsync(e => e.EventId == eventId)));

        // 5. ConnectWebhookSecret never falls back to platform Stripe:WebhookSecret
        using var noConnectSecretHost = _f.WithWebHostBuilder(b => b
            .UseSetting("Stripe:ConnectWebhookSecret", "")
            .UseSetting("Stripe:WebhookSecret", "whsec_platform_only_0123456789abcdef"));
        var noConnectClient = noConnectSecretHost.CreateClient();
        var fallbackAttempt = BuildWebhookRequest(payload, SignStripePayload(payload, nowUnix, "whsec_platform_only_0123456789abcdef"));
        Assert.Equal(HttpStatusCode.BadRequest, (await noConnectClient.SendAsync(fallbackAttempt)).StatusCode);
    }

    [Fact]
    public async Task StripeOnboard_ValidatesStripeRedirectDomain_AndUsesActualEuCountryInsteadOfHardcodingIe()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        await manager.PutAsJsonAsync(Url(clubId), new SavePayoutDetailsRequest(Region: PayoutRegion.Eu));

        // 1. EU account with no IBAN country and no requested country code is refused instead of silently defaulting to IE.
        var missingCountryResp = await manager.PostAsync(Url(clubId, "/stripe/onboard"), null);
        Assert.Equal(HttpStatusCode.BadRequest, missingCountryResp.StatusCode);

        // 2. Saving a German IBAN sets IbanCountry = "DE", which StripeOnboard sends to Stripe; and non-Stripe redirect URLs are rejected.
        await manager.PutAsJsonAsync(Url(clubId, "/bank"), new SavePayoutBankRequest("Holder", Iban: "DE89370400440532013000"));
        string? postedAccountForm = null;
        var accountId = $"acct_de_{Guid.NewGuid():N}"[..24];
        _f.Http.Reset();
        _f.Http.Respond("/v1/accounts", req =>
        {
            postedAccountForm = req.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            return JsonResponse($$"""{"id":"{{accountId}}","object":"account"}""");
        });
        _f.Http.RespondJson("/v1/account_links",
            """{"object":"account_link","url":"https://evil.example.org/phish"}""");

        var unsafeUrlResp = await manager.PostAsync(Url(clubId, "/stripe/onboard"), null);
        Assert.Equal(HttpStatusCode.BadRequest, unsafeUrlResp.StatusCode);
        Assert.NotNull(postedAccountForm);
        Assert.Contains("country=DE", postedAccountForm);
    }

    [Fact]
    public async Task LegacyReadyBacsAccount_IsBackfilledToManualBacsReady_AndKeepsReadyWhenStartingStripeOnboard()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        await manager.PutAsJsonAsync(Url(clubId), Complete());
        await manager.PutAsJsonAsync(Url(clubId, "/bank"), UkBank());
        await manager.PostAsync(Url(clubId, "/finish"), null);

        // Simulate a pre-Step-1 database row where Status = Ready (2) but ManualBacsReady was 0 before backfill.
        await _f.InDbAsync(async db =>
        {
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE ClubPayoutAccounts SET ManualBacsReady = 0 WHERE ClubId = {0}", clubId);
        });

        await DbInitializer_RunAsync();

        var afterBackfill = await _f.WithDbAsync(db =>
            db.ClubPayoutAccounts.AsNoTracking().SingleAsync(a => a.ClubId == clubId));
        Assert.True(afterBackfill.ManualBacsReady);

        // Starting Stripe onboarding must not downgrade a Ready manual BACS club to InProgress.
        var accountId = $"acct_bf_{Guid.NewGuid():N}"[..24];
        _f.Http.Reset();
        _f.Http.RespondJson("/v1/accounts", $$"""{"id":"{{accountId}}","object":"account"}""");
        _f.Http.RespondJson("/v1/account_links", """{"object":"account_link","url":"https://connect.stripe.com/setup/s/acct_bf"}""");

        var onboardResp = await manager.PostAsync(Url(clubId, "/stripe/onboard"), null);
        Assert.Equal(HttpStatusCode.OK, onboardResp.StatusCode);

        var dto = await (await manager.GetAsync(Url(clubId))).ReadAsync<ClubPayoutsDto>();
        Assert.Equal(PayoutStatus.Ready, dto.Status);
        Assert.True(dto.ManualBacsReady);
    }

    [Fact]
    public async Task AccountDeletion_RemovesUserPayoutAccountPii_EvenWhenAccountIsAnonymised()
    {
        var (seller, sellerAuth) = await _f.SignupAsync("Member", NewClubName());
        var userId = sellerAuth.User.Id;
        await seller.PutAsJsonAsync("/api/me/payouts", Complete(PayoutBusinessType.Individual) with
        {
            LegalName = "Secret Seller Name",
            PersonFullName = "Secret Seller Name",
            ContactEmail = "secret-seller@example.org"
        });
        await seller.PutAsJsonAsync("/api/me/payouts/bank", UkBank());

        // Block the user so AccountDeletionService takes the Anonymised (shell kept) path.
        await _f.InDbAsync(async db =>
        {
            var u = await db.Users.SingleAsync(x => x.Id == userId);
            u.BlockedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        });

        using (var scope = _f.Services.CreateScope())
        {
            var deleter = scope.ServiceProvider.GetRequiredService<MountedGames.Api.Services.AccountDeletionService>();
            var userManager = scope.ServiceProvider.GetRequiredService<Microsoft.AspNetCore.Identity.UserManager<AppUser>>();
            var user = await userManager.FindByIdAsync(userId);
            var outcome = await deleter.DeleteAsync(user!);
            Assert.Equal(MountedGames.Api.Services.AccountDeletionOutcome.Anonymised, outcome);
        }

        Assert.Equal(0, await _f.WithDbAsync(db => db.UserPayoutAccounts.CountAsync(a => a.UserId == userId)));
    }

    [Fact]
    public async Task StripeOnboard_SendsIdempotencyKey_PersistsAccountBeforeLink_AndPreservesPersonalScopeInMeReturnUrl()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        string? receivedIdempotencyKey = null;
        var accountId = $"acct_idem_{Guid.NewGuid():N}"[..24];
        _f.Http.Reset();
        _f.Http.Respond("/v1/accounts", req =>
        {
            if (req.Headers.TryGetValues("Idempotency-Key", out var vals))
                receivedIdempotencyKey = vals.FirstOrDefault();
            return JsonResponse($$"""{"id":"{{accountId}}","object":"account"}""");
        });
        // Simulate /v1/account_links failing on the first attempt: StripeAccountId must still be saved in DB.
        _f.Http.Respond("/v1/account_links", _ => JsonResponse("""{"error":{"message":"temporary error"}}""", HttpStatusCode.BadGateway));

        var failedLinkResp = await manager.PostAsync(Url(clubId, "/stripe/onboard"), null);
        Assert.Equal(HttpStatusCode.BadRequest, failedLinkResp.StatusCode);
        Assert.False(string.IsNullOrWhiteSpace(receivedIdempotencyKey));
        Assert.StartsWith($"connect-create-club-{clubId}-", receivedIdempotencyKey);

        var savedClubAccount = await _f.WithDbAsync(db =>
            db.ClubPayoutAccounts.AsNoTracking().SingleAsync(a => a.ClubId == clubId));
        Assert.Equal(accountId, savedClubAccount.StripeAccountId);

        // Personal /api/me/payouts/stripe/onboard includes scope=personal in return_url & refresh_url so Managers stay on personal payouts.
        var meAccountId = $"acct_me_{Guid.NewGuid():N}"[..24];
        string? accountLinkForm = null;
        _f.Http.Reset();
        _f.Http.RespondJson("/v1/accounts", $$"""{"id":"{{meAccountId}}","object":"account"}""");
        _f.Http.Respond("/v1/account_links", req =>
        {
            accountLinkForm = req.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            return JsonResponse("""{"object":"account_link","url":"https://connect.stripe.com/setup/s/acct_me"}""");
        });

        var meOnboardResp = await manager.PostAsync("/api/me/payouts/stripe/onboard", null);
        Assert.Equal(HttpStatusCode.OK, meOnboardResp.StatusCode);
        Assert.NotNull(accountLinkForm);
        Assert.Contains("scope%3Dpersonal", accountLinkForm);
    }

    [Fact]
    public async Task StripeConnectWebhook_RejectsLivemodeMismatch_IgnoresOutOfOrderOlderEvent_AndHandlesDeauthorized()
    {
        var (manager, clubId, _) = await ManagerWithClubAsync();
        var accountId = $"acct_ord_{Guid.NewGuid():N}"[..24];
        await _f.InDbAsync(async db =>
        {
            db.ClubPayoutAccounts.Add(new ClubPayoutAccount
            {
                ClubId = clubId,
                StripeAccountId = accountId,
                Status = PayoutStatus.InProgress,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        });

        var anon = _f.CreateClient();
        var nowUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        // 1. Livemode mismatch (livemode: true against sk_test_... secret key) -> 400 BadRequest
        var liveEventPayload = $$"""
        {
          "id": "evt_live_{{Guid.NewGuid():N}}",
          "object": "event",
          "type": "account.updated",
          "livemode": true,
          "created": {{nowUnix}},
          "account": "{{accountId}}",
          "data": { "object": { "id": "{{accountId}}", "charges_enabled": true, "payouts_enabled": true, "details_submitted": true } }
        }
        """;
        var liveResp = await anon.SendAsync(BuildWebhookRequest(liveEventPayload, SignStripePayload(liveEventPayload, nowUnix, StripeTestConnectWebhookSecret)));
        Assert.Equal(HttpStatusCode.BadRequest, liveResp.StatusCode);

        // 2. Newer event (created = nowUnix) enables charges & payouts -> Ready
        var newerPayload = $$"""
        {
          "id": "evt_new_{{Guid.NewGuid():N}}",
          "object": "event",
          "type": "account.updated",
          "livemode": false,
          "created": {{nowUnix}},
          "account": "{{accountId}}",
          "data": { "object": { "id": "{{accountId}}", "charges_enabled": true, "payouts_enabled": true, "details_submitted": true } }
        }
        """;
        var newerResp = await anon.SendAsync(BuildWebhookRequest(newerPayload, SignStripePayload(newerPayload, nowUnix, StripeTestConnectWebhookSecret)));
        Assert.Equal(HttpStatusCode.OK, newerResp.StatusCode);
        var afterNewer = await (await manager.GetAsync(Url(clubId))).ReadAsync<ClubPayoutsDto>();
        Assert.Equal(PayoutStatus.Ready, afterNewer.Status);
        Assert.True(afterNewer.StripeChargesEnabled);

        // 3. Out-of-order older event (created = nowUnix - 30) with charges_enabled = false arrives late -> recorded for idempotency but does NOT downgrade account
        var olderPayload = $$"""
        {
          "id": "evt_old_{{Guid.NewGuid():N}}",
          "object": "event",
          "type": "account.updated",
          "livemode": false,
          "created": {{nowUnix - 30}},
          "account": "{{accountId}}",
          "data": { "object": { "id": "{{accountId}}", "charges_enabled": false, "payouts_enabled": false, "details_submitted": false } }
        }
        """;
        var olderResp = await anon.SendAsync(BuildWebhookRequest(olderPayload, SignStripePayload(olderPayload, nowUnix, StripeTestConnectWebhookSecret)));
        Assert.Equal(HttpStatusCode.OK, olderResp.StatusCode);
        var afterOlder = await (await manager.GetAsync(Url(clubId))).ReadAsync<ClubPayoutsDto>();
        Assert.Equal(PayoutStatus.Ready, afterOlder.Status);
        Assert.True(afterOlder.StripeChargesEnabled);
        Assert.True(afterOlder.StripePayoutsEnabled);

        // 4. Subsequent account.application.deauthorized event (created = nowUnix + 5) revokes Stripe flags and downgrades to InProgress (when ManualBacsReady is false)
        var deauthPayload = $$"""
        {
          "id": "evt_deauth_{{Guid.NewGuid():N}}",
          "object": "event",
          "type": "account.application.deauthorized",
          "livemode": false,
          "created": {{nowUnix + 5}},
          "account": "{{accountId}}",
          "data": { "object": { "id": "ca_123", "object": "application" } }
        }
        """;
        var deauthResp = await anon.SendAsync(BuildWebhookRequest(deauthPayload, SignStripePayload(deauthPayload, nowUnix, StripeTestConnectWebhookSecret)));
        Assert.Equal(HttpStatusCode.OK, deauthResp.StatusCode);
        var afterDeauth = await (await manager.GetAsync(Url(clubId))).ReadAsync<ClubPayoutsDto>();
        Assert.Equal(PayoutStatus.InProgress, afterDeauth.Status);
        Assert.False(afterDeauth.StripeChargesEnabled);
        Assert.False(afterDeauth.StripePayoutsEnabled);
        Assert.False(afterDeauth.StripeDetailsSubmitted);
    }

    private static HttpResponseMessage JsonResponse(string json, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static HttpRequestMessage BuildWebhookRequest(string json, string stripeSignature)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/webhooks/stripe-connect")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        req.Headers.TryAddWithoutValidation("Stripe-Signature", stripeSignature);
        return req;
    }

    private static string SignStripePayload(string payload, long timestampSeconds, string secret)
    {
        var signedPayload = $"{timestampSeconds}.{payload}";
        var hash = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(signedPayload));
        var hex = Convert.ToHexString(hash).ToLowerInvariant();
        return $"t={timestampSeconds},v1={hex}";
    }

    private Task DbInitializer_RunAsync() => MountedGames.Api.Services.DbInitializer.SeedAsync(_f.Services);
}
