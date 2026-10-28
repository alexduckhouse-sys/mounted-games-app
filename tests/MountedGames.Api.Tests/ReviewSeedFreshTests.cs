using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Services;

namespace MountedGames.Api.Tests;

/// <summary>Today's demo event follows the real clock, and the demo events can be removed and made again safely.</summary>
public class ReviewSeedFreshTests
{
    private static readonly DateTime Today = new(2030, 6, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly string[] DemoNames = ReviewCompetitionSeeder.EventNames.ToArray();

    private static async Task<AppDbContext> Database()
    {
        // The model's own keys, with foreign keys on: a removal in the wrong order fails here.
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite("Data Source=:memory:").Options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        return db;
    }

    private static async Task<Competition> LoadMeadowAsync(AppDbContext db)
    {
        db.ChangeTracker.Clear();
        return await db.Competitions
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results)
            .SingleAsync(c => c.Name == "EGUK Winter Pairs Series — Round 1");
    }

    [Theory]
    [InlineData(14, 23)]
    [InlineData(9, 0)]
    [InlineData(0, 10)]
    [InlineData(23, 50)]
    public async Task TodaysEventIsAnchoredToNow(int hour, int minute)
    {
        await using var db = await Database();
        var now = Today.AddHours(hour).AddMinutes(minute).AddSeconds(41);
        await ReviewCompetitionSeeder.SeedAsync(db, Today, now);
        var meadow = await LoadMeadowAsync(db);

        var running = meadow.Sessions.Where(s => s.Status == SessionStatus.InArena).ToList();
        var finished = meadow.Sessions.Where(s => s.Status == SessionStatus.Finished).ToList();
        var upcoming = meadow.Sessions.Where(s => s.Status == SessionStatus.Upcoming).ToList();
        var live = Assert.Single(running);
        Assert.Single(finished);
        Assert.NotEmpty(upcoming);

        // Started about 30 minutes ago, on a five-minute mark.
        Assert.Equal(0, live.StartedAt!.Value.Minute % 5);
        Assert.Equal(0, live.StartedAt.Value.Second);
        Assert.InRange((now - live.StartedAt.Value).TotalMinutes, 30, 35);
        Assert.Equal(live.ScheduledStart, live.StartedAt);
        Assert.All(upcoming, s => Assert.True(s.ScheduledStart >= now, $"{s.Name} starts {s.ScheduledStart}"));
        Assert.All(upcoming, s => Assert.Equal(0, s.ScheduledStart!.Value.Minute % 5));

        // The finished session ended before the running one began.
        var done = finished.Single();
        Assert.True(done.FinishedAt <= live.StartedAt);
        Assert.Equal(done.Heats.Max(h => h.FinishedAt), done.FinishedAt);
        Assert.All(done.Heats.SelectMany(h => h.Races), r => Assert.True(r.IsComplete && r.FinishedAt <= done.FinishedAt));

        // The running session is halfway scored, with every scored race in the past.
        var races = live.Heats.SelectMany(h => h.Races).ToList();
        Assert.Contains(races, r => r.IsComplete);
        Assert.Contains(races, r => !r.IsComplete);
        Assert.All(races.Where(r => r.IsComplete), r =>
        {
            Assert.NotEmpty(r.Results);
            Assert.True(r.FinishedAt <= now);
        });
        Assert.All(races.Where(r => !r.IsComplete), r => Assert.Empty(r.Results));
        Assert.All(live.Heats, h => Assert.Null(h.FinishedAt));
        Assert.All(upcoming.SelectMany(s => s.Heats), h =>
        {
            Assert.Null(h.StartedAt);
            Assert.True(h.ScheduledStart >= now);
        });

        // In each arena: finished or running first, then upcoming in order, one after another.
        foreach (var arena in meadow.Sessions.GroupBy(s => s.ArenaName))
        {
            var inOrder = arena.OrderBy(s => s.OrderIndex).ToList();
            for (var i = 1; i < inOrder.Count; i++)
            {
                var before = inOrder[i - 1];
                var after = inOrder[i];
                Assert.True(after.ScheduledStart >= before.ScheduledStart!.Value.AddMinutes(before.Heats.Count * 35),
                    $"{arena.Key}: {after.Name} overlaps {before.Name}");
                Assert.True(before.Status <= after.Status || before.Status == SessionStatus.Finished
                    || (before.Status == SessionStatus.InArena && after.Status == SessionStatus.Upcoming));
            }
            var arenaRunning = inOrder.Where(s => s.Status == SessionStatus.InArena).ToList();
            foreach (var r in arenaRunning)
                Assert.All(inOrder.Where(s => s.Status == SessionStatus.Upcoming), u =>
                {
                    Assert.True(r.OrderIndex < u.OrderIndex);
                    Assert.True(r.ScheduledStart < u.ScheduledStart);
                });
        }

        // The event itself spans its timetable.
        var first = meadow.Sessions.Min(s => s.ScheduledStart)!.Value;
        var last = meadow.Sessions.Max(s => s.ScheduledStart!.Value.AddMinutes(s.Heats.Count * 35));
        Assert.True(meadow.StartDate <= first);
        Assert.True(meadow.EndDate >= last);
    }

