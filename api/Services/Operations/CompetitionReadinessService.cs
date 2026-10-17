using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
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
            .Where(t => t.CompetitionId == competitionId)
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
            .Include(s => s.Heats)
            .OrderBy(s => s.ScheduledStart).ThenBy(s => s.Id)
            .ToListAsync(cancellationToken);
        var overlaps = FindOverlaps(sessions);

        var equipment = await GetEquipmentStateAsync(competitionId, cancellationToken);

        var ready = missing.Count == 0 && unpaid.Count == 0 && incomplete.Count == 0
            && overlaps.Count == 0 && equipment.Issues.Count == 0
            && equipment.Checklist.All(x => x.Acknowledged);
        return new CompetitionReadinessDto(competitionId, ready, equipment.Fingerprint,
            missing, unpaid, incomplete, overlaps, equipment.Checklist, equipment.Issues);
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
                Minutes = session.DurationMinutes
                    ?? session.Heats.Sum(h => h.DurationMinutes ?? session.MinutesPerHeat ?? 0),
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

    private static string ArenaBucket(Session session)
    {
        var arena = (session.ArenaName ?? session.Location ?? string.Empty).Trim();
        return arena.Length == 0 ? "Arena not set" : arena;
    }

    private sealed record EquipmentState(
        IReadOnlyList<EquipmentChecklistItemDto> Checklist,
        IReadOnlyList<EquipmentReadinessIssueDto> Issues,
        string Fingerprint);
}
