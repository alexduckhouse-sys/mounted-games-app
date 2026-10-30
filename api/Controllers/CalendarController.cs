using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Security;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Calendar;

namespace MountedGames.Api.Controllers;

/// <summary>
/// Add-to-calendar files. An event's <c>.ics</c> is public. A team's heats are a subscribable feed behind a
/// secret link, because calendar apps can't send a sign-in header; the feed lists only what the public timetable
/// already shows (heat time, age group, arena, lane) and no riders.
/// </summary>
[ApiController]
public partial class CalendarController(AppDbContext db, IConfiguration configuration, TimeProvider clock) : ControllerBase
{
    private const string ProductId = "-//Mounted Games//MG App//EN";
    private static readonly TimeSpan FeedRefresh = TimeSpan.FromHours(1);

    [GeneratedRegex("^[A-Za-z0-9_-]{20,64}$")]
    private static partial Regex TokenShape();

    // ----- Public: one competition as an event -----

    [HttpGet("api/competitions/{id:int}/calendar.ics")]
    [AllowAnonymous]
    [PublicRead]
    [EnableRateLimiting("public-read")]
    public async Task<IActionResult> CompetitionEvent(int id, [FromQuery] string? site, CancellationToken ct)
    {
        var c = await db.Competitions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return NotFound();

        var rawStart = Utc(c.StartDate);
        var startIsDate = TryCalendarDate(rawStart, out var startDay);
        var endDay = startDay;
        var endIsDate = c.EndDate is null ? startIsDate : TryCalendarDate(Utc(c.EndDate.Value), out endDay);
        var allDay = startIsDate && endIsDate && endDay >= startDay;
        var start = allDay ? startDay : rawStart;
        var end = allDay
            ? endDay.AddDays(1)
            : c.EndDate is { } e
                ? ((endIsDate ? UkTime.FromUk(endDay.AddHours(17)) : Utc(e)) is var candidate && candidate > start ? candidate : start.AddHours(8))
                : start.AddHours(8);
        var link = SiteLink(site, $"/competitions/{c.Id}");
        var description = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(c.Description)) description.Append(Truncate(c.Description.Trim(), 1500));
        if (link is not null)
        {
            if (description.Length > 0) description.Append("\n\n");
            description.Append("Timetable and live results: ").Append(link);
        }

        var calendar = new IcsCalendar(ProductId) { Name = c.Name }.Add(new IcsEvent(
            Uid: $"competition-{c.Id}@mg-app",
            StartUtc: start, EndUtc: end, Summary: c.Name,
            StampUtc: clock.GetUtcNow().UtcDateTime,
            Location: c.Location,
            Description: description.Length > 0 ? description.ToString() : null,
            Url: link,
            AllDay: allDay));

