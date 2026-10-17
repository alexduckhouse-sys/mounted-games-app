using System.Data;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;

namespace MountedGames.Api.Services.EventTools;

public sealed class CompetitionCloneService(AppDbContext db)
{
    public async Task<CloneCompetitionResultDto> CloneAsync(
        int sourceCompetitionId, CloneCompetitionRequest request, string creatorUserId, bool canCopyAllProfiles, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 200)
            throw new EventToolsException("Competition name is required and must be at most 200 characters.", 400);
        if (request.EndDate.HasValue && request.EndDate.Value < request.StartDate)
            throw new EventToolsException("End date cannot be before start date.", 400);

        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
        db.ChangeTracker.Clear();
        var source = await db.Competitions
            .AsSplitQuery()
            .Include(x => x.Sections)
            .Include(x => x.Teams)
            .Include(x => x.Sessions).ThenInclude(x => x.Heats).ThenInclude(x => x.Entries)
            .Include(x => x.Sessions).ThenInclude(x => x.Heats).ThenInclude(x => x.Races)
            .SingleOrDefaultAsync(x => x.Id == sourceCompetitionId, ct)
            ?? throw new EventToolsException("Competition not found.", 404);
        var sourceLinks = await db.Set<EventTeamProfileLink>().AsNoTracking().Include(x => x.TeamProfile)
            .Where(x => x.CompetitionId == sourceCompetitionId).ToListAsync(ct);
        var shift = request.StartDate - source.StartDate;
        DateTime? Shift(DateTime? value) => value.HasValue ? value.Value.Add(shift) : null;

        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var clone = new Competition
        {
            Name = request.Name.Trim(),
            Icon = source.Icon,
            Location = source.Location,
            Latitude = source.Latitude,
            Longitude = source.Longitude,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            IsActive = true,
            IsArchived = false,
            Description = source.Description,
            What3Words = source.What3Words,
            AppleMapsUrl = source.AppleMapsUrl,
            CreatedByUserId = creatorUserId,
        };
        db.Competitions.Add(clone);
        await db.SaveChangesAsync(ct);

        var sectionMap = new Dictionary<int, CompetitionSection>();
        foreach (var sourceSection in source.Sections.OrderBy(x => x.Id))
        {
            var section = new CompetitionSection
            {
                CompetitionId = clone.Id,
                Format = sourceSection.Format,
                AgeGroup = sourceSection.AgeGroup,
                DisplayName = sourceSection.DisplayName,
                RunoffRaceName = sourceSection.RunoffRaceName,
                FinalistCount = sourceSection.FinalistCount,
                UsesRaceFinals = sourceSection.UsesRaceFinals,
                PriceMinor = sourceSection.PriceMinor,
                MaxParticipants = sourceSection.MaxParticipants,
            };
            sectionMap[sourceSection.Id] = section;
            db.CompetitionSections.Add(section);
        }
        await db.SaveChangesAsync(ct);

        var teamMap = new Dictionary<int, Team>();
        foreach (var sourceTeam in source.Teams.OrderBy(x => x.Id))
        {
            var team = new Team
            {
                CompetitionId = clone.Id,
                CompetitionSectionId = sectionMap[sourceTeam.CompetitionSectionId].Id,
                ClubId = sourceTeam.ClubId,
                Suffix = sourceTeam.Suffix,
                DisplayName = sourceTeam.DisplayName,
                BibColour = sourceTeam.BibColour,
                IsHorsConcours = sourceTeam.IsHorsConcours,
                TrainerUserId = null,
                SupporterJoinKey = null,
            };
            teamMap[sourceTeam.Id] = team;
            db.Teams.Add(team);
        }
        await db.SaveChangesAsync(ct);

        var sessionCount = 0;
        var heatCount = 0;
        var raceCount = 0;
        foreach (var sourceSession in source.Sessions.OrderBy(x => x.OrderIndex).ThenBy(x => x.Id))
        {
            var session = new Session
            {
                CompetitionId = clone.Id,
                CompetitionSectionId = sourceSession.CompetitionSectionId.HasValue
                    ? sectionMap[sourceSession.CompetitionSectionId.Value].Id : null,
                Name = sourceSession.Name,
                ArenaName = sourceSession.ArenaName,
                ScheduledStart = Shift(sourceSession.ScheduledStart),
                Status = SessionStatus.Upcoming,
                OrderIndex = sourceSession.OrderIndex,
                Notes = sourceSession.Notes,
                IsBreak = sourceSession.IsBreak,
                DurationMinutes = sourceSession.DurationMinutes,
                Kind = sourceSession.Kind,
                Location = sourceSession.Location,
                LanesPerHeat = sourceSession.LanesPerHeat,
                MinutesPerHeat = sourceSession.MinutesPerHeat,
                RaceOrderAlternating = sourceSession.RaceOrderAlternating,
            };
            db.Sessions.Add(session);
            await db.SaveChangesAsync(ct);
            sessionCount++;
            foreach (var sourceHeat in sourceSession.Heats.OrderBy(x => x.OrderIndex).ThenBy(x => x.Id))
            {
                var heat = new Heat
                {
                    SessionId = session.Id,
                    Label = sourceHeat.Label,
                    OrderIndex = sourceHeat.OrderIndex,
                    DurationMinutes = sourceHeat.DurationMinutes,
                    ScheduledStart = Shift(sourceHeat.ScheduledStart),
                    RaceRoundId = sourceHeat.RaceRoundId,
                    RaceRoundStage = sourceHeat.RaceRoundStage,
                };
                db.Heats.Add(heat);
                await db.SaveChangesAsync(ct);
                heatCount++;
                // Finals entries are populated from results. Keep their heat and race
                // configuration, but let the new event qualify its own teams.
                foreach (var entry in sourceHeat.Entries.Where(_ => !HasResultDerivedEntries(sourceHeat)).OrderBy(x => x.LaneIndex))
                    db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = teamMap[entry.TeamId].Id, LaneIndex = entry.LaneIndex });
                foreach (var sourceRace in sourceHeat.Races.OrderBy(x => x.OrderIndex))
                {
                    db.Races.Add(new Race { HeatId = heat.Id, Name = sourceRace.Name, OrderIndex = sourceRace.OrderIndex, IsComplete = false });
                    raceCount++;
                }
                await db.SaveChangesAsync(ct);
            }
        }

        foreach (var sourceLink in sourceLinks.Where(x => canCopyAllProfiles || x.TeamProfile?.OwnerUserId == creatorUserId))
        {
            db.Set<EventTeamProfileLink>().Add(new EventTeamProfileLink
            {
                TeamProfileId = sourceLink.TeamProfileId,
                CompetitionId = clone.Id,
                TeamId = teamMap[sourceLink.TeamId].Id,
                LinkedByUserId = creatorUserId,
            });
        }
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return new CloneCompetitionResultDto(clone.Id, clone.Name, sectionMap.Count, teamMap.Count, sessionCount, heatCount, raceCount);
        });
    }

    private static bool HasResultDerivedEntries(Heat heat)
    {
        if (heat.RaceRoundStage == RaceRoundStage.Final) return true;
        var label = heat.Label?.Trim() ?? string.Empty;
        return label.Length == 7 && label[0] is >= 'A' and <= 'Z'
            && label.EndsWith(" Final", StringComparison.Ordinal);
    }
}
