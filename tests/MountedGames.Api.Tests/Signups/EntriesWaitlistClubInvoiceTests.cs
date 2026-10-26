using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Controllers;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Email;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Signups;

public class EntriesWaitlistClubInvoiceTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public EntriesWaitlistClubInvoiceTests(ApiFactory f) => _f = f;

    private static string EntryUrl(CompetitionSection s) => $"/api/competitions/{s.CompetitionId}/sections/{s.Id}/signups";

    private static CreateSectionSignupInput MakeEntry(
        string fullName = "Synthetic Entrant",
        string? club = "Synthetic Valley PC",
        string? email = "entrant@example.invalid",
        bool whole = false,
        int teams = 1,
        int stables = 0,
        bool waitlist = false,
        string? arrivalWindow = null,
        string? vehicleReg = null) =>
        new(
            fullName,
            club,
            "07700900123",
            AcceptTerms: true,
            ConsentVersion: SignupTerms.WordingVersion,
            ContactEmail: email,
            TeamName: whole ? $"{club ?? "Synthetic"} Team" : null,
            WholeTeam: whole,
            TeamsCount: teams,
            StablesCount: stables,
            IsWaitlist: waitlist,
            ArrivalWindow: arrivalWindow,
            VehicleRegistration: vehicleReg
        );

    [Fact]
    public async Task BatchUnpaidReminders_SendsToSelectedPendingWithEmail_AndRecordsTimestamp()
    {
        var section = await _f.NewSectionAsync(priceMinor: 2500);
        var admin = await _f.AdminAsync();
        var (e1, _) = await _f.SignupAsync();
        var (e2, _) = await _f.SignupAsync();
        var (e3, _) = await _f.SignupAsync();

        var withEmail = await (await e1.PostAsJsonAsync(EntryUrl(section), MakeEntry("Alice Trainer", email: "alice@example.invalid"))).ReadAsync<SectionSignupExtendedDto>();
        var noEmail = await (await e2.PostAsJsonAsync(EntryUrl(section), MakeEntry("Bob Trainer", email: null))).ReadAsync<SectionSignupExtendedDto>();
        var alreadyPaid = await (await e3.PostAsJsonAsync(EntryUrl(section), MakeEntry("Cara Trainer", email: "cara@example.invalid"))).ReadAsync<SectionSignupExtendedDto>();
        (await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{alreadyPaid.Id}/mark-paid", new { })).EnsureSuccessStatusCode();

        // Empty selection is rejected.
        var emptyRes = await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/send-unpaid-reminders",
            new SendUnpaidRemindersInput(Array.Empty<int>()));
        Assert.Equal(HttpStatusCode.BadRequest, emptyRes.StatusCode);

        var remindRes = await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/send-unpaid-reminders",
            new SendUnpaidRemindersInput(new[] { withEmail.Id, noEmail.Id, alreadyPaid.Id }, "Please include your MG reference."));
        remindRes.EnsureSuccessStatusCode();
        var summary = await remindRes.ReadAsync<SendUnpaidRemindersResultDto>();
        Assert.Equal(1, summary.SentCount);
        Assert.Equal(0, summary.FailedCount);
        Assert.Equal(2, summary.SkippedCount);

        var updated = summary.Signups.Single(s => s.Id == withEmail.Id);
        Assert.NotNull(updated.LastReminderSentAt);

        // Verify email builder includes competition, section, amount, BACS details and MG-... reference.
        var comp = new Competition { Id = section.CompetitionId, Name = "Synthetic Show", PaymentDestination = "Sort 12-34-56 Acc 87654321" };
        var mail = SignupConfirmationEmail.BuildPaymentReminder(
            new SectionSignup { Id = withEmail.Id, AmountMinor = 2500 },
            comp,
            section,
            "alice@example.invalid",
            "Please pay by Friday.",
            "https://example.invalid/competitions/1");
        Assert.Contains($"MG-{section.CompetitionId}-{withEmail.Id}", mail.TextBody);
        Assert.Contains("£25.00", mail.TextBody);
        Assert.Contains("Sort 12-34-56 Acc 87654321", mail.TextBody);
        Assert.Contains("Please pay by Friday.", mail.TextBody);
    }

    [Fact]
    public async Task ArrivalAndVehicleManifest_CapturesUpdatesAndGroupsByArrivalWindow()
    {
        var section = await _f.NewSectionAsync(priceMinor: 2000);
        var admin = await _f.AdminAsync();
        var (e1, _) = await _f.SignupAsync();
        var (e2, _) = await _f.SignupAsync();

        var badWindow = await e1.PostAsJsonAsync(EntryUrl(section), MakeEntry(arrivalWindow: "ThursdayAfternoon"));
        Assert.Equal(HttpStatusCode.BadRequest, badWindow.StatusCode);

        var s1 = await (await e1.PostAsJsonAsync(EntryUrl(section),
            MakeEntry("Friday Entrant", stables: 2, arrivalWindow: "FridayEvening", vehicleReg: " ab12 cde "))).ReadAsync<SectionSignupExtendedDto>();
        Assert.Equal("FridayEvening", s1.ArrivalWindow);
        Assert.Equal("AB12 CDE", s1.VehicleRegistration);

        var s2 = await (await e2.PostAsJsonAsync(EntryUrl(section),
            MakeEntry("Saturday Entrant", stables: 1))).ReadAsync<SectionSignupExtendedDto>();

        // Entrant updates arrival window and vehicle registration on My Entries.
        var updateRes = await e2.PutAsJsonAsync($"/api/my/signups/{s2.Id}/arrival",
            new UpdateSignupArrivalInput("SaturdayMorning", "xy99 box"));
        updateRes.EnsureSuccessStatusCode();
        var updatedMine = await updateRes.ReadAsync<MySignupExtendedDto>();
        Assert.Equal("SaturdayMorning", updatedMine.ArrivalWindow);
        Assert.Equal("XY99 BOX", updatedMine.VehicleRegistration);

        // Another user cannot edit s1's arrival details.
        var forbidRes = await e2.PutAsJsonAsync($"/api/my/signups/{s1.Id}/arrival",
            new UpdateSignupArrivalInput("Other", "NOPE"));
        Assert.Equal(HttpStatusCode.Forbidden, forbidRes.StatusCode);

        var manifest = await (await admin.GetAsync($"/api/competitions/{section.CompetitionId}/arrival-manifest")).ReadAsync<ArrivalManifestDto>();
        Assert.Single(manifest.FridayEvening);
        Assert.Equal("AB12 CDE", manifest.FridayEvening[0].VehicleRegistration);
        Assert.Single(manifest.SaturdayMorning);
        Assert.Equal("XY99 BOX", manifest.SaturdayMorning[0].VehicleRegistration);
        Assert.Empty(manifest.Other);
    }

    [Fact]
    public async Task RefundAndFeeDispositionLedger_TracksRetainedPartialRefundAndRolloverTotals()
    {
        var section = await _f.NewSectionAsync(priceMinor: 4000);
        var admin = await _f.AdminAsync();
        var (e1, _) = await _f.SignupAsync();
        var (e2, _) = await _f.SignupAsync();
        var (e3, _) = await _f.SignupAsync();

        var s1 = await (await e1.PostAsJsonAsync(EntryUrl(section), MakeEntry("Withdrawn Partial"))).ReadAsync<SectionSignupExtendedDto>();
        var s2 = await (await e2.PostAsJsonAsync(EntryUrl(section), MakeEntry("Withdrawn Retained"))).ReadAsync<SectionSignupExtendedDto>();
        var s3 = await (await e3.PostAsJsonAsync(EntryUrl(section), MakeEntry("Withdrawn Rollover"))).ReadAsync<SectionSignupExtendedDto>();

        (await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{s1.Id}/mark-paid", new { })).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{s2.Id}/mark-paid", new { })).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{s3.Id}/mark-paid", new { })).EnsureSuccessStatusCode();

        (await e1.PostAsJsonAsync($"/api/my/signups/{s1.Id}/withdraw", new { })).EnsureSuccessStatusCode();
        (await e2.PostAsJsonAsync($"/api/my/signups/{s2.Id}/withdraw", new { })).EnsureSuccessStatusCode();
        (await e3.PostAsJsonAsync($"/api/my/signups/{s3.Id}/withdraw", new { })).EnsureSuccessStatusCode();

        // Rejects refund exceeding original fee.
        var overRefund = await admin.PutAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{s1.Id}/disposition",
            new UpdateSignupDispositionInput("Refunded", 5000, "Too much"));
        Assert.Equal(HttpStatusCode.BadRequest, overRefund.StatusCode);

        // Partial refund: £25 refunded, £15 retained admin fee.
        var d1 = await (await admin.PutAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{s1.Id}/disposition",
            new UpdateSignupDispositionInput("Refunded", 2500, "50% refunded less £15 admin fee"))).ReadAsync<SectionSignupExtendedDto>();
        Assert.Equal("Refunded", d1.FeeDisposition);
        Assert.Equal(2500, d1.RefundedAmountMinor);
        Assert.Equal("50% refunded less £15 admin fee", d1.DispositionNote);
        Assert.Equal(SignupPaymentStatus.Refunded, d1.Status);

        // Full fee retained.
        var d2 = await (await admin.PutAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{s2.Id}/disposition",
            new UpdateSignupDispositionInput("Retained", null, "Late withdrawal after vet deadline"))).ReadAsync<SectionSignupExtendedDto>();
        Assert.Equal("Retained", d2.FeeDisposition);

        // Credit rolled over.
        var d3 = await (await admin.PutAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{s3.Id}/disposition",
            new UpdateSignupDispositionInput("CreditRollover", null, "Rolled over to Autumn Show"))).ReadAsync<SectionSignupExtendedDto>();
        Assert.Equal("CreditRollover", d3.FeeDisposition);

        var ledger = await (await admin.GetAsync($"/api/competitions/{section.CompetitionId}/signups/disposition-summary")).ReadAsync<FeeDispositionLedgerSummaryDto>();
        Assert.Equal(2500, ledger.TotalRefundedMinor);
        Assert.Equal(1500 + 4000, ledger.TotalRetainedMinor);
        Assert.Equal(0, ledger.RefundsPendingMinor);
        Assert.Equal(4000, ledger.CreditsRolledOverMinor);
        Assert.Equal(3, ledger.Rows.Count);
    }

    [Fact]
    public async Task CombinedClubInvoice_GroupsMultiSectionClubEntries_AndAllocatesClubPaymentInOneTransaction()
    {
        var secU12 = await _f.NewSectionAsync(SectionFormat.Teams, priceMinor: 4000);
        CompetitionSection secU15 = null!;
        await _f.InDbAsync(async db =>
        {
            secU15 = new CompetitionSection
            {
                CompetitionId = secU12.CompetitionId,
                AgeGroup = "U15",
                DisplayName = "Under 15",
                Format = SectionFormat.Teams,
                PriceMinor = 4500,
            };
            db.CompetitionSections.Add(secU15);
            await db.SaveChangesAsync();
        });

        var trainer = await _f.TrainerAsync();
        var admin = await _f.AdminAsync();

        var s1 = await (await trainer.PostAsJsonAsync(EntryUrl(secU12),
            MakeEntry("Club Manager", club: "Synthetic Oak PC", whole: true, teams: 2, stables: 3))).ReadAsync<SectionSignupExtendedDto>();
        var s2 = await (await trainer.PostAsJsonAsync(EntryUrl(secU15),
            MakeEntry("Club Manager", club: "Synthetic Oak PC", whole: true, teams: 1, stables: 2))).ReadAsync<SectionSignupExtendedDto>();
        await (await trainer.PostAsJsonAsync(EntryUrl(secU12),
            MakeEntry("Solo Club Manager", club: "Single Entry PC", whole: true, teams: 1))).ReadAsync<SectionSignupExtendedDto>();

        var invoices = await (await admin.GetAsync($"/api/competitions/{secU12.CompetitionId}/signups/club-invoices")).ReadAsync<List<ClubInvoiceGroupDto>>();
        var clubInvoice = Assert.Single(invoices);
        Assert.Equal("Synthetic Oak PC", clubInvoice.ClubName);
        Assert.Equal($"MGC-{secU12.CompetitionId}-SYNTHETIC-OAK-PC", clubInvoice.ClubBacsReference);
        Assert.Equal(2, clubInvoice.SignupsCount);
        Assert.Equal(3, clubInvoice.TeamsCount);
        Assert.Equal(5, clubInvoice.StablesCount);
        Assert.Equal(12500, clubInvoice.TotalAmountMinor);
        Assert.Equal(12500, clubInvoice.TotalDueMinor);

        var markPaidRes = await admin.PostAsJsonAsync($"/api/competitions/{secU12.CompetitionId}/signups/mark-club-paid",
            new MarkClubPaidInput("Synthetic Oak PC"));
        markPaidRes.EnsureSuccessStatusCode();
        var paidResult = await markPaidRes.ReadAsync<MarkClubPaidResultDto>();
        Assert.Equal(2, paidResult.MarkedPaidCount);
        Assert.Equal(12500, paidResult.TotalAmountMinor);
        Assert.All(paidResult.Signups, s =>
        {
            Assert.Equal(SignupPaymentStatus.Paid, s.Status);
            Assert.NotNull(s.TeamId);
        });
        Assert.Contains(paidResult.Signups, s => s.Id == s1.Id);
        Assert.Contains(paidResult.Signups, s => s.Id == s2.Id);
    }

    [Fact]
    public async Task WaitlistOfferAndAcceptance_Enforces24HourWindow_AndPromotesEntrantToPendingPayment()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Pairs, priceMinor: 3000, max: 1);
        var admin = await _f.AdminAsync();
        var (first, _) = await _f.SignupAsync();
        var (waitlistedUser, _) = await _f.SignupAsync();

        var active = await (await first.PostAsJsonAsync(EntryUrl(section), MakeEntry("Active Pair"))).ReadAsync<SectionSignupExtendedDto>();
        var waiting = await (await waitlistedUser.PostAsJsonAsync(EntryUrl(section),
            MakeEntry("Waitlisted Pair", waitlist: true))).ReadAsync<SectionSignupExtendedDto>();
        Assert.True(waiting.IsWaitlist);
        Assert.Equal(0, waiting.AmountMinor);

        // Cannot offer spot while section is still full.
        var fullOffer = await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{waiting.Id}/offer-waitlist-spot", new { });
        Assert.Equal(HttpStatusCode.Conflict, fullOffer.StatusCode);

        // Active entrant withdraws, freeing the spot.
        (await first.PostAsJsonAsync($"/api/my/signups/{active.Id}/withdraw", new { })).EnsureSuccessStatusCode();

        // Entrant cannot accept before an offer is made.
        var prematureAccept = await waitlistedUser.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{waiting.Id}/accept-waitlist-spot", new { });
        Assert.Equal(HttpStatusCode.Conflict, prematureAccept.StatusCode);

        // Organiser offers the spot (24h window).
        var offerRes = await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{waiting.Id}/offer-waitlist-spot", new { });
        offerRes.EnsureSuccessStatusCode();
        var offered = await offerRes.ReadAsync<SectionSignupExtendedDto>();
        Assert.NotNull(offered.WaitlistOfferedAt);
        Assert.NotNull(offered.WaitlistOfferExpiresAt);
        Assert.True(offered.WaitlistOfferExpiresAt > offered.WaitlistOfferedAt);

        // Entrant accepts the spot and moves from waitlist to Pending payment with the section price.
        var acceptRes = await waitlistedUser.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/{waiting.Id}/accept-waitlist-spot", new { });
        acceptRes.EnsureSuccessStatusCode();
        var accepted = await acceptRes.ReadAsync<MySignupExtendedDto>();
        Assert.False(accepted.IsWaitlist);
        Assert.Null(accepted.WaitlistOfferExpiresAt);
        Assert.Equal(3000, accepted.AmountMinor);
        Assert.Equal(SignupPaymentStatus.Pending, accepted.Status);
    }
}
