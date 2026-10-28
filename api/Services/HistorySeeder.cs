using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Services.Seasons;

namespace MountedGames.Api.Services;

/// <summary>
/// Explicit command only (<c>--seed-history</c>), never run from startup. Fills a review site with a believable
/// back catalogue: twelve fictional clubs, about 180 riders with ponies, eight finished competitions with every race
/// scored, a season over four of them, and shop listings (no pictures). Everything is fictional.
///
/// Safe to run again. It removes only what it made before, then makes it again. Its output is recognised by the
/// stable competition names below together with the demo mark (<see cref="EventCommerceSettings.IsDemo"/>), by the
/// fictional organiser and seller accounts it owns (ids <c>history-seed-*</c>, no password, so nobody can sign in as
/// them), and by its club names. A same-named competition without the demo mark makes the run stop before it
/// changes anything. No other competition, user or listing is touched.
/// </summary>
public static class HistorySeeder
{
    public const string OrganiserId = "history-seed-organiser";
    public static readonly string[] SellerIds = { "history-seed-seller-1", "history-seed-seller-2", "history-seed-seller-3" };

    private const int LanesPerHeat = 6;
    private const int MinutesPerHeat = 35;

    /// <summary>What a run made. <c>Removed</c> is how many of its own earlier competitions it cleared first.</summary>
    public sealed record HistorySeedResult(
        int Removed, int Competitions, int Clubs, int Riders, int Ponies, int Teams, int Races, int Results,
        int Seasons, int TeamProfiles, int ShopPosts, int CatalogueItems, int Listings);

    // ----- fixed names -----

    private sealed record ClubDef(string Name, string Short, string Region, string Bib);

    private static readonly ClubDef[] Clubs =
    {
        new("Central Warwickshire", "Central Warwickshire", "Warwickshire", "Red"),
        new("North Warwickshire MGA", "North Warwickshire", "Warwickshire", "Blue"),
        new("Atherstone MGA", "Atherstone", "Leicestershire", "Green"),
        new("Rockwood Harriers MGA", "Rockwood Harriers", "West Yorkshire", "Yellow"),
        new("Oakley West", "Oakley West", "Buckinghamshire", "Orange"),
        new("Mid Glamorgan", "Mid Glamorgan", "South Wales", "Purple"),
        new("Berwyn & Dee MGA", "Berwyn & Dee", "North Wales", "Red"),
        new("Lancashire", "Lancashire", "Lancashire", "Blue"),
        new("Lothian & Borders", "Lothian & Borders", "Scotland", "Green"),
        new("Devon Daredevils", "Devon Daredevils", "Devon", "Yellow"),
        new("Dorset", "Dorset", "Dorset", "Orange"),
        new("Leicester Forest", "Leicester Forest", "Leicestershire", "Purple"),
    };

    private static readonly string[] LegacyClubNames =
    {
        "Hollowbrook Pony Club", "Marlow Heath Pony Club", "Cranmere Riding Club", "Carrowmore Pony Club",
        "Longmoor Hunt Pony Club", "Ballymore Equestrian Club", "Thornbury Vale Pony Club", "Westfield Riding Club",
        "Glenmara Pony Club", "Ashgrove Pony Club", "Fernhill Equestrian Club", "Dunmore Pony Club",
    };

    // Newest first. Offset is days back from today; the first four make up the series.
    private sealed record EventDef(string Name, string Icon, string Venue, int Offset, string[] Sections);

    private static readonly EventDef[] PastEvents =
    {
        new("British Pairs Championships", "trophy", "Addington Equestrian, Buckinghamshire", -16, new[] { "U14T", "U12T", "OT", "OP" }),
        new("English Team Championships", "gb", "Newark Showground, Nottinghamshire", -30, new[] { "U14T", "U12T", "OT" }),
        new("Celtic Pairs Championship", "ie", "Necarne Castle, Co. Fermanagh", -44, new[] { "U14T", "U12T", "OP" }),
        new("EGUK National Championships", "flag", "Dallas Burston Polo Club, Southam", -58, new[] { "U14T", "OT", "U12T", "U12P" }),
        new("Scottish Open Championships", "gb", "SNEC, West Lothian", -85, new[] { "U14T", "OT" }),
        new("Home International Trophy", "trophy", "Three Counties Showground, Malvern", -120, new[] { "U14T", "U12T", "OT", "OP" }),
        new("Southwest Spring Open", "ie", "Bicton Arena, Devon", -165, new[] { "U14T", "U12T", "OP" }),
        new("Heart of England Friendly", "world", "Solihull Riding Club, West Midlands", -230, new[] { "U14T", "OT", "U12T" }),
    };

    private static readonly EventDef UpcomingEvent =
        new("EGUK Winter Indoor Classic", "flag", "Aintree International Equestrian Centre, Liverpool", 24, new[] { "U14T", "OT" });

    private static readonly string[] LegacyEventNames =
    {
        "Westfield Finals Day", "Thornbury Autumn Games", "Ballymore Challenge", "Longmoor Summer Festival",
        "Cranmere Open", "Marlow Heath Trophy", "Carrowmore Spring Games", "Hartwell Park Cup", "Fernhill Winter Showdown",
    };

    private const int SeasonEventCount = 4;

    private sealed record SectionDef(string AgeGroup, SectionFormat Format, string Display, int PriceMinor, int AgeIndex);