    [Fact]
    public async Task OtherEventsAndTheUnanchoredSeedKeepTheirTimes()
    {
        await using var db = await Database();
        var now = Today.AddHours(15);
        await ReviewCompetitionSeeder.SeedAsync(db, Today, now);
        db.ChangeTracker.Clear();
        var clover = await db.Competitions.Include(c => c.Sessions).SingleAsync(c => c.Name == "Midlands Series — Open & Pairs");
        Assert.Equal(Today.AddDays(3).AddHours(9), clover.Sessions.Min(s => s.ScheduledStart));
        Assert.All(clover.Sessions, s => Assert.Equal(SessionStatus.Upcoming, s.Status));

        await using var plain = await Database();
        await ReviewCompetitionSeeder.SeedAsync(plain, Today);
        var meadow = await LoadMeadowAsync(plain);
        Assert.Equal(Today.AddHours(9), meadow.Sessions.Min(s => s.ScheduledStart));
        Assert.Equal(Today.AddHours(9 + 80d / 60), meadow.Sessions.Single(s => s.Status == SessionStatus.InArena).StartedAt);
        Assert.Equal(Today.AddHours(9), meadow.StartDate);
    }

    [Fact]
    public async Task ReseedVariesTheFinalOptionsAcrossTheDemoAgeGroups()
    {
        await using var db = await Database();
        await ReviewCompetitionSeeder.SeedAsync(db, Today, Today.AddHours(10));
        await ReviewCompetitionSeeder.ReseedAsync(db, Today.AddHours(11));

        var sections = await db.CompetitionSections.AsNoTracking().ToListAsync();
        Assert.Equal(24, sections.Count);
        Assert.Contains(sections, s => s.HasFinal && s.CarryPointsIntoFinal && !s.DoublePointsInFinal);
        Assert.Contains(sections, s => s.HasFinal && !s.CarryPointsIntoFinal && !s.DoublePointsInFinal);
        Assert.Contains(sections, s => s.HasFinal && s.CarryPointsIntoFinal && s.DoublePointsInFinal);
        Assert.Contains(sections, s => s.HasFinal && !s.CarryPointsIntoFinal && s.DoublePointsInFinal);
        Assert.Contains(sections, s => !s.HasFinal);
        // A section with no final has no finals session; the others have an "A Final" heat.
        foreach (var section in sections)
        {
            var labels = await db.Heats.Where(h => h.Session!.CompetitionSectionId == section.Id).Select(h => h.Label).ToListAsync();
            Assert.Equal(section.HasFinal, labels.Contains("A Final"));
        }
    }

