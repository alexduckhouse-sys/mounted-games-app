using System.Net;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Stats;

/// <summary>
/// The statistics hub. Every test seeds its own events with names carrying a unique marker, so tests sharing the
/// class database can't see each other's riders. The main scenario:
/// <list type="bullet">
/// <item>Pairs event 20 days ago: "Club A" (Olly, initials only, on Pony; Ann on Dobbin; a reserve), "Other A",
/// and "Club HC" (hors concours, also on Pony). Bending: Club A 1st, Other 2nd, HC 3rd. Flag Race: Other 1st,
/// HC 2nd, Club A did not finish. Standings: Other 5, Club A 3, so Club A is 2nd of 2.</item>
/// <item>Teams event 10 days ago: "Club A" again with Olly on Pony, racing an A Final heat; it wins the Mug Race.</item>
/// <item>An upcoming event and an event still running today, both with Olly: neither counts.</item>
/// </list>
/// </summary>
public class StatsEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public StatsEndpointsTests(ApiFactory f) => _f = f;

    private sealed record RiderSpec(string Name, string? Pony, bool InitialsOnly = false, bool Reserve = false, decimal? PonyHeightHands = null);
    private sealed record TeamSpec(string Club, string Name, RiderSpec[] Riders, bool Hc = false, bool FormLocked = true);
    /// <summary>A place of null is a did-not-finish.</summary>
    private sealed record RaceSpec(string Name, (int Team, int? Place, int Points)[] Results, bool Complete = true, string? Note = null);

    private sealed record Scenario(string U, int PairsCompetition, int TeamsCompetition, int[] PairsTeams, int[] TeamsTeams)
    {
        public string Olly => $"Olly{U}";
        public string OllyFull => $"Olly{U} Smith{U}";
        public string OllyShown => $"Olly{U} S.";
        public string Pony => $"Pony{U}";
        public string ClubA => $"Club{U} A";
        public string Club => $"Club{U}";
        public string Secret => $"Secret{U}";
    }

    private async Task<int[]> SeedEventAsync(string name, DateTime start, SectionFormat format, TeamSpec[] teams, RaceSpec[] races,
        string heatLabel = "Heat 1", bool demo = false, int lanes = 0)
        => await _f.WithDbAsync(async db =>
        {
            var competition = new Competition { Name = name, StartDate = start };
            db.Competitions.Add(competition);
            await db.SaveChangesAsync();
            if (demo) db.Set<EventCommerceSettings>().Add(new EventCommerceSettings { CompetitionId = competition.Id, IsDemo = true });
            var section = new CompetitionSection { CompetitionId = competition.Id, Format = format, AgeGroup = "U14", DisplayName = $"U14 {format}" };
            db.CompetitionSections.Add(section);
            await db.SaveChangesAsync();

            var ids = new List<int>();
            foreach (var spec in teams)
            {
                var club = await db.Clubs.FirstOrDefaultAsync(c => c.Name == spec.Club) ?? db.Clubs.Add(new Club { Name = spec.Club }).Entity;
                var team = new Team { CompetitionId = competition.Id, CompetitionSectionId = section.Id, Club = club, DisplayName = spec.Name, IsHorsConcours = spec.Hc };
                db.Teams.Add(team);
                await db.SaveChangesAsync();
                ids.Add(team.Id);
                var form = new DeclarationForm { TeamId = team.Id, IsLocked = spec.FormLocked, SubmittedAt = DateTime.UtcNow };
                var order = 0;
                foreach (var rider in spec.Riders)
                    form.Riders.Add(new RiderEntry { FullName = rider.Name, HorseName = rider.Pony, PonyHeightHands = rider.PonyHeightHands, UseInitialOnly = rider.InitialsOnly, IsReserve = rider.Reserve, OrderIndex = order++ });
                db.DeclarationForms.Add(form);
            }
            await db.SaveChangesAsync();

            if (races.Length == 0) return ids.ToArray();
            var session = new Session { CompetitionId = competition.Id, CompetitionSectionId = section.Id, Name = "Morning", OrderIndex = 1, LanesPerHeat = lanes > 0 ? lanes : null };
            db.Sessions.Add(session);
            await db.SaveChangesAsync();
            var heat = new Heat { SessionId = session.Id, Label = heatLabel, OrderIndex = 1 };
            for (var i = 0; i < ids.Count; i++) heat.Entries.Add(new HeatEntry { TeamId = ids[i], LaneIndex = i + 1 });
            db.Heats.Add(heat);
            await db.SaveChangesAsync();
            var raceOrder = 0;
            foreach (var spec in races)
            {
                var race = new Race { HeatId = heat.Id, Name = spec.Name, OrderIndex = raceOrder++, IsComplete = spec.Complete };
                foreach (var (teamIndex, place, points) in spec.Results)
                    race.Results.Add(new Result
                    {
                        TeamId = ids[teamIndex], Placing = place, Eliminated = place is null, Points = points,
                        Status = place is null ? ResultStatus.DidNotFinish : ResultStatus.Finished, RefereeNote = spec.Note,
                    });
                db.Races.Add(race);
            }
            await db.SaveChangesAsync();
            return ids.ToArray();
        });

    private async Task<Scenario> SeedScenarioAsync()
    {
        var u = Guid.NewGuid().ToString("N")[..8];
        var olly = new RiderSpec($"Olly{u} Smith{u}", $"Pony{u}", InitialsOnly: true);
        var today = DateTime.UtcNow.Date;

        // An older locked form for Club A that the newer one replaces: its rider must not count.
        var pairs = await SeedEventAsync($"Pairs{u}", today.AddDays(-20), SectionFormat.Pairs,
            [
                new TeamSpec($"Club{u}", $"Club{u} A", [olly, new RiderSpec($"Ann{u} Jones", $"Dobbin{u}"), new RiderSpec($"Res{u} Rider", $"Spare{u}", Reserve: true)]),
                new TeamSpec($"Other{u}", $"Other{u} A", [new RiderSpec($"Bea{u} Brown", $"Rocket{u}")]),
                new TeamSpec($"Club{u}", $"Club{u} HC", [new RiderSpec($"Hc{u} Rider", $"Pony{u}")], Hc: true),
            ],
            [
                new RaceSpec("Bending", [(0, 1, 3), (1, 2, 2), (2, 3, 1)], Note: $"Secret{u}"),
                new RaceSpec("Flag  Race", [(1, 1, 3), (2, 2, 2), (0, null, 0)]),
            ]);
        await _f.WithDbAsync(async db =>
        {
            var old = new DeclarationForm { TeamId = pairs[0], IsLocked = true, SubmittedAt = DateTime.UtcNow.AddDays(-30) };
            old.Riders.Add(new RiderEntry { FullName = $"Ghost{u} Rider", HorseName = $"Ghosty{u}" });
            db.DeclarationForms.Add(old);
            await db.SaveChangesAsync();
            return 0;
        });

        var teams = await SeedEventAsync($"Teams{u}", today.AddDays(-10), SectionFormat.Teams,
            [
                new TeamSpec($"Club{u}", $"Club{u} A", [olly with { Reserve = true }, new RiderSpec($"Cat{u} Green", $"Dobbin{u}")]),
                new TeamSpec($"Rival{u}", $"Rival{u} A", [new RiderSpec($"Dan{u} Gray", null)]),
            ],
            [new RaceSpec("Mug Race", [(0, 1, 2), (1, 2, 1)])],
            heatLabel: "A Final");

        // Neither of these counts: an event that hasn't started, and one still running today.
        await SeedEventAsync($"Soon{u}", today.AddDays(30), SectionFormat.Pairs,
            [new TeamSpec($"Club{u}", $"Club{u} A", [olly])], []);
        await SeedEventAsync($"Live{u}", today, SectionFormat.Pairs,
            [new TeamSpec($"Club{u}", $"Club{u} A", [olly])],
            [new RaceSpec("Bending", [(0, 1, 1)]), new RaceSpec("Sack Race", [], Complete: false)]);

        return new Scenario(u, 0, 0, pairs, teams);
    }

    private static string Url(string path, string name) => $"/api/stats/{path}?name={Uri.EscapeDataString(name)}";

    [Fact]
    public async Task Search_FindsEachKind_AndHidesAnInitialsOnlySurname()
    {
        var s = await SeedScenarioAsync();
        var anon = _f.CreateClient();

        var byFirstName = await (await anon.GetAsync($"/api/stats/search?q=olly{s.U}")).ReadAsync<StatsSearchDto>();
        var hit = Assert.Single(byFirstName.Riders);
        Assert.Equal(StatsSubjectKind.Rider, hit.Kind);
        Assert.Equal(s.OllyShown, hit.Name);
        Assert.Equal(s.OllyShown.ToLowerInvariant(), hit.Key);
        Assert.Equal(2, hit.Competitions);

        foreach (var q in new[] { $"smith{s.U}", $"Olly{s.U} Smith{s.U}", $"  OLLY{s.U}   smith{s.U} " })
        {
            var hidden = await (await anon.GetAsync($"/api/stats/search?q={Uri.EscapeDataString(q)}")).ReadAsync<StatsSearchDto>();
            Assert.Empty(hidden.Riders);
        }
        var raw = await (await anon.GetAsync($"/api/stats/search?q=olly{s.U}")).Content.ReadAsStringAsync();
        Assert.DoesNotContain($"Smith{s.U}", raw, StringComparison.OrdinalIgnoreCase);

        // A signed-in member still sees initials; only a site admin finds the surname.
        var (member, _) = await _f.SignupAsync("Member");
        Assert.Empty((await (await member.GetAsync($"/api/stats/search?q=smith{s.U}")).ReadAsync<StatsSearchDto>()).Riders);
        var admin = await _f.AdminAsync();
        var full = await (await admin.GetAsync($"/api/stats/search?q=smith{s.U}")).ReadAsync<StatsSearchDto>();
        Assert.Equal(s.OllyFull, Assert.Single(full.Riders).Name);

        var pony = Assert.Single((await (await anon.GetAsync($"/api/stats/search?q=pony{s.U}")).ReadAsync<StatsSearchDto>()).Ponies);
        Assert.Equal((StatsSubjectKind.Pony, s.Pony, 2), (pony.Kind, pony.Name, pony.Competitions));
        var clubs = await (await anon.GetAsync($"/api/stats/search?q=club{s.U}")).ReadAsync<StatsSearchDto>();
        Assert.Equal([s.ClubA, $"Club{s.U} HC"], clubs.Teams.Select(t => t.Name));
        Assert.Equal(2, clubs.Teams[0].Competitions);
        Assert.Equal((StatsSubjectKind.Club, s.Club, 2), (clubs.Clubs.Single().Kind, clubs.Clubs.Single().Name, clubs.Clubs.Single().Competitions));
    }

    [Fact]
    public async Task Search_SkipsReservesInPairs_OldForms_AndDrafts()
    {
        var s = await SeedScenarioAsync();
        var draft = await SeedEventAsync($"Draft{s.U}", DateTime.UtcNow.Date.AddDays(-3), SectionFormat.Individual,
            [new TeamSpec($"Club{s.U}", $"Solo{s.U}", [new RiderSpec($"Draft{s.U} Rider", $"DraftPony{s.U}")], FormLocked: false)],
            [new RaceSpec("Bending", [(0, 1, 1)])]);
        Assert.Single(draft);
        var anon = _f.CreateClient();
        foreach (var q in new[] { $"res{s.U}", $"ghost{s.U}", $"ghosty{s.U}", $"draft{s.U}" })
        {
            var result = await (await anon.GetAsync($"/api/stats/search?q={q}")).ReadAsync<StatsSearchDto>();
            Assert.Empty(result.Riders);
            Assert.Empty(result.Ponies);
        }
        // The pairs reserve's pony is theirs alone, so it has no counted entry either.
        Assert.Empty((await (await anon.GetAsync($"/api/stats/search?q=spare{s.U}")).ReadAsync<StatsSearchDto>()).Ponies);
        // The team itself still counts at the event with the draft form.
        Assert.Single((await (await anon.GetAsync($"/api/stats/search?q=solo{s.U}")).ReadAsync<StatsSearchDto>()).Teams);
    }

    [Fact]
    public async Task RiderProfile_Anonymous_GetsHeadlineNumbersOnly()
    {
        var s = await SeedScenarioAsync();
        var anon = _f.CreateClient();
        var response = await anon.GetAsync(Url("riders", s.OllyShown));
        var raw = await response.Content.ReadAsStringAsync();
        var profile = await response.ReadAsync<StatsProfileDto>();

        Assert.Equal((StatsSubjectKind.Rider, s.OllyShown, false, false), (profile.Kind, profile.Name, profile.Detailed, profile.RaceFiguresAllFormats));
        Assert.Null(profile.Games);
        Assert.Null(profile.BestGames);
        Assert.Null(profile.WorstGames);
        Assert.Null(profile.Entries);
        Assert.Null(profile.Partnerships);
        var sum = profile.Summary;
        Assert.Equal((2, 2, 2), (sum.Competitions, sum.Entries, sum.PlacedEntries));
        Assert.Equal((1, 1, 0, 1.5), (sum.Firsts, sum.Seconds, sum.Thirds, sum.AveragePlace));
        Assert.Equal((1, 1, 1, 100.0), (sum.EntriesWithFinals, sum.FinalsReached, sum.AFinals, sum.AFinalPercent));
        // Race figures are from the pairs event only: Bending won (3 of 3), Flag Race not finished (0 of 3).
        Assert.Equal((2, 1, 50.0, 3, 6, 50.0), (sum.Races, sum.Wins, sum.WinPercent, sum.Points, sum.MaxPoints, sum.PointQuotaPercent));
        Assert.DoesNotContain($"Smith{s.U}", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(s.Pony, raw);

        // The surname finds nothing, by search or by profile.
        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync(Url("riders", s.OllyFull))).StatusCode);
    }

    [Fact]
    public async Task RiderProfile_SignedIn_GetsGamesEntriesAndPonies_WithoutNotes()
    {
        var s = await SeedScenarioAsync();
        var (member, _) = await _f.SignupAsync("Member");
        var response = await member.GetAsync(Url("riders", $"  olly{s.U}  S. "));
        var raw = await response.Content.ReadAsStringAsync();
        var profile = await response.ReadAsync<StatsProfileDto>();

        Assert.True(profile.Detailed);
        Assert.Equal(s.OllyShown, profile.Name);
        Assert.DoesNotContain(s.Secret, raw);
        Assert.DoesNotContain($"Smith{s.U}", raw, StringComparison.OrdinalIgnoreCase);

        Assert.Equal(["Bending", "Flag Race"], profile.Games!.Select(g => g.Name));
        var bending = profile.Games![0];
        Assert.Equal((1, 1, 100.0, 0, 3, 3, 100.0, 3.0, 1.0), (bending.Races, bending.Wins, bending.WinPercent, bending.NonFinishes, bending.Points, bending.MaxPoints, bending.PointQuotaPercent, bending.AveragePoints, bending.AveragePlace));
        var flag = profile.Games[1];
        Assert.Equal((1, 0, 0.0, 1, 0.0, 0.0, (double?)null), (flag.Races, flag.Wins, flag.WinPercent, flag.NonFinishes, flag.PointQuotaPercent, flag.AveragePoints, flag.AveragePlace));
        Assert.Equal(["Bending"], profile.BestGames!);
        Assert.Equal(["Flag Race"], profile.WorstGames!);

        // Newest first: the teams event (team result and session only), then the pairs event.
        Assert.Equal(2, profile.Entries!.Count);
        var teamsEntry = profile.Entries[0];
        Assert.Equal((SectionFormat.Teams, 1, 2, 0, s.Pony), (teamsEntry.Format, teamsEntry.Place, teamsEntry.TeamsPlaced, teamsEntry.FinalTier, teamsEntry.PonyName));
        var pairsEntry = profile.Entries[1];
        Assert.Equal((SectionFormat.Pairs, 2, 2, (int?)null, 2, 3, 6, 50.0), (pairsEntry.Format, pairsEntry.Place, pairsEntry.TeamsPlaced, pairsEntry.FinalTier, pairsEntry.Races, pairsEntry.Points, pairsEntry.MaxPoints, pairsEntry.PointQuotaPercent));
        Assert.Null(pairsEntry.RiderName);
        var session = Assert.Single(pairsEntry.Sessions);
        Assert.Equal(("Morning", 3, 6, 2, 2), (session.Name, session.Points, session.MaxPoints, session.Rank, session.Teams));

        var partnership = Assert.Single(profile.Partnerships!);
        Assert.Equal((s.OllyShown, s.Pony, 2, 2), (partnership.RiderName, partnership.PonyName, partnership.Entries, partnership.Competitions));

        var club = Assert.Single(profile.Clubs!);
        Assert.Equal((s.Club, 2, 2), (club.ClubName, club.Entries, club.Competitions));
        Assert.Empty(profile.Seasons!); // Calendar-year totals are not season standings.
    }

    [Fact]
    public async Task RiderProfile_UsesPublishedSeasonStandings_NotEventPointsOrOldPublications()
    {
        var scenario = await SeedScenarioAsync();
        var owner = await _f.TrainerIdAsync();
        var seasonId = await _f.WithDbAsync(async db =>
        {
            var team = await db.Teams.SingleAsync(t => t.Id == scenario.PairsTeams[0]);
            var profile = new TeamProfile { OwnerUserId = owner, ClubId = team.ClubId, DisplayName = "Example season team" };
            var season = new Season { OwnerUserId = owner, Title = "Example league", Year = DateTime.UtcNow.Year, Format = SectionFormat.Pairs, AgeGroup = "U14" };
            var round = new SeasonRound { Season = season, CompetitionId = team.CompetitionId, CompetitionSectionId = team.CompetitionSectionId, IsIncluded = true };
            foreach (var version in new[] { 1, 2 })
            {
                var publication = new SeasonRoundPublication { SeasonRound = round, Version = version, PublishedByUserId = owner, SourceFingerprint = $"example-{version}" };
                publication.Results.Add(new SeasonRoundResult { TeamProfile = profile, EventTeamId = team.Id, TeamName = "Example season team", ClubName = "Example club", EventRank = 2, EventPoints = 3, SeasonPoints = version == 1 ? 99 : 8 });
                db.Set<SeasonRoundPublication>().Add(publication);
            }
            await db.SaveChangesAsync();
            return season.Id;
        });
        var (member, _) = await _f.SignupAsync("Member");
        var profileResult = await (await member.GetAsync(Url("riders", scenario.OllyShown))).ReadAsync<StatsProfileDto>();
        var standing = Assert.Single(profileResult.Seasons!);
        Assert.Equal(seasonId, standing.SeasonId);
        Assert.Equal(("Example league", 1, 8L, 1), (standing.SeasonName, standing.Rank, standing.Points, standing.EventsEntered));
        var anonymous = await (await _f.CreateClient().GetAsync(Url("riders", scenario.OllyShown))).ReadAsync<StatsProfileDto>();
        Assert.Null(anonymous.Seasons);
    }

    [Fact]
    public async Task RiderProfile_Admin_UsesTheFullName()
    {
        var s = await SeedScenarioAsync();
        var admin = await _f.AdminAsync();
        var profile = await (await admin.GetAsync(Url("riders", s.OllyFull))).ReadAsync<StatsProfileDto>();
        Assert.Equal(s.OllyFull, profile.Name);
        Assert.Equal(2, profile.Summary.Entries);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync(Url("riders", s.OllyShown))).StatusCode);
    }

    [Fact]
    public async Task PonyProfile_CountsEveryRider_LeavesHcOutOfPlaces()
    {
        var s = await SeedScenarioAsync();
        var anon = await (await _f.CreateClient().GetAsync(Url("ponies", s.Pony.ToUpperInvariant()))).ReadAsync<StatsProfileDto>();
        Assert.Equal((StatsSubjectKind.Pony, s.Pony, false), (anon.Kind, anon.Name, anon.Detailed));
        // Club A twice and the HC team once; HC has no place. Races: both pairs teams' two races.
        Assert.Equal((2, 3, 2, 4), (anon.Summary.Competitions, anon.Summary.Entries, anon.Summary.PlacedEntries, anon.Summary.Races));
        Assert.Equal((1, 1), (anon.Summary.Firsts, anon.Summary.Seconds));
        Assert.Null(anon.Partnerships);

        var (member, _) = await _f.SignupAsync("Member");
        var profile = await (await member.GetAsync(Url("ponies", s.Pony))).ReadAsync<StatsProfileDto>();
        Assert.Equal([(s.OllyShown, 2, 2), ($"Hc{s.U} Rider", 1, 1)], profile.Partnerships!.Select(p => (p.RiderName, p.Entries, p.Competitions)));
        var hc = profile.Entries!.Single(e => e.IsHorsConcours);
        Assert.Null(hc.Place);
        Assert.Equal(0, hc.TeamsPlaced);
        Assert.Equal($"Hc{s.U} Rider", hc.RiderName);
        Assert.Null(Assert.Single(hc.Sessions).Rank);
        Assert.Null(hc.PonyName);
    }

    [Fact]
    public async Task TeamAndClubProfiles_UseEveryFormat_AndListPartnerships()
    {
        var s = await SeedScenarioAsync();
        var (member, _) = await _f.SignupAsync("Member");

        var team = await (await member.GetAsync(Url("teams", s.ClubA))).ReadAsync<StatsProfileDto>();
        Assert.Equal((StatsSubjectKind.Team, s.ClubA, true), (team.Kind, team.Name, team.RaceFiguresAllFormats));
        Assert.Equal((2, 2, 3, 2), (team.Summary.Competitions, team.Summary.Entries, team.Summary.Races, team.Summary.Wins));
        Assert.Equal(["Bending", "Mug Race", "Flag Race"], team.Games!.Select(g => g.Name));
        Assert.Equal(["Bending", "Mug Race"], team.BestGames!);
        Assert.Equal(["Flag Race"], team.WorstGames!);
        // Olly is a reserve in the teams event: in a teams competition reserves ride, so that entry counts.
        Assert.Equal(
            [(s.OllyShown, s.Pony, 2), ($"Ann{s.U} Jones", $"Dobbin{s.U}", 1), ($"Cat{s.U} Green", $"Dobbin{s.U}", 1), ($"Res{s.U} Rider", $"Spare{s.U}", 1)],
            team.Partnerships!.Select(p => (p.RiderName, p.PonyName, p.Entries)));
        Assert.All(team.Entries!, e => Assert.Null(e.RiderName));

        var club = await (await member.GetAsync(Url("clubs", s.Club))).ReadAsync<StatsProfileDto>();
        Assert.Equal((StatsSubjectKind.Club, 2, 3, 2), (club.Kind, club.Summary.Competitions, club.Summary.Entries, club.Summary.PlacedEntries));
        Assert.Contains(club.Partnerships!, p => p.RiderName == $"Hc{s.U} Rider");

        var anon = await (await _f.CreateClient().GetAsync(Url("teams", s.ClubA))).ReadAsync<StatsProfileDto>();
        Assert.Null(anon.Games);
        Assert.Null(anon.Partnerships);
        Assert.Equal(2, anon.Summary.Entries);
    }

    [Fact]
    public async Task Profiles_ForUnknownNames_Are404_AndBadQueriesAre400()
    {
        var anon = _f.CreateClient();
        var u = Guid.NewGuid().ToString("N")[..8];
        foreach (var path in new[] { "riders", "ponies", "teams", "clubs" })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync(Url(path, $"Nobody{u}"))).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await anon.GetAsync(Url(path, "x"))).StatusCode);
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await anon.GetAsync($"/api/stats/riders")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anon.GetAsync("/api/stats/search?q=%20a%20")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anon.GetAsync("/api/stats/search?q=..")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await anon.GetAsync($"/api/stats/search?q={new string('a', 81)}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync($"/api/stats/team-profiles/{Guid.NewGuid()}")).StatusCode);
        var empty = await (await anon.GetAsync($"/api/stats/search?q=nobody{u}")).ReadAsync<StatsSearchDto>();
        Assert.Equal($"nobody{u}", empty.Query);
        Assert.Empty(empty.Riders.Concat(empty.Ponies).Concat(empty.Teams).Concat(empty.Clubs));
    }

    [Fact]
    public async Task AnEventFinishedToday_Counts_AndAProfileWithNothingCountedIsEmpty()
    {
        var u = Guid.NewGuid().ToString("N")[..8];
        await SeedEventAsync($"Today{u}", DateTime.UtcNow.Date, SectionFormat.Individual,
            [new TeamSpec($"Solo{u}", $"Solo{u}", [new RiderSpec($"Today{u} Rider", null)])],
            [new RaceSpec("Bending", [(0, 1, 1)])], lanes: 4);
        var anon = _f.CreateClient();
        Assert.Equal(1, Assert.Single((await (await anon.GetAsync($"/api/stats/search?q=today{u}")).ReadAsync<StatsSearchDto>()).Riders).Competitions);

        // Entered only in an upcoming event: the profile exists but counts nothing.
        await SeedEventAsync($"Later{u}", DateTime.UtcNow.Date.AddDays(9), SectionFormat.Individual,
            [new TeamSpec($"Solo{u}", $"Later{u} Solo", [new RiderSpec($"Later{u} Rider", $"LaterPony{u}")])], []);
        var (member, _) = await _f.SignupAsync("Member");
        var profile = await (await member.GetAsync(Url("riders", $"Later{u} Rider"))).ReadAsync<StatsProfileDto>();
        Assert.Equal((0, 0, (double?)null, (double?)null), (profile.Summary.Entries, profile.Summary.Races, profile.Summary.AveragePlace, profile.Summary.PointQuotaPercent));
        Assert.Empty(profile.Games!);
        Assert.Empty(profile.BestGames!);
        Assert.Empty(profile.Entries!);
        Assert.Empty(profile.Partnerships!);
    }

    [Fact]
    public async Task TeamProfileStats_CoverTheLinkedEventTeams()
    {
        var s = await SeedScenarioAsync();
        var profileId = await _f.WithDbAsync(async db =>
        {
            var owner = await db.Users.Select(x => x.Id).FirstAsync();
            var club = await db.Clubs.FirstAsync(c => c.Name == s.Club);
            var profile = new TeamProfile { OwnerUserId = owner, ClubId = club.Id, DisplayName = $"  {s.ClubA} " };
            profile.EventTeams.Add(new EventTeamProfileLink { CompetitionId = await db.Teams.Where(t => t.Id == s.PairsTeams[0]).Select(t => t.CompetitionId).SingleAsync(), TeamId = s.PairsTeams[0], LinkedByUserId = owner });
            profile.EventTeams.Add(new EventTeamProfileLink { CompetitionId = await db.Teams.Where(t => t.Id == s.TeamsTeams[0]).Select(t => t.CompetitionId).SingleAsync(), TeamId = s.TeamsTeams[0], LinkedByUserId = owner });
            db.Set<TeamProfile>().Add(profile);
            await db.SaveChangesAsync();
            return profile.Id;
        });

        var anon = await (await _f.CreateClient().GetAsync($"/api/stats/team-profiles/{profileId}")).ReadAsync<StatsProfileDto>();
        Assert.Equal((StatsSubjectKind.Team, s.ClubA, profileId.ToString(), false), (anon.Kind, anon.Name, anon.Key, anon.Detailed));
        Assert.Equal((2, 3), (anon.Summary.Entries, anon.Summary.Races));
        Assert.Null(anon.Games);

        var (member, _) = await _f.SignupAsync("Member");
        var detailed = await (await member.GetAsync($"/api/stats/team-profiles/{profileId}")).ReadAsync<StatsProfileDto>();
        Assert.Equal(3, detailed.Games!.Count);
    }

    [Fact]
    public async Task PoniesWithSameName_AreSeparatedAndOrderedByHeight()
    {
        var u = Guid.NewGuid().ToString("N")[..8];
        var past = DateTime.UtcNow.Date.AddDays(-12);
        await SeedEventAsync($"Heights{u}", past, SectionFormat.Individual,
            [
                new TeamSpec($"Club{u}", $"Big{u}", [new RiderSpec($"RiderA{u}", $"Star{u}", PonyHeightHands: 14.2m)]),
                new TeamSpec($"Club{u}", $"Small{u}", [new RiderSpec($"RiderB{u}", $"Star{u}", PonyHeightHands: 12.2m)]),
                new TeamSpec($"Club{u}", $"Unknown{u}", [new RiderSpec($"RiderC{u}", $"Star{u}")]),
            ],
            [new RaceSpec("Bending", [(0, 1, 2), (1, 2, 1), (2, 3, 0)])]);

        var (member, _) = await _f.SignupAsync("Member");
        var search = await (await member.GetAsync($"/api/stats/search?q=star{u}")).ReadAsync<StatsSearchDto>();
        Assert.Equal([$"Star{u}", $"Star{u} (12.2hh)", $"Star{u} (14.2hh)"], search.Ponies.Select(p => p.Name));

        var browse = await (await member.GetAsync($"/api/stats/browse?kind=1&q=star{u}")).ReadAsync<StatsBrowseDto>();
        Assert.Equal([$"Star{u}", $"Star{u} (12.2hh)", $"Star{u} (14.2hh)"], browse.Items.Select(p => p.Name));

        var legacy = await (await member.GetAsync(Url("ponies", $"Star{u}"))).ReadAsync<StatsProfileDto>();
        Assert.Equal($"Star{u}", legacy.Name);
        Assert.Equal(3, legacy.Summary.Races);

        var small = await (await member.GetAsync(Url("ponies", search.Ponies[1].Key))).ReadAsync<StatsProfileDto>();
        Assert.Equal($"Star{u} (12.2hh)", small.Name);
        Assert.Equal((1, 0), (small.Summary.Races, small.Summary.Wins));
        Assert.Equal((1.0, 2.0), (small.Games![0].AveragePoints, small.Games[0].AveragePlace));

        var big = await (await member.GetAsync(Url("ponies", search.Ponies[2].Key))).ReadAsync<StatsProfileDto>();
        Assert.Equal($"Star{u} (14.2hh)", big.Name);
        Assert.Equal((1, 1), (big.Summary.Races, big.Summary.Wins));
        Assert.Equal((2.0, 1.0), (big.Games![0].AveragePoints, big.Games[0].AveragePlace));
    }
}

