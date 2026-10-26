using System.Text;
using MountedGames.Api.Services.Calendar;

namespace MountedGames.Api.Tests.Calendar;

public class IcsCalendarTests
{
    private static readonly DateTime Start = new(2026, 10, 17, 9, 30, 0, DateTimeKind.Utc);

    private static IcsEvent Event(string summary = "Heat", string uid = "heat-1@mg-app", string? description = null,
        string? location = null, string? url = null, int? sequence = null, DateTime? modified = null) =>
        new(uid, Start, Start.AddMinutes(30), summary, Start.AddDays(-1), location, description, url, sequence, modified);

    private static string[] Lines(string ics) => ics.Split("\r\n");

    [Fact]
    public void Build_WritesACompleteCalendarWithCrlfLineEnds()
    {
        var ics = new IcsCalendar("-//Test//EN") { Name = "My team" }.Add(Event(location: "Field 1")).Build();

        Assert.StartsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n", ics);
        Assert.EndsWith("END:VEVENT\r\nEND:VCALENDAR\r\n", ics);
        Assert.DoesNotContain("\n", ics.Replace("\r\n", ""));
        var lines = Lines(ics);
        Assert.Contains("X-WR-CALNAME:My team", lines);
        Assert.Contains("UID:heat-1@mg-app", lines);
        Assert.Contains("DTSTAMP:20261016T093000Z", lines);
        Assert.Contains("DTSTART:20261017T093000Z", lines);
        Assert.Contains("DTEND:20261017T100000Z", lines);
        Assert.Contains("SUMMARY:Heat", lines);
        Assert.Contains("LOCATION:Field 1", lines);
    }

    [Fact]
    public void Times_AreUtcWithZ_WhateverTheKind()
    {
        Assert.Equal("20261017T093000Z", IcsCalendar.FormatUtc(Start));
        Assert.Equal("20261017T093000Z", IcsCalendar.FormatUtc(DateTime.SpecifyKind(Start, DateTimeKind.Unspecified)));
        var local = DateTime.SpecifyKind(Start, DateTimeKind.Utc).ToLocalTime();
        Assert.Equal("20261017T093000Z", IcsCalendar.FormatUtc(local));
    }

    [Fact]
    public void Text_EscapesSeparatorsAndLineBreaks()
    {
        Assert.Equal(@"a\\b\;c\,d\ne\nf\ng", IcsCalendar.EscapeText("a\\b;c,d\ne\rf\r\ng"));
        Assert.Equal("ab", IcsCalendar.EscapeText("a\u0000\u0007b"));
    }

    [Fact]
    public void ValuesCannotStartANewLine()
    {
        var hostile = "Pony Club\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Fake";
        var ics = new IcsCalendar("-//T//EN").Add(Event(summary: hostile, description: hostile, location: hostile, uid: hostile)).Build();

        var lines = Lines(ics);
        Assert.Single(lines, l => l == "BEGIN:VEVENT");
        Assert.Single(lines, l => l == "END:VEVENT");
        Assert.DoesNotContain("SUMMARY:Fake", lines);
        Assert.Contains(lines, l => l.StartsWith("SUMMARY:Pony Club\\nEND:VEVENT"));
    }

    [Fact]
    public void LongLines_AreFoldedAtSeventyFiveOctets_AndUnfoldToTheOriginal()
    {
        var summary = new string('a', 200);
        var ics = new IcsCalendar("-//T//EN").Add(Event(summary: summary)).Build();

        var lines = Lines(ics);
        Assert.All(lines, l => Assert.True(Encoding.UTF8.GetByteCount(l) <= 75, l));
        Assert.Contains(lines, l => l.StartsWith(' '));
        Assert.Contains("SUMMARY:" + summary, ics.Replace("\r\n ", "").Split("\r\n"));
    }

