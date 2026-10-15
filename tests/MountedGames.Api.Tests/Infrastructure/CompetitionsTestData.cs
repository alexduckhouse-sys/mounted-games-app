using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>Direct-to-database arrange/assert helpers for the competitions, teams and equipment tests.</summary>
public static class CompetitionsTestData
{
    public static Task<int> SeedCompetitionAsync(this ApiFactory f, string? name = null, DateTime? start = null,
        DateTime? end = null, bool archived = false)
        => f.WithDbAsync(async db =>
        {
            var c = new Competition
            {
                Name = name ?? $"Comp {Guid.NewGuid():N}",
                StartDate = start ?? DateTime.UtcNow.Date.AddDays(30),
                EndDate = end,
                IsArchived = archived,
            };
            db.Competitions.Add(c);
            await db.SaveChangesAsync();
            return c.Id;
        });

    public static Task<int> SeedSectionAsync(this ApiFactory f, int competitionId, string? display = null)
        => f.WithDbAsync(async db =>
        {
            var s = new CompetitionSection
            {
                CompetitionId = competitionId,
                Format = SectionFormat.Teams,
                AgeGroup = "Under 12",
                DisplayName = display ?? $"Section {Guid.NewGuid():N}",
            };
            db.CompetitionSections.Add(s);
            await db.SaveChangesAsync();
            return s.Id;
        });

    public static Task<int> SeedClubAsync(this ApiFactory f, string? name = null, string? bib = null)
        => f.WithDbAsync(async db =>
        {
            var c = new Club { Name = name ?? $"Club {Guid.NewGuid():N}", BibColour = bib };
            db.Clubs.Add(c);
            await db.SaveChangesAsync();
            return c.Id;
        });

    public static Task<int> SeedTeamAsync(this ApiFactory f, int competitionId, int sectionId, int clubId,
        string? display = null, string? trainerUserId = null, bool horsConcours = false, string? joinKey = null)
        => f.WithDbAsync(async db =>
        {
            var t = new Team
            {
                CompetitionId = competitionId,
                CompetitionSectionId = sectionId,
                ClubId = clubId,
                Suffix = "A",
                DisplayName = display ?? $"Team {Guid.NewGuid():N}",
                TrainerUserId = trainerUserId,
                IsHorsConcours = horsConcours,
                SupporterJoinKey = joinKey,
            };
            db.Teams.Add(t);
            await db.SaveChangesAsync();
            return t.Id;
        });

    /// <summary>Creates a session with one heat and one race, and records the given results against it.</summary>
    public static Task<int> SeedScoredRaceAsync(this ApiFactory f, int competitionId, int? sectionId,
        IReadOnlyList<(int TeamId, int? Placing, bool Eliminated, int Points)> results)
        => f.WithDbAsync(async db =>
        {
            var session = new Session { CompetitionId = competitionId, CompetitionSectionId = sectionId, Name = "Scored", OrderIndex = 1 };
            db.Sessions.Add(session);
            await db.SaveChangesAsync();
            var heat = new Heat { SessionId = session.Id, Label = "Heat 1", OrderIndex = 1 };
            db.Heats.Add(heat);
            await db.SaveChangesAsync();
            var race = new Race { HeatId = heat.Id, Name = "R1", OrderIndex = 1, IsComplete = true };
            db.Races.Add(race);
            await db.SaveChangesAsync();
            foreach (var (teamId, placing, elim, points) in results)
                db.Results.Add(new Result { RaceId = race.Id, TeamId = teamId, Placing = placing, Eliminated = elim, Points = points });
            await db.SaveChangesAsync();
            return session.Id;
        });
}