/// <summary>A host with a very low statistics limit, to prove the hub is limited per address.</summary>
public class LowStatsLimitFactory : ApiFactory
{
    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("RateLimits:StatsPerMinute", "2");
    }
}

public class StatsRateLimitTests : IClassFixture<LowStatsLimitFactory>
{
    private readonly LowStatsLimitFactory _f;
    public StatsRateLimitTests(LowStatsLimitFactory f) => _f = f;

    [Fact]
    public async Task SearchIsLimitedPerAddress()
    {
        HttpResponseMessage last = null!;
        for (var i = 0; i < 3; i++)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, "/api/stats/search?q=anyone");
            request.Headers.Add("X-Test-Ip", "198.51.100.40");
            last = await _f.CreateClient().SendAsync(request);
        }
        Assert.Equal(HttpStatusCode.TooManyRequests, last.StatusCode);

        var other = new HttpRequestMessage(HttpMethod.Get, "/api/stats/search?q=anyone");
        other.Headers.Add("X-Test-Ip", "198.51.100.41");
        Assert.Equal(HttpStatusCode.OK, (await _f.CreateClient().SendAsync(other)).StatusCode);
    }

    [Fact]
    public async Task BrowseSharesTheSameLimit()
    {
        HttpResponseMessage last = null!;
        for (var i = 0; i < 3; i++)
        {
            var request = new HttpRequestMessage(HttpMethod.Get, "/api/stats/browse?kind=0");
            request.Headers.Add("X-Test-Ip", "198.51.100.50");
            last = await _f.CreateClient().SendAsync(request);
        }
        Assert.Equal(HttpStatusCode.TooManyRequests, last.StatusCode);
    }
}