    [Fact]
    public async Task ReseedReplacesTheEightDemoEventsAndWorksTwiceInARow()
    {
        await using var db = await Database();
        await ReviewCompetitionSeeder.SeedAsync(db, Today, Today.AddHours(10));
        var firstIds = await db.Competitions.Select(c => c.Id).ToListAsync();
        Assert.Equal(8, firstIds.Count);

        var first = await ReviewCompetitionSeeder.ReseedAsync(db, Today.AddHours(11));
        Assert.Equal(8, first.Removed);
        Assert.Equal(8, first.Created);
        Assert.Empty(first.Skipped);
        var secondIds = await db.Competitions.Select(c => c.Id).ToListAsync();
        Assert.Equal(8, secondIds.Count);
        Assert.Empty(secondIds.Intersect(firstIds));
        Assert.Equal(DemoNames.OrderBy(n => n), await db.Competitions.Select(c => c.Name).OrderBy(n => n).ToListAsync());
        Assert.Equal(8, await db.Set<EventCommerceSettings>().CountAsync(x => x.IsDemo));

        var again = await ReviewCompetitionSeeder.ReseedAsync(db, Today.AddHours(12));
        Assert.Equal(8, again.Removed);
        Assert.Equal(8, again.Created);
        Assert.Equal(8, await db.Competitions.CountAsync());
        // Nothing left from the first generations: exactly one graph per event.
        Assert.Equal(8, await db.Set<EventCommerceSettings>().CountAsync());
        var liveIds = await db.Competitions.Select(c => c.Id).ToListAsync();
        Assert.All(await db.Teams.Select(t => t.CompetitionId).Distinct().ToListAsync(), id => Assert.Contains(id, liveIds));
        Assert.All(await db.Sessions.Select(t => t.CompetitionId).Distinct().ToListAsync(), id => Assert.Contains(id, liveIds));
        var meadow = await LoadMeadowAsync(db);
        Assert.Equal(Today.AddHours(12).AddMinutes(-30), meadow.Sessions.Single(s => s.Status == SessionStatus.InArena).StartedAt);
    }

