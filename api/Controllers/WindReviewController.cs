using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Hubs;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

[ApiController]
[WindConflictFilter]
[Route("api/competitions/{competitionId:int}")]
[Authorize(Policy = CompetitionStaff.Policy)]
public class WindReviewController(AppDbContext db, ILiveBroadcaster live, TimeProvider time) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private IQueryable<Session> Sessions => db.Sessions.Include(s => s.Section)
        .Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
        .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).ThenInclude(r => r.Team);

    [CompetitionAccess("competitionId")]
    [HttpGet("wind-review/rules")]
    public async Task<ActionResult<object>> Rules(int competitionId, CancellationToken ct)
    {
        var selections = await db.Set<WindRulesSelection>().AsNoTracking().Where(s => s.CompetitionId == competitionId).ToListAsync(ct);
        var now = time.GetUtcNow().ToUnixTimeMilliseconds();
        var acknowledgements = await db.Set<WindAcknowledgement>().AsNoTracking().Where(a => a.CompetitionId == competitionId && a.EndsAt > now)
            .Select(a => new { a.Arena, a.StartsAt, a.EndsAt, a.PeakMph, a.Severity }).ToListAsync(ct);
        return Ok(new { profiles = WindRuleCatalogue.All, selections = selections.Select(SelectionDto), acknowledgements,
            candidates = new[] { SectionFormat.Teams, SectionFormat.Pairs, SectionFormat.Individual }.Select(WindRuleCatalogue.HooplaName) });
    }
    [CompetitionAccess("competitionId")]
    [HttpPost("wind-review/acknowledge")]
    public async Task<IActionResult> Acknowledge(int competitionId, WindAcknowledgeRequest req, CancellationToken ct)
    {
        var outcome = await db.Database.CreateExecutionStrategy().ExecuteAsync<IActionResult>(async () =>
        {
            db.ChangeTracker.Clear();
            var now = time.GetUtcNow().ToUnixTimeMilliseconds();
            if (req.StartsAt >= req.EndsAt || req.EndsAt < now || req.EndsAt > now + 4 * 3_600_000 || req.EndsAt - req.StartsAt > 4 * 3_600_000)
                return BadRequest(new { message = "Review the current forecast interval." });
            await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
            await LockCompetition(competitionId, ct);
            await db.Set<WindAcknowledgement>().Where(a => a.CompetitionId == competitionId && (a.EndsAt <= now || a.Arena == req.Arena)).ExecuteDeleteAsync(ct);
            db.Add(new WindAcknowledgement { CompetitionId = competitionId, Arena = req.Arena ?? "", StartsAt = req.StartsAt,
                EndsAt = req.EndsAt, PeakMph = req.PeakMph, Severity = req.Severity, AcknowledgedAt = time.GetUtcNow().UtcDateTime });
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return NoContent();
        });
        return outcome;
    }

    private static object SelectionDto(WindRulesSelection s) => new { s.SectionId, s.ProfileId, s.Revision, s.EventLevel,
        s.PublishedSpare, permittedRaces = JsonSerializer.Deserialize<string[]>(s.PermittedRacesJson), s.VenueNotes,
        s.ReviewMph, s.OfficialReviewMph, s.VenueLimitMph, s.AdoptionConfirmed };

    [CompetitionAccess("competitionId")]
    [HttpPut("wind-review/rules")]
    public async Task<ActionResult<object>> SetRules(int competitionId, WindRulesRequest req, CancellationToken ct)
    {
        var outcome = await db.Database.CreateExecutionStrategy().ExecuteAsync<ActionResult<object>>(async () =>
        {
            db.ChangeTracker.Clear();
            if (!WindRuleCatalogue.All.Any(p => p.Id == req.ProfileId) || req.OfficialReviewMph < req.ReviewMph
                || req.PermittedRaces == null || req.PermittedRaces.Count > 100 || req.PermittedRaces.Any(n => string.IsNullOrWhiteSpace(n) || n.Length > 150))
                return BadRequest(new { message = "Check the rule profile, prompt speeds and permitted races." });
            if (req.SectionId != 0 && !await db.CompetitionSections.AnyAsync(s => s.Id == req.SectionId && s.CompetitionId == competitionId, ct)) return NotFound();
            await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
            await LockCompetition(competitionId, ct);
            var row = await db.Set<WindRulesSelection>().SingleOrDefaultAsync(s => s.CompetitionId == competitionId && s.SectionId == req.SectionId, ct);
            if ((row?.Revision ?? 0) != req.ExpectedRevision) return Conflict(new { message = "The rules changed on another device. Reload them before editing." });
            if (row == null) { row = new WindRulesSelection { CompetitionId = competitionId, SectionId = req.SectionId }; db.Add(row); }
            row.ProfileId = req.ProfileId; row.EventLevel = (req.EventLevel ?? "").Trim(); row.PublishedSpare = (req.PublishedSpare ?? "").Trim();
            row.PermittedRacesJson = JsonSerializer.Serialize(req.PermittedRaces.Distinct()); row.VenueNotes = (req.VenueNotes ?? "").Trim();
            row.ReviewMph = req.ReviewMph; row.OfficialReviewMph = req.OfficialReviewMph; row.VenueLimitMph = req.VenueLimitMph;
            row.AdoptionConfirmed = req.AdoptionConfirmed; row.Revision++;
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
            return Ok(SelectionDto(row));
        });
        return outcome;
    }

    [CompetitionAccess("competitionId")]
    [HttpPost("wind-review/preview")]
    public async Task<ActionResult<WindPreviewDto>> Preview(int competitionId, WindPreviewRequest req, CancellationToken ct)
    {
        var result = await BuildPreview(competitionId, req, ct);
        return result == null ? NotFound() : result.Value.Preview;
    }

    [CompetitionAccess("competitionId")]
    [HttpPost("race-changes")]
    public async Task<ActionResult<SessionDto>> Apply(int competitionId, WindApplyRequest req, CancellationToken ct)
    {
        var decisionId = 0;
        var outcome = await db.Database.CreateExecutionStrategy().ExecuteAsync<ActionResult<SessionDto>>(async () =>
        {
            db.ChangeTracker.Clear();
            await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
            await LockCompetition(competitionId, ct);
            await WindRaceGuard.LockSessionAsync(db, req.SessionId, ct);
            var existing = await db.Set<WindRaceDecision>().SingleOrDefaultAsync(d => d.CompetitionId == competitionId && d.RequestId == req.RequestId, ct);
            if (existing != null)
            {
                if (existing.Fingerprint != req.Fingerprint || existing.Authority != req.Authority || existing.Decision != req.Decision.Trim())
                    return Conflict(new { message = "This request was already used for another decision." });
                decisionId = existing.Id;
                return (await Sessions.SingleAsync(s => s.Id == existing.SessionId && s.CompetitionId == competitionId, ct)).ToDto();
            }
            var result = await BuildPreview(competitionId, new(req.SessionId, req.RaceId, req.Replacement), ct);
            if (result == null) return NotFound();
            var (preview, session, target, affected) = result.Value;
            if (!preview.CanApply || preview.Fingerprint != req.Fingerprint)
                return Conflict(new { message = preview.BlockedReason ?? "The programme or rules changed. Review a fresh preview." });
            if (req.Authority != preview.Authority || string.IsNullOrWhiteSpace(req.Decision) || !req.EquipmentConfirmed)
                return BadRequest(new { message = "Record the named official's decision and confirm the replacement equipment is ready." });
            var before = JsonSerializer.Serialize(preview.Races, Json);
            WindRaceGuard.Replace(session, target, affected, preview.Races[0].After);
            var savedDecision = new WindRaceDecision { CompetitionId = competitionId, SessionId = session.Id, RequestId = req.RequestId,
                Fingerprint = req.Fingerprint, ProfileId = preview.ProfileId, BeforeJson = before,
                AfterJson = JsonSerializer.Serialize(affected.Select(r => new { r.Id, r.Name, r.ProgrammeRevision }), Json),
                Authority = req.Authority, Decision = req.Decision.Trim(), ActorUserId = User.FindFirstValue(ClaimTypes.NameIdentifier), CreatedAt = time.GetUtcNow().UtcDateTime };
            db.Add(savedDecision);
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
            var dto = session.ToDto();
            decisionId = savedDecision.Id;
            return dto;
        });
        if (outcome.Value is { } dto)
        {
            await live.SessionUpdated(competitionId, dto);
            var publishedAt = time.GetUtcNow().UtcDateTime;
            await db.Set<WindRaceDecision>().Where(d => d.Id == decisionId)
                .ExecuteUpdateAsync(set => set.SetProperty(d => d.PublishedAt, publishedAt), ct);
        }
        return outcome;
    }

    private Task<int> LockCompetition(int id, CancellationToken ct) => db.Competitions.Where(c => c.Id == id)
        .ExecuteUpdateAsync(set => set.SetProperty(c => c.Name, c => c.Name), ct);

    private async Task<(WindPreviewDto Preview, Session Session, Race Target, List<Race> Affected)?> BuildPreview(int competitionId, WindPreviewRequest req, CancellationToken ct)
    {
        var session = await Sessions.SingleOrDefaultAsync(s => s.Id == req.SessionId && s.CompetitionId == competitionId, ct);
        var target = session?.Heats.SelectMany(h => h.Races).SingleOrDefault(r => r.Id == req.RaceId);
        if (session == null || target == null) return null;
        var selection = await db.Set<WindRulesSelection>().Where(s => s.CompetitionId == competitionId && (s.SectionId == 0 || s.SectionId == session.CompetitionSectionId))
            .OrderByDescending(s => s.SectionId).FirstOrDefaultAsync(ct) ?? new WindRulesSelection();
        var profile = WindRuleCatalogue.Find(selection.ProfileId);
        var affected = WindRaceGuard.Scope(session, target);
        var name = req.Replacement.Trim();
        var format = session.Section?.Format;
        var effective = format == null ? null : WindRuleCatalogue.ReplacementName(selection, format.Value, name);
        var raceName = effective ?? name;
        var permitted = JsonSerializer.Deserialize<string[]>(selection.PermittedRacesJson) ?? [];
        var template = effective == null ? null : await db.RaceTemplates.AsNoTracking().FirstOrDefaultAsync(t => t.Name == effective, ct);
        var eventDate = await db.Competitions.Where(c => c.Id == competitionId).Select(c => c.StartDate).SingleAsync(ct);
        var protectedRace = await WindRaceGuard.ProtectedAsync(db, affected, ct);
        string? blocked = eventDate.Year != 2026 ? "This rule edition has only been reviewed for 2026. Confirm the current edition before changing a later event."
            : protectedRace ? "This contest has started or has scoring history. Ask the official about interruption or voiding; no results will be removed here."
            : !profile.SubstitutionsVerified || effective == null ? "This rule, format or event context does not have a verified replacement here. Ask the official to review it."
            : !permitted.Contains(name, StringComparer.OrdinalIgnoreCase) ? "The replacement is not in the event's confirmed permitted race list."
            : template?.Rules == null || template.DiagramJson == null ? "The replacement's rules, diagram and equipment have not been verified."
            : affected.Any(r => r.Name != target.Name) ? "The contest has different race programmes. Review it manually."
            : affected.Any(r => r.Name == raceName) ? "Choose a different race." : null;
        var races = affected.OrderBy(r => r.Id).Select(r => new WindRaceScopeDto(r.Id, r.HeatId, session.Heats.Single(h => h.Id == r.HeatId).Label ?? $"Heat {r.HeatId}", r.Name, raceName, r.ProgrammeRevision)).ToList();
        var fingerprint = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { selection, races, template, session.PlannedRaces, session.PlannedFinalRaces }, Json))));
        var preview = new WindPreviewDto(fingerprint, profile.Id, profile.Authority, profile.Source, profile.Clause, races,
            template?.Rules ?? "", template?.DiagramJson ?? "[]", "Review the replacement diagram and equipment list for every affected lane before confirming.", blocked == null, blocked);
        return (preview, session, target, affected);
    }
}
