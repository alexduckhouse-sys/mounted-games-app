using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

public static class ReviewCompetitionSeeder
{
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
            foreach (var (name, icon, offset) in events)
            {
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
                foreach (var ageGroup in new[] { "Seniors", "Juniors", "Novices" })
                {
                    var section = new CompetitionSection
                    {
                        Competition = competition,
                        Format = SectionFormat.Teams,
                        AgeGroup = ageGroup,
                        DisplayName = $"{ageGroup} teams",
                    };
                    competition.Sections.Add(section);
                    var teams = Enumerable.Range(1, 4).Select(number => new Team
                    {
                        Competition = competition,
                        Section = section,
                        Club = club,
                        DisplayName = $"{name.Replace("Demo ", "")} {ageGroup} {number}",
                        Suffix = number.ToString(),
                        BibColour = new[] { "Red", "Blue", "Green", "Yellow" }[number - 1],
                    }).ToArray();
                    foreach (var team in teams) competition.Teams.Add(team);

                    for (var round = 0; round < 2; round++)
                    {
                        var start = day.AddHours(9).AddMinutes(sessionOrder * 65);
                        var finished = offset < 0 || (offset == 0 && sessionOrder == 0);
                        var running = offset == 0 && sessionOrder == 1;
                        var session = new Session
                        {
                            Competition = competition,
                            Section = section,
                            Name = $"{ageGroup} {(round == 0 ? "heats" : "finals")}",
                            ArenaName = round == 0 ? "Demo main arena" : "Demo final arena",
                            ScheduledStart = start,
                            OrderIndex = ++sessionOrder,
                            MinutesPerHeat = 25,
                            LanesPerHeat = 2,
                            Status = finished ? SessionStatus.Finished : running ? SessionStatus.InArena : SessionStatus.Upcoming,
                            StartedAt = finished || running ? start : null,
                            FinishedAt = finished ? start.AddMinutes(50) : null,
                        };
                        competition.Sessions.Add(session);
                        for (var heatNumber = 0; heatNumber < 2; heatNumber++)
                        {
                            var heat = new Heat
                            {
                                Session = session,
                                Label = $"{(round == 0 ? "Heat" : "Final")} {heatNumber + 1}",
                                OrderIndex = heatNumber + 1,
                                DurationMinutes = 25,
                                ScheduledStart = start.AddMinutes(heatNumber * 25),
                                StartedAt = finished || (running && heatNumber == 0) ? start.AddMinutes(heatNumber * 25) : null,
                                FinishedAt = finished ? start.AddMinutes((heatNumber + 1) * 25) : null,
                            };
                            session.Heats.Add(heat);
                            var entrants = teams.Skip(heatNumber * 2).Take(2).ToArray();
                            for (var lane = 0; lane < entrants.Length; lane++)
                                heat.Entries.Add(new HeatEntry { Heat = heat, Team = entrants[lane], LaneIndex = lane + 1 });
                            var raceNames = new[] { "Two Flag", "Mug Shuffle", "Bottle Shuttle" };
                            for (var raceNumber = 0; raceNumber < raceNames.Length; raceNumber++)
                            {
                                var complete = finished || (running && heatNumber == 0 && raceNumber == 0);
                                var raceStart = start.AddMinutes(heatNumber * 25 + raceNumber * 7);
                                var race = new Race
                                {
                                    Heat = heat,
                                    Name = raceNames[raceNumber],
                                    OrderIndex = raceNumber + 1,
                                    IsComplete = complete,
                                    StartedAt = complete ? raceStart : null,
                                    FinishedAt = complete ? raceStart.AddMinutes(5) : null,
                                };
                                heat.Races.Add(race);
                                if (complete)
                                    for (var lane = 0; lane < entrants.Length; lane++)
                                    {
                                        var placing = (lane + raceNumber) % 2 + 1;
                                        race.Results.Add(new Result { Race = race, Team = entrants[lane], Placing = placing, Points = 3 - placing, RecordedAt = raceStart.AddMinutes(5) });
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