    private static readonly Dictionary<string, SectionDef> SectionDefs = new()
    {
        ["U12T"] = new("Under 12", SectionFormat.Teams, "Under 12 Teams", 2500, 0),
        ["U14T"] = new("Under 14", SectionFormat.Teams, "Under 14 Teams", 2500, 1),
        ["OT"] = new("Open", SectionFormat.Teams, "Open Teams", 3000, 2),
        ["U12P"] = new("Under 12", SectionFormat.Pairs, "Under 12 Pairs", 1800, 0),
        ["OP"] = new("Open", SectionFormat.Pairs, "Open Pairs", 2000, 2),
    };

    private static readonly string[] RaceNames =
    {
        "Two Flag", "Mug Shuffle", "Bottle Shuttle", "Litter Lifter", "Bending",
        "Five Flag", "Stepping Stones", "Tack Shop", "Big Sack", "Pole Bending",
    };

    private static readonly string[] AgeLabels = { "U12", "U14", "Open" };

    private static readonly string[] FirstNames =
    {
        "Amelia", "Isla", "Ava", "Freya", "Poppy", "Ella", "Grace", "Lily", "Mia", "Evie", "Florence", "Ruby", "Daisy",
        "Matilda", "Phoebe", "Imogen", "Niamh", "Aoife", "Saoirse", "Ciara", "Orla", "Sinead", "Maeve", "Roisin",
        "Eilidh", "Catriona", "Megan", "Rhiannon", "Seren", "Tilly", "Willow", "Harriet", "Beatrice", "Esme", "Clara",
        "Edie", "Rosie", "Hattie", "Molly", "Georgia", "Oliver", "George", "Harry", "Jack", "Noah", "Arthur", "Charlie",
        "Alfie", "Oscar", "Henry", "Theo", "Freddie", "Rory", "Callum", "Fergus", "Cian", "Sean", "Conor", "Eoin",
        "Darragh", "Finn", "Angus", "Hamish", "Euan", "Rhys", "Owen", "Dylan", "Ewan", "Jasper", "Hugo", "Barnaby",
        "Tom", "Ben", "Sam", "Joe", "Max",
    };

    private static readonly string[] Surnames =
    {
        "Ashworth", "Bennett", "Carter", "Dawson", "Ellison", "Fletcher", "Gibson", "Hargreaves", "Ingram", "Jennings",
        "Kendrick", "Lawson", "Mitchell", "Norris", "Osborne", "Pearce", "Quinn", "Rowland", "Sutton", "Thornton",
        "Underwood", "Vaughan", "Whitaker", "Yates", "Alderton", "Brennan", "Callaghan", "Donnelly", "Egan", "Fahey",
        "Gallagher", "Hennessy", "Keane", "Lynch", "McCarthy", "Nolan", "O'Brien", "Power", "Redmond", "Sweeney",
        "Tierney", "Walsh", "Buchanan", "Campbell", "Drummond", "Forbes", "Gordon", "Hamilton", "Kerr", "Munro",
        "Ogilvie", "Davies", "Evans", "Griffiths", "Hughes", "Jenkins", "Llewellyn", "Pritchard", "Rees", "Thomas",
        "Barker", "Chapman", "Hartley", "Marsh", "Nash", "Reeves", "Stokes", "Tanner", "Wheeler", "Penhaligon",
        "Trelawney", "Kitchener", "Moran", "Coyle", "Devlin", "Farrelly", "Healy", "Mulcahy", "Rafferty", "Slattery",
    };

    private static readonly string[] SinglePonies =
    {
        "Biscuit", "Bramble", "Pepper", "Maverick", "Willow", "Juniper", "Cobweb", "Clover", "Dusty", "Ember", "Fudge",
        "Ginger", "Haze", "Ivy", "Jester", "Kipper", "Ludo", "Mistral", "Nutmeg", "Opal", "Pixie", "Quince", "Rascal",
        "Sherlock", "Truffle", "Umber", "Velvet", "Whisper", "Yarrow", "Zephyr", "Archie", "Bertie", "Conker", "Domino",
        "Elvis", "Flint", "Gizmo", "Hobnob", "Indigo", "Jinx", "Kestrel", "Lottie", "Mocha", "Nimbus", "Otis",
        "Puddles", "Rocket", "Sparrow", "Tinker", "Biscay",
    };

    private static readonly string[] PonyAdjectives =
    {
        "Little", "Silver", "Golden", "Midnight", "Copper", "Misty", "Merry", "Wild", "Dapper", "Sunny", "Stormy", "Frosty",
    };

    private static readonly string[] PonyNouns =
    {
        "Bramble", "Comet", "Echo", "Lark", "Poppy", "Rowan", "Thistle", "Wren", "Barley", "Heather", "Flint", "Pebble",
        "Sorrel", "Briar", "Tansy",
    };

    private static readonly string[] TrainerNames =
    {
        "Helen Fairweather", "Gareth Pryce", "Moira Doherty", "Simon Radcliffe", "Joanne Kavanagh", "Peter Holloway",
        "Alison Murdoch", "Declan Brophy", "Katherine Stroud", "Neil Garrity", "Fiona Whelan", "Martin Prowse",
    };

    // ----- the run -----

