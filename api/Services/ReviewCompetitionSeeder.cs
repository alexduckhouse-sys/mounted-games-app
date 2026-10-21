using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

public static class ReviewCompetitionSeeder
{
    private const int LanesPerHeat = 6;
    // Cycled per age group: team counts span 4-16, race counts 6-10 (8 is the norm).
    private static readonly int[] TeamCounts = { 6, 8, 12, 16, 6, 10, 4, 14, 6 };
    private static readonly int[] RaceCounts = { 8, 8, 10, 8, 6, 8, 7, 9, 8 };
    private static readonly string[] BibColours = { "Red", "Blue", "Green", "Yellow", "Orange", "Purple" };
    private static readonly string[] RaceNames =
    {
        "Two Flag", "Mug Shuffle", "Bottle Shuttle", "Litter Lifter", "Bending",
        "Five Flag", "Stepping Stones", "Tack Shop", "Big Sack", "Pole Bending",
    };

    /// <summary>Splits teams into as-even-as-possible groups of at most maxSize.</summary>
    private static List<Team[]> SplitBalanced(Team[] teams, int maxSize)
    {
        var groupCount = Math.Max(1, (int)Math.Ceiling(teams.Length / (double)maxSize));
        var groups = Enumerable.Range(0, groupCount).Select(_ => new List<Team>()).ToList();
        for (var i = 0; i < teams.Length; i++) groups[i % groupCount].Add(teams[i]);
        return groups.Select(g => g.ToArray()).ToList();
    }

