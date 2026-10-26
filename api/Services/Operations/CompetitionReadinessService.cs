using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;

namespace MountedGames.Api.Services.Operations;

public class CompetitionReadinessService(AppDbContext db, EquipmentCalculator equipmentCalculator)
{
    public async Task<CompetitionReadinessDto> GetAsync(
        int competitionId, CancellationToken cancellationToken = default)
    {
        var exists = await db.Competitions.AsNoTracking()
            .AnyAsync(c => c.Id == competitionId, cancellationToken);
        if (!exists) throw new KeyNotFoundException("Competition not found.");

        var teams = await db.Teams.AsNoTracking()
            // A withdrawn or no-show team owes nothing more: no declaration, no riders.
            .Where(t => t.CompetitionId == competitionId && t.EntryStatus == TeamEntryStatus.Active)
            .Include(t => t.Section)
            .Include(t => t.DeclarationForms).ThenInclude(d => d.Riders)
            .OrderBy(t => t.Id)
            .ToListAsync(cancellationToken);

        var missing = teams.Where(t => t.DeclarationForms.Count == 0)
            .Select(t => new MissingDeclarationDto(t.Id, t.DisplayName, t.CompetitionSectionId,
                t.Section?.DisplayName ?? string.Empty)).ToList();

        var incomplete = teams.Select(t =>
            {
                var required = t.Section?.Format switch
                {
                    SectionFormat.Pairs => 2,
                    SectionFormat.Individual => 1,
                    _ => 4,
                };
                var riders = t.DeclarationForms.OrderByDescending(d => d.SubmittedAt).FirstOrDefault()?
                    .Riders.Count(r => !r.IsReserve) ?? 0;
                return new { Team = t, Required = required, Riders = riders };
            })
            .Where(x => x.Riders < x.Required)
            .Select(x => new IncompleteTeamDto(x.Team.Id, x.Team.DisplayName,
                x.Team.CompetitionSectionId, x.Team.Section?.DisplayName ?? string.Empty,
                x.Riders, x.Required)).ToList();

        var unpaid = await db.SectionSignups.AsNoTracking()
            .Where(s => s.Section!.CompetitionId == competitionId && s.Status == SignupPaymentStatus.Pending)
            .OrderBy(s => s.Id)
            .Select(s => new UnpaidSignupDto(s.Id, s.CompetitionSectionId,
                s.Section!.DisplayName, s.AmountMinor))
            .ToListAsync(cancellationToken);

        var sessions = await db.Sessions.AsNoTracking()
            .Where(s => s.CompetitionId == competitionId && s.ScheduledStart != null)
            .Include(s => s.Section)
            .Include(s => s.Heats).ThenInclude(h => h.Entries)
            .OrderBy(s => s.ScheduledStart).ThenBy(s => s.Id)
            .ToListAsync(cancellationToken);
        var overlaps = FindOverlaps(sessions);
        overlaps.AddRange(FindRiderClashes(sessions, teams));

        var equipment = await GetEquipmentStateAsync(competitionId, cancellationToken);

        var flagged = teams
            .Select(t => new
            {
                Team = t,
                Flagged = t.DeclarationForms.OrderByDescending(d => d.SubmittedAt).FirstOrDefault()?
                    .Riders.Count(r => !string.IsNullOrEmpty(r.FlagsJson) && r.FlagsJson != "[]") ?? 0,
            })
            .Where(x => x.Flagged > 0)
            .Select(x => new FlaggedDecFormDto(x.Team.Id, x.Team.DisplayName, x.Team.CompetitionSectionId,
                x.Team.Section?.DisplayName ?? string.Empty, x.Flagged)).ToList();
        var raceLists = await GetRaceListsToChooseAsync(competitionId, cancellationToken);

        var ready = missing.Count == 0 && unpaid.Count == 0 && incomplete.Count == 0
            && overlaps.Count == 0 && equipment.Issues.Count == 0
            && equipment.Checklist.All(x => x.Acknowledged);
        return new CompetitionReadinessDto(competitionId, ready, equipment.Fingerprint,
            missing, unpaid, incomplete, overlaps, equipment.Checklist, equipment.Issues, flagged, raceLists);
    }