    public static async Task<HistorySeedResult> SeedAsync(AppDbContext db, DateTime todayUtc)
    {
        var allNames = PastEvents.Append(UpcomingEvent).Select(e => e.Name).ToArray();
        return await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync();

            // A same-named event that isn't ours stops the run before anything is deleted.
            var unmarked = await db.Competitions
                .Where(c => allNames.Contains(c.Name)
                    && !db.Set<EventCommerceSettings>().Any(x => x.CompetitionId == c.Id && x.IsDemo))
                .Select(c => c.Name).ToListAsync();
            if (unmarked.Count > 0)
                throw new InvalidOperationException(
                    $"\"{unmarked[0]}\" already exists and is not marked as sample data, so nothing was changed.");

            var removed = await RemoveCoreAsync(db);
            db.ChangeTracker.Clear();
            var result = await CreateAsync(db, todayUtc.Date, removed);
            await transaction.CommitAsync();
            return result;
        });
    }

    /// <summary>Removes only what <see cref="SeedAsync"/> made. Returns how many competitions went.</summary>
    public static async Task<int> RemoveAsync(AppDbContext db)
        => await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync();
            var removed = await RemoveCoreAsync(db);
            await transaction.CommitAsync();
            return removed;
        });

    private static async Task<int> RemoveCoreAsync(AppDbContext db)
    {
        var names = PastEvents.Append(UpcomingEvent).Select(e => e.Name).Concat(LegacyEventNames).ToArray();
        var ids = await db.Competitions
            .Where(c => names.Contains(c.Name)
                && db.Set<EventCommerceSettings>().Any(x => x.CompetitionId == c.Id && x.IsDemo))
            .Select(c => c.Id).ToListAsync();

        // The series first: results, publications, rounds, points, then the season. If someone has added a round
        // of their own, stop rather than change their league.
        var seasonIds = await db.Set<Season>().Where(s => s.OwnerUserId == OrganiserId).Select(s => s.Id).ToListAsync();
        if (seasonIds.Count > 0)
        {
            if (await db.Set<SeasonRound>().AnyAsync(r => seasonIds.Contains(r.SeasonId) && !ids.Contains(r.CompetitionId)))
                throw new InvalidOperationException("The seeded season has a round from another event. Remove that round, then run this again.");
            var roundIds = db.Set<SeasonRound>().Where(r => seasonIds.Contains(r.SeasonId)).Select(r => r.Id);
            var publicationIds = db.Set<SeasonRoundPublication>().Where(p => roundIds.Contains(p.SeasonRoundId)).Select(p => p.Id);
            await db.Set<SeasonRoundResult>().Where(r => publicationIds.Contains(r.SeasonRoundPublicationId)).ExecuteDeleteAsync();
            await db.Set<SeasonRoundPublication>().Where(p => roundIds.Contains(p.SeasonRoundId)).ExecuteDeleteAsync();
            await db.Set<SeasonRound>().Where(r => seasonIds.Contains(r.SeasonId)).ExecuteDeleteAsync();
            await db.Set<SeasonPlacePoints>().Where(p => seasonIds.Contains(p.SeasonId)).ExecuteDeleteAsync();
            await db.Set<Season>().Where(s => seasonIds.Contains(s.Id)).ExecuteDeleteAsync();
        }

        if (ids.Count > 0) await ReviewCompetitionSeeder.DeleteCompetitionGraphAsync(db, ids);

        // Listings on any event for the seeded sellers' items, then the items.
        var itemIds = db.Set<CatalogueItem>().Where(i => SellerIds.Contains(i.SellerUserId)).Select(i => i.Id);
        await db.Set<CompetitionListing>().Where(l => itemIds.Contains(l.CatalogueItemId)).ExecuteDeleteAsync();
        await db.Set<CatalogueItemOption>().Where(o => itemIds.Contains(o.CatalogueItemId)).ExecuteDeleteAsync();
        await db.Set<CatalogueItem>().Where(i => SellerIds.Contains(i.SellerUserId)).ExecuteDeleteAsync();

        // Marketplace posts by the seeded sellers, with anything attached to them.
        var postIds = db.ShopPosts.Where(p => p.AuthorUserId != null && SellerIds.Contains(p.AuthorUserId)).Select(p => p.Id);
        await db.ShopComments.Where(c => postIds.Contains(c.PostId)).ExecuteDeleteAsync();
        await db.ShopReports.Where(r => postIds.Contains(r.PostId)).ExecuteDeleteAsync();
        await db.ShopPosts.Where(p => p.AuthorUserId != null && SellerIds.Contains(p.AuthorUserId)).ExecuteDeleteAsync();

        // Profiles with nothing left linked, saved riders we made, and our clubs once nothing uses them.
        await db.Set<TeamProfile>()
            .Where(p => p.OwnerUserId == OrganiserId
                && !db.Set<EventTeamProfileLink>().Any(l => l.TeamProfileId == p.Id)
                && !db.Set<SeasonRoundResult>().Any(r => r.TeamProfileId == p.Id))
            .ExecuteDeleteAsync();
        await db.SavedRiders.Where(r => r.CreatedByUserId == OrganiserId
                && !db.RiderEntries.Any(e => e.SavedRiderId == r.Id))
            .ExecuteDeleteAsync();
        var clubNames = Clubs.Select(c => c.Name).Concat(LegacyClubNames).ToArray();
        await db.Clubs
            .Where(c => clubNames.Contains(c.Name)
                && !db.Teams.Any(t => t.ClubId == c.Id)
                && !db.SavedRiders.Any(r => r.ClubId == c.Id)
                && !db.Set<TeamProfile>().Any(p => p.ClubId == c.Id)
                && !db.Users.Any(u => u.ClubId == c.Id))
            .ExecuteDeleteAsync();
        return ids.Count;
    }

    // ----- generation -----

    private sealed class RiderDef
    {
        public required int ClubIndex { get; init; }
        public required int Age { get; init; }
        public required int Slot { get; init; }
        public required string Name { get; init; }
        public required string Pony { get; init; }
        public required string? AltPony { get; init; }
        public required decimal Hands { get; init; }
        public SavedRider Saved { get; set; } = null!;
    }

    private sealed record Entrant(Team Team, double Strength);

    private static async Task<HistorySeedResult> CreateAsync(AppDbContext db, DateTime today, int removed)
    {
        var rng = new Random(20261023);

        // Fictional accounts with no password: Identity refuses a sign-in without a password hash.
        await EnsureUserAsync(db, OrganiserId, "Series Organiser", "organiser");
        await EnsureUserAsync(db, SellerIds[0], "Warwickshire Tack Swap", "seller1");
        await EnsureUserAsync(db, SellerIds[1], "Onley Rosettes and Prints", "seller2");
        await EnsureUserAsync(db, SellerIds[2], "Malvern Saddlery Spares", "seller3");

        // Clubs.
        var clubs = new List<Club>();
        foreach (var def in Clubs)
        {
            var club = await db.Clubs.FirstOrDefaultAsync(c => c.Name == def.Name)
                ?? new Club { Name = def.Name };
            club.Region = def.Region;
            club.BibColour = def.Bib;
            if (club.Id == 0) db.Clubs.Add(club);
            clubs.Add(club);
        }

        // Riders and ponies: five per club in each age group (four to ride, one reserve), one pony each.
        var names = UniqueNames(rng, Clubs.Length * 3 * 5);
        var ponies = UniquePonies(rng, Clubs.Length * 3 * 5 + 40);
        var riders = new List<RiderDef>();
        var ponyIndex = 0;
        for (var c = 0; c < Clubs.Length; c++)
            for (var age = 0; age < 3; age++)
                for (var slot = 0; slot < 5; slot++)
                {
                    var hands = age switch
                    {
                        0 => 11.1m + rng.Next(0, 3) / 10m,
                        1 => 12.1m + rng.Next(0, 3) / 10m,
                        _ => 13.1m + rng.Next(0, 3) / 10m,
                    };
                    riders.Add(new RiderDef
                    {
                        ClubIndex = c, Age = age, Slot = slot, Name = names[riders.Count],
                        Pony = ponies[ponyIndex++],
                        // About one in ten sometimes rides a second pony.
                        AltPony = rng.Next(10) == 0 ? ponies[ponyIndex++] : null,
                        Hands = hands,
                    });
                }
        foreach (var rider in riders)
        {
            // Full names and no initial-only flags: these riders have consented to appear in public stats.
            rider.Saved = new SavedRider
            {
                Club = clubs[rider.ClubIndex], CreatedByUserId = OrganiserId, FullName = rider.Name,
                HorseName = rider.Pony, PonyHeightHands = rider.Hands, UseInitialOnly = false,
            };
            db.SavedRiders.Add(rider.Saved);
        }

        // One team profile per club for the Under 14 series, and the club strengths that shape results.
        var profiles = new List<TeamProfile>();
        for (var c = 0; c < Clubs.Length; c++)
        {
            var profile = new TeamProfile
            {
                OwnerUserId = OrganiserId, Club = clubs[c], Suffix = string.Empty,
                DisplayName = $"{Clubs[c].Short} U14",
            };
            profiles.Add(profile);
            db.Set<TeamProfile>().Add(profile);
        }
        await db.SaveChangesAsync();
        var clubStrength = Enumerable.Range(0, Clubs.Length).Select(_ => rng.NextDouble()).ToArray();

        // Competitions, oldest first so ids and dates run the same way.
        var made = new List<(Competition Comp, EventDef Def, CompetitionSection? U14)>();
        var teamCount = 0;
        var raceCount = 0;
        var resultCount = 0;
        var ordered = PastEvents.Reverse().Select((e, i) => (Def: e, Index: i, Upcoming: false))
            .Append((Def: UpcomingEvent, Index: PastEvents.Length, Upcoming: true));
        foreach (var (def, index, upcoming) in ordered)
        {
            var eventRng = new Random(1000 + index);
            var day = SaturdayOnOrBefore(today.AddDays(def.Offset));
            var competition = new Competition
            {
                Name = def.Name,
                Icon = def.Icon,
                Location = def.Venue,
                StartDate = DateTime.SpecifyKind(day.AddHours(9), DateTimeKind.Utc),
                EndDate = DateTime.SpecifyKind(day.AddHours(17), DateTimeKind.Utc),
                IsActive = upcoming,
                IsArchived = !upcoming,
                SignupsLocked = !upcoming,
                OrganiserName = "Series Organiser",
                CreatedByUserId = OrganiserId,
                Description = "Mounted games for clubs, pairs and individuals, with timed heats and finals.",
            };
            var arenaFree = new Dictionary<string, DateTime>
            {
                ["Main arena"] = day.AddHours(9), ["Second arena"] = day.AddHours(9),
            };
            var latestEnd = day.AddHours(9);
            var sessionOrder = 0;
            CompetitionSection? u14 = null;
            for (var s = 0; s < def.Sections.Length; s++)
            {
                var sd = SectionDefs[def.Sections[s]];
                var section = new CompetitionSection
                {
                    Competition = competition, Format = sd.Format, AgeGroup = sd.AgeGroup, DisplayName = sd.Display,
                    PriceMinor = sd.PriceMinor, FinalistCount = 6,
                };
                competition.Sections.Add(section);
                if (def.Sections[s] == "U14T") u14 = section;

                var entrants = BuildTeams(db, competition, section, sd, clubs, riders, profiles, clubStrength, eventRng, def, index, upcoming, s);
                teamCount += entrants.Count;
                var arena = s % 2 == 0 ? "Main arena" : "Second arena";
                var raceTotal = 6 + eventRng.Next(0, 3);

                // Heats: balanced groups of at most six.
                var heatGroups = Split(entrants, LanesPerHeat);
                var heatsSession = NewSession(competition, section, $"{sd.Display} heats", arena, arenaFree[arena], ++sessionOrder, upcoming);
                var heatBase = heatGroups.Max(g => g.Count);
                var heatTotals = entrants.ToDictionary(e => e.Team, _ => 0.0);
                BuildHeats(heatsSession, heatGroups.Select((g, i) => ($"Heat {i + 1}", g)).ToList(), raceTotal, heatBase, eventRng, upcoming, heatTotals,
                    ref raceCount, ref resultCount);
                arenaFree[arena] = heatsSession.ScheduledStart!.Value.AddMinutes(heatGroups.Count * MinutesPerHeat + 10);
                latestEnd = Max(latestEnd, arenaFree[arena]);

                // Finals: an A Final of the top six and a B Final of the next six, for the bigger sections.
                if (!upcoming && entrants.Count >= 8)
                {
                    var rankedTeams = entrants
                        .OrderByDescending(e => heatTotals[e.Team]).ThenBy(e => e.Team.DisplayName, StringComparer.Ordinal).ToList();
                    var aFinal = rankedTeams.Take(LanesPerHeat).ToList();
                    var bFinal = rankedTeams.Skip(LanesPerHeat).Take(LanesPerHeat).ToList();
                    var finals = new List<(string, List<Entrant>)> { ("A Final", aFinal) };
                    if (bFinal.Count >= 2) finals.Add(("B Final", bFinal));
                    var finalsSession = NewSession(competition, section, $"{sd.Display} finals", arena, arenaFree[arena], ++sessionOrder, upcoming);
                    BuildHeats(finalsSession, finals, raceTotal, aFinal.Count, eventRng, upcoming, null, ref raceCount, ref resultCount);
                    arenaFree[arena] = finalsSession.ScheduledStart!.Value.AddMinutes(finals.Count * MinutesPerHeat + 10);
                    latestEnd = Max(latestEnd, arenaFree[arena]);
                }
            }
            competition.EndDate = DateTime.SpecifyKind(Max(competition.EndDate!.Value, latestEnd.AddMinutes(30)), DateTimeKind.Utc);
            db.Competitions.Add(competition);
            db.Set<EventCommerceSettings>().Add(new EventCommerceSettings
            {
                Competition = competition, IsDemo = true, UpdatedByUserId = OrganiserId,
            });
            await db.SaveChangesAsync();
            made.Add((competition, def, u14));
        }

        // The series: the four most recent past events, Under 14 teams, oldest round first.
        var seasonEvents = made.Where(m => PastEvents.Take(SeasonEventCount).Any(p => p.Name == m.Def.Name)).ToList();
        var season = new Season
        {
            OwnerUserId = OrganiserId,
            Title = $"{seasonEvents[^1].Comp.StartDate.Year} Autumn Series",
            Year = seasonEvents[^1].Comp.StartDate.Year,
            Format = SectionFormat.Teams,
            AgeGroup = "Under 14",
            BestResultsToCount = 3,
            PlacePoints = new[] { 25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4 }
                .Select((p, i) => new SeasonPlacePoints { Place = i + 1, Points = p }).ToList(),
        };
        db.Set<Season>().Add(season);
        for (var r = 0; r < seasonEvents.Count; r++)
            season.Rounds.Add(new SeasonRound
            {
                Season = season, Competition = seasonEvents[r].Comp, CompetitionSection = seasonEvents[r].U14!, OrderIndex = r + 1,
            });
        await db.SaveChangesAsync();

        // Publish each round as the published results, the same numbers the organiser's preview would show.
        var publisher = new SeasonPublicationService(db);
        foreach (var round in season.Rounds.OrderBy(r => r.OrderIndex))
        {
            var preview = await publisher.PreviewAsync(season.Id, round.Id, CancellationToken.None);
            var eventEnd = seasonEvents.First(m => m.Comp.Id == round.CompetitionId).Comp.EndDate!.Value;
            db.Set<SeasonRoundPublication>().Add(new SeasonRoundPublication
            {
                SeasonRoundId = round.Id, Version = preview.NextVersion, SourceFingerprint = preview.SourceFingerprint,
                PublishedByUserId = OrganiserId, PublishedAt = DateTime.SpecifyKind(eventEnd.Date.AddDays(1).AddHours(10), DateTimeKind.Utc),
                Results = preview.Results.Select(x => new SeasonRoundResult
                {
                    TeamProfileId = x.TeamProfileId, EventTeamId = x.EventTeamId, TeamName = x.TeamName, ClubName = x.ClubName,
                    EventRank = x.EventRank, EventPoints = x.EventPoints, SeasonPoints = x.SeasonPoints,
                }).ToList(),
            });
        }
        await db.SaveChangesAsync();

        // Shop: marketplace posts, and a catalogue listed on the upcoming event.
        var upcomingComp = made.Single(m => m.Def == UpcomingEvent).Comp;
        var posts = ShopPosts(today);
        db.ShopPosts.AddRange(posts);
        var items = CatalogueItems();
        db.Set<CatalogueItem>().AddRange(items);
        foreach (var item in items)
            db.Set<CompetitionListing>().Add(new CompetitionListing
            {
                Competition = upcomingComp, CatalogueItem = item, SellerUserId = item.SellerUserId,
                Status = CommerceListingStatus.Approved, ReviewedByUserId = OrganiserId, ReviewedAt = DateTime.UtcNow,
            });
        await db.SaveChangesAsync();

        return new HistorySeedResult(
            removed, made.Count, clubs.Count, riders.Count, riders.Count + riders.Count(r => r.AltPony is not null),
            teamCount, raceCount, resultCount, 1, profiles.Count, posts.Count, items.Count, items.Count);
    }

    // ----- teams, sessions, results -----

    private static List<Entrant> BuildTeams(
        AppDbContext db, Competition competition, CompetitionSection section, SectionDef sd, List<Club> clubs,
        List<RiderDef> riders, List<TeamProfile> profiles, double[] clubStrength, Random rng, EventDef def, int eventIndex,
        bool upcoming, int sectionIndex)
    {
        var entrants = new List<Entrant>();
        for (var c = 0; c < clubs.Count; c++)
        {
            var pool = riders.Where(r => r.ClubIndex == c && r.Age == sd.AgeIndex).OrderBy(r => r.Slot).ToList();
            // Pairs: pair A is the first two riders, pair B the next two. Teams: four riders and a reserve.
            var shapes = sd.Format == SectionFormat.Pairs
                ? new[] { (Suffix: "A", Take: pool.Take(2).ToList()), (Suffix: "B", Take: pool.Skip(2).Take(2).ToList()) }
                : new[] { (Suffix: string.Empty, Take: pool.ToList()) };
            foreach (var (suffix, members) in shapes)
            {
                // Not every club enters every section: about three in four turn up, fewer with a second pair.
                if (rng.NextDouble() > (suffix == "B" ? 0.45 : 0.75)) continue;
                var shortName = Clubs[c].Short;
                var display = sd.Format == SectionFormat.Pairs
                    ? $"{shortName} {AgeLabels[sd.AgeIndex]} Pair {suffix}"
                    : $"{shortName} {AgeLabels[sd.AgeIndex]}";
                var team = new Team
                {
                    Competition = competition, Section = section, Club = clubs[c], Suffix = suffix, DisplayName = display,
                    BibColour = Clubs[c].Bib,
                };
                competition.Teams.Add(team);

                var lineup = members.ToList();
                // Now and then a rider drops out and the reserve steps up.
                if (sd.Format == SectionFormat.Teams && rng.NextDouble() < 0.15)
                {
                    lineup.RemoveAt(rng.Next(0, 4));
                    lineup = lineup.OrderBy(r => r.Slot).ToList();
                }
                var form = new DeclarationForm
                {
                    Team = team,
                    SubmittedAt = DateTime.SpecifyKind(competition.StartDate.Date.AddDays(-12), DateTimeKind.Utc),
                    IsLocked = !upcoming || rng.Next(2) == 0,
                    TrainerName = TrainerNames[(c + (sd.Format == SectionFormat.Pairs ? 5 : 0)) % TrainerNames.Length],
                    TermsAcceptedAt = DateTime.SpecifyKind(competition.StartDate.Date.AddDays(-12), DateTimeKind.Utc),
                    Notes = null,
                };
                var order = 0;
                for (var m = 0; m < lineup.Count; m++)
                {
                    var rider = lineup[m];
                    var reserve = sd.Format == SectionFormat.Teams && m == lineup.Count - 1 && lineup.Count == 5;
                    var altPony = rider.AltPony is not null && rng.NextDouble() < 0.4;
                    form.Riders.Add(new RiderEntry
                    {
                        DeclarationForm = form, SavedRider = rider.Saved, FullName = rider.Name,
                        HorseName = altPony ? rider.AltPony : rider.Pony, PonyHeightHands = rider.Hands,
                        BibColour = Clubs[c].Bib, IsCaptain = m == 0, IsReserve = reserve, OrderIndex = order++,
                        UseInitialOnly = false,
                    });
                }
                team.DeclarationForms.Add(form);
                if (sd.Format == SectionFormat.Teams && sd.AgeIndex == 1)
                    db.Set<EventTeamProfileLink>().Add(new EventTeamProfileLink
                    {
                        TeamProfile = profiles[c], Competition = competition, Team = team, LinkedByUserId = OrganiserId,
                    });
                entrants.Add(new Entrant(team, clubStrength[c] + sd.AgeIndex * 0.05 + (suffix == "B" ? -0.25 : 0)));
            }
        }
        return entrants;
    }

    private static Session NewSession(
        Competition competition, CompetitionSection section, string name, string arena, DateTime start, int order, bool upcoming)
    {
        var session = new Session
        {
            Competition = competition, Section = section, Name = name, ArenaName = arena,
            ScheduledStart = DateTime.SpecifyKind(start, DateTimeKind.Utc), OrderIndex = order,
            MinutesPerHeat = MinutesPerHeat, LanesPerHeat = LanesPerHeat,
            Status = upcoming ? SessionStatus.Upcoming : SessionStatus.Finished,
        };
        competition.Sessions.Add(session);
        return session;
    }

    private static void BuildHeats(
        Session session, List<(string Label, List<Entrant> Entrants)> heats, int raceTotal, int baseSize, Random rng,
        bool upcoming, Dictionary<Team, double>? totals, ref int raceCount, ref int resultCount)
    {
        var start = session.ScheduledStart!.Value;
        for (var h = 0; h < heats.Count; h++)
        {
            var (label, entrants) = heats[h];
            var heatStart = start.AddMinutes(h * MinutesPerHeat);
            var heat = new Heat
            {
                Session = session, Label = label, OrderIndex = h + 1, DurationMinutes = MinutesPerHeat, ScheduledStart = heatStart,
                StartedAt = upcoming ? null : heatStart, FinishedAt = upcoming ? null : heatStart.AddMinutes(MinutesPerHeat),
            };
            session.Heats.Add(heat);
            // A lettered final (A Final, B Final) scores from its own heat's team count, as ScoringService does.
            var heatBase = label.EndsWith(" Final", StringComparison.Ordinal) ? entrants.Count : baseSize;
            for (var lane = 0; lane < entrants.Count; lane++)
                heat.Entries.Add(new HeatEntry { Heat = heat, Team = entrants[lane].Team, LaneIndex = lane + 1 });
            for (var r = 0; r < raceTotal; r++)
            {
                var raceStart = heatStart.AddMinutes(r * 4);
                var race = new Race
                {
                    Heat = heat, Name = RaceNames[r % RaceNames.Length], OrderIndex = r + 1, IsComplete = !upcoming,
                    StartedAt = upcoming ? null : raceStart, FinishedAt = upcoming ? null : raceStart.AddMinutes(3),
                };
                heat.Races.Add(race);
                raceCount++;
                if (upcoming) continue;
                foreach (var result in Score(race, entrants, heatBase, rng, raceStart.AddMinutes(3)))
                {
                    race.Results.Add(result);
                    resultCount++;
                    if (totals is not null) totals[result.Team!] += result.Points;
                }
            }
        }
        if (!upcoming)
        {
            session.StartedAt = start;
            session.FinishedAt = start.AddMinutes(heats.Count * MinutesPerHeat);
        }
    }

    /// <summary>
    /// Places the teams in one race. A winner scores the session's largest field, each place below one less; the odd
    /// team is eliminated or doesn't start, doesn't finish or retires, with no place and no points.
    /// </summary>
    private static IEnumerable<Result> Score(Race race, List<Entrant> entrants, int baseSize, Random rng, DateTime recordedAt)
    {
        var order = entrants.Select(e => (e.Team, Score: e.Strength * 1.5 + rng.NextDouble() * 2))
            .OrderByDescending(x => x.Score).Select(x => x.Team).ToList();
        var statuses = order.Select(_ =>
        {
            var roll = rng.NextDouble();
            return roll < 0.04 ? ResultStatus.Eliminated
                : roll < 0.055 ? ResultStatus.DidNotStart
                : roll < 0.07 ? ResultStatus.DidNotFinish
                : roll < 0.08 ? ResultStatus.Retired
                : ResultStatus.Finished;
        }).ToList();
        if (statuses.All(s => s != ResultStatus.Finished)) statuses[0] = ResultStatus.Finished;
        var place = 0;
        for (var i = 0; i < order.Count; i++)
        {
            if (statuses[i] == ResultStatus.Finished)
            {
                place++;
                yield return new Result
                {
                    Race = race, Team = order[i], Placing = place, Points = Math.Max(baseSize - place + 1, 0), RecordedAt = recordedAt,
                };
            }
            else
            {
                yield return new Result
                {
                    Race = race, Team = order[i], Placing = null, Eliminated = true, Status = statuses[i], Points = 0, RecordedAt = recordedAt,
                };
            }
        }
    }

    private static List<List<Entrant>> Split(List<Entrant> entrants, int maxSize)
    {
        var groupCount = Math.Max(1, (int)Math.Ceiling(entrants.Count / (double)maxSize));
        var groups = Enumerable.Range(0, groupCount).Select(_ => new List<Entrant>()).ToList();
        // Snake the strongest across groups so heats are balanced.
        var sorted = entrants.OrderByDescending(e => e.Strength).ToList();
        for (var i = 0; i < sorted.Count; i++)
        {
            var round = i / groupCount;
            var slot = i % groupCount;
            groups[round % 2 == 0 ? slot : groupCount - 1 - slot].Add(sorted[i]);
        }
        return groups;
    }

    // ----- shop -----

    private static List<ShopPost> ShopPosts(DateTime today)
    {
        (string Seller, string Club, string Title, string Body, int Price)[] rows =
        {
            ("Warwickshire Tack Swap", "Central Warwickshire", "Jumping saddle, 16.5 inch, black", "Well looked after, medium tree. Recently reflocked. Sold as seen, buyer collects from Warwickshire.", 32000),
            ("Warwickshire Tack Swap", "Central Warwickshire", "Mounted games bibs, set of 12", "Mixed colours, a few faded. Ideal for a club starting out.", 4500),
            ("Warwickshire Tack Swap", "Central Warwickshire", "Navy numnah, full size", "Quilted, washed and good as new. Two available.", 1800),
            ("Warwickshire Tack Swap", "Central Warwickshire", "Skull cap, size 55, in date", "Worn for one season only. Collect or I can bring it to the next show.", 3500),
            ("Warwickshire Tack Swap", "Central Warwickshire", "Set of 8 plastic mugs for the mug game", "Bright colours. Handy for training days at home.", 1200),
            ("Onley Rosettes and Prints", "North Warwickshire", "Rosettes, 1st to 6th, pack of 60", "Ten of each place with gold lettering. Can add your event name for a small extra charge.", 6500),
            ("Onley Rosettes and Prints", "North Warwickshire", "Club hoodie, youth sizes", "Navy with embroidered logo. Sizes 7 to 14 years in stock.", 2400),
            ("Onley Rosettes and Prints", "North Warwickshire", "Number bibs, laminated, 1 to 20", "Wipe clean and hard wearing. Fits over a body protector.", 3800),
            ("Onley Rosettes and Prints", "North Warwickshire", "Trophy cup, silver plate, 25 cm", "Engraving available. Allow a week.", 2900),
            ("Onley Rosettes and Prints", "North Warwickshire", "Banner, 3 m, club colours", "Used at one show. Eyelets all intact.", 2200),
            ("Malvern Saddlery Spares", "Atherstone", "Pair of leather reins, 5/8 inch", "Brown, rubber grip. Hardly used.", 1500),
            ("Malvern Saddlery Spares", "Atherstone", "Gel pad and half pad", "Suits a 13.2 pony. Washed and dry.", 2600),
            ("Malvern Saddlery Spares", "Atherstone", "Grooming kit in a carry box", "Brushes, hoof pick, sponge and sweat scraper. Good first kit.", 2000),
            ("Malvern Saddlery Spares", "Atherstone", "Foal-safe lead rope, pair", "Heavy duty clips. Two colours available.", 900),
            ("Malvern Saddlery Spares", "Atherstone", "Show jacket, ladies 10, navy", "Worn twice. Cleaned and pressed.", 4800),
        };
        var rng = new Random(77);
        return rows.Select((r, i) => new ShopPost
        {
            AuthorUserId = SellerIds[Array.IndexOf(new[] { "Warwickshire Tack Swap", "Onley Rosettes and Prints", "Malvern Saddlery Spares" }, r.Seller)],
            AuthorName = r.Seller, PonyClubName = r.Club, Title = r.Title, Body = r.Body, PriceMinor = r.Price,
            ContactInfo = "Message me through the shop.", ImageBase64 = null,
            CreatedAt = DateTime.SpecifyKind(today.AddDays(-(i * 2 + rng.Next(0, 2))).AddHours(8 + rng.Next(0, 10)), DateTimeKind.Utc),
        }).ToList();
    }

    private static List<CatalogueItem> CatalogueItems()
    {
        (int Seller, string Title, string Description, int Price, int? Stock, CommerceItemCategory Category)[] rows =
        {
            (0, "Event T-shirt", "Soft cotton tee with the show logo. Adult and youth sizes.", 1500, 60, CommerceItemCategory.Merchandise),
            (0, "Insulated water bottle", "500 ml steel bottle that keeps drinks cold all day.", 1100, 40, CommerceItemCategory.Merchandise),
            (0, "Spectator day ticket", "Entry for one adult on the day. Under 12s go free.", 600, 300, CommerceItemCategory.Ticket),
            (0, "Weekend spectator pass", "Entry on both days, with a printed programme.", 1000, 150, CommerceItemCategory.Ticket),
            (1, "Club hoodie", "Heavy fleece-backed hoodie, embroidered club logo.", 2800, 35, CommerceItemCategory.Merchandise),
            (1, "Custom rosette, single", "Made to order with the name of your event. Ordered in tens.", 250, null, CommerceItemCategory.Other),
            (1, "Canvas tote bag", "Roomy bag for kit and snacks.", 800, 50, CommerceItemCategory.Merchandise),
            (2, "Camping pitch, per night", "Grass pitch for a tent or small van, near the arenas. Toilets close by.", 1500, 40, CommerceItemCategory.Camping),
            (2, "Horsebox pitch with hook-up", "Space for a lorry with electric hook-up. Book early.", 2500, 12, CommerceItemCategory.Camping),
            (2, "Grooming kit", "Brushes, hoof pick and sponge in a carry box.", 2000, 20, CommerceItemCategory.Other),
        };
        return rows.Select(r => new CatalogueItem
        {
            SellerUserId = SellerIds[r.Seller], Title = r.Title, Description = r.Description, PriceMinor = r.Price,
            StockQuantity = r.Stock, Category = r.Category, ImageUrl = null, IsActive = true,
            Options = SizesFor(r.Title),
        }).ToList();
    }

    /// <summary>Clothes in the back catalogue come in sizes, each with a little stock, so the size pills show.</summary>
    private static List<CatalogueItemOption> SizesFor(string title)
    {
        string[] labels = title switch
        {
            "Event T-shirt" => ["Age 7-8", "Age 9-10", "Age 11-12", "S", "M", "L", "XL"],
            "Club hoodie" => ["S", "M", "L", "XL"],
            _ => [],
        };
        return labels.Select((label, i) => new CatalogueItemOption { Label = label, StockQuantity = 5 + i, SortOrder = i }).ToList();
    }

    // ----- helpers -----

    private static async Task EnsureUserAsync(AppDbContext db, string id, string fullName, string handle)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id);
        if (user is not null) return;
        var email = $"{handle}@history-seed.invalid";
        db.Users.Add(new AppUser
        {
            Id = id, UserName = email, NormalizedUserName = email.ToUpperInvariant(), Email = email,
            NormalizedEmail = email.ToUpperInvariant(), EmailConfirmed = true, FullName = fullName,
            // No password hash, so no password can ever match; the lock stops it being used at all.
            PasswordHash = null, SecurityStamp = Guid.NewGuid().ToString("N"), LockoutEnabled = true,
            LockoutEnd = DateTimeOffset.MaxValue,
        });
        await db.SaveChangesAsync();
    }

    private static DateTime SaturdayOnOrBefore(DateTime date)
        => DateTime.SpecifyKind(date.AddDays(-(((int)date.DayOfWeek - (int)DayOfWeek.Saturday + 7) % 7)).Date, DateTimeKind.Utc);

    private static DateTime Max(DateTime a, DateTime b) => a > b ? a : b;

    private static List<string> UniqueNames(Random rng, int count)
    {
        var firsts = FirstNames.OrderBy(_ => rng.Next()).ToArray();
        var lasts = Surnames.OrderBy(_ => rng.Next()).ToArray();
        var seen = new HashSet<string>();
        var result = new List<string>();
        for (var i = 0; result.Count < count; i++)
        {
            var name = $"{firsts[i % firsts.Length]} {lasts[(i * 7 + i / lasts.Length) % lasts.Length]}";
            if (seen.Add(name)) result.Add(name);
        }
        return result;
    }

    private static List<string> UniquePonies(Random rng, int count)
    {
        var all = SinglePonies
            .Concat(PonyAdjectives.SelectMany(a => PonyNouns.Select(n => $"{a} {n}")))
            .OrderBy(_ => rng.Next()).ToList();
        return all.Take(count).ToList();
    }
}