    [Fact]
    public async Task ReseedLeavesEverythingElseAlone()
    {
        await using var db = await Database();
        var club = new Club { Name = "Real club", Region = "Somewhere" };
        // Looks like a demo event but has no demo mark; another is marked but not one of the seeder names.
        var lookAlike = new Competition { Name = "EGUK Winter Pairs Series — Round 1", StartDate = Today, Description = "A real event" };
        var otherDemo = new Competition { Name = "EGUK Winter Pairs Series — Round 1 (copy)", StartDate = Today };
        var ordinary = new Competition { Name = "Spring Show", StartDate = Today.AddDays(5) };
        var section = new CompetitionSection { Competition = ordinary, AgeGroup = "U12", DisplayName = "U12", Format = SectionFormat.Teams, PriceMinor = 1000 };
        var teamA = new Team { Competition = ordinary, Section = section, Club = club, DisplayName = "A", Suffix = "1" };
        var teamB = new Team { Competition = ordinary, Section = section, Club = club, DisplayName = "B", Suffix = "2" };
        var session = new Session { Competition = ordinary, Section = section, Name = "Heats", ArenaName = "Main", OrderIndex = 1 };
        var heat = new Heat { Session = session, Label = "Heat 1", OrderIndex = 1 };
        var race = new Race { Heat = heat, Name = "Two Flag", OrderIndex = 1, IsComplete = true };
        heat.Races.Add(race);
        session.Heats.Add(heat);
        db.AddRange(lookAlike, otherDemo, ordinary, section, teamA, teamB, session);
        db.Set<HeatEntry>().AddRange(new HeatEntry { Heat = heat, Team = teamA, LaneIndex = 1 }, new HeatEntry { Heat = heat, Team = teamB, LaneIndex = 2 });
        db.Results.AddRange(new Result { Race = race, Team = teamA, Placing = 1, Points = 2 }, new Result { Race = race, Team = teamB, Placing = 2, Points = 1 });
        db.SectionSignups.Add(new SectionSignup { Section = section, FullName = "Real person", AmountMinor = 1000 });
        db.ChatMessages.Add(new ChatMessage { Competition = ordinary, AuthorName = "Someone", Body = "Hello" });
        db.Set<EventCommerceSettings>().Add(new EventCommerceSettings { Competition = otherDemo, IsDemo = true });
        db.Set<EventCommerceSettings>().Add(new EventCommerceSettings { Competition = ordinary, IsDemo = false });
        await db.SaveChangesAsync();
        var lookAlikeId = lookAlike.Id;

        var result = await ReviewCompetitionSeeder.ReseedAsync(db, Today.AddHours(10));

        Assert.Equal(0, result.Removed);
        Assert.Equal(7, result.Created); // the look-alike's name is taken, so only seven are made
        Assert.Equal(new[] { "EGUK Winter Pairs Series — Round 1" }, result.Skipped);
        db.ChangeTracker.Clear();
        var kept = await db.Competitions.SingleAsync(c => c.Id == lookAlikeId);
        Assert.Equal("A real event", kept.Description);
        // Not even given the demo mark.
        Assert.False(await db.Set<EventCommerceSettings>().AnyAsync(x => x.CompetitionId == lookAlikeId));
        Assert.True(await db.Competitions.AnyAsync(c => c.Name == "EGUK Winter Pairs Series — Round 1 (copy)"));
        Assert.True(await db.Set<EventCommerceSettings>().AnyAsync(x => x.CompetitionId == otherDemo.Id && x.IsDemo));
        Assert.Equal(2, await db.Teams.CountAsync(t => t.CompetitionId == ordinary.Id));
        Assert.Equal(2, await db.Results.CountAsync(r => r.Race!.Heat!.Session!.CompetitionId == ordinary.Id));
        Assert.Equal(1, await db.SectionSignups.CountAsync(s => s.CompetitionSectionId == section.Id));
        Assert.Equal(1, await db.ChatMessages.CountAsync(m => m.CompetitionId == ordinary.Id));
        Assert.Equal(1, await db.Clubs.CountAsync(c => c.Name == "Real club"));

        // And a second run, with the demo events now present, still touches only them.
        var next = await ReviewCompetitionSeeder.ReseedAsync(db, Today.AddHours(11));
        Assert.Equal(7, next.Removed);
        Assert.Equal(7, next.Created);
        Assert.Equal(2, await db.Teams.CountAsync(t => t.CompetitionId == ordinary.Id));
        Assert.Equal(lookAlikeId, (await db.Competitions.SingleAsync(c => c.Name == "EGUK Winter Pairs Series — Round 1")).Id);
    }