        // The link comes from the caller, so keep this out of shared caches.
        Response.Headers.CacheControl = "private, max-age=60";
        return File(Encoding.UTF8.GetBytes(calendar.Build()), "text/calendar; charset=utf-8", FileName(c.Name) + ".ics");
    }

    // ----- Public, behind the secret link: a team's heats -----

    [HttpGet("api/calendar/teams/{teamId:int}/{token}.ics")]
    [AllowAnonymous]
    [PublicRead]
    [EnableRateLimiting("public-read")]
    public async Task<IActionResult> TeamFeed(int teamId, string token, [FromQuery] string? site, CancellationToken ct)
    {
        // A wrong team, a wrong token and a switched-off feed all answer the same way.
        var team = await db.Teams.AsNoTracking().Include(t => t.Competition).Include(t => t.Section)
            .FirstOrDefaultAsync(t => t.Id == teamId, ct);
        if (team?.Competition is null || !TokenShape().IsMatch(token) || !CalendarFeedTokens.Matches(team.CalendarFeedTokenHash, token))
            return NotFound();

        var sessions = await db.Sessions.AsNoTracking().AsSplitQuery()
            .Where(s => s.CompetitionId == team.CompetitionId)
            .Include(s => s.Section)
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .Include(s => s.Heats).ThenInclude(h => h.Races)
            .ToListAsync(ct);
        var now = clock.GetUtcNow().UtcDateTime;
        var times = TimetableTimes.Compute(sessions, now);
        var link = SiteLink(site, $"/competitions/{team.CompetitionId}");

        var drafts = new List<HeatEvent>();
        foreach (var session in sessions.Where(s => s.Kind == SessionKind.Race).OrderBy(s => s.OrderIndex))
        {
            var ordered = session.Heats.OrderBy(h => h.OrderIndex).ToList();
            for (var i = 0; i < ordered.Count; i++)
            {
                var heat = ordered[i];
                var entry = heat.Entries.FirstOrDefault(x => x.TeamId == team.Id);
                if (entry is null || !times.TryGetValue(heat.Id, out var time) || time.Start is not { } start) continue;
                drafts.Add(BuildHeatEvent(team, team.Competition, session, heat, i, entry.LaneIndex, start, time.DurationMinutes, link));
            }
        }

        var versions = await db.CalendarHeatVersions.Where(v => v.TeamId == team.Id).ToDictionaryAsync(v => v.HeatId, ct);
        var calendar = new IcsCalendar(ProductId)
        {
            Name = $"{team.DisplayName} heats, {team.Competition.Name}",
            RefreshInterval = FeedRefresh,
        };
        var changed = false;
        foreach (var draft in drafts)
        {
            if (!versions.TryGetValue(draft.HeatId, out var version))
            {
                version = new CalendarHeatVersion { HeatId = draft.HeatId, TeamId = team.Id, Fingerprint = draft.Fingerprint, Sequence = 0, ModifiedAt = now };
                db.CalendarHeatVersions.Add(version);
                changed = true;
            }
            else if (version.Fingerprint != draft.Fingerprint)
            {
                version.Fingerprint = draft.Fingerprint;
                version.Sequence++;
                version.ModifiedAt = now;
                changed = true;
            }
            calendar.Add(draft.ToEvent(version));
        }
        if (changed)
        {
            try { await db.SaveChangesAsync(ct); }
            // A second request recorded the same heat first. Its numbers are as good as ours.
            catch (DbUpdateException) { }
        }

        var body = Encoding.UTF8.GetBytes(calendar.Build());
        var etag = new EntityTagHeaderValue($"\"{Convert.ToHexStringLower(SHA256.HashData(body), 0, 16)}\"");
        Response.Headers.ETag = etag.ToString();
        // The link is a secret, so shared caches must not keep it.
        Response.Headers.CacheControl = "private, no-cache";
        if (Request.GetTypedHeaders().IfNoneMatch.Any(t => t.Compare(etag, useStrongComparison: false)))
            return StatusCode(StatusCodes.Status304NotModified);
        return Content(Encoding.UTF8.GetString(body), "text/calendar; charset=utf-8");
    }

    // ----- Trainer and organiser: manage the secret link -----

    [HttpGet("api/teams/{teamId:int}/calendar-feed")]
    [Authorize]
    public async Task<ActionResult<CalendarFeedStatusDto>> FeedStatus(int teamId, CancellationToken ct)
    {
        var team = await LoadManagedTeamAsync(teamId, ct);
        if (team is null) return NotFound();
        return new CalendarFeedStatusDto(team.CalendarFeedTokenHash is not null, team.CalendarFeedTokenCreatedAt);
    }

    /// <summary>Creates the feed link, or replaces it: the old link stops working at once.</summary>
    [HttpPost("api/teams/{teamId:int}/calendar-feed")]
    [Authorize]
    public async Task<ActionResult<CalendarFeedCreatedDto>> CreateFeed(int teamId, CancellationToken ct)
    {
        var team = await LoadManagedTeamAsync(teamId, ct);
        if (team is null) return NotFound();
        var token = CalendarFeedTokens.Generate();
        team.CalendarFeedTokenHash = CalendarFeedTokens.Hash(token);
        team.CalendarFeedTokenCreatedAt = clock.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(ct);
        return new CalendarFeedCreatedDto(token, $"/api/calendar/teams/{team.Id}/{token}.ics", team.CalendarFeedTokenCreatedAt.Value);
    }

    [HttpDelete("api/teams/{teamId:int}/calendar-feed")]
    [Authorize]
    public async Task<IActionResult> DisableFeed(int teamId, CancellationToken ct)
    {
        var team = await LoadManagedTeamAsync(teamId, ct);
        if (team is null) return NotFound();
        team.CalendarFeedTokenHash = null;
        team.CalendarFeedTokenCreatedAt = null;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>
    /// The team, if the signed-in user trains it or can manage its competition (<see cref="CompetitionManagers"/>: an admin,
    /// the owning Trainer or a competition admin). Anyone else gets a 404.
    /// </summary>
    private async Task<Team?> LoadManagedTeamAsync(int teamId, CancellationToken ct)
    {
        var uid = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(uid)) return null;
        var team = await db.Teams.FirstOrDefaultAsync(t => t.Id == teamId, ct);
        if (team is null) return null;
        return team.TrainerUserId == uid || await db.CanManageAsync(User, team.CompetitionId, ct) ? team : null;
    }

    private HeatEvent BuildHeatEvent(Team team, Competition competition, Session session, Heat heat, int index, int lane,
        DateTime start, int minutes, string? link)
    {
        var group = session.Section?.DisplayName is { Length: > 0 } name ? name : session.Name;
        var heatName = string.IsNullOrWhiteSpace(heat.Label) ? $"Heat {index + 1}" : heat.Label.Trim();
        var summary = $"{team.DisplayName}: {group}, {heatName}";
        var lines = new List<string> { session.Name };
        if (!string.IsNullOrWhiteSpace(session.ArenaName)) lines.Add($"Arena: {session.ArenaName.Trim()}");
        lines.Add($"Starting lane: {lane}");
        lines.Add("Heat times are estimates. Check the timetable and listen for the collecting ring call.");
        var location = string.Join(", ", new[] { session.ArenaName?.Trim(), competition.Location?.Trim() }.Where(x => !string.IsNullOrEmpty(x)));
        return new HeatEvent(heat.Id, $"heat-{heat.Id}-team-{team.Id}@mg-app", start, start.AddMinutes(minutes), summary,
            string.IsNullOrEmpty(location) ? null : location, string.Join("\n", lines), link);
    }

    private string? SiteLink(string? site, string path) => PublicSite.Resolve(configuration, site) is { } origin ? origin + path : null;

    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    /// <summary>
    /// Recognises a midnight date stored either as UTC midnight (<c>00:00:00Z</c>) or UK local midnight
    /// (<c>00:00</c> in <c>Europe/London</c>, which is <c>23:00:00Z</c> the day before during BST) and
    /// returns the corresponding calendar date in UTC.
    /// </summary>
    private static bool TryCalendarDate(DateTime utc, out DateTime calendarDate)
    {
        var uk = UkTime.ToUk(utc);
        if (uk.TimeOfDay == TimeSpan.Zero)
        {
            calendarDate = DateTime.SpecifyKind(uk.Date, DateTimeKind.Utc);
            return true;
        }
        if (utc.TimeOfDay == TimeSpan.Zero)
        {
            calendarDate = utc.Date;
            return true;
        }
        calendarDate = default;
        return false;
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max].TrimEnd() + "…";

    private static string FileName(string name)
    {
        var words = name.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(w => new string(w.Where(char.IsAsciiLetterOrDigit).ToArray())).Where(w => w.Length > 0);
        var joined = string.Join("-", words);
        return joined.Length == 0 ? "competition" : joined.Length > 60 ? joined[..60] : joined;
    }

    private sealed record HeatEvent(int HeatId, string Uid, DateTime Start, DateTime End, string Summary, string? Location, string Description, string? Url)
    {
        // What the calendar shows apart from the website link, so any visible change (time, name, lane, place)
        // raises the sequence, while a different link alone does not.
        public string Fingerprint => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(
            string.Join("\n", Uid, IcsCalendar.FormatUtc(Start), IcsCalendar.FormatUtc(End), Summary, Location, Description))));

        public IcsEvent ToEvent(CalendarHeatVersion version) => new(Uid, Start, End, Summary, version.ModifiedAt, Location,
            Url is null ? Description : Description + "\nTimetable and live results: " + Url, Url, version.Sequence, version.ModifiedAt);
    }
}
