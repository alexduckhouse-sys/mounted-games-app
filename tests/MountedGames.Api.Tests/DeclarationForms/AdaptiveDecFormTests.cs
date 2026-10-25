using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.DecForms;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.DeclarationForms;

/// <summary>The per-competition dec form setup: what it asks, what it refuses, what it flags and who may see the answers.</summary>
public class AdaptiveDecFormTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public AdaptiveDecFormTests(ApiFactory f) => _f = f;

    private const string Forms = "/api/declaration-forms";
    private static string ConfigUrl(int competitionId) => $"/api/competitions/{competitionId}/dec-form-config";
    private static string FlagsUrl(int competitionId) => $"/api/competitions/{competitionId}/dec-form-flags";

    private sealed record Setup(int CompetitionId, int SectionId, int TeamId);

    /// <summary>A competition owned by the seeded trainer, with one team the trainer coaches.</summary>
    private async Task<Setup> NewSetupAsync()
    {
        var trainer = await _f.TrainerIdAsync();
        var comp = await _f.SeedCompetitionAsync(ownerUserId: trainer);
        var section = await _f.SeedSectionAsync(comp);
        var club = await _f.SeedClubAsync();
        var team = await _f.SeedTeamAsync(comp, section, club, trainerUserId: trainer);
        return new Setup(comp, section, team);
    }

    private static DecFormConfig Basic(Func<DecFormConfig, DecFormConfig>? change = null)
        => change?.Invoke(DecFormConfig.Basic) ?? DecFormConfig.Basic;

    private async Task SetConfigAsync(int competitionId, DecFormConfig config)
    {
        var r = await (await _f.AdminAsync()).PutAsJsonAsync(ConfigUrl(competitionId), config);
        Assert.True(r.IsSuccessStatusCode, await r.Content.ReadAsStringAsync());
    }

    private static RiderEntryInput Rider(string name, bool reserve = false, DateTime? dob = null, decimal? weight = null,
        string? passport = null, int? ponyAge = null, string? member = null, string? contact = null, string? phone = null,
        string? medical = null, string? ageGroup = null, int? year = null, decimal? height = null, Dictionary<string, string?>? custom = null)
        => new(null, name, dob, "Pickle", null, false, reserve, 0, false, false, false, height, year, ageGroup, weight, passport,
            ponyAge, member, contact, phone, medical, custom);

    private static SubmitDeclarationFormRequest Form(int teamId, params RiderEntryInput[] riders)
        => new(teamId, null, riders, false, "07123 456-789", AcceptTerms: true);

    private async Task<HttpResponseMessage> SubmitAsync(Setup s, params RiderEntryInput[] riders)
        => await (await _f.TrainerAsync()).PostAsJsonAsync(Forms, Form(s.TeamId, riders));

    private static async Task<string> MessageAsync(HttpResponseMessage r) => await r.Content.ReadAsStringAsync();

    // ---- The setup itself ----

    [Fact]
    public async Task Config_IsTheStandardForm_UntilTheOrganiserSetsOne()
    {
        var s = await NewSetupAsync();

        var dto = await (await (await _f.TrainerAsync()).GetAsync(ConfigUrl(s.CompetitionId))).ReadAsync<DecFormConfigDto>();

        Assert.True(dto.IsStandard);
        Assert.Equal(FieldRequirement.Required, dto.Config.Dob);
        Assert.Equal(FieldRequirement.Required, dto.Config.PonyHeight);
        Assert.Equal(FieldRequirement.Off, dto.Config.Weight);
        Assert.Empty(dto.Config.CustomFields);
    }

    [Fact]
    public async Task Config_RoundTrips_AndCountsFormsAlreadyIn()
    {
        var s = await NewSetupAsync();
        var config = Basic(c => c with
        {
            Dob = FieldRequirement.Optional, DobFormat = DobFormat.YearOnly,
            Weight = FieldRequirement.Required, WeightUnit = WeightUnit.StonePounds,
            MedicalNotes = FieldRequirement.Optional,
            CustomFields = [new DecFormCustomField("girth", "  Girth  ", CustomFieldType.Number, true, 10, 90, " cm "),
                            new DecFormCustomField("club", "Home club", CustomFieldType.Text, false)],
        });
        var owner = await _f.TrainerAsync();

        var put = await owner.PutAsJsonAsync(ConfigUrl(s.CompetitionId), config);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SubmitAsync(s, Rider("Alice", weight: 30, custom: new() { ["girth"] = "50" }))).StatusCode);
        var dto = await (await owner.GetAsync(ConfigUrl(s.CompetitionId))).ReadAsync<DecFormConfigDto>();

        Assert.False(dto.IsStandard);
        Assert.Equal(1, dto.FormsSubmitted);
        Assert.Equal(DobFormat.YearOnly, dto.Config.DobFormat);
        Assert.Equal(WeightUnit.StonePounds, dto.Config.WeightUnit);
        Assert.Equal(("Girth", "cm", 90m), (dto.Config.CustomFields[0].Label, dto.Config.CustomFields[0].Unit, dto.Config.CustomFields[0].Max));
    }

    [Fact]
    public async Task NewCompetitions_StartWithTheBasicForm()
    {
        var trainer = await _f.TrainerAsync();

        var created = await trainer.PostAsJsonAsync("/api/competitions", new CreateCompetitionRequest(
            $"New {Guid.NewGuid():N}", null, null, null, null, null, null, DateTime.UtcNow.AddDays(30), null));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await created.ReadAsync<CompetitionSummary>()).Id;

        var dto = await (await trainer.GetAsync(ConfigUrl(id))).ReadAsync<DecFormConfigDto>();
        Assert.False(dto.IsStandard);
        Assert.Equal((FieldRequirement.Off, FieldRequirement.Off, FieldRequirement.Off, FieldRequirement.Required, FieldRequirement.Off),
            (dto.Config.Dob, dto.Config.PonyHeight, dto.Config.Weight, dto.Config.TrainerPhone, dto.Config.Bib));
    }

    [Theory]
    [InlineData("07123 456 789", "07123456789")]
    [InlineData("(07123) 456-789", "07123456789")]
    [InlineData("+44 7123 456789", "+447123456789")]
    [InlineData("+44 (0)7123 456789", "+447123456789")]
    [InlineData("0044 7123 456789", "+447123456789")]
    [InlineData("+353 87 123 4567", "+353871234567")]
    [InlineData("087 123 4567", "0871234567")]
    [InlineData("020 7946 0958", "02079460958")]
    public void Phone_IsAcceptedAndTidied(string typed, string expected)
    {
        Assert.True(PhoneNumbers.TryNormalise(typed, out var normalised));
        Assert.Equal(expected, normalised);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("  ")]
    [InlineData("12345")]
    [InlineData("7123456789")]
    [InlineData("+1 202 555 0143")]
    [InlineData("07123 abc 789")]
    [InlineData("+44 12")]
    [InlineData("0123456789012")]
    public void Phone_IsRefusedWhenItIsNotUkOrIrish(string? typed) => Assert.False(PhoneNumbers.TryNormalise(typed, out _));

    [Fact]
    public async Task TrainerPhone_IsRequiredOnTheBasicForm_NormalisedAndPrivate()
    {
        var s = await NewSetupAsync();
        await SetConfigAsync(s.CompetitionId, Basic());
        var trainer = await _f.TrainerAsync();
        SubmitDeclarationFormRequest WithPhone(string? phone) => new(s.TeamId, null, [Rider("Alice")], false, phone, AcceptTerms: true);

        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(Forms, WithPhone(null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(Forms, WithPhone("12345"))).StatusCode);
        var ok = await trainer.PostAsJsonAsync(Forms, WithPhone("+44 7123 456789"));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal("+447123456789", (await ok.ReadAsync<DeclarationFormDto>()).TrainerPhone);

        var publicBody = await (await _f.CreateClient().GetAsync($"{Forms}?teamId={s.TeamId}")).Content.ReadAsStringAsync();
        Assert.DoesNotContain("447123456789", publicBody);
        var publicForm = Assert.Single(System.Text.Json.JsonSerializer.Deserialize<List<DeclarationFormDto>>(publicBody,
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!);
        Assert.Null(publicForm.TrainerPhone);
        var staff = Assert.Single(await (await (await _f.AdminAsync()).GetAsync($"{Forms}?teamId={s.TeamId}")).ReadAsync<List<DeclarationFormDto>>());
        Assert.Equal("+447123456789", staff.TrainerPhone);
    }

    [Fact]
    public async Task TrainerPhone_OffIsNeverStored_AndOptionalMayBeLeftOut()
    {
        var s = await NewSetupAsync();
        var trainer = await _f.TrainerAsync();
        await SetConfigAsync(s.CompetitionId, Basic(c => c with { TrainerPhone = FieldRequirement.Off }));
        var off = await trainer.PostAsJsonAsync(Forms, new SubmitDeclarationFormRequest(s.TeamId, null, [Rider("A")], false, "07123 456789", AcceptTerms: true));
        Assert.Null((await off.ReadAsync<DeclarationFormDto>()).TrainerPhone);

        await SetConfigAsync(s.CompetitionId, Basic(c => c with { TrainerPhone = FieldRequirement.Optional }));
        var none = await trainer.PostAsJsonAsync(Forms, new SubmitDeclarationFormRequest(s.TeamId, null, [Rider("A")], false, null, AcceptTerms: true));
        Assert.Equal(HttpStatusCode.OK, none.StatusCode);
    }

    [Fact]
    public async Task Bib_FollowsTheSetup()
    {
        var s = await NewSetupAsync();
        var trainer = await _f.TrainerAsync();
        SubmitDeclarationFormRequest WithBib(string? bib) => new(s.TeamId, null, [Rider("A")], false, "07123 456789", BibDescription: bib, AcceptTerms: true);
        await SetConfigAsync(s.CompetitionId, Basic());
        await trainer.PostAsJsonAsync(Forms, WithBib("Red"));
        Assert.Null(await _f.InDbAsync(db => db.Teams.Where(t => t.Id == s.TeamId).Select(t => t.BibDescription).SingleAsync()));

        await SetConfigAsync(s.CompetitionId, Basic(c => c with { Bib = FieldRequirement.Required }));
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(Forms, WithBib(" "))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await trainer.PostAsJsonAsync(Forms, WithBib("Red"))).StatusCode);
        Assert.Equal("Red", await _f.InDbAsync(db => db.Teams.Where(t => t.Id == s.TeamId).Select(t => t.BibDescription).SingleAsync()));
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(Forms, WithBib("[flag:gb]"))).StatusCode);
        await SetConfigAsync(s.CompetitionId, Basic());
        Assert.Equal(HttpStatusCode.OK, (await trainer.PostAsJsonAsync(Forms, WithBib("[flag:gb]"))).StatusCode);
        Assert.Equal("[flag:gb] Red", await _f.InDbAsync(db => db.Teams.Where(t => t.Id == s.TeamId).Select(t => t.BibDescription).SingleAsync()));
        Assert.Equal(HttpStatusCode.OK, (await trainer.PostAsJsonAsync(Forms, WithBib(""))).StatusCode);
        Assert.Equal("Red", await _f.InDbAsync(db => db.Teams.Where(t => t.Id == s.TeamId).Select(t => t.BibDescription).SingleAsync()));

    }

    [Fact]
    public async Task Config_CanBeResetToTheStandardForm()
    {
        var s = await NewSetupAsync();
        await SetConfigAsync(s.CompetitionId, Basic());

        var reset = await (await _f.AdminAsync()).DeleteAsync(ConfigUrl(s.CompetitionId));

        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        Assert.True((await reset.ReadAsync<DecFormConfigDto>()).IsStandard);
    }

    [Fact]
    public async Task Config_Authorisation()
    {
        var s = await NewSetupAsync();
        var config = Basic();

        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync(ConfigUrl(s.CompetitionId))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().PutAsJsonAsync(ConfigUrl(s.CompetitionId), config)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().DeleteAsync(ConfigUrl(s.CompetitionId))).StatusCode);

        var (other, _) = await _f.ApprovedTrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsJsonAsync(ConfigUrl(s.CompetitionId), config)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.DeleteAsync(ConfigUrl(s.CompetitionId))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(FlagsUrl(s.CompetitionId))).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await (await _f.TrainerAsync()).PutAsJsonAsync(ConfigUrl(s.CompetitionId), config)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await _f.AdminAsync()).PutAsJsonAsync(ConfigUrl(s.CompetitionId), config)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await _f.AdminAsync()).GetAsync(ConfigUrl(999999))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await _f.AdminAsync()).PutAsJsonAsync(ConfigUrl(999999), config)).StatusCode);
    }

    [Fact]
    public async Task Config_Rejects_BadSetups()
    {
        var s = await NewSetupAsync();
        var admin = await _f.AdminAsync();
        DecFormCustomField Num(string id, string label = "Girth", decimal? min = null, decimal? max = null)
            => new(id, label, CustomFieldType.Number, false, min, max);

        var cases = new[]
        {
            Basic(c => c with { CustomFields = [Num("a"), Num("a", "Other")] }),                       // same id twice
            Basic(c => c with { CustomFields = [Num("a", " ")] }),                                      // no label
            Basic(c => c with { CustomFields = [Num("a", min: 9, max: 3)] }),                           // min above max
            Basic(c => c with { CustomFields = [Num("not ok!")] }),                                      // bad id
            Basic(c => c with { CustomFields = [new("t", "Text", CustomFieldType.Text, false, null, 5)] }), // limit on text
            Basic(c => c with { CustomFields = [new("t", "Text", (CustomFieldType)9, false)] }),         // unknown type
            Basic(c => c with { CustomFields = [new("t", "Text", CustomFieldType.Text, false, null, null, new string('x', 30))] }),
            Basic(c => c with { CustomFields = Enumerable.Range(0, 13).Select(i => Num($"f{i}")).ToList() }), // too many
            Basic(c => c with { Weight = (FieldRequirement)7 }),
        };

        foreach (var bad in cases)
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync(ConfigUrl(s.CompetitionId), bad)).StatusCode);
    }

    // ---- Required answers ----

    [Fact]
    public async Task Required_Parts_AreRefusedWhenMissing_AndStoredWhenGiven()
    {
        var s = await NewSetupAsync();
        await SetConfigAsync(s.CompetitionId, Basic(c => c with
        {
            Dob = FieldRequirement.Required, DobFormat = DobFormat.AgeGroup,
            Weight = FieldRequirement.Required, PonyPassport = FieldRequirement.Required, PonyAge = FieldRequirement.Required,
            MembershipNumber = FieldRequirement.Required, EmergencyContact = FieldRequirement.Required,
            MedicalNotes = FieldRequirement.Required,
            CustomFields = [new DecFormCustomField("note", "Saddle size", CustomFieldType.Text, true)],
        }));

        var empty = await SubmitAsync(s, Rider("Alice"));
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Contains("age group is needed", await MessageAsync(empty));

        var missing = new Func<RiderEntryInput>[]
        {
            () => Rider("Alice", ageGroup: "U12", passport: "P1", ponyAge: 9, member: "M1", contact: "Mum", phone: "07700", medical: "none", custom: new() { ["note"] = "17" }),
            () => Rider("Alice", ageGroup: "U12", weight: 30, ponyAge: 9, member: "M1", contact: "Mum", phone: "07700", medical: "none", custom: new() { ["note"] = "17" }),
            () => Rider("Alice", ageGroup: "U12", weight: 30, passport: "P1", member: "M1", contact: "Mum", phone: "07700", medical: "none", custom: new() { ["note"] = "17" }),
            () => Rider("Alice", ageGroup: "U12", weight: 30, passport: "P1", ponyAge: 9, contact: "Mum", phone: "07700", medical: "none", custom: new() { ["note"] = "17" }),
            () => Rider("Alice", ageGroup: "U12", weight: 30, passport: "P1", ponyAge: 9, member: "M1", contact: "Mum", medical: "none", custom: new() { ["note"] = "17" }),
            () => Rider("Alice", ageGroup: "U12", weight: 30, passport: "P1", ponyAge: 9, member: "M1", contact: "Mum", phone: "07700", custom: new() { ["note"] = "17" }),
            () => Rider("Alice", ageGroup: "U12", weight: 30, passport: "P1", ponyAge: 9, member: "M1", contact: "Mum", phone: "07700", medical: "none"),
        };
        foreach (var make in missing)
            Assert.Equal(HttpStatusCode.BadRequest, (await SubmitAsync(s, make())).StatusCode);

        var ok = await SubmitAsync(s, Rider("Alice", ageGroup: "U12", weight: 30.5m, passport: "P1", ponyAge: 9, member: "M1",
            contact: "Mum", phone: "07700", medical: "asthma", custom: new() { ["note"] = "17" }));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var rider = (await ok.ReadAsync<DeclarationFormDto>()).Riders.Single();
        Assert.Equal(("U12", 30.5m, "P1", 9, "M1", "Mum", "07700", "asthma"),
            (rider.AgeGroup, rider.WeightKg, rider.PonyPassportNumber, rider.PonyAge, rider.MembershipNumber, rider.EmergencyContactName, rider.EmergencyContactPhone, rider.MedicalNotes));
        Assert.Equal("17", rider.CustomValues!["note"]);
        Assert.Null(rider.DateOfBirth);
    }

    [Fact]
    public async Task BirthYear_AndFullDob_AreCheckedWhenRequired()
    {
        var s = await NewSetupAsync();
        await SetConfigAsync(s.CompetitionId, Basic(c => c with { Dob = FieldRequirement.Required, DobFormat = DobFormat.YearOnly }));
        Assert.Equal(HttpStatusCode.BadRequest, (await SubmitAsync(s, Rider("Alice"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SubmitAsync(s, Rider("Alice", year: 1850))).StatusCode);
        var ok = await SubmitAsync(s, Rider("Alice", year: 2014, dob: new DateTime(2014, 5, 5)));
        var rider = (await ok.ReadAsync<DeclarationFormDto>()).Riders.Single();
        Assert.Equal((2014, null), (rider.BirthYear, rider.DateOfBirth)); // the full date isn't kept when only the year is asked for

        await SetConfigAsync(s.CompetitionId, Basic(c => c with { Dob = FieldRequirement.Required, DobFormat = DobFormat.Full }));
        Assert.Equal(HttpStatusCode.BadRequest, (await SubmitAsync(s, Rider("Alice"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SubmitAsync(s, Rider("Alice", dob: new DateTime(2014, 5, 5)))).StatusCode);
    }

    [Fact]
    public async Task OptionalAndOffParts_AreNotRequired_AndOffAnswersAreNeverStored()
    {
        var s = await NewSetupAsync();
        await SetConfigAsync(s.CompetitionId, Basic(c => c with { Weight = FieldRequirement.Optional, MedicalNotes = FieldRequirement.Optional }));

        var plain = await SubmitAsync(s, Rider("Alice"));
        Assert.Equal(HttpStatusCode.OK, plain.StatusCode);

        // Passport and DOB are off: a client that sends them anyway doesn't get them kept.
        var sent = await SubmitAsync(s, Rider("Alice", weight: 28, passport: "P9", member: "M9", contact: "Mum", phone: "1",
            dob: new DateTime(2014, 5, 5), height: 12.2m, medical: "x"));
        var rider = (await sent.ReadAsync<DeclarationFormDto>()).Riders.Single();
        Assert.Equal((28m, "x"), (rider.WeightKg, rider.MedicalNotes));
        Assert.Null(rider.PonyPassportNumber);
        Assert.Null(rider.MembershipNumber);
        Assert.Null(rider.EmergencyContactName);
        Assert.Null(rider.DateOfBirth);
        Assert.Null(rider.PonyHeightHands);
    }

    [Fact]
    public async Task EmergencyContact_NeedsBothNameAndPhone_OrNeither()
    {
        var s = await NewSetupAsync();
        await SetConfigAsync(s.CompetitionId, Basic(c => c with { EmergencyContact = FieldRequirement.Optional }));

        Assert.Equal(HttpStatusCode.BadRequest, (await SubmitAsync(s, Rider("Alice", contact: "Mum"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SubmitAsync(s, Rider("Alice"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SubmitAsync(s, Rider("Alice", contact: "Mum", phone: "07700"))).StatusCode);
    }

    [Fact]
    public async Task ReserveRider_HasNoPonyPartsAsked()
    {
        var s = await NewSetupAsync();
        await SetConfigAsync(s.CompetitionId, Basic(c => c with { PonyPassport = FieldRequirement.Required, PonyAge = FieldRequirement.Required, PonyHeight = FieldRequirement.Required }));

        var r = await SubmitAsync(s, Rider("Riding", passport: "P1", ponyAge: 8, height: 12.2m), Rider("Reserve", reserve: true, passport: "ignored"));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var reserve = (await r.ReadAsync<DeclarationFormDto>()).Riders.Single(x => x.IsReserve);
        Assert.Null(reserve.PonyPassportNumber);
    }

    [Theory]
    [InlineData(2.0, false)]
    [InlineData(400.0, false)]
    [InlineData(31.0, true)]
    public async Task Weight_MustBeSensible(double kg, bool ok)
    {
        var s = await NewSetupAsync();
        await SetConfigAsync(s.CompetitionId, Basic(c => c with { Weight = FieldRequirement.Optional }));

        var r = await SubmitAsync(s, Rider("Alice", weight: (decimal)kg));

        Assert.Equal(ok, r.StatusCode == HttpStatusCode.OK);
    }

    [Fact]
    public async Task CustomFields_RejectBadNumbers_AndTooLongText()
    {
        var s = await NewSetupAsync();
        await SetConfigAsync(s.CompetitionId, Basic(c => c with
        {
            CustomFields = [new DecFormCustomField("n", "Girth", CustomFieldType.Number, false),
                            new DecFormCustomField("t", "Notes", CustomFieldType.Text, false)],
        }));

        Assert.Equal(HttpStatusCode.BadRequest, (await SubmitAsync(s, Rider("A", custom: new() { ["n"] = "lots" }))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SubmitAsync(s, Rider("A", custom: new() { ["n"] = "99999999999" }))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SubmitAsync(s, Rider("A", custom: new() { ["t"] = new string('x', 301) }))).StatusCode);
        // Unknown ids are dropped; blanks mean "not answered".
        var ok = await SubmitAsync(s, Rider("A", custom: new() { ["zzz"] = "1", ["n"] = " ", ["t"] = "fine" }));
        var rider = (await ok.ReadAsync<DeclarationFormDto>()).Riders.Single();
        Assert.Equal(new[] { "t" }, rider.CustomValues!.Keys);
    }

    // ---- Flags ----

    [Fact]
    public async Task NumberRuleBreach_IsAcceptedButFlagged_ForTheOrganiser()
    {
        var s = await NewSetupAsync();
        await SetConfigAsync(s.CompetitionId, Basic(c => c with
        {
            CustomFields = [new DecFormCustomField("girth", "Girth", CustomFieldType.Number, false, 20, 90, "cm")],
        }));

        var over = await SubmitAsync(s, Rider("Alice", custom: new() { ["girth"] = "95.5" }), Rider("Bea", custom: new() { ["girth"] = "50" }),
            Rider("Cat", custom: new() { ["girth"] = "10" }));

        Assert.Equal(HttpStatusCode.OK, over.StatusCode);
        var dto = await over.ReadAsync<DeclarationFormDto>();
        Assert.Equal(2, dto.FlagCount);
        Assert.Equal("Alice: Girth is 95.5 cm, over the limit of 90 cm.", Assert.Single(dto.Riders.Single(r => r.FullName == "Alice").Flags!));
        Assert.Equal("Cat: Girth is 10 cm, under the minimum of 20 cm.", Assert.Single(dto.Riders.Single(r => r.FullName == "Cat").Flags!));
        Assert.Null(dto.Riders.Single(r => r.FullName == "Bea").Flags);

        var flags = await (await (await _f.TrainerAsync()).GetAsync(FlagsUrl(s.CompetitionId))).ReadAsync<List<TeamFlagsDto>>();
        var team = Assert.Single(flags);
        Assert.Equal((s.TeamId, 2), (team.TeamId, team.Flags.Count));

        // A limit exactly on the edge is not a breach.
        var edge = await (await SubmitAsync(s, Rider("Dee", custom: new() { ["girth"] = "90" }))).ReadAsync<DeclarationFormDto>();
        Assert.Equal(0, edge.FlagCount);
        Assert.Empty(await (await (await _f.TrainerAsync()).GetAsync(FlagsUrl(s.CompetitionId))).ReadAsync<List<TeamFlagsDto>>());
    }

    [Fact]
    public async Task Flags_AreStaffOnly()
    {
        var s = await NewSetupAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync(FlagsUrl(s.CompetitionId))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await (await _f.SignupAsync("Member")).Client.GetAsync(FlagsUrl(s.CompetitionId))).StatusCode);
    }

    [Fact]
    public async Task ChangingTheRules_DoesNotRewriteFlagsOnFormsAlreadyIn()
    {
        var s = await NewSetupAsync();
        await SetConfigAsync(s.CompetitionId, Basic(c => c with
        {
            CustomFields = [new DecFormCustomField("g", "Girth", CustomFieldType.Number, false, null, 50)],
        }));
        await SubmitAsync(s, Rider("Alice", custom: new() { ["g"] = "60" }));

        await SetConfigAsync(s.CompetitionId, Basic(c => c with
        {
            CustomFields = [new DecFormCustomField("g", "Girth", CustomFieldType.Number, false, null, 500)],
        }));

        var forms = await (await (await _f.TrainerAsync()).GetAsync($"{Forms}?teamId={s.TeamId}")).ReadAsync<List<DeclarationFormDto>>();
        Assert.Equal(1, Assert.Single(forms).FlagCount);
    }

    // ---- Competitions that never set one up ----

    [Fact]
    public async Task LegacyCompetition_KeepsTodaysForm_AndRefusesNothingNew()
    {
        var s = await NewSetupAsync();

        // No date of birth and no height, as the API has always allowed.
        var bare = await SubmitAsync(s, Rider("Alice"));
        Assert.Equal(HttpStatusCode.OK, bare.StatusCode);

        // Today's four answers are kept; the new ones aren't asked for, so they aren't stored.
        var r = await SubmitAsync(s, Rider("Alice", dob: new DateTime(2014, 5, 5), height: 12.2m, weight: 30, medical: "x", passport: "P"));
        var dto = await r.ReadAsync<DeclarationFormDto>();
        var rider = dto.Riders.Single();
        Assert.Equal((new DateTime(2014, 5, 5), 12.2m, "Pickle"), (rider.DateOfBirth, rider.PonyHeightHands, rider.HorseName));
        Assert.Null(rider.WeightKg);
        Assert.Null(rider.MedicalNotes);
        Assert.Null(rider.PonyPassportNumber);
        Assert.Equal(0, dto.FlagCount);
    }

    // ---- Privacy ----

    private async Task<(Setup Setup, string Marker)> SubmitPersonalAsync()
    {
        var s = await NewSetupAsync();
        await SetConfigAsync(s.CompetitionId, Basic(c => c with
        {
            Dob = FieldRequirement.Optional, DobFormat = DobFormat.Full,
            Weight = FieldRequirement.Optional, PonyPassport = FieldRequirement.Optional, PonyAge = FieldRequirement.Optional,
            MembershipNumber = FieldRequirement.Optional, EmergencyContact = FieldRequirement.Optional, MedicalNotes = FieldRequirement.Optional,
            CustomFields = [new DecFormCustomField("secret", "Secret", CustomFieldType.Text, false)],
        }));
        var marker = $"zz{Guid.NewGuid():N}";
        var r = await SubmitAsync(s, Rider($"Rider {marker}", dob: new DateTime(2014, 5, 5), weight: 31.5m, passport: $"PASS{marker}",
            ponyAge: 11, member: $"MEM{marker}", contact: $"Contact{marker}", phone: "07700900123", medical: $"Medical{marker}",
            custom: new() { ["secret"] = $"Custom{marker}" }));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return (s, marker);
    }

    private static void AssertNothingPersonal(string body, string marker)
    {
        foreach (var secret in new[] { $"Medical{marker}", $"Contact{marker}", $"PASS{marker}", $"MEM{marker}", $"Custom{marker}", "07700900123", "07123456789" })
            Assert.DoesNotContain(secret, body);
    }

    [Fact]
    public async Task PersonalAnswers_AreGivenToTheSubmitterAndStaff_AndToNoOneElse()
    {
        var (s, marker) = await SubmitPersonalAsync();
        var url = $"{Forms}?competitionId={s.CompetitionId}";

        foreach (var staff in new HttpClient[] { await _f.TrainerAsync(), await _f.AdminAsync() })
        {
            var rider = Assert.Single(Assert.Single(await (await staff.GetAsync(url)).ReadAsync<List<DeclarationFormDto>>()).Riders);
            Assert.Equal(($"Medical{marker}", $"MEM{marker}", $"PASS{marker}", 31.5m, 11, "07700900123"),
                (rider.MedicalNotes, rider.MembershipNumber, rider.PonyPassportNumber, rider.WeightKg, rider.PonyAge, rider.EmergencyContactPhone));
            Assert.Equal($"Custom{marker}", rider.CustomValues!["secret"]);
        }

        // An anonymous visitor and an unrelated signed-in trainer see the locked form, with the names but none of the answers.
        foreach (var outsider in new[] { _f.CreateClient(), (await _f.ApprovedTrainerAsync()).Client })
        {
            var response = await outsider.GetAsync(url);
            var body = await response.Content.ReadAsStringAsync();
            var rider = Assert.Single(Assert.Single(System.Text.Json.JsonSerializer.Deserialize<List<DeclarationFormDto>>(body,
                new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!).Riders);
            Assert.Equal($"Rider {marker}", rider.FullName);
            Assert.Null(rider.DateOfBirth);
            Assert.Null(rider.WeightKg);
            Assert.Null(rider.MedicalNotes);
            Assert.Null(rider.EmergencyContactName);
            Assert.Null(rider.EmergencyContactPhone);
            Assert.Null(rider.MembershipNumber);
            Assert.Null(rider.PonyPassportNumber);
            Assert.Null(rider.PonyAge);
            Assert.Null(rider.CustomValues);
            Assert.Null(rider.Flags);
            AssertNothingPersonal(body, marker);
        }
    }

    [Fact]
    public async Task PersonalAnswers_AreNotOnAnyOtherPublicEndpoint()
    {
        var (s, marker) = await SubmitPersonalAsync();
        var anonymous = _f.CreateClient();
        var id = (await _f.InDbAsync(db => db.DeclarationForms.Where(d => d.TeamId == s.TeamId).Select(d => d.Id).SingleAsync()));

        var urls = new[]
        {
            $"{Forms}/{id}",
            $"/api/competitions/{s.CompetitionId}",
            $"/api/competitions/{s.CompetitionId}/first-view",
            $"/api/competitions/{s.CompetitionId}/teams",
            $"/api/teams?competitionId={s.CompetitionId}",
            $"/api/stats/search?q={marker}",
            $"/api/stats/riders?q={marker}",
            $"/api/stats/ponies?q=Pickle",
            "/api/stats/teams?q=Team",
        };
        foreach (var url in urls)
        {
            var response = await anonymous.GetAsync(url);
            var body = await response.Content.ReadAsStringAsync();
            AssertNothingPersonal(body, marker);
        }
    }

    // ---- Team name from the entry ----

    private static string SignupUrl(CompetitionSection s) => $"/api/competitions/{s.CompetitionId}/sections/{s.Id}/signups";

    [Fact]
    public async Task TeamNameGivenAtEntry_BecomesTheTeam_AndIsShownOnItsDecForm()
    {
        var section = await _f.NewSectionAsync();
        var trainer = await _f.TrainerAsync();
        var name = $"Welsh Dragons {Guid.NewGuid():N}"[..24];
        foreach (var rider in new[] { "R1", "R2" })
            (await trainer.PostAsJsonAsync(SignupUrl(section), new CreateSectionSignupRequest(rider, "Club X", null,
                AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, TeamName: name))).EnsureSuccessStatusCode();
        (await trainer.PostAsJsonAsync(SignupUrl(section), new CreateSectionSignupRequest("Solo", "Club X", null,
            AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion))).EnsureSuccessStatusCode();

        var admin = await _f.AdminAsync();
        var formed = await (await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/sections/{section.Id}/form-teams",
            new FormTeamsFromSignupsRequest(5, false, false))).ReadAsync<FormTeamsResult>();
        Assert.Contains(name, formed.Created.Select(t => t.DisplayName));
        var named = formed.Created.Single(t => t.DisplayName == name);
        var unnamed = formed.Created.Single(t => t.DisplayName != name);

        await _f.InDbAsync(async db =>
        {
            foreach (var t in new[] { named.Id, unnamed.Id }) db.DeclarationForms.Add(new DeclarationForm { TeamId = t, IsLocked = true });
            await db.SaveChangesAsync();
        });
        var forms = await (await _f.CreateClient().GetAsync($"{Forms}?competitionId={section.CompetitionId}")).ReadAsync<List<DeclarationFormDto>>();

        // Public, like the team's name; an entry with no team name is unchanged.
        Assert.Equal(name, forms.Single(f => f.TeamId == named.Id).EntryTeamName);
        Assert.Null(forms.Single(f => f.TeamId == unnamed.Id).EntryTeamName);
    }

    [Fact]
    public async Task EntryTeamName_SurvivesTheTrainerRenamingTheTeamOnTheForm()
    {
        var section = await _f.NewSectionAsync();
        var trainer = await _f.TrainerAsync();
        var name = $"Originals {Guid.NewGuid():N}"[..20];
        (await trainer.PostAsJsonAsync(SignupUrl(section), new CreateSectionSignupRequest("R1", "Club Y", null,
            AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, TeamName: name, WholeTeam: false))).EnsureSuccessStatusCode();
        var formed = await (await (await _f.AdminAsync()).PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/sections/{section.Id}/form-teams",
            new FormTeamsFromSignupsRequest(5, false, false))).ReadAsync<FormTeamsResult>();
        var team = formed.Created.Single();
        await _f.InDbAsync(async db =>
        {
            (await db.Teams.SingleAsync(t => t.Id == team.Id)).TrainerUserId = await _f.TrainerIdAsync();
            await db.SaveChangesAsync();
        });

        var r = await trainer.PostAsJsonAsync(Forms, new SubmitDeclarationFormRequest(team.Id, null, [Rider("R1", dob: new DateTime(2014, 1, 1), height: 12m)],
            false, null, AcceptTerms: true, TeamName: "Renamed"));

        var dto = await r.ReadAsync<DeclarationFormDto>();
        Assert.Equal(("Renamed", name), (dto.TeamName, dto.EntryTeamName));
    }

    // ---- Existing databases ----

    [Fact]
    public async Task ExistingSqliteDatabase_GainsTheDecFormColumns_WithoutLosingRiders()
    {
        var s = await NewSetupAsync();
        await SetConfigAsync(s.CompetitionId, Basic());
        await SubmitAsync(s, Rider("Before the upgrade", dob: new DateTime(2014, 5, 5)));
        await _f.InDbAsync(db => db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE "Competitions" DROP COLUMN "DecFormConfigJson";
            ALTER TABLE "RiderEntries" DROP COLUMN "BirthYear";
            ALTER TABLE "RiderEntries" DROP COLUMN "AgeGroup";
            ALTER TABLE "RiderEntries" DROP COLUMN "WeightKg";
            ALTER TABLE "RiderEntries" DROP COLUMN "PonyPassportNumber";
            ALTER TABLE "RiderEntries" DROP COLUMN "PonyAge";
            ALTER TABLE "RiderEntries" DROP COLUMN "MembershipNumber";
            ALTER TABLE "RiderEntries" DROP COLUMN "EmergencyContactName";
            ALTER TABLE "RiderEntries" DROP COLUMN "EmergencyContactPhone";
            ALTER TABLE "RiderEntries" DROP COLUMN "MedicalNotes";
            ALTER TABLE "RiderEntries" DROP COLUMN "CustomValuesJson";
            ALTER TABLE "RiderEntries" DROP COLUMN "FlagsJson";
            """));

        await DbInitializer.SeedAsync(_f.Services);
        await DbInitializer.SeedAsync(_f.Services); // running twice is harmless

        await _f.InDbAsync(async db =>
        {
            db.ChangeTracker.Clear();
            var kept = await db.RiderEntries.AsNoTracking().SingleAsync(r => r.FullName == "Before the upgrade" && r.DeclarationForm!.TeamId == s.TeamId);
            Assert.Null(kept.WeightKg);
            Assert.Null((await db.Competitions.AsNoTracking().SingleAsync(c => c.Id == s.CompetitionId)).DecFormConfigJson);
        });
    }

    [Fact]
    public async Task ClonedCompetition_KeepsTheDecFormSetup()
    {
        var s = await NewSetupAsync();
        await SetConfigAsync(s.CompetitionId, Basic(c => c with { Weight = FieldRequirement.Required }));
        var start = DateTime.UtcNow.Date.AddDays(60);

        var response = await (await _f.TrainerAsync()).PostAsJsonAsync($"/api/event-tools/competitions/{s.CompetitionId}/clone",
            new CloneCompetitionRequest("Next one", start, start.AddDays(1)));
        var clone = await response.ReadAsync<CloneCompetitionResultDto>();

        var json = await _f.InDbAsync(db => db.Competitions.Where(c => c.Id == clone.CompetitionId).Select(c => c.DecFormConfigJson).SingleAsync());
        Assert.Equal(FieldRequirement.Required, DecFormConfig.Parse(json)!.Weight);
        Assert.Null(DecFormConfig.Parse("not json"));
        Assert.Null(DecFormConfig.Parse(" "));
    }

    [Fact]
    public void RiderAgeEligibility_UsesFirstJanuaryOfCompetitionYear_AndFallsBackToSectionAgeGroup()
    {
        // Competition is on 15 August 2026, so eligibility date is 1 January 2026.
        var compDate = new DateTime(2026, 8, 15, 0, 0, 0, DateTimeKind.Utc);

        // Rider born 10 March 2014 turns 12 in March 2026, but was 11 on 1 January 2026 -> eligible for Under 12.
        var eligibleRider = new RiderEntry
        {
            FullName = "Alice",
            DateOfBirth = new DateTime(2014, 3, 10, 0, 0, 0, DateTimeKind.Utc),
            AgeGroup = null,
        };
        Assert.Equal(11, DecFormRules.AgeYears(eligibleRider.DateOfBirth.Value, compDate));
        Assert.Null(DecFormRules.CheckAgeEligibility(eligibleRider, compDate, sectionAgeGroup: "Under 12"));

        // Rider born 31 December 2013 was already 12 on 1 January 2026 -> flagged for Under 12 via sectionAgeGroup fallback.
        var overAgeRider = new RiderEntry
        {
            FullName = "Bob",
            DateOfBirth = new DateTime(2013, 12, 31, 0, 0, 0, DateTimeKind.Utc),
            AgeGroup = null,
        };
        Assert.Equal(12, DecFormRules.AgeYears(overAgeRider.DateOfBirth.Value, compDate));
        var flag = DecFormRules.CheckAgeEligibility(overAgeRider, compDate, sectionAgeGroup: "Under 12");
        Assert.NotNull(flag);
        Assert.Contains("1 January 2026", flag);
        Assert.Contains("Under 12", flag);
    }
}
