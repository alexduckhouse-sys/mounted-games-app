using System.Net.Http.Json;
using MountedGames.Api.Controllers;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Signups;

/// <summary>A club payment can cover several families: each contact's receipt lists only their own entries.</summary>
public class ClubReceiptPrivacyTests : IClassFixture<EmailApiFactory>
{
    private readonly EmailApiFactory _f;
    public ClubReceiptPrivacyTests(EmailApiFactory f) => _f = f;

    private static string EntryUrl(CompetitionSection s) => $"/api/competitions/{s.CompetitionId}/sections/{s.Id}/signups";

    private static CreateSectionSignupInput Entry(string fullName, string club, string email) =>
        new(fullName, club, "07700900123", AcceptTerms: true, ConsentVersion: SignupTerms.WordingVersion, ContactEmail: email);

    [Fact]
    public async Task MarkClubPaid_SendsEachContactOnlyTheirOwnEntries()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Pairs, priceMinor: 3000);
        var club = $"Receipt Privacy PC {Guid.NewGuid():N}"[..30];
        var (parentA, _) = await _f.SignupAsync();
        var (parentB, _) = await _f.SignupAsync();
        var admin = await _f.AdminAsync();

        (await parentA.PostAsJsonAsync(EntryUrl(section), Entry("Alpha Rider One", club, "alpha@example.invalid"))).EnsureSuccessStatusCode();
        (await parentA.PostAsJsonAsync(EntryUrl(section), Entry("Alpha Rider Two", club, "ALPHA@example.invalid"))).EnsureSuccessStatusCode();
        (await parentB.PostAsJsonAsync(EntryUrl(section), Entry("Bravo Rider", club, "bravo@example.invalid"))).EnsureSuccessStatusCode();
        _f.Sent.Clear();

        var res = await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/mark-club-paid",
            new MarkClubPaidInput(club));
        res.EnsureSuccessStatusCode();
        var paid = await res.ReadAsync<MarkClubPaidResultDto>();
        Assert.Equal(3, paid.MarkedPaidCount);
        Assert.Equal(9000, paid.TotalAmountMinor);

        var receipts = _f.Sent.Where(m => m.Subject.StartsWith("Club payment receipt", StringComparison.Ordinal)).ToList();
        Assert.Equal(2, receipts.Count);

        var alpha = Assert.Single(receipts, m => m.To.Equals("alpha@example.invalid", StringComparison.OrdinalIgnoreCase));
        Assert.Contains("Alpha Rider One", alpha.Text);
        Assert.Contains("Alpha Rider Two", alpha.Text);
        Assert.Contains("Your total: £60.00", alpha.Text);
        Assert.DoesNotContain("Bravo Rider", alpha.Text);
        Assert.DoesNotContain("Bravo Rider", alpha.Html);
        Assert.DoesNotContain("£90.00", alpha.Text);

        var bravo = Assert.Single(receipts, m => m.To == "bravo@example.invalid");
        Assert.Contains("Bravo Rider", bravo.Text);
        Assert.Contains("Your total: £30.00", bravo.Text);
        Assert.DoesNotContain("Alpha Rider", bravo.Text);
        Assert.DoesNotContain("Alpha Rider", bravo.Html);
    }

    [Fact]
    public async Task MarkClubPaid_WithoutReceiptEmail_SendsNothing()
    {
        var section = await _f.NewSectionAsync(SectionFormat.Pairs, priceMinor: 3000);
        var club = $"Quiet PC {Guid.NewGuid():N}"[..20];
        var (parent, _) = await _f.SignupAsync();
        var admin = await _f.AdminAsync();
        (await parent.PostAsJsonAsync(EntryUrl(section), Entry("Quiet Rider", club, "quiet@example.invalid"))).EnsureSuccessStatusCode();
        _f.Sent.Clear();

        (await admin.PostAsJsonAsync($"/api/competitions/{section.CompetitionId}/signups/mark-club-paid",
            new MarkClubPaidInput(club, SendReceiptEmail: false))).EnsureSuccessStatusCode();

        Assert.DoesNotContain(_f.Sent, m => m.Subject.StartsWith("Club payment receipt", StringComparison.Ordinal));
    }
}
