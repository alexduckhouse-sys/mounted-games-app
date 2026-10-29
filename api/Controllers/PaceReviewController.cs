using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Calendar;

namespace MountedGames.Api.Controllers;

public record PaceReviewRow(string Game, string AgeGroup, SectionFormat Format, string Arena,
    double? MinutesPerSlot, int Samples, int ExcludedHolds, string Source, double? TypicalErrorMinutes);
public record PaceReviewDto(IReadOnlyList<PaceReviewRow> Rows);

/// <summary>Advisory evaluation only. Never writes or reschedules a heat.</summary>
[ApiController]
[Authorize(Policy = CompetitionStaff.Policy)]
public class PaceReviewController(AppDbContext db) : ControllerBase
{
    [HttpGet("api/competitions/{competitionId:int}/pace-review")]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<PaceReviewDto>> Get(int competitionId, CancellationToken ct)
    {
        var current = await db.Sessions.AsNoTracking().Where(s => s.CompetitionId == competitionId)
            .Include(s => s.Section).Include(s => s.Heats).ThenInclude(h => h.Races).ToListAsync(ct);
        if (!await db.Competitions.AnyAsync(c => c.Id == competitionId, ct)) return NotFound();
        var pastHeats = await db.Heats.AsNoTracking()
            .Where(h => h.Session!.CompetitionId != competitionId && h.FinishedAt != null
                && h.Session.Status == SessionStatus.Finished
                && !db.Set<EventCommerceSettings>().Any(e => e.CompetitionId == h.Session.CompetitionId && e.IsDemo))
            .OrderByDescending(h => h.FinishedAt).Take(400)
            .Include(h => h.Races).Include(h => h.Session).ThenInclude(s => s!.Section).ToListAsync(ct);
        var pastSessions = pastHeats.OrderBy(h => h.FinishedAt).GroupBy(h => h.SessionId).Select(group => {
            var session = group.First().Session!;
            session.Heats = group.ToList();
            return session;
        }).ToList();
        return new PaceReviewDto(Review(current, pastSessions));
    }

    internal static IReadOnlyList<PaceReviewRow> Review(List<Session> current, List<Session> history)
    {
        static string Game(string name) => BuiltInRaceMetadata.ResolveCanonicalName(name).ToLowerInvariant();
        static string Age(string name) => SectionAgeOrder.Rank(name) is var rank && rank != SectionAgeOrder.Unclassified ? rank.ToString() : name.Trim().ToLowerInvariant();
        var past = PaceLearning.Samples(history);
        var live = PaceLearning.Samples(current);
        var rows = new List<PaceReviewRow>();
        foreach (var group in current.Where(s => s.Kind == SessionKind.Race).GroupBy(s => new {
            Age = s.Section?.AgeGroup ?? "", Format = s.Section?.Format ?? default, Arena = s.ArenaName ?? "" }))
        foreach (var game in group.SelectMany(s => s.Heats).SelectMany(h => h.Races).Select(r => r.Name).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var historical = past.Where(s => Game(s.Game) == Game(game) && Age(s.AgeGroup) == Age(group.Key.Age) && s.Format == group.Key.Format).ToList();
            var today = live.Where(s => Game(s.Game) == Game(game) && Age(s.AgeGroup) == Age(group.Key.Age)
                && s.Format == group.Key.Format && s.Arena == group.Key.Arena).ToList();
            var cleanPast = PaceLearning.Clean(historical);
            var cleanToday = PaceLearning.Clean(today);
            var enoughPast = cleanPast.Count >= 5;
            var enoughToday = cleanToday.Count >= 5;
            double? estimate = enoughPast ? PaceLearning.Median(cleanPast.Select(s => s.Minutes)) : null;
            if (enoughToday)
            {
                var liveMedian = PaceLearning.Median(cleanToday.Select(s => s.Minutes));
                var weight = cleanToday.Count / (cleanToday.Count + 6.0);
                estimate = estimate.HasValue ? estimate * (1 - weight) + liveMedian * weight : liveMedian;
            }
            // Evaluate history against later observations without training on the held-out observation.
            var errors = new List<double>();
            for (var i = 5; i < historical.Count; i++)
            {
                var training = PaceLearning.Clean(historical.Take(i).ToList());
                if (training.Count >= 5) errors.Add(Math.Abs(historical[i].Minutes - PaceLearning.Median(training.Select(s => s.Minutes))));
            }
            rows.Add(new(game, group.Key.Age, group.Key.Format, group.Key.Arena,
                estimate.HasValue ? Math.Round(estimate.Value, 1) : null, cleanPast.Count + cleanToday.Count,
                historical.Count + today.Count - cleanPast.Count - cleanToday.Count,
                enoughToday ? enoughPast ? "History and this arena" : "This arena" : enoughPast ? "History" : "Waiting for five comparable slots",
                errors.Count > 0 ? Math.Round(PaceLearning.Median(errors), 1) : null));
        }
        return rows;
    }
}
