using MountedGames.Api.Services;

namespace MountedGames.Api.Tests.Services;

public class RiderNamesTests
{
    [Theory]
    [InlineData("Oliver Smith", "Oliver S.")]
    [InlineData("oliver smith", "oliver S.")]
    [InlineData("Mary Jane Watson", "Mary Jane W.")]
    [InlineData("Mary van der Berg", "Mary van der B.")]
    [InlineData("  Oliver    Smith  ", "Oliver S.")]
    [InlineData("Oliver\tSmith", "Oliver S.")]
    [InlineData("Oliver S.", "Oliver S.")]
    [InlineData("Oliver S", "Oliver S.")]
    [InlineData("Zoë Émile", "Zoë É.")]
    [InlineData("Oliver", "Oliver")]
    [InlineData("  Oliver ", "Oliver")]
    [InlineData("", "")]
    [InlineData("   ", "")]
    [InlineData(null, "")]
    public void ShortenSurname_UsesTheLastWordsInitial(string? input, string expected)
        => Assert.Equal(expected, RiderNames.ShortenSurname(input));

    [Fact]
    public void ShortenSurname_KeepsSurrogatePairsWhole()
        => Assert.Equal("Ann \U0001D49C.", RiderNames.ShortenSurname("Ann \U0001D49Cbc"));

    [Theory]
    [InlineData(true, false, "Oliver S.")]
    [InlineData(true, true, "Oliver Smith")]
    [InlineData(false, false, "Oliver Smith")]
    [InlineData(false, true, "Oliver Smith")]
    public void Display_ShortensOnlyForViewersWhoCannotSeeFullNames(bool initialOnly, bool staff, string expected)
        => Assert.Equal(expected, RiderNames.Display(" Oliver  Smith ", initialOnly, staff));

    [Fact]
    public void Display_HandlesNull() => Assert.Equal("", RiderNames.Display(null, false, false));
}
