using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Entities.Seasons;

namespace MountedGames.Api.Services;

public static class ReviewCompetitionSeeder
{
    private const int LanesPerHeat = 6;
    private const int DemoEntryPriceMinor = 1500;

    /// <summary>(has a final, earlier points carry into it, final points double), cycled over the demo age groups.</summary>
    private static readonly (bool HasFinal, bool Carry, bool Doubled)[] FinalOptions =
    [
        (true, true, false), (true, false, false), (true, true, true), (true, false, true), (false, false, false),
    ];
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

    private const int MinutesPerHeat = 35;
    private const int ChangeoverMinutes = 5;

    // The eight demo events: name, icon and day offset from the seed date. Offset 0 is the live one.
    private static readonly (string Name, string Icon, int Offset)[] Events =
    {
        ("Demo Meadow Cup", "gb", 0), ("Demo Clover Challenge", "ie", 3),
        ("Demo River Games", "fr", 7), ("Demo Forest Trophy", "de", 14),
        ("Demo Windmill Open", "nl", 21), ("Demo World Festival", "world", 28),
        ("Demo Valley Finals", "trophy", -7), ("Demo Lakeside Games", "flag", -21),
    };

    private static DateTime RoundDownTo5Minutes(DateTime t)
        => new(t.Year, t.Month, t.Day, t.Hour, t.Minute / 5 * 5, 0, DateTimeKind.Utc);

    private static DateTime RoundUpTo5Minutes(DateTime t)
    {
        var down = RoundDownTo5Minutes(t);
        return down < t ? down.AddMinutes(5) : down;
    }