    /// <summary>
    /// Race sessions that have no races chosen: no planned list and no races in any heat (heats' races are the truth once
    /// they exist). An age group with no race session at all is listed too, so it isn't forgotten. Informational: it does
    /// not change <c>IsReady</c>.
    /// </summary>
    private async Task<List<RaceListToChooseDto>> GetRaceListsToChooseAsync(
        int competitionId, CancellationToken cancellationToken)
    {
        var sections = await db.CompetitionSections.AsNoTracking()
            .Where(s => s.CompetitionId == competitionId).OrderBy(s => s.Id)
            .Select(s => new { s.Id, s.DisplayName }).ToListAsync(cancellationToken);
        var raceSessions = await db.Sessions.AsNoTracking()
            .Where(s => s.CompetitionId == competitionId && s.Kind == SessionKind.Race && s.CompetitionSectionId != null)
            .OrderBy(s => s.OrderIndex).ThenBy(s => s.Id)
            .Select(s => new
            {
                s.Id, s.Name, SectionId = s.CompetitionSectionId!.Value, s.PlannedRaces,
                HasRaces = s.Heats.Any(h => h.Races.Any()),
            })
            .ToListAsync(cancellationToken);
        var result = new List<RaceListToChooseDto>();
        foreach (var section in sections)
        {
            var own = raceSessions.Where(s => s.SectionId == section.Id).ToList();
            if (own.Count == 0)
            {
                result.Add(new RaceListToChooseDto(null, section.DisplayName, section.Id, section.DisplayName));
                continue;
            }
            result.AddRange(own
                .Where(s => !s.HasRaces && PlannedRaceList.Read(s.PlannedRaces) is not { Count: > 0 })
                .Select(s => new RaceListToChooseDto(s.Id, s.Name, section.Id, section.DisplayName)));
        }
        return result;
    }

    public async Task<CompetitionReadinessDto> UpdateEquipmentAsync(
        int competitionId, IEnumerable<string> acknowledgedKeys, string expectedFingerprint,
        string? actorUserId,
        CancellationToken cancellationToken = default)
    {
        var requested = acknowledgedKeys.Where(k => !string.IsNullOrWhiteSpace(k))
            .Select(k => k.Trim()).ToHashSet(StringComparer.Ordinal);
        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);
            var equipment = await GetEquipmentStateAsync(competitionId, cancellationToken);
            if (!string.Equals(equipment.Fingerprint, expectedFingerprint.Trim(), StringComparison.Ordinal))
                throw new DrawChangedException(
                    "The equipment checklist changed after it was loaded. Refresh readiness before saving.");

            var valid = equipment.Checklist.Select(item => item.Key).ToHashSet(StringComparer.Ordinal);
            if (!requested.IsSubsetOf(valid))
                throw new DrawChangedException(
                    "The equipment checklist changed after it was loaded. Refresh readiness before saving.");

