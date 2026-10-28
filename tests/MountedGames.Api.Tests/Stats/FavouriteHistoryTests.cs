using System.Net;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Stats;

/// <summary>The earlier finishes behind the stream's Favourites card: public, names and one figure only.</summary>
public class FavouriteHistoryTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public FavouriteHistoryTests(ApiFactory f) => _f = f;

    private sealed record Seeded(int CompetitionId, int SectionId, Dictionary<string, int> Teams);

    /// <summary>A competition with one age group and one scored race: each team scores the points given, in order.</summary>
    private Task<Seeded> SeedAsync(string competition, DateTime start, (string Name, double Points, bool Hc)[] teams, bool scored = true)
        => _f.WithDbAsync(async db =>
        {
            var comp = new Competition { Name = competition, StartDate = start };
            db.Competitions.Add(comp);
            await db.SaveChangesAsync();
            var section = new CompetitionSection { CompetitionId = comp.Id, AgeGroup = "U14", DisplayName = "U14" };
            db.CompetitionSections.Add(section);
            await db.SaveChangesAsync();
            var club = db.Clubs.Add(new Club { Name = $"Club {Guid.NewGuid():N}" }).Entity;
            await db.SaveChangesAsync();
            var created = new Dictionary<string, int>();
            foreach (var t in teams)
            {
                var team = new Team { CompetitionId = comp.Id, CompetitionSectionId = section.Id, Club = club, DisplayName = t.Name, IsHorsConcours = t.Hc };
                db.Teams.Add(team);
                await db.SaveChangesAsync();
                created[t.Name] = team.Id;
            }
            var session = new Session { CompetitionId = comp.Id, CompetitionSectionId = section.Id, Name = "Morning", OrderIndex = 1 };
            db.Sessions.Add(session);
            await db.SaveChangesAsync();
            var heat = new Heat { SessionId = session.Id, Label = "Heat 1", OrderIndex = 1 };
            var lane = 1;
            foreach (var t in teams) heat.Entries.Add(new HeatEntry { TeamId = created[t.Name], LaneIndex = lane++ });
            db.Heats.Add(heat);
            await db.SaveChangesAsync();
            var race = new Race { HeatId = heat.Id, Name = "Bending", OrderIndex = 0, IsComplete = scored };
            var placing = 1;
            if (scored)
                foreach (var t in teams.OrderByDescending(x => x.Points))
                    race.Results.Add(new Result { TeamId = created[t.Name], Placing = placing++, Points = t.Points, Status = ResultStatus.Finished });
            db.Races.Add(race);
            await db.SaveChangesAsync();
            return new Seeded(comp.Id, section.Id, created);
        });

    [Fact]
    public async Task Averages_the_place_share_of_earlier_finished_entries_by_team_name_and_is_public()
    {
        var u = Guid.NewGuid().ToString("N")[..6];
        string Alpha = $"Alpha {u}", Beta = $"Beta {u}", Gamma = $"Gamma {u}", Hc = $"Hc {u}";
        // Earlier event: Alpha wins, Beta second of three placed (HC left out).
        await SeedAsync($"Past one {u}", DateTime.UtcNow.AddDays(-60), [(Alpha, 9, false), (Beta, 6, false), ($"Other {u}", 3, false), (Hc, 12, true)]);
        // Another earlier event: Alpha is second of two.
        await SeedAsync($"Past two {u}", DateTime.UtcNow.AddDays(-30), [($"Rival {u}", 8, false), (Alpha.ToUpperInvariant(), 4, false)]);
        // A future event that has not been ridden does not count.
        await SeedAsync($"Future {u}", DateTime.UtcNow.AddDays(30), [(Gamma, 5, false), (Beta, 1, false)], scored: false);
        var now = await SeedAsync($"Now {u}", DateTime.UtcNow, [(Alpha, 0, false), (Beta, 0, false), (Gamma, 0, false), (Hc, 0, true)], scored: false);

        var response = await _f.CreateClient().GetAsync($"/api/stats/competitions/{now.CompetitionId}/favourites-history?sectionId={now.SectionId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var rows = await response.ReadAsync<List<FavouriteHistoryDto>>();

        Assert.Equal(3, rows.Count);
        Assert.DoesNotContain(rows, r => r.TeamName == Hc);
        var alpha = rows.Single(r => r.TeamName == Alpha);
        Assert.Equal(2, alpha.HistoryEntries);
        Assert.Equal(Math.Round((1.0 / 3 + 2.0 / 2) / 2, 4), alpha.HistoryPlaceShare);
        var beta = rows.Single(r => r.TeamName == Beta);
        Assert.Equal(1, beta.HistoryEntries);
        Assert.Equal(Math.Round(2.0 / 3, 4), beta.HistoryPlaceShare);
        var gamma = rows.Single(r => r.TeamName == Gamma);
        Assert.Equal(0, gamma.HistoryEntries);
        Assert.Null(gamma.HistoryPlaceShare);
    }

    [Fact]
    public async Task Unknown_age_group_is_not_found()
    {
        var now = await SeedAsync($"Solo {Guid.NewGuid():N}", DateTime.UtcNow, [("Solo", 0, false)], scored: false);
        var response = await _f.CreateClient().GetAsync($"/api/stats/competitions/{now.CompetitionId}/favourites-history?sectionId={now.SectionId + 9999}");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
