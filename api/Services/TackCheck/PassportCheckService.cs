using System.Globalization;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.EventTools;

namespace MountedGames.Api.Services.TackCheck;

/// <summary>
/// The passport and vaccination check on arrival, for competitions that turn it on. Staff only. Ponies come from
/// each team's latest declaration and are matched by name within that team, or across competitions via
/// <see cref="CertifiedHorse"/> when a passport code or horse + owner full name is recorded.
/// </summary>
public sealed class PassportCheckService(AppDbContext db)
{
    /// <summary>The name a tick is stored under: trimmed, single-spaced and lower-case.</summary>
    public static string KeyOf(string name)
        => string.Join(' ', name.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).ToLowerInvariant();

    public static string? NormalizePassportCode(string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        var norm = string.Join(' ', code.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).ToUpperInvariant();
        return norm.Length == 0 ? null : Truncate(norm, 80);
    }

    private static string? CleanText(string? value, int max)
        => string.IsNullOrWhiteSpace(value) ? null : Truncate(value.Trim(), max);

    private static string NormalizeRole(string? role)
        => string.Equals(role?.Trim(), "Vet", StringComparison.OrdinalIgnoreCase) ? "Vet" : "Official";

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];

    private static DateOnly? ParseIsoDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return DateOnly.TryParseExact(value.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
            || DateOnly.TryParse(value.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.None, out d)
            ? d
            : null;
    }

    private static string? ValidateIsoDate(string? value, string label)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var parsed = ParseIsoDate(value)
            ?? throw new EventToolsException($"Invalid {label}; use YYYY-MM-DD.", StatusCodes.Status400BadRequest);
        return parsed.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Evaluates whether a pony is currently certified as of <paramref name="referenceDate"/>.
    /// Automatically removes the Certified tick (`Certified = false`, `Status = "Expired"`) when either
    /// <paramref name="fluValidUntil"/> or <paramref name="tetanusValidUntil"/> has passed, and flags
    /// vaccinations given within the last 6 days as `"TooRecent"`.
    /// </summary>
    public static (bool Certified, string Status) EvaluateStatus(
        DateOnly referenceDate,
        bool hasCheckOrCert,
        ref string? lastFluVaccineDate,
        ref string? fluValidUntil,
        ref string? lastTetanusDate,
        ref string? tetanusValidUntil)
    {
        var lastFlu = ParseIsoDate(lastFluVaccineDate);
        var fluValid = ParseIsoDate(fluValidUntil);
        var lastTet = ParseIsoDate(lastTetanusDate);
        var tetValid = ParseIsoDate(tetanusValidUntil);

        if (lastFlu.HasValue && !fluValid.HasValue)
        {
            fluValid = lastFlu.Value.AddMonths(12);
            fluValidUntil = fluValid.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }
        if (lastTet.HasValue && !tetValid.HasValue)
        {
            tetValid = lastTet.Value.AddMonths(24);
            tetanusValidUntil = tetValid.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        if ((fluValid.HasValue && referenceDate > fluValid.Value)
            || (tetValid.HasValue && referenceDate > tetValid.Value))
        {
            return (false, "Expired");
        }

        if (lastFlu.HasValue && referenceDate < lastFlu.Value.AddDays(7))
        {
            return (false, "TooRecent");
        }

        if (hasCheckOrCert || lastFlu.HasValue || lastTet.HasValue || fluValid.HasValue || tetValid.HasValue)
        {
            return (true, "Certified");
        }

        return (false, "Unchecked");
    }

    private static CertifiedHorse? MatchCertifiedHorse(
        IReadOnlyList<CertifiedHorse> certifiedHorses, string? passportCode, string horseKey, string? ownerFullName)
    {
        if (!string.IsNullOrWhiteSpace(passportCode))
        {
            var byPassport = certifiedHorses
                .Where(x => string.Equals(x.PassportCode, passportCode, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(x => x.InspectedAt)
                .ThenByDescending(x => x.Id)
                .FirstOrDefault();
            if (byPassport is not null) return byPassport;
        }

        if (!string.IsNullOrWhiteSpace(ownerFullName) && horseKey.Length > 0)
        {
            var ownerKey = KeyOf(ownerFullName);
            if (ownerKey.Length > 0)
            {
                return certifiedHorses
                    .Where(x => x.HorseKey == horseKey && x.OwnerKey == ownerKey)
                    .OrderByDescending(x => x.InspectedAt)
                    .ThenByDescending(x => x.Id)
                    .FirstOrDefault();
            }
        }

        return null;
    }

    private static PassportCheckPonyDto BuildPonyDto(
        string ponyName,
        IReadOnlyList<RiderEntry> riders,
        PassportCheck? check,
        CertifiedHorse? cert,
        DateOnly referenceDate)
    {
        var declaredPassport = riders.Select(r => NormalizePassportCode(r.PonyPassportNumber)).FirstOrDefault(x => x is not null);
        var declaredOwner = riders.Select(r => CleanText(r.PonyOwnerFullName, 160)).FirstOrDefault(x => x is not null);

        var passportCode = NormalizePassportCode(check?.PassportCode) ?? declaredPassport ?? NormalizePassportCode(cert?.PassportCode);
        var ownerFullName = CleanText(check?.OwnerFullName, 160) ?? declaredOwner ?? CleanText(cert?.OwnerFullName, 160);
        var lastFlu = CleanText(check?.LastFluVaccineDate, 16) ?? CleanText(cert?.LastFluVaccineDate, 16);
        var fluValid = CleanText(check?.FluValidUntil, 16) ?? CleanText(cert?.FluValidUntil, 16);
        var lastTet = CleanText(check?.LastTetanusDate, 16) ?? CleanText(cert?.LastTetanusDate, 16);
        var tetValid = CleanText(check?.TetanusValidUntil, 16) ?? CleanText(cert?.TetanusValidUntil, 16);
        var inspectorRole = CleanText(check?.InspectorRole, 40) ?? CleanText(cert?.InspectorRole, 40);
        var officialNotes = CleanText(check?.OfficialNotes, 500) ?? CleanText(cert?.OfficialNotes, 500);
        var checkedByName = check?.CheckedByName ?? CleanText(cert?.InspectedByName, 200);
        var rawCheckedAt = check?.CheckedAt ?? cert?.InspectedAt;

        var (certified, status) = EvaluateStatus(
            referenceDate,
            hasCheckOrCert: check is not null || cert is not null,
            ref lastFlu,
            ref fluValid,
            ref lastTet,
            ref tetValid);

        return new PassportCheckPonyDto(
            ponyName,
            riders.Select(r => r.FullName).ToList(),
            certified ? rawCheckedAt : null,
            checkedByName,
            passportCode,
            ownerFullName,
            certified,
            status,
            lastFlu,
            fluValid,
            lastTet,
            tetValid,
            inspectorRole,
            officialNotes);
    }

    public async Task<PassportCheckBoardDto?> BoardAsync(int competitionId, CancellationToken ct)
    {
        var competition = await db.Competitions.AsNoTracking().AsSplitQuery()
            .Include(x => x.Sections).ThenInclude(x => x.Teams).ThenInclude(x => x.Club)
            .Include(x => x.Sections).ThenInclude(x => x.Teams).ThenInclude(x => x.DeclarationForms).ThenInclude(x => x.Riders)
            .SingleOrDefaultAsync(x => x.Id == competitionId, ct);
        if (competition is null) return null;
        if (!competition.EnablePassportCheck) return new PassportCheckBoardDto(false, 0, 0, []);

        var referenceDate = DateOnly.FromDateTime(competition.StartDate);
        var checks = (await db.Set<PassportCheck>().AsNoTracking().Where(x => x.CompetitionId == competitionId).ToListAsync(ct))
            .ToDictionary(x => (x.TeamId, x.PonyKey));
        var certifiedHorses = await db.Set<CertifiedHorse>().AsNoTracking().ToListAsync(ct);

        var sections = competition.Sections.OrderBy(x => x.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(x => x.Id)
            .Select(section => new PassportCheckSectionDto(section.Id, section.DisplayName,
                section.Teams.OrderBy(t => t.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(t => t.Id).Select(team =>
                {
                    var riders = TackCheckService.DeclaredRiders(team).ToList();
                    var ponies = riders
                        .Where(r => TackCheckService.PonyName(r.HorseName) is not null)
                        .GroupBy(r => KeyOf(r.HorseName!))
                        .Select(g =>
                        {
                            var groupRiders = g.ToList();
                            checks.TryGetValue((team.Id, g.Key), out var check);
                            var passportCode = NormalizePassportCode(check?.PassportCode)
                                ?? groupRiders.Select(r => NormalizePassportCode(r.PonyPassportNumber)).FirstOrDefault(x => x is not null);
                            var ownerFullName = CleanText(check?.OwnerFullName, 160)
                                ?? groupRiders.Select(r => CleanText(r.PonyOwnerFullName, 160)).FirstOrDefault(x => x is not null);
                            var cert = MatchCertifiedHorse(certifiedHorses, passportCode, g.Key, ownerFullName);
                            return BuildPonyDto(
                                TackCheckService.PonyName(groupRiders[0].HorseName)!,
                                groupRiders,
                                check,
                                cert,
                                referenceDate);
                        }).ToList();
                    return new PassportCheckTeamDto(team.Id, team.DisplayName, team.Club?.Name ?? string.Empty,
                        team.EntryStatus != TeamEntryStatus.Active, team.IsHorsConcours, team.DeclarationForms.Count > 0, ponies);
                }).ToList())).ToList();
        var all = sections.SelectMany(s => s.Teams).SelectMany(t => t.Ponies).ToList();
        return new PassportCheckBoardDto(true, all.Count(p => p.Certified), all.Count, sections);
    }

    /// <summary>Turns the check on or off. Turning it off hides the ticks but keeps them.</summary>
    public async Task<bool> SetEnabledAsync(int competitionId, bool enabled, CancellationToken ct)
    {
        var competition = await db.Competitions.SingleOrDefaultAsync(x => x.Id == competitionId, ct);
        if (competition is null) return false;
        competition.EnablePassportCheck = enabled;
        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>Ticks, inspects or clears one pony on one team. The pony must be on the team's latest declaration.</summary>
    public async Task<PassportCheckPonyDto> SetCheckedAsync(
        int competitionId, int teamId, SetPassportCheckRequest request, string? userId, string? userName, CancellationToken ct)
    {
        var competition = await db.Competitions.AsNoTracking()
            .SingleOrDefaultAsync(c => c.Id == competitionId && c.EnablePassportCheck, ct)
            ?? throw new EventToolsException("The passport check is turned off for this competition.", StatusCodes.Status409Conflict);
        var team = await db.Teams.AsNoTracking().Include(t => t.DeclarationForms).ThenInclude(f => f.Riders)
            .SingleOrDefaultAsync(t => t.Id == teamId && t.CompetitionId == competitionId, ct)
            ?? throw new EventToolsException("That team is not in this competition.", StatusCodes.Status404NotFound);
        var key = KeyOf(request.PonyName ?? string.Empty);
        var riders = TackCheckService.DeclaredRiders(team)
            .Where(r => TackCheckService.PonyName(r.HorseName) is not null && KeyOf(r.HorseName!) == key).ToList();
        if (key.Length == 0 || riders.Count == 0)
            throw new EventToolsException("That pony is not on this team’s declaration.", StatusCodes.Status404NotFound);

        var ponyDisplayName = TackCheckService.PonyName(riders[0].HorseName)!;
        var referenceDate = DateOnly.FromDateTime(competition.StartDate);

        var lastFlu = ValidateIsoDate(request.LastFluVaccineDate, "flu vaccine date");
        var fluValid = ValidateIsoDate(request.FluValidUntil, "flu valid-until date");
        var lastTet = ValidateIsoDate(request.LastTetanusDate, "tetanus vaccine date");
        var tetValid = ValidateIsoDate(request.TetanusValidUntil, "tetanus valid-until date");

        if (lastFlu is not null && fluValid is null)
            fluValid = ParseIsoDate(lastFlu)!.Value.AddMonths(12).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (lastTet is not null && tetValid is null)
            tetValid = ParseIsoDate(lastTet)!.Value.AddMonths(24).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        var declaredPassport = riders.Select(r => NormalizePassportCode(r.PonyPassportNumber)).FirstOrDefault(x => x is not null);
        var declaredOwner = riders.Select(r => CleanText(r.PonyOwnerFullName, 160)).FirstOrDefault(x => x is not null);

        var existing = await db.Set<PassportCheck>().SingleOrDefaultAsync(x => x.TeamId == teamId && x.PonyKey == key, ct);
        CertifiedHorse? certifiedHorse = null;

        if (request.Checked)
        {
            var inspectorName = string.IsNullOrWhiteSpace(userName) ? null : Truncate(userName.Trim(), 200);
            if (existing is null)
            {
                existing = new PassportCheck
                {
                    CompetitionId = competitionId,
                    TeamId = teamId,
                    PonyKey = key,
                    PonyName = ponyDisplayName,
                    CheckedAt = DateTime.UtcNow,
                    CheckedByUserId = userId,
                    CheckedByName = inspectorName,
                };
                db.Add(existing);
            }
            else
            {
                existing.CheckedAt = DateTime.UtcNow;
                existing.CheckedByUserId = userId ?? existing.CheckedByUserId;
                existing.CheckedByName = inspectorName ?? existing.CheckedByName;
            }

            var passportCode = NormalizePassportCode(request.PassportCode) ?? existing.PassportCode ?? declaredPassport;
            var ownerFullName = CleanText(request.OwnerFullName, 160) ?? existing.OwnerFullName ?? declaredOwner;
            var role = request.InspectorRole is not null
                ? NormalizeRole(request.InspectorRole)
                : (existing.InspectorRole ?? "Official");
            var notes = request.OfficialNotes is not null
                ? CleanText(request.OfficialNotes, 500)
                : existing.OfficialNotes;

            existing.PassportCode = passportCode;
            existing.OwnerFullName = ownerFullName;
            if (lastFlu is not null || request.LastFluVaccineDate is not null) existing.LastFluVaccineDate = lastFlu;
            if (fluValid is not null || request.FluValidUntil is not null) existing.FluValidUntil = fluValid;
            if (lastTet is not null || request.LastTetanusDate is not null) existing.LastTetanusDate = lastTet;
            if (tetValid is not null || request.TetanusValidUntil is not null) existing.TetanusValidUntil = tetValid;
            existing.InspectorRole = role;
            existing.OfficialNotes = notes;

            var hasInspectionDetails = passportCode is not null
                || ownerFullName is not null
                || existing.LastFluVaccineDate is not null
                || existing.FluValidUntil is not null
                || existing.LastTetanusDate is not null
                || existing.TetanusValidUntil is not null
                || existing.OfficialNotes is not null;

            if (hasInspectionDetails)
            {
                certifiedHorse = await UpsertCertifiedHorseAsync(
                    ponyDisplayName, key, passportCode, ownerFullName, existing, userId, inspectorName, ct);
            }
        }
        else if (existing is not null)
        {
            db.Remove(existing);
            existing = null;
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException) when (request.Checked)
        {
            // Another steward ticked the same pony a moment earlier: theirs stands.
            db.ChangeTracker.Clear();
            existing = await db.Set<PassportCheck>().AsNoTracking().SingleAsync(x => x.TeamId == teamId && x.PonyKey == key, ct);
        }

        return BuildPonyDto(ponyDisplayName, riders, existing, certifiedHorse, referenceDate);
    }

    private async Task<CertifiedHorse> UpsertCertifiedHorseAsync(
        string horseName,
        string horseKey,
        string? passportCode,
        string? ownerFullName,
        PassportCheck check,
        string? userId,
        string? inspectorName,
        CancellationToken ct)
    {
        CertifiedHorse? cert = null;
        if (!string.IsNullOrWhiteSpace(passportCode))
        {
            cert = await db.Set<CertifiedHorse>()
                .OrderByDescending(x => x.InspectedAt)
                .FirstOrDefaultAsync(x => x.PassportCode == passportCode, ct);
        }
        var ownerKey = string.IsNullOrWhiteSpace(ownerFullName) ? null : KeyOf(ownerFullName);
        if (cert is null && ownerKey is not null)
        {
            cert = await db.Set<CertifiedHorse>()
                .OrderByDescending(x => x.InspectedAt)
                .FirstOrDefaultAsync(x => x.HorseKey == horseKey && x.OwnerKey == ownerKey, ct);
        }
        if (cert is null && passportCode is null && ownerKey is null)
        {
            cert = await db.Set<CertifiedHorse>()
                .OrderByDescending(x => x.InspectedAt)
                .FirstOrDefaultAsync(x => x.HorseKey == horseKey && x.PassportCode == null && x.OwnerKey == null, ct);
        }

        if (cert is null)
        {
            cert = new CertifiedHorse();
            db.Add(cert);
        }

        cert.PassportCode = passportCode ?? cert.PassportCode;
        cert.HorseName = Truncate(horseName, 160);
        cert.HorseKey = Truncate(horseKey, 160);
        cert.OwnerFullName = ownerFullName ?? cert.OwnerFullName;
        cert.OwnerKey = ownerKey ?? cert.OwnerKey;
        cert.LastFluVaccineDate = check.LastFluVaccineDate ?? cert.LastFluVaccineDate;
        cert.FluValidUntil = check.FluValidUntil ?? cert.FluValidUntil;
        cert.LastTetanusDate = check.LastTetanusDate ?? cert.LastTetanusDate;
        cert.TetanusValidUntil = check.TetanusValidUntil ?? cert.TetanusValidUntil;
        cert.InspectorRole = NormalizeRole(check.InspectorRole);
        cert.InspectedByUserId = userId ?? cert.InspectedByUserId;
        cert.InspectedByName = Truncate(inspectorName ?? check.CheckedByName ?? "Official", 160);
        cert.InspectedAt = check.CheckedAt;
        cert.OfficialNotes = check.OfficialNotes ?? cert.OfficialNotes;
        return cert;
    }

    /// <summary>
    /// Looks up a horse's certification status by passport code or by pony name + owner full name.
    /// Automatically expires certification if the reference date is past <see cref="CertifiedHorse.FluValidUntil"/>
    /// or <see cref="CertifiedHorse.TetanusValidUntil"/>.
    /// </summary>
    public async Task<CertifiedHorseLookupDto> LookupCertifiedHorseAsync(
        string? passportCode, string? ponyName, string? ownerFullName, int? competitionId, CancellationToken ct)
    {
        var normPassport = NormalizePassportCode(passportCode);
        var cleanPonyName = CleanText(ponyName, 160);
        var cleanOwner = CleanText(ownerFullName, 160);
        var horseKey = cleanPonyName is null ? string.Empty : KeyOf(cleanPonyName);
        var ownerKey = cleanOwner is null ? string.Empty : KeyOf(cleanOwner);

        var referenceDate = DateOnly.FromDateTime(DateTime.UtcNow);
        if (competitionId.HasValue)
        {
            var compStart = await db.Competitions.AsNoTracking()
                .Where(c => c.Id == competitionId.Value)
                .Select(c => (DateTime?)c.StartDate)
                .SingleOrDefaultAsync(ct);
            if (compStart.HasValue)
                referenceDate = DateOnly.FromDateTime(compStart.Value);
        }

        CertifiedHorse? cert = null;
        if (normPassport is not null)
        {
            cert = await db.Set<CertifiedHorse>().AsNoTracking()
                .Where(x => x.PassportCode == normPassport)
                .OrderByDescending(x => x.InspectedAt)
                .ThenByDescending(x => x.Id)
                .FirstOrDefaultAsync(ct);
        }
        if (cert is null && horseKey.Length > 0 && ownerKey.Length > 0)
        {
            cert = await db.Set<CertifiedHorse>().AsNoTracking()
                .Where(x => x.HorseKey == horseKey && x.OwnerKey == ownerKey)
                .OrderByDescending(x => x.InspectedAt)
                .ThenByDescending(x => x.Id)
                .FirstOrDefaultAsync(ct);
        }

        if (cert is null)
        {
            return new CertifiedHorseLookupDto(
                Found: false,
                Certified: false,
                Status: "Unchecked",
                PassportCode: normPassport,
                HorseName: cleanPonyName,
                OwnerFullName: cleanOwner,
                LastFluVaccineDate: null,
                FluValidUntil: null,
                LastTetanusDate: null,
                TetanusValidUntil: null,
                InspectorRole: null,
                InspectedByName: null,
                InspectedAt: null,
                OfficialNotes: null);
        }

        var lastFlu = cert.LastFluVaccineDate;
        var fluValid = cert.FluValidUntil;
        var lastTet = cert.LastTetanusDate;
        var tetValid = cert.TetanusValidUntil;
        var (certified, status) = EvaluateStatus(referenceDate, hasCheckOrCert: true, ref lastFlu, ref fluValid, ref lastTet, ref tetValid);

        return new CertifiedHorseLookupDto(
            Found: true,
            Certified: certified,
            Status: status,
            PassportCode: cert.PassportCode,
            HorseName: cert.HorseName,
            OwnerFullName: cert.OwnerFullName,
            LastFluVaccineDate: lastFlu,
            FluValidUntil: fluValid,
            LastTetanusDate: lastTet,
            TetanusValidUntil: tetValid,
            InspectorRole: cert.InspectorRole,
            InspectedByName: cert.InspectedByName,
            InspectedAt: cert.InspectedAt,
            OfficialNotes: cert.OfficialNotes);
    }
}