    // Explicit command only. Never run from normal application startup.
    public static async Task<int> SeedAsync(AppDbContext db, DateTime todayUtc)
    {
        var events = new[]
        {
            ("Demo Meadow Cup", "gb", 0), ("Demo Clover Challenge", "ie", 3),
            ("Demo River Games", "fr", 7), ("Demo Forest Trophy", "de", 14),
            ("Demo Windmill Open", "nl", 21), ("Demo World Festival", "world", 28),
            ("Demo Valley Finals", "trophy", -7), ("Demo Lakeside Games", "flag", -21),
        };
        return await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync();
            var created = 0;
            var eventIndex = -1;
            foreach (var (name, icon, offset) in events)
            {
                eventIndex++;
                if (await db.Competitions.AnyAsync(c => c.Name == name)) continue;
                var day = DateTime.SpecifyKind(todayUtc.Date.AddDays(offset), DateTimeKind.Utc);
                var clubName = $"{name} Club";
                var club = await db.Clubs.SingleOrDefaultAsync(c => c.Name == clubName)
                    ?? new Club { Name = clubName, Region = "Demo" };
                var competition = new Competition
                {
                    Name = name,
                    Icon = icon,
                    StartDate = day.AddHours(9),
                    EndDate = day.AddHours(17),
                    IsActive = offset >= 0,
                    IsArchived = offset < 0,
                    Location = "Demo showground",
                    Description = "Sample competition for trying the app. All teams and results are fictional.",
                };
                var sessionOrder = 0;
                var ageGroups = new[] { "Seniors", "Juniors", "Novices" };
                for (var ageIndex = 0; ageIndex < ageGroups.Length; ageIndex++)
                {
                    var ageGroup = ageGroups[ageIndex];
                    // Varied shape: 4-16 teams per age group, 6-10 races per heat, up to 6 teams
                    // per heat. Larger age groups (12+) are split into two sections, A and B.
                    var profile = (eventIndex * ageGroups.Length + ageIndex) % TeamCounts.Length;
                    var teamCount = TeamCounts[profile];
                    var raceCount = RaceCounts[profile];
                    var sectionSizes = teamCount >= 12
                        ? new[] { (teamCount + 1) / 2, teamCount / 2 }
                        : new[] { teamCount };
                    var teamNumber = 0;
                    for (var sectionIndex = 0; sectionIndex < sectionSizes.Length; sectionIndex++)
                    {
                        var sectionName = sectionSizes.Length == 1
                            ? $"{ageGroup} teams"
                            : $"{ageGroup} teams {(char)('A' + sectionIndex)}";
                        var section = new CompetitionSection
                        {
                            Competition = competition,
                            Format = SectionFormat.Teams,
                            AgeGroup = ageGroup,
                            DisplayName = sectionName,
                        };
                        competition.Sections.Add(section);
                        var teams = Enumerable.Range(1, sectionSizes[sectionIndex]).Select(_ =>
                        {
                            teamNumber++;
                            return new Team
                            {
                                Competition = competition,
                                Section = section,
                                Club = club,
                                DisplayName = $"{name.Replace("Demo ", "")} {ageGroup} {teamNumber}",
                                Suffix = teamNumber.ToString(),
                                BibColour = BibColours[(teamNumber - 1) % BibColours.Length],
                            };
                        }).ToArray();
                        foreach (var team in teams) competition.Teams.Add(team);

                        for (var round = 0; round < 2; round++)
                        {
                            var start = day.AddHours(9).AddMinutes(sessionOrder * 80);
                            var finished = offset < 0 || (offset == 0 && sessionOrder == 0);
                            var running = offset == 0 && sessionOrder == 1;
                            var session = new Session
                            {
                                Competition = competition,
                                Section = section,
                                Name = $"{sectionName} {(round == 0 ? "heats" : "finals")}",
                                ArenaName = round == 0 ? "Demo main arena" : "Demo final arena",
                                ScheduledStart = start,
                                OrderIndex = ++sessionOrder,
                                MinutesPerHeat = 35,
                                LanesPerHeat = LanesPerHeat,
                                Status = finished ? SessionStatus.Finished : running ? SessionStatus.InArena : SessionStatus.Upcoming,
                                StartedAt = finished || running ? start : null,
                                FinishedAt = finished ? start.AddMinutes(70) : null,
                            };
                            competition.Sessions.Add(session);
                            // Heats: balanced groups of at most 6. Finals: one heat of the top 6.
                            var groups = round == 0
                                ? SplitBalanced(teams, LanesPerHeat)
                                : new List<Team[]> { teams.Take(LanesPerHeat).ToArray() };
                            for (var heatNumber = 0; heatNumber < groups.Count; heatNumber++)
                            {
                                var entrants = groups[heatNumber];
                                var heat = new Heat
                                {
                                    Session = session,
                                    Label = round == 0 ? $"Heat {heatNumber + 1}" : "Final",
                                    OrderIndex = heatNumber + 1,
                                    DurationMinutes = 35,
                                    ScheduledStart = start.AddMinutes(heatNumber * 35),
                                    StartedAt = finished || running ? start.AddMinutes(heatNumber * 35) : null,
                                    FinishedAt = finished ? start.AddMinutes((heatNumber + 1) * 35) : null,
                                };
                                session.Heats.Add(heat);
                                for (var lane = 0; lane < entrants.Length; lane++)
                                    heat.Entries.Add(new HeatEntry { Heat = heat, Team = entrants[lane], LaneIndex = lane + 1 });
                                var raceNames = RaceNames.Take(raceCount).ToArray();
                                for (var raceNumber = 0; raceNumber < raceNames.Length; raceNumber++)
                                {
                                    // A running session is halfway: the first half of every heat's races are scored.
                                    var complete = finished || (running && raceNumber < raceNames.Length / 2);
                                    var raceStart = start.AddMinutes(heatNumber * 35 + raceNumber * 4);
                                    var race = new Race
                                    {
                                        Heat = heat,
                                        Name = raceNames[raceNumber],
                                        OrderIndex = raceNumber + 1,
                                        IsComplete = complete,
                                        StartedAt = complete ? raceStart : null,
                                        FinishedAt = complete ? raceStart.AddMinutes(3) : null,
                                    };
                                    heat.Races.Add(race);
                                    if (complete)
                                    {
                                        // Deterministic but uneven results: earlier lanes are slightly
                                        // stronger, with noise so the top list has a real spread.
                                        var rng = new Random(eventIndex * 10_000 + ageIndex * 1_000 + sectionIndex * 500 + round * 100 + heatNumber * 20 + raceNumber);
                                        var ranked = entrants
                                            .Select((team, lane) => (team, score: rng.NextDouble() * 3 - lane * 0.4))
                                            .OrderByDescending(x => x.score)
                                            .Select(x => x.team)
                                            .ToArray();
                                        for (var place = 0; place < ranked.Length; place++)
                                            race.Results.Add(new Result { Race = race, Team = ranked[place], Placing = place + 1, Points = ranked.Length - place, RecordedAt = raceStart.AddMinutes(3) });
                                    }
                                }
                            }
                        }
                    }
                }
                db.Competitions.Add(competition);
                await db.SaveChangesAsync();
                created++;
            }
            await transaction.CommitAsync();
            return created;
        });
    }
}