    [Fact]
    public void Folding_NeverSplitsAMultiByteCharacter()
    {
        // 3-byte characters and a surrogate pair (4 bytes) land on every possible boundary.
        foreach (var prefix in Enumerable.Range(0, 6))
        {
            var summary = new string('x', prefix) + string.Concat(Enumerable.Repeat("€🐴é", 30));
            var ics = new IcsCalendar("-//T//EN").Add(Event(summary: summary)).Build();

            var lines = Lines(ics);
            Assert.All(lines, l => Assert.True(Encoding.UTF8.GetByteCount(l) <= 75));
            var unfolded = ics.Replace("\r\n ", "");
            Assert.Contains("SUMMARY:" + summary, unfolded.Split("\r\n"));
            Assert.DoesNotContain('�', ics);
            // Valid UTF-8 end to end.
            Assert.Equal(ics, Encoding.UTF8.GetString(new UTF8Encoding(false, true).GetBytes(ics)));
        }
    }

    [Fact]
    public void ALineOfExactlySeventyFiveOctetsIsNotFolded()
    {
        var summary = new string('a', 75 - "SUMMARY:".Length);
        var ics = new IcsCalendar("-//T//EN").Add(Event(summary: summary)).Build();

        Assert.Contains("SUMMARY:" + summary, Lines(ics));
        Assert.DoesNotContain("\r\n \r\n", ics);
    }

    [Fact]
    public void SequenceAndLastModified_AreWrittenWhenGiven_AndOmittedOtherwise()
    {
        var without = new IcsCalendar("-//T//EN").Add(Event()).Build();
        Assert.DoesNotContain("SEQUENCE", without);
        Assert.DoesNotContain("LAST-MODIFIED", without);

        var with = new IcsCalendar("-//T//EN").Add(Event(sequence: 3, modified: Start.AddHours(2))).Build();
        Assert.Contains("SEQUENCE:3\r\n", with);
        Assert.Contains("LAST-MODIFIED:20261017T113000Z\r\n", with);
    }

    [Fact]
    public void UrlIsNotTextEscaped_ButHasNoWhitespaceOrControlCharacters()
    {
        var ics = new IcsCalendar("-//T//EN").Add(Event(url: "https://example.org/competitions/3?a=1;b=2,c\r\nEND:VEVENT")).Build();

        Assert.Contains("URL:https://example.org/competitions/3?a=1;b=2,cEND:VEVENT\r\n", ics);
        Assert.Single(Lines(ics), l => l == "END:VEVENT");
    }

    [Fact]
    public void SubscriptionHints_AreWrittenForRefreshIntervals()
    {
        var hourly = new IcsCalendar("-//T//EN") { RefreshInterval = TimeSpan.FromHours(1) }.Build();
        Assert.Contains("REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n", hourly);
        Assert.Contains("X-PUBLISHED-TTL:PT1H\r\n", hourly);
        Assert.Contains("REFRESH-INTERVAL;VALUE=DURATION:PT90M\r\n", new IcsCalendar("-//T//EN") { RefreshInterval = TimeSpan.FromMinutes(90) }.Build());
        Assert.Contains("PT1M\r\n", new IcsCalendar("-//T//EN") { RefreshInterval = TimeSpan.Zero }.Build());
    }

    [Fact]
    public void EmptyOptionalFieldsAreLeftOut()
    {
        var ics = new IcsCalendar("-//T//EN") { Name = " " }.Add(Event(description: " ", location: "", url: " ")).Build();

        Assert.DoesNotContain("X-WR-CALNAME", ics);
        Assert.DoesNotContain("DESCRIPTION", ics);
        Assert.DoesNotContain("LOCATION", ics);
        Assert.DoesNotContain("URL:", ics);
    }

    [Fact]
    public void AllDayEvents_EmitValueDateWithoutTime()
    {
        var allDay = new IcsEvent(
            Uid: "competition-1@mg-app",
            StartUtc: new DateTime(2026, 10, 17, 0, 0, 0, DateTimeKind.Utc),
            EndUtc: new DateTime(2026, 10, 19, 0, 0, 0, DateTimeKind.Utc),
            Summary: "Weekend Championships",
            StampUtc: Start,
            AllDay: true);

        var lines = Lines(new IcsCalendar("-//T//EN").Add(allDay).Build());

        Assert.Contains("DTSTART;VALUE=DATE:20261017", lines);
        Assert.Contains("DTEND;VALUE=DATE:20261019", lines);
    }
}
