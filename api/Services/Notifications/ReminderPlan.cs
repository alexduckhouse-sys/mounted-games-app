using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Services.Calendar;

namespace MountedGames.Api.Services.Notifications;

internal sealed record PlannedReminder(string Key, int CompetitionId, DateTime DueAt, DateTime ExpiresAt,
    string Version, PushPayload Payload, IReadOnlySet<string> Users);

internal static class ReminderPlan
{
    internal static async Task<List<PlannedReminder>> LoadAsync(AppDbContext db, DateTime now, CancellationToken ct, int? competitionId = null)
    {
        var start = now.AddDays(-2);
        var end = now.AddDays(14);
        var query = db.Sessions.AsNoTracking().Where(s => s.Competition != null && !s.Competition.IsArchived
            && s.Competition.StartDate <= end && (s.Competition.EndDate ?? s.Competition.StartDate) >= start);
        if (competitionId.HasValue) query = query.Where(s => s.CompetitionId == competitionId.Value);
        var sessions = await query.Include(s => s.Section).Include(s => s.Heats).ThenInclude(h => h.Races)
            .Include(s => s.Heats).ThenInclude(h => h.Entries).ToListAsync(ct);
        var ids = sessions.Select(s => s.CompetitionId).Distinct().ToList();
        var teams = await db.Teams.AsNoTracking().Where(t => ids.Contains(t.CompetitionId) && t.EntryStatus == TeamEntryStatus.Active)
            .Select(t => new { t.Id, t.CompetitionId, t.CompetitionSectionId, t.DisplayName, t.TrainerUserId }).ToListAsync(ct);
        var teamIds = teams.Select(t => t.Id).ToList();
        var supporters = await db.TeamSupporters.AsNoTracking().Where(s => teamIds.Contains(s.TeamId) && s.Status == TeamSupporterStatus.Accepted)
            .Select(s => new { s.TeamId, s.UserId }).ToListAsync(ct);
        var usersByTeam = teams.ToDictionary(t => t.Id, t => supporters.Where(s => s.TeamId == t.Id).Select(s => s.UserId)
            .Concat(string.IsNullOrEmpty(t.TrainerUserId) ? [] : new[] { t.TrainerUserId }).ToHashSet());
        var plans = new List<PlannedReminder>();
        foreach (var competition in sessions.GroupBy(s => s.CompetitionId))
        {
            var sessionStarts = new Dictionary<int, DateTime?>();
            var timings = TimetableTimes.Compute(competition, now, sessionStarts);
            foreach (var s in competition.Where(s => s.Status != SessionStatus.Finished))
            {
                if (s.Kind == SessionKind.Race && s.Heats.Any(h => h.Entries.Count > 0))
                {
                    foreach (var h in s.Heats.OrderBy(h => h.OrderIndex))
                    {
                        if (h.StartedAt.HasValue || h.FinishedAt.HasValue || (h.Races.Count > 0 && h.Races.All(r => r.IsComplete))) continue;
                        if (timings.GetValueOrDefault(h.Id).Start is not { } heatStart) continue;
                        var label = string.IsNullOrWhiteSpace(h.Label) ? $"Heat {h.OrderIndex + 1}" : h.Label;
                        foreach (var entry in h.Entries)
                        {
                            var team = teams.FirstOrDefault(t => t.Id == entry.TeamId);
                            if (team is null) continue;
                            Add($"1h:{s.Id}:h{h.Id}:t{team.Id}", s.CompetitionId, heatStart, 60,
                                "60 minutes until your heat",
                                $"{team.DisplayName} · {s.Name} ({label}, lane {entry.LaneIndex}) starts around {NotificationScheduler.UkTime(heatStart):HH:mm}.", usersByTeam[team.Id]);
                        }
                    }
                }
                else if (s.ScheduledStart is { } rawScheduled && !s.StartedAt.HasValue && s.Status == SessionStatus.Upcoming)
                {
                    // Lead time counts from when the session is now expected to start (after any delay), not its planned time.
                    var scheduled = sessionStarts.GetValueOrDefault(s.Id) ?? rawScheduled;
                    var users = teams.Where(t => t.CompetitionId == s.CompetitionId && (s.CompetitionSectionId == null || t.CompetitionSectionId == s.CompetitionSectionId))
                        .SelectMany(t => usersByTeam[t.Id]).ToHashSet();
                    if (s.Kind == SessionKind.Race && s.Heats.Count > 0)
                        Add($"1h:{s.Id}", s.CompetitionId, scheduled, 60, $"1 hour to {s.Name}",
                            $"Starts at {NotificationScheduler.UkTime(scheduled):HH:mm} · {s.Section?.DisplayName ?? "—"}.", users);
                    if (s.Kind == SessionKind.Briefing)
                        Add($"brief:{s.Id}", s.CompetitionId, scheduled, 30, "Briefing in 30 minutes", s.Name, users);
                }
            }
        }
        var heatCalls = await db.Set<HeatCall>().AsNoTracking().Where(c => c.CalledAt > now.AddMinutes(-15)
            && (!competitionId.HasValue || c.Heat!.Session!.CompetitionId == competitionId)).ToListAsync(ct);
        foreach (var call in heatCalls)
        {
            var session = sessions.FirstOrDefault(s => s.Heats.Any(h => h.Id == call.HeatId));
            var heat = session?.Heats.First(h => h.Id == call.HeatId);
            if (session is null || heat is null || heat.StartedAt.HasValue || heat.FinishedAt.HasValue
                || heat.Races.Any(r => r.StartedAt.HasValue || r.IsComplete)) continue;
            var users = heat.Entries.SelectMany(e => usersByTeam.GetValueOrDefault(e.TeamId) ?? []).ToHashSet();
            var key = $"collecting-ring:{heat.Id}";
            var label = heat.Label ?? $"Heat {heat.OrderIndex}";
            var payload = new PushPayload("Collecting ring call", $"{label} · {session.Name} · {session.ArenaName ?? "Main Arena"}: please go to the collecting ring now.", key, $"/competitions/{session.CompetitionId}/timetable");
            plans.Add(new(key, session.CompetitionId, call.CalledAt, call.CalledAt.AddMinutes(15),
                call.CalledAt.Ticks.ToString(), payload, users));
        }
        return plans;

        void Add(string key, int compId, DateTime scheduled, int lead, string title, string body, IReadOnlySet<string> users)
        {
            var due = DateTime.SpecifyKind(scheduled, DateTimeKind.Utc).AddMinutes(-lead);
            var expiry = due.AddMinutes(5); // Preserve existing wording/window; never send a late "60 minutes" alert.
            if (expiry <= now || due > now.AddMinutes(90)) return;
            var payload = new PushPayload(title, body, key, $"/competitions/{compId}");
            var version = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { due, payload }))));
            plans.Add(new(key, compId, due, expiry, version, payload, users));
        }
    }
}
