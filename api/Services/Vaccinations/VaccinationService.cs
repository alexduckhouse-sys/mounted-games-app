using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.EventTools;
namespace MountedGames.Api.Services.Vaccinations;

public sealed class VaccinationService(AppDbContext db, TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private DateTime Now => clock.GetUtcNow().UtcDateTime;
    private DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(Now, TimeZoneInfo.FindSystemTimeZoneById("Europe/London")));
    private static string? UserId(ClaimsPrincipal user) => user.FindFirstValue(ClaimTypes.NameIdentifier);
    private static EventToolsException Missing() => new("That declared pony is not available.", 404);
    private static EventToolsException Conflict() => new("The dates, declaration or event rules have changed. Reload and check them before continuing.", 409);
    private static T[] Read<T>(string json) => JsonSerializer.Deserialize<T[]>(json, Json) ?? [];
    private static bool IdentityChanged(VaccinationDeclarationHorse link, RiderEntry rider) =>
        link.PonyNameSnapshot != rider.HorseName || link.PassportSnapshot != rider.PonyPassportNumber;

    public async Task<VaccinationSettingsDto> SettingsAsync(int competitionId, CancellationToken ct)
    {
        var start = await db.Competitions.Where(c => c.Id == competitionId).Select(c => (DateTime?)c.StartDate).SingleOrDefaultAsync(ct) ?? throw Missing();
        var settings = await db.Set<EventVaccinationSettings>().AsNoTracking().SingleOrDefaultAsync(x => x.CompetitionId == competitionId, ct);
        return new(settings?.Revision ?? 0, settings?.PolicyVersionId ?? "manual-v1", settings?.ReferenceDateBasis ?? "arrival",
            settings is null ? [] : Read<VenueVaccinationRule>(settings.VenueRulesJson), DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(start, DateTimeKind.Utc), TimeZoneInfo.FindSystemTimeZoneById("Europe/London"))));
    }
    public async Task<VaccinationSettingsDto> SaveSettingsAsync(int competitionId, SaveVaccinationSettingsRequest request, ClaimsPrincipal user, CancellationToken ct)
    {
        if (VaccinationPolicies.Find(request.PolicyVersionId) is null || request.ReferenceDateBasis is not ("arrival" or "event-start"))
            throw new EventToolsException("Choose a listed policy and an attendance date basis.", 400);
        if (request.VenueRules.Count > 8 || request.VenueRules.Any(v => string.IsNullOrWhiteSpace(v.Name) || string.IsNullOrWhiteSpace(v.Version)
            || !Uri.TryCreate(v.SourceUrl, UriKind.Absolute, out var url) || url.Scheme != "https"
            || v.EffectiveUntil < v.EffectiveFrom || v.MaximumMonths is < 1 or > 24 || v.AdditionalDays is < 0 or > 31
            || v.StandDownDays is < 0 or > 30))
            throw new EventToolsException("Give each venue rule a source, version, valid dates and supported calendar interval.", 400);
        _ = await SettingsAsync(competitionId, ct);
        var row = await db.Set<EventVaccinationSettings>().SingleOrDefaultAsync(x => x.CompetitionId == competitionId, ct);
        if ((row?.Revision ?? 0) != request.ExpectedRevision) throw Conflict();
        if (row is null) { row = new() { CompetitionId = competitionId, Revision = 0 }; db.Add(row); }
        row.Revision++; row.PolicyVersionId = request.PolicyVersionId; row.ReferenceDateBasis = request.ReferenceDateBasis;
        row.VenueRulesJson = JsonSerializer.Serialize(request.VenueRules, Json); row.UpdatedAt = Now; row.UpdatedByUserId = UserId(user);
        await SaveAsync(ct);
        return await SettingsAsync(competitionId, ct);
    }
    private IQueryable<RiderEntry> CurrentRiders(int competitionId) => db.RiderEntries.AsNoTracking()
        .Include(r => r.DeclarationForm).ThenInclude(f => f!.Team)
        .Where(r => r.HorseName != null && r.HorseName.Trim() != "" && r.DeclarationForm!.Team!.CompetitionId == competitionId
            && r.DeclarationFormId == db.DeclarationForms.Where(f => f.TeamId == r.DeclarationForm.TeamId)
                .OrderByDescending(f => f.SubmittedAt).ThenByDescending(f => f.Id).Select(f => f.Id).First());
    private async Task<RiderEntry> RiderAsync(int competitionId, int riderId, CancellationToken ct)
    {
        if (!await db.Competitions.AnyAsync(c => c.Id == competitionId && c.EnablePassportCheck, ct)) throw Missing();
        return await CurrentRiders(competitionId).SingleOrDefaultAsync(r => r.Id == riderId, ct) ?? throw Missing();
    }
    public async Task RequireEntrantAsync(int competitionId, int riderId, ClaimsPrincipal user, CancellationToken ct)
    {
        var rider = await RiderAsync(competitionId, riderId, ct);
        var form = rider.DeclarationForm!; var team = form.Team!; var uid = UserId(user);
        if (uid is null) throw Missing();
        if (team.TrainerUserId == uid || form.SubmittedByUserId == uid || await db.IsClubManagerAsync(user, team.ClubId, ct)) return;
        var owns = await db.SectionSignups.AnyAsync(s => s.UserId == uid && s.CompetitionSectionId == team.CompetitionSectionId
            && (s.Status == SignupPaymentStatus.Pending || s.Status == SignupPaymentStatus.Paid)
            && db.Set<SignupMatchmaking>().Any(m => m.SignupId == s.Id && m.DeclarationAccessGranted)
            && !db.Set<SignupExtras>().Any(x => x.SignupId == s.Id && (x.IsWithdrawn || x.IsWaitlist))
            && (s.TeamId == team.Id || db.Set<SignupTeamLink>().Any(l => l.SignupId == s.Id && l.TeamId == team.Id)), ct);
        if (!owns) throw Missing();
    }
    public async Task<VaccinationBoardDto> BoardAsync(int competitionId, int? riderId, CancellationToken ct)
    {
        var settings = await SettingsAsync(competitionId, ct);
        var enabled = await db.Competitions.AnyAsync(c => c.Id == competitionId && c.EnablePassportCheck, ct);
        if (!enabled) return new(false, settings, VaccinationPolicies.Catalogue, []);
        var query = CurrentRiders(competitionId);
        if (riderId is { } id) query = query.Where(r => r.Id == id);
        var riders = await query.OrderBy(r => r.DeclarationForm!.TeamId).ThenBy(r => r.OrderIndex).ToListAsync(ct);
        var ids = riders.Select(x => x.Id).ToArray();
        var links = await db.Set<VaccinationDeclarationHorse>().AsNoTracking().Where(x => x.CompetitionId == competitionId && ids.Contains(x.RiderEntryId)).ToListAsync(ct);
        var linkIds = links.Select(x => x.Id).ToArray();
        var evidence = await db.Set<VaccinationEvidence>().AsNoTracking().Where(x => x.CompetitionId == competitionId && linkIds.Contains(x.DeclarationHorseId)
            && !db.Set<VaccinationEvidence>().Any(newer => newer.DeclarationHorseId == x.DeclarationHorseId && newer.Source == x.Source && newer.Revision > x.Revision)).ToListAsync(ct);
        var inspections = await db.Set<VaccinationInspection>().AsNoTracking().Where(x => x.CompetitionId == competitionId && linkIds.Contains(x.DeclarationHorseId)
            && db.Set<VaccinationInspection>().Count(newer => newer.DeclarationHorseId == x.DeclarationHorseId && newer.Id > x.Id) < 20).ToListAsync(ct);
        // Legacy name matches show only that a previous manual note exists. They never certify or copy dates.
        var teams = riders.Select(x => x.DeclarationForm!.TeamId).Distinct().ToArray();
        var legacy = await db.Set<PassportCheck>().AsNoTracking().Where(x => x.CompetitionId == competitionId && teams.Contains(x.TeamId)).Select(x => new { x.TeamId, x.PonyKey }).ToListAsync(ct);
        return new(true, settings, VaccinationPolicies.Catalogue, riders.Select(r =>
        {
            var link = links.SingleOrDefault(x => x.RiderEntryId == r.Id);
            var changed = link is not null && IdentityChanged(link, r);
            var history = evidence.Where(x => x.DeclarationHorseId == link?.Id).OrderByDescending(x => x.Revision).ToList();
            VaccinationEvidenceDto? MapEvidence(string source)
            {
                var e = history.FirstOrDefault(x => x.Source == source);
                return e is null ? null : EvidenceDto(e, settings);
            }
            var decisions = inspections.Where(x => x.DeclarationHorseId == link?.Id).OrderByDescending(x => x.Id).Select(i => new VaccinationInspectionDto(
                i.Id, i.Decision, i.Reason, i.InspectedAt, i.EvidenceId, i.EvidenceRevision, i.SettingsRevision,
                !changed && i.LinkRevision == link!.Revision && i.SettingsRevision == settings.Revision && i.PolicyVersionId == settings.PolicyVersionId && i.EventStartOn == settings.EventStartOn,
                i.InspectedByUserId)).ToArray();
            return new VaccinationPonyDto(r.Id, r.DeclarationFormId, r.DeclarationForm!.TeamId, r.DeclarationForm.Team!.DisplayName,
                r.HorseName!, link?.Revision ?? 0, link?.HorseId, changed,
                legacy.Any(x => x.TeamId == r.DeclarationForm.TeamId && x.PonyKey == TackCheck.PassportCheckService.KeyOf(r.HorseName!)),
                MapEvidence("entrant"), MapEvidence("staff"), decisions.FirstOrDefault(), decisions);
        }).ToArray());
    }
    private VaccinationEvidenceDto EvidenceDto(VaccinationEvidence e, VaccinationSettingsDto settings)
    {
        var dates = Read<DateOnly>(e.DatesJson);
        return new(e.Id, e.Revision, e.Source, dates, e.CompleteHistory, e.ArrivalOn, e.ExceptionReview, e.Notes, e.RecordedAt,
            VaccinationEvaluator.Evaluate(settings, dates, e.CompleteHistory, e.ArrivalOn, e.ExceptionReview, Today, e.LastOtherVaccinationOn), e.LastOtherVaccinationOn);
    }
    public async Task<VaccinationPonyDto> SaveEvidenceAsync(int competitionId, int riderId, SaveVaccinationEvidenceRequest request,
        bool staff, ClaimsPrincipal user, CancellationToken ct)
    {
        if (request.Dates.Count > 160 || request.LastOtherVaccinationOn > Today || request.LastOtherVaccinationOn?.Year < 1900 || request.Dates.Any(d => d.Year < 1900 || d > Today)
            || request.Dates.Zip(request.Dates.Skip(1)).Any(p => p.First >= p.Second))
            throw new EventToolsException("Enter past vaccination dates once each, from oldest to newest.", 400);
        await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            // A retried transaction must reload the revision and discard entities from its rolled-back attempt.
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var rider = await RiderAsync(competitionId, riderId, ct);
            var link = await db.Set<VaccinationDeclarationHorse>().SingleOrDefaultAsync(x => x.RiderEntryId == riderId, ct);
            if ((link?.Revision ?? 0) != request.ExpectedRevision || (link is not null && IdentityChanged(link, rider))) throw Conflict();
            if (link is null)
            {
                var horse = new VaccinationHorse { Id = Guid.NewGuid(), CompetitionId = competitionId, CreatedByUserId = UserId(user), CreatedAt = Now };
                db.Add(horse); link = NewLink(horse.Id, rider, competitionId); db.Add(link); await SaveAsync(ct);
            }
            else link.Revision++;
            db.Add(new VaccinationEvidence
            {
                CompetitionId = competitionId, DeclarationHorseId = link.Id, Revision = link.Revision, Source = staff ? "staff" : "entrant",
                DatesJson = JsonSerializer.Serialize(request.Dates, Json), CompleteHistory = request.CompleteHistory, ArrivalOn = request.ArrivalOn, LastOtherVaccinationOn = request.LastOtherVaccinationOn,
                ExceptionReview = request.ExceptionReview, Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(),
                RecordedByUserId = UserId(user), RecordedAt = Now,
            });
            await SaveAsync(ct);
            await transaction.CommitAsync(ct);
        });
        // A failed response read retries independently; it must never replay an already committed history write.
        return (await BoardAsync(competitionId, riderId, ct)).Ponies.Single();
    }
    private static VaccinationDeclarationHorse NewLink(Guid horseId, RiderEntry rider, int competitionId) => new()
    {
        CompetitionId = competitionId, DeclarationFormId = rider.DeclarationFormId, RiderEntryId = rider.Id,
        HorseId = horseId, PonyNameSnapshot = rider.HorseName!, PassportSnapshot = rider.PonyPassportNumber,
    };
    public async Task<VaccinationPonyDto> LinkAsync(int competitionId, int riderId, LinkVaccinationHorseRequest request, CancellationToken ct)
    {
        var rider = await RiderAsync(competitionId, riderId, ct);
        // Only staff can explicitly reuse an identity already in this event. No global lookup or name matching.
        if (!request.ConfirmSameHorse || !await db.Set<VaccinationHorse>().AnyAsync(h => h.Id == request.HorseId && h.CompetitionId == competitionId, ct)) throw Missing();
        var existing = await db.Set<VaccinationDeclarationHorse>().SingleOrDefaultAsync(x => x.RiderEntryId == riderId, ct);
        if (existing is not null || request.ExpectedRevision != 0) throw Conflict();
        db.Add(NewLink(request.HorseId, rider, competitionId)); await SaveAsync(ct);
        return (await BoardAsync(competitionId, riderId, ct)).Ponies.Single();
    }
    public async Task<VaccinationPonyDto> InspectAsync(int competitionId, int riderId, InspectVaccinationRequest request, ClaimsPrincipal user, CancellationToken ct)
    {
        var rider = await RiderAsync(competitionId, riderId, ct);
        if (!request.PassportInspected || request.Decision is not ("admitted" or "declined" or "review") || string.IsNullOrWhiteSpace(request.Reason))
            throw new EventToolsException("Inspect the passport, choose the admission decision and give the reason.", 400);
        var link = await db.Set<VaccinationDeclarationHorse>().SingleOrDefaultAsync(x => x.RiderEntryId == riderId, ct) ?? throw Conflict();
        var settings = await SettingsAsync(competitionId, ct);
        var evidence = await db.Set<VaccinationEvidence>().AsNoTracking().SingleOrDefaultAsync(e => e.Id == request.EvidenceId && e.DeclarationHorseId == link.Id, ct) ?? throw Conflict();
        var newest = await db.Set<VaccinationEvidence>().Where(e => e.DeclarationHorseId == link.Id).MaxAsync(e => e.Revision, ct);
        if (link.Revision != request.ExpectedRevision || IdentityChanged(link, rider) || evidence.Revision != newest
            || settings.Revision != request.ExpectedSettingsRevision || settings.EventStartOn != request.ExpectedEventStartOn) throw Conflict();
        link.Revision++;
        db.Add(new VaccinationInspection
        {
            CompetitionId = competitionId, DeclarationHorseId = link.Id, LinkRevision = link.Revision, EvidenceId = evidence.Id,
            EvidenceRevision = evidence.Revision, SettingsRevision = settings.Revision, PolicyVersionId = settings.PolicyVersionId,
            EventStartOn = settings.EventStartOn, Decision = request.Decision, Reason = request.Reason.Trim(),
            EvaluationJson = JsonSerializer.Serialize(EvidenceDto(evidence, settings).Evaluation, Json), InspectedAt = Now, InspectedByUserId = UserId(user),
        });
        await SaveAsync(ct);
        return (await BoardAsync(competitionId, riderId, ct)).Ponies.Single();
    }
    private async Task SaveAsync(CancellationToken ct)
    {
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { db.ChangeTracker.Clear(); throw Conflict(); }
        catch (DbUpdateException ex) when (ex.InnerException?.Message.Contains("UNIQUE", StringComparison.OrdinalIgnoreCase) == true
            || ex.InnerException is Npgsql.PostgresException { SqlState: "23505" }
            || ex.InnerException is Microsoft.Data.Sqlite.SqliteException { SqliteErrorCode: 5 or 6 }) { db.ChangeTracker.Clear(); throw Conflict(); }
    }
}