    [Fact]
    public async Task RemovalCopesWithEverythingThatCanHangOffADemoEvent()
    {
        await using var db = await Database();
        var user = new AppUser { UserName = "organiser@example.test", Email = "organiser@example.test", FullName = "Organiser" };
        var seller = new AppUser { UserName = "seller@example.test", Email = "seller@example.test", FullName = "Seller" };
        db.Users.AddRange(user, seller);
        var item = new CatalogueItem { Seller = seller, Title = "Hay", Description = "A bale", PriceMinor = 500, StockQuantity = 7 };
        var size = new CatalogueItemOption { Label = "Large bale", StockQuantity = 3 };
        item.Options.Add(size);
        db.Set<CatalogueItem>().Add(item);
        await db.SaveChangesAsync();
        await ReviewCompetitionSeeder.SeedAsync(db, Today, Today.AddHours(10));

        var targets = await db.Competitions.Include(c => c.Teams).Include(c => c.Sections)
            .Include(c => c.Sessions).ThenInclude(s => s.Heats).ThenInclude(h => h.Races)
            .Where(c => c.Name == "EGUK Winter Pairs Series — Round 1" || c.Name == "End of Season Championships").ToListAsync();
        db.Set<Rulebook>().Add(new Rulebook { Title = "Rules", Edition = "1", Text = "Shared rules" });
        foreach (var competition in targets)
        {
            var section = competition.Sections.First();
            var team = competition.Teams.First(t => t.CompetitionSectionId == section.Id);
            var heat = competition.Sessions.SelectMany(s => s.Heats).First();
            var race = heat.Races.First();
            var form = new DeclarationForm { Team = team, SubmittedByUserId = user.Id, Riders = { new RiderEntry { FullName = "Rider One", IsCaptain = true }, new RiderEntry { FullName = "Rider Two", IsReserve = true } } };
            db.AddRange(form);
            var signup = new SectionSignup { Section = section, FullName = "Synthetic entrant", AmountMinor = 1500, TeamId = team.Id };
            db.SectionSignups.Add(signup);
            db.ScorerLinks.Add(new ScorerLink { Competition = competition, Label = "Gate", ArenaName = "Demo main arena", TokenHash = Guid.NewGuid().ToString("N"), CreatedByUserId = user.Id, CreatedAt = Today, ExpiresAt = Today.AddDays(2) });
            db.Set<TeamStatusEvent>().Add(new TeamStatusEvent { CompetitionId = competition.Id, Team = team, Status = TeamEntryStatus.Withdrawn, Reason = "Lame horse" });
            db.ChatMessages.Add(new ChatMessage { Competition = competition, AuthorName = "Steward", Body = "Welcome" });
            var sponsor = new Sponsor { Competition = competition, Name = "Acme Feeds", ShowOn = SponsorPlacement.Details, CreatedAt = Today, UpdatedAt = Today };
            db.Sponsors.Add(sponsor);
            db.SponsorExposures.Add(new SponsorExposure { Sponsor = sponsor, Day = Today, Placement = SponsorPlacement.Details, Views = 3 });
            db.SpecialAwards.Add(new SpecialAward { Competition = competition, Section = section, Title = "Best turned out", Recipient = team.DisplayName });
            db.FinalsTieOrders.Add(new FinalsTieOrder { Competition = competition, Team = team, Points = 10, Position = 1 });
            db.CompetitionCollaborators.Add(new CompetitionCollaborator { Competition = competition, UserId = user.Id, AddedByUserId = user.Id, AddedAt = Today });
            db.TeamSupporters.Add(new TeamSupporter { Team = team, UserId = user.Id });
            db.Set<EquipmentAcknowledgement>().Add(new EquipmentAcknowledgement { Competition = competition, ItemKey = "flags" });
            db.Set<DrawChange>().Add(new DrawChange { CompetitionId = competition.Id, SectionId = section.Id, Kind = DrawChangeKind.SectionDraw, RequestId = Guid.NewGuid().ToString() });
            db.Set<CalendarHeatVersion>().Add(new CalendarHeatVersion { HeatId = heat.Id, TeamId = team.Id, Fingerprint = "x" });
            db.Set<RaceScoreState>().Add(new RaceScoreState { Race = race, Revision = 1 });
            db.Set<RaceScoreEvent>().Add(new RaceScoreEvent { Race = race, Revision = 1, Kind = RaceScoreEventKind.ResultsRecorded, RequestId = Guid.NewGuid().ToString() });
            db.Set<Protest>().Add(new Protest { Competition = competition, HeatId = heat.Id, Race = race, RaisedByTeam = team, Reason = "Missed a flag", RequestId = Guid.NewGuid().ToString() });
            db.Set<Protest>().Add(new Protest { Competition = competition, HeatId = heat.Id, Reason = "Whole heat restarted late", Status = ProtestStatus.Dismissed, Decision = "No effect", RequestId = Guid.NewGuid().ToString() });
            db.LiveStreams.Add(new LiveStream { Competition = competition, ArenaName = "Demo main arena", StartedByUserId = user.Id, StartedAt = Today, LastHeartbeatAt = Today });
            db.StreamOverlays.Add(new StreamOverlay { Competition = competition, UpdatedAt = Today });
            var listing = new CompetitionListing { Competition = competition, CatalogueItemId = item.Id, SellerUserId = seller.Id };
            db.Set<CompetitionListing>().Add(listing);
            var order = new EventOrder { Competition = competition, BuyerUserId = user.Id, IdempotencyKey = Guid.NewGuid().ToString(), RequestHash = "h", Status = CommerceOrderStatus.Paid, TotalMinor = 1000, HasStockReservation = true };
            order.Lines.Add(new EventOrderLine { CatalogueItemId = item.Id, SellerUserId = seller.Id, TitleSnapshot = "Hay", Quantity = 2, UnitPriceMinorSnapshot = 500, LineTotalMinor = 1000, ReservedStockQuantity = 2,
                CatalogueItemOptionId = size.Id, OptionLabel = size.Label, ReservedOptionStockQuantity = 2 });
            order.TestPayments.Add(new TestPaymentRecord { CompetitionId = competition.Id, OwnerUserId = user.Id, IdempotencyKey = Guid.NewGuid().ToString(), AmountMinor = 1000 });
            db.Set<EventOrder>().Add(order);
            var tack = new TackCheckSection { Competition = competition, Section = section, IsEnabled = true, Mode = TackCheckMode.BonusPoints };
            tack.Sectors.Add(new TackCheckSector { Name = "Bit", Marks = { new TackCheckMark { Team = team, Points = 4 } } });
            db.Add(tack);
            db.Add(new PassportCheck { Competition = competition, Team = team, PonyName = "Bramble", PonyKey = "bramble" });
            var vShift = new VolunteerShift { Competition = competition, Role = "Arena Party", RequiredCount = 2 };
            db.VolunteerShifts.Add(vShift);
            await db.SaveChangesAsync();
            db.VolunteerClaims.Add(new VolunteerClaim { ShiftId = vShift.Id, UserId = user.Id, VolunteerName = "Sam Volunteer" });
            db.Add(new SignupMatchmaking { SignupId = signup.Id, LookingForPair = true });
            db.Add(new SignupExtras { SignupId = signup.Id, StablesCount = 2 });
            db.Add(new SignupGuestDetails { SignupId = signup.Id, RiderName = "Synthetic guest rider", GuardianName = "Synthetic parent", GuardianPhone = "07700900123" });
            db.Add(new CompetitionEntrySettings { CompetitionId = competition.Id, EntriesCloseAt = Today });
            db.Add(new CompetitionDeclarationLock { CompetitionId = competition.Id, DeclarationsCloseAt = Today });
            db.Set<RiderSwapEvent>().Add(new RiderSwapEvent { CompetitionId = competition.Id, DeclarationFormId = form.Id, TeamId = team.Id, OutRiderEntryId = 1, InRiderEntryId = 2, RequestId = Guid.NewGuid().ToString() });
            await db.SaveChangesAsync();
        }
        db.ChangeTracker.Clear();

        var removed = await ReviewCompetitionSeeder.RemoveReviewCompetitionsAsync(db);

        Assert.Equal(8, removed);
        Assert.Empty(await db.Competitions.ToListAsync());
        Assert.Empty(await db.Sessions.ToListAsync());
        Assert.Empty(await db.Heats.ToListAsync());
        Assert.Empty(await db.Races.ToListAsync());
        Assert.Empty(await db.Results.ToListAsync());
        Assert.Empty(await db.Teams.ToListAsync());
        Assert.Empty(await db.CompetitionSections.ToListAsync());
        Assert.Empty(await db.SectionSignups.ToListAsync());
        Assert.Empty(await db.Set<SignupMatchmaking>().ToListAsync());
        Assert.Empty(await db.Set<SignupExtras>().ToListAsync());
        Assert.Empty(await db.Set<SignupGuestDetails>().ToListAsync());
        Assert.Empty(await db.Set<CompetitionEntrySettings>().ToListAsync());
        Assert.Empty(await db.Set<CompetitionDeclarationLock>().ToListAsync());
        Assert.Empty(await db.DeclarationForms.ToListAsync());
        Assert.Empty(await db.RiderEntries.ToListAsync());
        Assert.Empty(await db.ScorerLinks.ToListAsync());
        Assert.Empty(await db.Sponsors.ToListAsync());
        Assert.Empty(await db.SponsorExposures.ToListAsync());
        Assert.Empty(await db.SpecialAwards.ToListAsync());
        Assert.Empty(await db.FinalsTieOrders.ToListAsync());
        Assert.Empty(await db.ChatMessages.ToListAsync());
        Assert.Empty(await db.CompetitionCollaborators.ToListAsync());
        Assert.Empty(await db.LiveStreams.ToListAsync());
        Assert.Empty(await db.StreamOverlays.ToListAsync());
        Assert.Empty(await db.Set<TeamStatusEvent>().ToListAsync());
        Assert.Empty(await db.Set<EventOrder>().ToListAsync());
        Assert.Empty(await db.Set<EventOrderLine>().ToListAsync());
        Assert.Empty(await db.Set<TestPaymentRecord>().ToListAsync());
        Assert.Empty(await db.Set<CompetitionListing>().ToListAsync());
        Assert.Empty(await db.Set<EventCommerceSettings>().ToListAsync());
        Assert.Empty(await db.Set<DrawChange>().ToListAsync());
        Assert.Empty(await db.Set<RaceScoreState>().ToListAsync());
        Assert.Empty(await db.Set<RaceScoreEvent>().ToListAsync());
        Assert.Empty(await db.Set<Protest>().ToListAsync());
        Assert.Empty(await db.Set<CalendarHeatVersion>().ToListAsync());
        Assert.Empty(await db.Set<RiderSwapEvent>().ToListAsync());
        Assert.Empty(await db.Set<TackCheckMark>().ToListAsync());
        Assert.Empty(await db.Set<TackCheckSector>().ToListAsync());
        Assert.Empty(await db.Set<TackCheckSection>().ToListAsync());
        Assert.Empty(await db.Set<PassportCheck>().ToListAsync());
        Assert.Empty(await db.VolunteerShifts.ToListAsync());
        Assert.Empty(await db.VolunteerClaims.ToListAsync());
        // Rulebooks are shared by every competition, so a reseed leaves them alone.
        Assert.Equal("Rules", (await db.Set<Rulebook>().SingleAsync()).Title);
        Assert.Empty(await db.Set<EquipmentAcknowledgement>().ToListAsync());
        // The two orders' held stock went back to the seller's item; the item and both users stay.
        Assert.Equal(7 + 2 * 2, (await db.Set<CatalogueItem>().SingleAsync()).StockQuantity);
        // ...and to the option each line was for.
        Assert.Equal(3 + 2 * 2, (await db.Set<CatalogueItemOption>().SingleAsync()).StockQuantity);
        Assert.Equal(2, await db.Users.CountAsync());
        Assert.Equal(0, await ReviewCompetitionSeeder.RemoveReviewCompetitionsAsync(db));
    }

    [Fact]
    public async Task RemovalRefusesWhenADemoEventIsInASeason()
    {
        await using var db = await Database();
        await ReviewCompetitionSeeder.SeedAsync(db, Today, Today.AddHours(10));
        var competition = await db.Competitions.Include(c => c.Sections).FirstAsync(c => c.Name == "EGUK Winter Pairs Series — Round 1");
        var owner = new AppUser { UserName = "owner@example.test", Email = "owner@example.test", FullName = "Owner" };
        var season = new Season { Owner = owner, Title = "League", Year = 2030, AgeGroup = "Seniors" };
        db.Set<Season>().Add(season);
        db.Set<SeasonRound>().Add(new SeasonRound { SeasonId = season.Id, CompetitionId = competition.Id, CompetitionSectionId = competition.Sections.First().Id });
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() => ReviewCompetitionSeeder.RemoveReviewCompetitionsAsync(db));

        Assert.Equal(8, await db.Competitions.CountAsync());
    }
}
