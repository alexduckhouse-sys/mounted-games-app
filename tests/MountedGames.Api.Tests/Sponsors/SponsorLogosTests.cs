using MountedGames.Api.Entities;
using MountedGames.Api.Services.Sponsors;

namespace MountedGames.Api.Tests.Sponsors;

public class SponsorLogosTests
{
    [Fact]
    public void RecognisesImagesByTheirFirstBytes()
    {
        Assert.Equal("image/png", SponsorLogos.Detect(SponsorsEndpointsTests.Png));
        Assert.Equal("image/jpeg", SponsorLogos.Detect(SponsorsEndpointsTests.Jpeg));
        Assert.Equal("image/webp", SponsorLogos.Detect(SponsorsEndpointsTests.Webp));
        Assert.Null(SponsorLogos.Detect("<svg/>"u8));
        Assert.Null(SponsorLogos.Detect("GIF89a......"u8));
        Assert.Null(SponsorLogos.Detect("RIFF....WAVE"u8));
        Assert.Null(SponsorLogos.Detect([]));
    }

    [Theory]
    [InlineData(null, true, null)]
    [InlineData("", true, null)]
    [InlineData("https://acme.example", true, "https://acme.example/")]
    [InlineData("http://acme.example", false, null)]
    [InlineData("https://", false, null)]
    [InlineData("https://u@acme.example", false, null)]
    public void LinksMustBeHttps(string? value, bool ok, string? expected)
    {
        Assert.Equal(ok, SponsorLogos.TryNormaliseLink(value, out var link));
        Assert.Equal(expected, link);
    }

    [Fact]
    public void EveryPlacementIsAKnownSingleFlag_SoANewOneNeedsNoOtherList()
    {
        foreach (var placement in Enum.GetValues<SponsorPlacement>().Where(p => p != SponsorPlacement.None))
        {
            Assert.True(SponsorPlacements.IsSingle(placement), placement.ToString());
            Assert.Equal(placement, SponsorPlacements.All & placement);
        }
        Assert.False(SponsorPlacements.IsSingle(SponsorPlacement.None));
        Assert.False(SponsorPlacements.IsSingle(SponsorPlacement.Timetable | SponsorPlacement.Results));
        Assert.False(SponsorPlacements.IsSingle((SponsorPlacement)(1 << 20)));
    }
}
