using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>A throwaway competition with one section, N teams and an empty race session.</summary>
public record Arena(int CompetitionId, int SectionId, int SessionId, int[] TeamIds);

public static class ArenaFixtures
{
    public static async Task<T> WithDbAsync<T>(this ApiFactory f, Func<AppDbContext, Task<T>> work)
    {
        using var scope = f.Services.CreateScope();
        return await work(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    public static Task WithDbAsync(this ApiFactory f, Func<AppDbContext, Task> work)
        => f.WithDbAsync<int>(async db => { await work(db); return 0; });

    public static async Task<Arena> CreateArenaAsync(this ApiFactory f, int teamCount = 4, bool raceFinals = false)
    {
        return await f.WithDbAsync(async db =>
        {
            var comp = new Competition { Name = $"Test comp {Guid.NewGuid():N}", StartDate = DateTime.UtcNow.Date };
            db.Competitions.Add(comp);
            await db.SaveChangesAsync();
            var section = new CompetitionSection
            {
                CompetitionId = comp.Id,
                Format = SectionFormat.Teams,
                AgeGroup = "U12",
                DisplayName = "Under 12 Teams",
                UsesRaceFinals = raceFinals,
                // The long-standing behaviour: a finalist's earlier points count. New sections score the final on its own.
                CarryPointsIntoFinal = true,
            };
            var club = new Club { Name = $"Club {Guid.NewGuid():N}" };
            db.CompetitionSections.Add(section);
            db.Clubs.Add(club);
            await db.SaveChangesAsync();
            var teams = Enumerable.Range(1, teamCount).Select(i => new Team
            {
                CompetitionId = comp.Id,
                CompetitionSectionId = section.Id,
                ClubId = club.Id,
                Suffix = i.ToString(),
                DisplayName = $"Team {i}",
                BibColour = "red"
            }).ToList();
            db.Teams.AddRange(teams);
            var session = new Session { CompetitionId = comp.Id, CompetitionSectionId = section.Id, Name = "Session A", OrderIndex = 1 };
            db.Sessions.Add(session);
            await db.SaveChangesAsync();
            return new Arena(comp.Id, section.Id, session.Id, teams.Select(t => t.Id).ToArray());
        });
    }

    /// <summary>Adds a heat with the given teams (lane = position + 1) and a number of races. Returns heat id and race ids.</summary>
    public static async Task<(int HeatId, int[] RaceIds)> AddHeatAsync(
        this ApiFactory f, int sessionId, IEnumerable<int> teamIds, string label = "Heat 1", int orderIndex = 1,
        int raceCount = 1, RaceRoundStage stage = RaceRoundStage.None, int? roundId = null)
    {
        return await f.WithDbAsync(async db =>
        {
            var heat = new Heat
            {
                SessionId = sessionId, Label = label, OrderIndex = orderIndex,
                RaceRoundStage = stage, RaceRoundId = roundId
            };
            db.Heats.Add(heat);
            await db.SaveChangesAsync();
            var lane = 1;
            foreach (var t in teamIds) db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = t, LaneIndex = lane++ });
            var races = Enumerable.Range(1, raceCount).Select(i => new Race { HeatId = heat.Id, Name = $"Race {i}", OrderIndex = i }).ToList();
            db.Races.AddRange(races);
            await db.SaveChangesAsync();
            return (heat.Id, races.Select(r => r.Id).ToArray());
        });
    }
}