            var current = await db.Set<EquipmentAcknowledgement>()
                .Where(a => a.CompetitionId == competitionId).ToListAsync(cancellationToken);
            db.RemoveRange(current.Where(a => !requested.Contains(a.ItemKey)));
            var existing = current.Select(a => a.ItemKey).ToHashSet(StringComparer.Ordinal);
            foreach (var key in requested.Except(existing))
                db.Add(new EquipmentAcknowledgement
                {
                    CompetitionId = competitionId,
                    ItemKey = key,
                    AcknowledgedAt = DateTime.UtcNow,
                    AcknowledgedByUserId = actorUserId,
                });
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
        return await GetAsync(competitionId, cancellationToken);
    }

    public static string EquipmentKey(string kind, string bucket, int count) => $"{bucket}|{kind}|{count}";

    private async Task<EquipmentState> GetEquipmentStateAsync(
        int competitionId, CancellationToken cancellationToken)
    {
        var computed = await equipmentCalculator.ComputeAsync(competitionId);
        var acknowledgements = await db.Set<EquipmentAcknowledgement>().AsNoTracking()
            .Where(a => a.CompetitionId == competitionId)
            .ToDictionaryAsync(a => a.ItemKey, StringComparer.Ordinal, cancellationToken);
        var checklist = computed.Lines.Select(line =>
            {
                var key = EquipmentKey(line.Kind, line.Bucket, line.Count);
                acknowledgements.TryGetValue(key, out var ack);
                return new EquipmentChecklistItemDto(key, line.Kind, line.Bucket, line.Count,
                    ack is not null, ack?.AcknowledgedAt);
            })
            .OrderBy(item => item.Key, StringComparer.Ordinal)
            .ToList();
        var issues = await GetEquipmentIssuesAsync(competitionId, cancellationToken);
        return new EquipmentState(checklist, issues, EquipmentFingerprint(checklist, issues));
    }

    private async Task<List<EquipmentReadinessIssueDto>> GetEquipmentIssuesAsync(
        int competitionId, CancellationToken cancellationToken)
    {
        var names = (await db.Races.AsNoTracking()
                .Where(r => r.Heat!.Session!.CompetitionId == competitionId
                    && r.Heat.Session.Kind == SessionKind.Race)
                .Select(r => r.Name)
                .ToListAsync(cancellationToken))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (names.Count == 0) return [];

        var loweredNames = names.Select(name => name.ToLower()).ToList();
        var candidates = await db.RaceTemplates.AsNoTracking()
            .Where(template => loweredNames.Contains(template.Name.ToLower()))
            .OrderBy(template => template.Id)
            .ToListAsync(cancellationToken);
        var issues = new List<EquipmentReadinessIssueDto>();
        foreach (var name in names)
        {
            var template = candidates.FirstOrDefault(candidate => candidate.Name == name)
                ?? candidates.FirstOrDefault(candidate =>
                    string.Equals(candidate.Name, name, StringComparison.OrdinalIgnoreCase));
            if (template is null)
            {
                issues.Add(new EquipmentReadinessIssueDto(name, "No matching race template was found."));
                continue;
            }
            if (!HasValidDiagram(template.DiagramJson))
                issues.Add(new EquipmentReadinessIssueDto(
                    name, "The race template has no valid equipment diagram."));
        }
        return issues;
    }

    private static bool HasValidDiagram(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return false;
        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind == JsonValueKind.Array;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static string EquipmentFingerprint(
        IReadOnlyList<EquipmentChecklistItemDto> checklist,
        IReadOnlyList<EquipmentReadinessIssueDto> issues)
    {
        var source = new StringBuilder();
        foreach (var item in checklist.OrderBy(item => item.Key, StringComparer.Ordinal))
            source.Append("|item:").Append(item.Key).Append(':').Append(item.Acknowledged ? '1' : '0');
        foreach (var issue in issues.OrderBy(issue => issue.RaceName, StringComparer.OrdinalIgnoreCase))
            source.Append("|issue:").Append(issue.RaceName).Append(':').Append(issue.Message);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source.ToString())))
            .ToLowerInvariant();
    }

    private static List<SessionOverlapDto> FindOverlaps(IReadOnlyList<Session> sessions)
    {
        var timed = sessions.Select(session => new
            {
                Session = session,
                Arena = ArenaBucket(session),
                Start = session.ScheduledStart!.Value,
                Minutes = SessionMinutes(session),
            })
            .Where(x => x.Minutes > 0)
            .ToList();
        var result = new List<SessionOverlapDto>();
        for (var i = 0; i < timed.Count; i++)
        for (var j = i + 1; j < timed.Count; j++)
        {
            var first = timed[i];
            var second = timed[j];
            if (!string.Equals(first.Arena, second.Arena, StringComparison.OrdinalIgnoreCase)) continue;
            var firstEnd = first.Start.AddMinutes(first.Minutes);
            var secondEnd = second.Start.AddMinutes(second.Minutes);
            if (first.Start >= secondEnd || second.Start >= firstEnd) continue;
            result.Add(new SessionOverlapDto(first.Session.Id, first.Session.Name,
                second.Session.Id, second.Session.Name, first.Arena,
                first.Start > second.Start ? first.Start : second.Start,
                firstEnd < secondEnd ? firstEnd : secondEnd));
        }
        return result;
    }

    private static int SessionMinutes(Session session) =>
        session.DurationMinutes
        ?? session.Heats.Sum(h => h.DurationMinutes ?? session.MinutesPerHeat ?? 0);

    /// <summary>
    /// Finds a rider declared in two teams that race in different arenas at overlapping times.
    /// Matches on the rider's name only (trimmed, case-insensitive, spaces collapsed): trainers and
    /// pony names are ignored, because ponies often share names. Reserves are left out, since they
    /// only ride if called on. Results use the same shape as session overlaps, so they appear under
    /// the arena clashes: the first session name is prefixed with the rider and the arena field
    /// names both arenas.
    /// </summary>
    private static List<SessionOverlapDto> FindRiderClashes(
        IReadOnlyList<Session> sessions, IReadOnlyList<Team> teams)
    {
        var ridersByTeam = teams.ToDictionary(t => t.Id, t =>
        {
            var latest = t.DeclarationForms.OrderByDescending(d => d.SubmittedAt).FirstOrDefault();
            return (latest?.Riders ?? [])
                .Where(r => !r.IsReserve && !string.IsNullOrWhiteSpace(r.FullName))
                .Select(r => CollapseSpaces(r.FullName))
                .DistinctBy(name => name.ToLowerInvariant())
                .ToList();
        });
        var teamsById = teams.ToDictionary(t => t.Id);

        var slots = new List<RiderSlot>();
        foreach (var session in sessions)
        {
            var arena = ArenaBucket(session);
            if (arena == UnsetArena) continue;
            var cursor = session.ScheduledStart!.Value;
            var sessionMinutes = SessionMinutes(session);
            foreach (var heat in session.Heats.OrderBy(h => h.OrderIndex).ThenBy(h => h.Id))
            {
                var heatMinutes = heat.DurationMinutes ?? session.MinutesPerHeat ?? 0;
                var start = heat.ScheduledStart ?? cursor;
                var end = start.AddMinutes(heatMinutes);
                if (heatMinutes > 0) cursor = end;
                else
                {
                    // No heat length to go on: treat the heat as running for the whole session.
                    if (sessionMinutes <= 0) continue;
                    start = session.ScheduledStart!.Value;
                    end = start.AddMinutes(sessionMinutes);
                }
                foreach (var entry in heat.Entries)
                {
                    if (!ridersByTeam.TryGetValue(entry.TeamId, out var riders)) continue;
                    var sectionName = teamsById[entry.TeamId].Section?.DisplayName
                        ?? session.Section?.DisplayName ?? string.Empty;
                    foreach (var rider in riders)
                        slots.Add(new RiderSlot(rider, session, sectionName, arena, start, end));
                }
            }
        }

        var result = new List<SessionOverlapDto>();
        var reported = new HashSet<(string, int, int)>();
        foreach (var group in slots.GroupBy(s => s.Rider.ToLowerInvariant()))
        {
            var list = group.OrderBy(s => s.Start).ThenBy(s => s.Session.Id).ToList();
            for (var i = 0; i < list.Count; i++)
            for (var j = i + 1; j < list.Count; j++)
            {
                var first = list[i];
                var second = list[j];
                if (first.Session.Id == second.Session.Id) continue;
                if (string.Equals(first.Arena, second.Arena, StringComparison.OrdinalIgnoreCase)) continue;
                if (first.Start >= second.End || second.Start >= first.End) continue;
                if (!reported.Add((group.Key, Math.Min(first.Session.Id, second.Session.Id),
                        Math.Max(first.Session.Id, second.Session.Id)))) continue;
                result.Add(new SessionOverlapDto(
                    first.Session.Id, $"{first.Rider}: {SessionLabel(first)}",
                    second.Session.Id, SessionLabel(second),
                    $"{first.Arena} and {second.Arena}",
                    first.Start > second.Start ? first.Start : second.Start,
                    first.End < second.End ? first.End : second.End));
            }
        }
        return result;
    }

    private static string SessionLabel(RiderSlot slot) =>
        slot.SectionName.Length == 0 ? slot.Session.Name : $"{slot.Session.Name} ({slot.SectionName})";

    private static string CollapseSpaces(string value) =>
        Regex.Replace(value.Trim(), @"\s+", " ");

    private const string UnsetArena = "Arena not set";

    private static string ArenaBucket(Session session)
    {
        var arena = (session.ArenaName ?? session.Location ?? string.Empty).Trim();
        return arena.Length == 0 ? UnsetArena : arena;
    }

    private sealed record RiderSlot(
        string Rider, Session Session, string SectionName, string Arena, DateTime Start, DateTime End);

    private sealed record EquipmentState(
        IReadOnlyList<EquipmentChecklistItemDto> Checklist,
        IReadOnlyList<EquipmentReadinessIssueDto> Issues,
        string Fingerprint);
}