    /// <summary>
    /// Explicit command only. Never run from normal application startup. With <paramref name="nowUtc"/>, today's
    /// event (offset 0) is timed from that moment: its running session started about 30 minutes before it, the
    /// finished one ran before that, and every upcoming session in an arena follows the running one.
    /// </summary>
    public static async Task<int> SeedAsync(AppDbContext db, DateTime todayUtc, DateTime? nowUtc = null, bool markExistingAsDemo = true)
    {
        var events = Events;
        var now = nowUtc.HasValue ? DateTime.SpecifyKind(nowUtc.Value, DateTimeKind.Utc) : (DateTime?)null;
        return await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync();
            var created = 0;
            var eventIndex = -1;
            foreach (var (name, icon, offset) in events)
            {
                eventIndex++;
                var existingId = await db.Competitions.Where(c => c.Name == name).Select(c => (int?)c.Id).FirstOrDefaultAsync();
                if (existingId.HasValue)
                {
                    // Events made before the demo mark existed gain it; an existing choice is never changed.
                    if (markExistingAsDemo && !await db.Set<EventCommerceSettings>().AnyAsync(x => x.CompetitionId == existingId.Value))
                    {
                        db.Set<EventCommerceSettings>().Add(new EventCommerceSettings { CompetitionId = existingId.Value, IsDemo = true });
                        await db.SaveChangesAsync();
                    }
                    var isDemo = await db.Set<EventCommerceSettings>().AnyAsync(x => x.CompetitionId == existingId.Value && x.IsDemo);
                    var hasSplitSections = isDemo
                        && (await db.CompetitionSections.Where(s => s.CompetitionId == existingId.Value)
                            .Select(s => new { s.Format, s.AgeGroup }).ToListAsync())
                            .GroupBy(s => (s.Format, s.AgeGroup.Trim().ToLowerInvariant()))
                            .Any(g => g.Count() > 1);
                    if (hasSplitSections && !await db.Set<SeasonRound>().AnyAsync(r => r.CompetitionId == existingId.Value))
                    {
                        await DeleteCompetitionGraphAsync(db, new List<int> { existingId.Value });
                    }
                    else
                    {
                        continue;
                    }
                }
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
                // Today's event, timed from the real clock: when each arena is next free, and the latest end.
                var anchored = offset == 0 && now.HasValue;
                var runningStart = anchored ? RoundDownTo5Minutes(now!.Value.AddMinutes(-30)) : default;
                var arenaFree = new Dictionary<string, DateTime>();
                var latestEnd = default(DateTime);
                var ageGroups = new[] { "Seniors", "Juniors", "Novices" };
                for (var ageIndex = 0; ageIndex < ageGroups.Length; ageIndex++)
                {
                    var ageGroup = ageGroups[ageIndex];
                    // Varied shape: 4-16 teams per age group, 6-10 races per heat, up to 6 teams
                    // per heat. Larger age groups stay one single section with multiple balanced heats.
                    var profile = (eventIndex * ageGroups.Length + ageIndex) % TeamCounts.Length;
                    var teamCount = TeamCounts[profile];
                    var raceCount = RaceCounts[profile];
                    var sectionName = SectionNaming.DisplayName(SectionFormat.Teams, ageGroup);
                    // Vary the final options across the demo age groups so each combination can be seen: carry on or off,
                    // double on or off, and some with no final at all.
                    var (hasFinal, carry, doubled) = FinalOptions[(eventIndex * ageGroups.Length + ageIndex) % FinalOptions.Length];
                    var section = new CompetitionSection
                    {
                        HasFinal = hasFinal,
                        CarryPointsIntoFinal = carry,
                        DoublePointsInFinal = doubled,
                        Competition = competition,
                        Format = SectionFormat.Teams,
                        AgeGroup = ageGroup,
                        DisplayName = sectionName,
                        // Priced so the test payment page can be shown; no money is ever taken.
                        PriceMinor = DemoEntryPriceMinor,
                    };
                    competition.Sections.Add(section);
                    var teams = Enumerable.Range(1, teamCount).Select(teamNumber => new Team
                    {
                        Competition = competition,
                        Section = section,
                        Club = club,
                        DisplayName = $"{name.Replace("Demo ", "")} {ageGroup} {teamNumber}",
                        Suffix = teamNumber.ToString(),
                        BibColour = BibColours[(teamNumber - 1) % BibColours.Length],
                    }).ToArray();
                    foreach (var team in teams) competition.Teams.Add(team);

                    for (var round = 0; round < (hasFinal ? 2 : 1); round++)
                    {
                        var finished = offset < 0 || (offset == 0 && sessionOrder == 0);
                        var running = offset == 0 && sessionOrder == 1;
                        var arenaName = round == 0 ? "Demo main arena" : "Demo final arena";
                        // Heats: balanced groups of at most 6. Finals: one heat of the top 6.
                        var groups = round == 0
                            ? SplitBalanced(teams, LanesPerHeat)
                            : new List<Team[]> { teams.Take(LanesPerHeat).ToArray() };
                        var duration = groups.Count * MinutesPerHeat;
                        DateTime start;
                        if (!anchored) start = day.AddHours(9).AddMinutes(sessionOrder * 80);
                        else
                        {
                            // Each arena runs its sessions in order: finished, then running, then the upcoming
                            // ones from the next free slot (never before now).
                            if (!arenaFree.TryGetValue(arenaName, out var free)) free = RoundUpTo5Minutes(now!.Value);
                            if (finished) start = runningStart.AddMinutes(-duration);
                            else if (running) start = runningStart;
                            else start = free;
                            if (!finished) arenaFree[arenaName] = new[] { free, start.AddMinutes(duration + ChangeoverMinutes) }.Max();
                            if (start.AddMinutes(duration) > latestEnd) latestEnd = start.AddMinutes(duration);
                        }
                        var session = new Session
                        {
                            Competition = competition,
                            Section = section,
                            Name = $"{sectionName} {(round == 0 ? "heats" : "finals")}",
                            ArenaName = arenaName,
                            ScheduledStart = start,
                            OrderIndex = ++sessionOrder,
                            MinutesPerHeat = MinutesPerHeat,
                            LanesPerHeat = LanesPerHeat,
                            Status = finished ? SessionStatus.Finished : running ? SessionStatus.InArena : SessionStatus.Upcoming,
                            StartedAt = finished || running ? start : null,
                            FinishedAt = finished ? start.AddMinutes(anchored ? duration : 70) : null,
                        };
                        competition.Sessions.Add(session);
                        for (var heatNumber = 0; heatNumber < groups.Count; heatNumber++)
                        {
                            var entrants = groups[heatNumber];
                            var heat = new Heat
                            {
                                Session = session,
                                Label = round == 0 ? $"Heat {heatNumber + 1}" : "A Final",
                                OrderIndex = heatNumber + 1,
                                DurationMinutes = MinutesPerHeat,
                                ScheduledStart = start.AddMinutes(heatNumber * MinutesPerHeat),
                                StartedAt = finished || running ? start.AddMinutes(heatNumber * MinutesPerHeat) : null,
                                FinishedAt = finished ? start.AddMinutes((heatNumber + 1) * MinutesPerHeat) : null,
                            };
                            session.Heats.Add(heat);
                            for (var lane = 0; lane < entrants.Length; lane++)
                                heat.Entries.Add(new HeatEntry { Heat = heat, Team = entrants[lane], LaneIndex = lane + 1 });
                            var raceNames = RaceNames.Take(raceCount).ToArray();
                            for (var raceNumber = 0; raceNumber < raceNames.Length; raceNumber++)
                            {
                                // A running session is halfway: the first half of every heat's races are scored.
                                var complete = finished || (running && raceNumber < raceNames.Length / 2);
                                var raceStart = start.AddMinutes(heatNumber * MinutesPerHeat + raceNumber * 4);
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
                                    var rng = new Random(eventIndex * 10_000 + ageIndex * 1_000 + round * 100 + heatNumber * 20 + raceNumber);
                                    var ranked = entrants
                                        .Select((team, lane) => (team, score: rng.NextDouble() * 3 - lane * 0.4))
                                        .OrderByDescending(x => x.score)
                                        .Select(x => x.team)
                                        .ToArray();
                                    for (var place = 0; place < ranked.Length; place++)
                                        race.Results.Add(new Result { Race = race, Team = ranked[place], Placing = place + 1, Points = (ranked.Length - place) * (round == 1 && doubled ? 2 : 1), RecordedAt = raceStart.AddMinutes(3) });
                                }
                            }
                        }
                    }
                }
                if (anchored)
                {
                    // A day that starts before the clock allows, or runs past the planned finish, still holds the event.
                    var firstStart = competition.Sessions.Min(x => x.ScheduledStart!.Value);
                    if (firstStart < competition.StartDate) competition.StartDate = firstStart;
                    if (latestEnd.AddMinutes(30) > competition.EndDate) competition.EndDate = latestEnd.AddMinutes(30);
                }
                db.Competitions.Add(competition);
                // The same mark an organiser sets under "Demo" in the event shop settings.
                db.Set<EventCommerceSettings>().Add(new EventCommerceSettings { Competition = competition, IsDemo = true });
                await db.SaveChangesAsync();
                created++;
            }
            await transaction.CommitAsync();
            return created;
        });
    }

    /// <summary>What <see cref="ReseedAsync"/> did. <c>Skipped</c> lists seeder-named events left alone because they lack the demo mark.</summary>
    public sealed record ReseedResult(int Removed, int Created, IReadOnlyList<string> Skipped);

    /// <summary>
    /// The fresh reseed: removes the marked demo events, then seeds all eight again timed from <paramref name="nowUtc"/>.
    /// A same-named event without the demo mark is neither removed nor marked (<c>markExistingAsDemo: false</c>), so it
    /// is reported and the matching new demo event is not made.
    /// </summary>
    public static async Task<ReseedResult> ReseedAsync(AppDbContext db, DateTime nowUtc)
    {
        var removed = await RemoveReviewCompetitionsAsync(db);
        var names = Events.Select(e => e.Name).ToArray();
        var skipped = await db.Competitions.Where(c => names.Contains(c.Name)).Select(c => c.Name).OrderBy(n => n).ToListAsync();
        var created = await SeedAsync(db, nowUtc, nowUtc, markExistingAsDemo: false);
        return new ReseedResult(removed, created, skipped);
    }

    /// <summary>
    /// Deletes the review demo events so <see cref="SeedAsync"/> can make them again from today. Safety rule: a
    /// competition goes only if its name is one of the eight seeder names AND it carries the demo mark
    /// (<see cref="EventCommerceSettings.IsDemo"/>). Everything else, including a same-named event without the mark,
    /// is left alone. Each event's whole graph is removed bottom-up in one transaction, without relying on database
    /// cascades (SQLite tables made by the startup guards may not have them). Returns the number of events removed.
    /// </summary>
    public static async Task<int> RemoveReviewCompetitionsAsync(AppDbContext db)
    {
        var names = Events.Select(e => e.Name).ToArray();
        return await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync();
            var ids = await db.Competitions
                .Where(c => names.Contains(c.Name)
                    && db.Set<EventCommerceSettings>().Any(x => x.CompetitionId == c.Id && x.IsDemo))
                .Select(c => c.Id)
                .ToListAsync();
            if (ids.Count == 0) return 0;

            // A season round points at its event with a restricting key. Removing it would change a league, so stop.
            if (await db.Set<SeasonRound>().AnyAsync(r => ids.Contains(r.CompetitionId)))
                throw new InvalidOperationException("A demo event is part of a season. Remove it from the season, then run this again.");

            await DeleteCompetitionGraphAsync(db, ids);

            await transaction.CommitAsync();
            return ids.Count;
        });
    }

    /// <summary>
    /// Removes the whole graph of the given competitions bottom-up, without relying on database cascades. The caller
    /// owns the transaction and has already decided these competitions may go. Shared with <see cref="HistorySeeder"/>.
    /// </summary>
    internal static async Task DeleteCompetitionGraphAsync(AppDbContext db, List<int> ids)
    {
    var sessionIds = db.Sessions.Where(x => ids.Contains(x.CompetitionId)).Select(x => x.Id);
    var heatIds = db.Heats.Where(x => sessionIds.Contains(x.SessionId)).Select(x => x.Id);
    var raceIds = db.Races.Where(x => heatIds.Contains(x.HeatId)).Select(x => x.Id);
    var teamIds = db.Teams.Where(x => ids.Contains(x.CompetitionId)).Select(x => x.Id);
    var sectionIds = db.CompetitionSections.Where(x => ids.Contains(x.CompetitionId)).Select(x => x.Id);
    var formIds = db.DeclarationForms.Where(x => teamIds.Contains(x.TeamId)).Select(x => x.Id);
    var orderIds = db.Set<EventOrder>().Where(x => ids.Contains(x.CompetitionId)).Select(x => x.Id);

    // Orders that still hold stock give it back to the seller's catalogue item first.
    var reserved = await db.Set<EventOrderLine>()
        .Where(l => orderIds.Contains(l.EventOrderId) && l.ReservedStockQuantity > 0
            && db.Set<EventOrder>().Any(o => o.Id == l.EventOrderId && o.HasStockReservation))
        .Select(l => new { l.CatalogueItemId, l.ReservedStockQuantity })
        .ToListAsync();
    foreach (var line in reserved)
        await db.Set<CatalogueItem>()
            .Where(x => x.Id == line.CatalogueItemId && x.StockQuantity != null)
            .ExecuteUpdateAsync(set => set
                .SetProperty(x => x.StockQuantity, x => x.StockQuantity + line.ReservedStockQuantity)
                .SetProperty(x => x.Version, x => x.Version + 1)
                .SetProperty(x => x.UpdatedAt, DateTime.UtcNow));
    // ...and a line for one option (a size) gives that option its stock back too.
    var reservedOptions = await db.Set<EventOrderLine>()
        .Where(l => orderIds.Contains(l.EventOrderId) && l.ReservedOptionStockQuantity > 0 && l.CatalogueItemOptionId != null
            && db.Set<EventOrder>().Any(o => o.Id == l.EventOrderId && o.HasStockReservation))
        .Select(l => new { OptionId = l.CatalogueItemOptionId!.Value, l.ReservedOptionStockQuantity })
        .ToListAsync();
    foreach (var line in reservedOptions)
        await db.Set<CatalogueItemOption>()
            .Where(x => x.Id == line.OptionId && x.StockQuantity != null)
            .ExecuteUpdateAsync(set => set
                .SetProperty(x => x.StockQuantity, x => x.StockQuantity + line.ReservedOptionStockQuantity)
                .SetProperty(x => x.Version, x => x.Version + 1));

    // Shop: payments, order lines, orders, listings, the demo mark.
    await db.Set<TestPaymentRecord>().Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    await db.Set<EventOrderLine>().Where(x => orderIds.Contains(x.EventOrderId)).ExecuteDeleteAsync();
    await db.Set<EventOrder>().Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    await db.Set<CompetitionListing>().Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    await db.Set<EventCommerceSettings>().Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();

    // Timetable and scoring, deepest first.
    var shiftIds = db.Set<VolunteerShift>().Where(x => ids.Contains(x.CompetitionId)).Select(x => x.Id);
    await db.Set<VolunteerClaim>().Where(x => shiftIds.Contains(x.ShiftId)).ExecuteDeleteAsync();
    await db.Set<VolunteerShift>().Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    await db.Set<RaceScoreEvent>().Where(x => raceIds.Contains(x.RaceId)).ExecuteDeleteAsync();
    await db.Set<RaceScoreState>().Where(x => raceIds.Contains(x.RaceId)).ExecuteDeleteAsync();
    await db.Results.Where(x => raceIds.Contains(x.RaceId)).ExecuteDeleteAsync();
    await db.Races.Where(x => heatIds.Contains(x.HeatId)).ExecuteDeleteAsync();
    await db.Set<CalendarHeatVersion>().Where(x => heatIds.Contains(x.HeatId) || teamIds.Contains(x.TeamId)).ExecuteDeleteAsync();
    await db.HeatEntries.Where(x => heatIds.Contains(x.HeatId)).ExecuteDeleteAsync();
    await db.Heats.Where(x => sessionIds.Contains(x.SessionId)).ExecuteDeleteAsync();
    await db.Sessions.Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();

    // Tack check marks, sectors and set-ups, and passport ticks (they point at teams and sections).
    var tackIds = db.Set<TackCheckSection>().Where(x => ids.Contains(x.CompetitionId) || sectionIds.Contains(x.CompetitionSectionId)).Select(x => x.Id);
    var sectorIds = db.Set<TackCheckSector>().Where(x => tackIds.Contains(x.TackCheckSectionId)).Select(x => x.Id);
    await db.Set<TackCheckMark>().Where(x => sectorIds.Contains(x.TackCheckSectorId) || teamIds.Contains(x.TeamId)).ExecuteDeleteAsync();
    await db.Set<TackCheckSector>().Where(x => tackIds.Contains(x.TackCheckSectionId)).ExecuteDeleteAsync();
    await db.Set<TackCheckSection>().Where(x => ids.Contains(x.CompetitionId) || sectionIds.Contains(x.CompetitionSectionId)).ExecuteDeleteAsync();
    await db.Set<PassportCheck>().Where(x => ids.Contains(x.CompetitionId) || teamIds.Contains(x.TeamId)).ExecuteDeleteAsync();

    // Entries, teams and declarations.
    await db.Set<RiderSwapEvent>().Where(x => ids.Contains(x.CompetitionId) || formIds.Contains(x.DeclarationFormId)).ExecuteDeleteAsync();
    await db.RiderEntries.Where(x => formIds.Contains(x.DeclarationFormId)).ExecuteDeleteAsync();
    await db.DeclarationForms.Where(x => teamIds.Contains(x.TeamId)).ExecuteDeleteAsync();
    await db.Set<TeamStatusEvent>().Where(x => ids.Contains(x.CompetitionId) || teamIds.Contains(x.TeamId)).ExecuteDeleteAsync();
    await db.TeamSupporters.Where(x => teamIds.Contains(x.TeamId)).ExecuteDeleteAsync();
    await db.Set<EventTeamProfileLink>().Where(x => ids.Contains(x.CompetitionId) || teamIds.Contains(x.TeamId)).ExecuteDeleteAsync();
    await db.FinalsTieOrders.Where(x => ids.Contains(x.CompetitionId) || teamIds.Contains(x.TeamId)).ExecuteDeleteAsync();
    await db.SpecialAwards.Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    var signupIds = db.SectionSignups.Where(x => sectionIds.Contains(x.CompetitionSectionId)).Select(x => x.Id);
    await db.Set<SignupMatchmaking>().Where(x => x.PairRequestFromSignupId != null && signupIds.Contains(x.PairRequestFromSignupId.Value))
        .ExecuteUpdateAsync(set => set.SetProperty(x => x.PairRequestFromSignupId, (int?)null));
    await db.Set<SignupMatchmaking>().Where(x => x.PairRequestToSignupId != null && signupIds.Contains(x.PairRequestToSignupId.Value))
        .ExecuteUpdateAsync(set => set.SetProperty(x => x.PairRequestToSignupId, (int?)null));
    await db.Set<SignupMatchmaking>().Where(x => signupIds.Contains(x.SignupId)).ExecuteDeleteAsync();
    await db.Set<SignupExtras>().Where(x => signupIds.Contains(x.SignupId)).ExecuteDeleteAsync();
    await db.Set<SignupGuestDetails>().Where(x => signupIds.Contains(x.SignupId)).ExecuteDeleteAsync();
    await db.Set<SignupTeamLink>().Where(x => signupIds.Contains(x.SignupId) || teamIds.Contains(x.TeamId)).ExecuteDeleteAsync();
    await db.SectionSignups.Where(x => sectionIds.Contains(x.CompetitionSectionId)).ExecuteDeleteAsync();
    await db.Teams.Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    await db.Set<DrawChange>().Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    await db.CompetitionSections.Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();

    // Everything else that hangs off the event itself.
    await db.ChatMessages.Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    await db.LiveStreams.Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    await db.StreamOverlays.Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    var sponsorIds = db.Sponsors.Where(x => ids.Contains(x.CompetitionId)).Select(x => x.Id);
    await db.SponsorExposures.Where(x => sponsorIds.Contains(x.SponsorId)).ExecuteDeleteAsync();
    await db.Sponsors.Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    await db.CompetitionCollaborators.Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    await db.ScorerLinks.Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    await db.Set<EquipmentAcknowledgement>().Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    await db.Set<CompetitionEntrySettings>().Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    await db.Set<CompetitionDeclarationLock>().Where(x => ids.Contains(x.CompetitionId)).ExecuteDeleteAsync();
    await db.Competitions.Where(x => ids.Contains(x.Id)).ExecuteDeleteAsync();
    }
}
