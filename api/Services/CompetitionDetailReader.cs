using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Services.Payouts;

namespace MountedGames.Api.Services;

/// <summary>Loads each public part once rather than repeating teams and their result histories for every heat entry.</summary>
public static class CompetitionDetailReader
{
    public sealed record Snapshot(CompetitionDetail? Value, DateTime? ValidUntil);

    public static async Task<Snapshot> LoadAsync(AppDbContext db, int id, bool includePaymentDetails, bool includeBankDetails, CancellationToken ct, bool firstView = false)
    {
        var c = await db.Competitions.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id, ct);
        if (c is null) return new(null, null);
        var sections = await db.CompetitionSections.AsNoTracking().Where(s => s.CompetitionId == id).ToListAsync(ct);
        var sessionQuery = db.Sessions.AsNoTracking().Where(s => s.CompetitionId == id);
        if (firstView)
        {
            var outline = await sessionQuery.Select(s => new Controllers.CompetitionsController.SessionOutline(s.Id, s.ArenaName, s.Status, s.OrderIndex)).ToListAsync(ct);
            var selected = Controllers.CompetitionsController.FirstViewSessionIds(outline);
            sessionQuery = sessionQuery.Where(s => selected.Contains(s.Id));
        }
        var sessions = await sessionQuery.ToListAsync(ct);
        var sessionIds = sessions.Select(s => s.Id).ToArray();
        var heats = await db.Heats.AsNoTracking().Where(h => sessionIds.Contains(h.SessionId)).ToListAsync(ct);
        var heatIds = heats.Select(h => h.Id).ToArray();
        var entries = await db.HeatEntries.AsNoTracking().Where(e => heatIds.Contains(e.HeatId)).ToListAsync(ct);
        var races = await db.Races.AsNoTracking().Where(r => heatIds.Contains(r.HeatId)).ToListAsync(ct);
        var teamQuery = db.Teams.AsNoTracking().Where(t => t.CompetitionId == id);
        if (firstView)
        {
            var selectedTeams = entries.Select(e => e.TeamId).Distinct().ToArray();
            teamQuery = teamQuery.Where(t => selectedTeams.Contains(t.Id));
        }
        var teams = await teamQuery.Select(t => new Team
        {
            Id = t.Id, CompetitionId = t.CompetitionId, CompetitionSectionId = t.CompetitionSectionId,
            ClubId = t.ClubId, Suffix = t.Suffix, DisplayName = t.DisplayName, BibColour = t.BibColour,
            BibDescription = t.BibDescription, TrainerUserId = t.TrainerUserId, IsHorsConcours = t.IsHorsConcours,
            EntryStatus = t.EntryStatus,
            Club = t.Club == null ? null : new Club { Name = t.Club.Name },
            Trainer = t.Trainer == null ? null : new AppUser { FullName = t.Trainer.FullName },
        }).ToListAsync(ct);
        var teamIds = teams.Select(t => t.Id).ToArray();
        var raceIds = races.Select(r => r.Id).ToArray();
        var results = await db.Results.AsNoTracking()
            .Where(r => raceIds.Contains(r.RaceId) || teamIds.Contains(r.TeamId))
            .Select(r => new Result
            {
                Id = r.Id, RaceId = r.RaceId, TeamId = r.TeamId, Placing = r.Placing, Eliminated = r.Eliminated,
                Points = r.Points, IsSitOut = r.IsSitOut, Status = r.Status, RefereeNote = r.RefereeNote,
                Team = new Team { DisplayName = r.Team!.DisplayName },
            }).ToListAsync(ct);
        var bySection = sections.ToDictionary(s => s.Id);
        var byTeam = teams.ToDictionary(t => t.Id);
        var resultsByTeam = results.ToLookup(r => r.TeamId);
        var resultsByRace = results.ToLookup(r => r.RaceId);
        var entriesByHeat = entries.ToLookup(e => e.HeatId);
        var racesByHeat = races.ToLookup(r => r.HeatId);
        var heatsBySession = heats.ToLookup(h => h.SessionId);
        foreach (var team in teams)
        {
            team.Section = bySection.GetValueOrDefault(team.CompetitionSectionId);
            team.Results = resultsByTeam[team.Id].ToList();
        }
        foreach (var entry in entries) entry.Team = byTeam.GetValueOrDefault(entry.TeamId);
        foreach (var race in races) race.Results = resultsByRace[race.Id].ToList();
        foreach (var heat in heats)
        {
            heat.Entries = entriesByHeat[heat.Id].ToList();
            heat.Races = racesByHeat[heat.Id].ToList();
        }
        foreach (var session in sessions)
        {
            session.Section = bySection.GetValueOrDefault(session.CompetitionSectionId ?? 0);
            session.Heats = heatsBySession[session.Id].ToList();
        }
        var now = DateTime.UtcNow;
        var signups = await db.SectionSignups.AsNoTracking()
            .Where(s => s.Section!.CompetitionId == id && (s.Status == SignupPaymentStatus.Paid || s.Status == SignupPaymentStatus.Pending)
                && !db.Set<SignupMatchmaking>().Any(m => m.SignupId == s.Id && m.WaitingForGuestSpot)
                && !db.Set<SignupExtras>().Any(x => x.SignupId == s.Id && (x.IsWithdrawn || (x.IsWaitlist && (x.WaitlistOfferExpiresAt == null || x.WaitlistOfferExpiresAt <= now)))))
            .Select(s => new { s.CompetitionSectionId,
                Count = db.Set<SignupExtras>().Where(x => x.SignupId == s.Id).Select(x => (int?)x.TeamsCount).FirstOrDefault() ?? 1 })
            .ToListAsync(ct);
        var counts = signups.GroupBy(s => s.CompetitionSectionId).ToDictionary(g => g.Key, g => g.Sum(s => s.Count));
        // A clock change can release capacity without a write; never retain a snapshot past the next offer expiry.
        var expiry = await (from x in db.Set<SignupExtras>().AsNoTracking()
                            join s in db.SectionSignups on x.SignupId equals s.Id
                            where s.Section!.CompetitionId == id && x.IsWaitlist && x.WaitlistOfferExpiresAt > now
                            select x.WaitlistOfferExpiresAt).MinAsync(ct);
        var capacity = await VenueCapacity.GetCapacityAsync(db, id, ct: ct);
        var demo = await db.Set<EventCommerceSettings>().AsNoTracking().AnyAsync(x => x.CompetitionId == id && x.IsDemo, ct);
        var payout = await db.PayoutsToAsync(c.CreatedByUserId, c.DecFormConfigJson, ct);
        return new(c.ToDto(sections.OrderBy(s => s.DisplayName).Select(s => s.ToDto(counts.GetValueOrDefault(s.Id))).ToList(),
            teams.OrderBy(t => t.DisplayName).Select(t => includePaymentDetails ? t.ToDto() : t.ToDto() with { TrainerUserId = null }).ToList(),
            sessions.OrderBy(s => s.OrderIndex).Select(s => s.ToDto()).ToList(), isDemo: demo, payoutsTo: payout,
            includePaymentDetails: includePaymentDetails, includeBankDetails: includeBankDetails,
            maxStables: capacity.MaxStables, maxHookups: capacity.MaxHookups,
            stablesRemaining: capacity.StablesRemaining, hookupsRemaining: capacity.HookupsRemaining), expiry);
    }
}
