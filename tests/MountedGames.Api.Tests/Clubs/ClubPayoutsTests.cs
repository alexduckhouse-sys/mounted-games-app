using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Payouts;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Clubs;

/// <summary>A club's payout set-up (mock provider onboarding): access, validation, masking and the Ready step.</summary>
public class ClubPayoutsTests : IClassFixture<ApiFactory>
{
    private const string FullAccount = "55779911";
    private const string FullIban = "IE29AIBK93115212345678";
    private const string GoodIban = "GB82WEST12345698765432";

    private readonly ApiFactory _f;
    public ClubPayoutsTests(ApiFactory f) => _f = f;

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
        });

        await DbInitializer_RunAsync();

        Assert.Equal(0, await _f.WithDbAsync(db => db.ClubPayoutAccounts.CountAsync()));
    }

    private Task DbInitializer_RunAsync() => MountedGames.Api.Services.DbInitializer.SeedAsync(_f.Services);
}
