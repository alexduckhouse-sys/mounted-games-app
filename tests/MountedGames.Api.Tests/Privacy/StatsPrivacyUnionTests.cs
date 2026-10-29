using System.Net;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Privacy;

public class StatsPrivacyUnionTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private sealed record Scenario(Arena Arena, Guid ProfileId, string FirstName, string FullName, string ShownName, string Pony, string Club);

    private async Task<Scenario> SeedAsync(SectionFormat format, bool locked, bool initialOnly, bool ordinaryTeamName = false)
    {
        var arena = await factory.CreateArenaAsync(1);
        var heat = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds);
        var owner = await factory.TrainerIdAsync();
        return await factory.WithDbAsync(async db =>
        {
            var suffix = Guid.NewGuid().ToString("N")[..8];
            var firstName = $"Fake{suffix}";
            var riderName = $"{firstName} Hiddensurname";
            var secondName = $"Example{suffix} Othersurname";
            var fullName = ordinaryTeamName ? $"Fake Club{suffix} A" : format == SectionFormat.Individual ? riderName : $"{riderName} & {secondName}";
            var shownName = ordinaryTeamName || (locked && !initialOnly) ? fullName : format == SectionFormat.Individual ? $"{firstName} H." : $"{firstName} H. & Example{suffix} O.";
            var team = await db.Teams.Include(t => t.Section).Include(t => t.Competition).Include(t => t.Club).SingleAsync(t => t.Id == arena.TeamIds[0]);
            team.DisplayName = fullName;
            team.Section!.Format = format;
            team.Competition!.StartDate = DateTime.UtcNow.AddDays(-30);
            team.Competition.EndDate = DateTime.UtcNow.AddDays(-29);
            var race = await db.Races.FindAsync(heat.RaceIds[0]);
            race!.IsComplete = true;
            db.Results.Add(new Result { RaceId = race.Id, TeamId = team.Id, Placing = 1, Points = 1 });
            team.Club!.Name = $"Fake Club{suffix}";
            var pony = $"Fake Pony{suffix}";
            var saved = new SavedRider { ClubId = team.ClubId, FullName = riderName, UseInitialOnly = initialOnly };
            var form = new DeclarationForm
            {
                TeamId = team.Id, IsLocked = locked,
                Riders = [new RiderEntry { FullName = riderName, SavedRider = saved, HorseName = pony }],
            };
            if (format == SectionFormat.Pairs) form.Riders.Add(new RiderEntry { FullName = secondName });
            db.Add(form);
            var profile = new TeamProfile { ClubId = team.ClubId, OwnerUserId = owner, DisplayName = fullName };
            db.Add(new EventTeamProfileLink { TeamId = team.Id, CompetitionId = team.CompetitionId, TeamProfile = profile, LinkedByUserId = owner });
            await db.SaveChangesAsync();
            return new Scenario(arena, profile.Id, firstName, fullName, shownName, pony, team.Club.Name);
        });
    }

    [Theory]
    [InlineData(SectionFormat.Pairs, true)]
    [InlineData(SectionFormat.Pairs, false)]
    [InlineData(SectionFormat.Individual, true)]
    [InlineData(SectionFormat.Individual, false)]
    public async Task RiderNamedTeamsHaveSafeSearchKeysHeadingsHistoryAndShareCards(SectionFormat format, bool locked)
    {
        var s = await SeedAsync(format, locked, initialOnly: true);
        var visitor = factory.CreateClient();
        var search = await (await visitor.GetAsync($"/api/stats/search?q={s.FirstName}")).ReadAsync<StatsSearchDto>();
        var hit = Assert.Single(search.Teams);
        Assert.Equal(s.ShownName, hit.Name);
        Assert.Equal(s.ShownName.ToLowerInvariant(), hit.Key);
        var browse = await (await visitor.GetAsync($"/api/stats/browse?kind=2&q={s.FirstName}")).ReadAsync<StatsBrowseDto>();
        Assert.Equal(s.ShownName, Assert.Single(browse.Items).Name);
        var surnameSearch = await (await visitor.GetAsync($"/api/stats/search?q={s.FirstName}%20Hiddensurname")).ReadAsync<StatsSearchDto>();
        Assert.Empty(surnameSearch.Teams);
        Assert.Equal(HttpStatusCode.NotFound, (await visitor.GetAsync($"/api/stats/teams?name={Uri.EscapeDataString(s.FullName)}")).StatusCode);

        var routes = new List<string>
        {
            $"/api/stats/teams?name={Uri.EscapeDataString(s.ShownName)}",
            $"/api/stats/team-profiles/{s.ProfileId}",
            $"/api/stats/clubs?name={Uri.EscapeDataString(s.Club)}",
            $"/api/stats/competitions/{s.Arena.CompetitionId}/favourites-history?sectionId={s.Arena.SectionId}",
            $"/api/team-profiles/{s.ProfileId}/history",
            $"/api/share/team-profiles/{s.ProfileId}",
        };
        if (locked) routes.Add($"/api/stats/ponies?name={Uri.EscapeDataString(s.Pony)}");
        foreach (var route in routes)
        {
            var response = await visitor.GetAsync(route);
            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadAsStringAsync();
            Assert.Contains($"{s.FirstName} H.", body);
            Assert.DoesNotContain("Hiddensurname", body);
            Assert.DoesNotContain("Othersurname", body);
        }
        var admin = await factory.AdminAsync();
        var full = await (await admin.GetAsync($"/api/stats/teams?name={Uri.EscapeDataString(s.FullName)}")).ReadAsync<StatsProfileDto>();
        Assert.Equal(s.FullName, full.Name);
        Assert.Equal(s.FullName, Assert.Single(full.Entries!).TeamName);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task PairsKeepConsentfulRiderNamesAndOrdinaryClubLabels(bool ordinaryTeamName)
    {
        var s = await SeedAsync(SectionFormat.Pairs, locked: true, initialOnly: ordinaryTeamName, ordinaryTeamName: ordinaryTeamName);
        var visitor = factory.CreateClient();
        var profile = await (await visitor.GetAsync($"/api/stats/team-profiles/{s.ProfileId}")).ReadAsync<StatsProfileDto>();
        Assert.Equal(s.FullName, profile.Name);
        Assert.Equal(s.FullName, Assert.Single(profile.Entries!).TeamName);
        var response = await visitor.GetAsync($"/api/share/team-profiles/{s.ProfileId}");
        response.EnsureSuccessStatusCode();
        Assert.Contains(ordinaryTeamName ? s.Club : "Hiddensurname", await response.Content.ReadAsStringAsync());
    }
}
