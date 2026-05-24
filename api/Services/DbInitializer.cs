using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

public static class DbInitializer
{
    public static async Task SeedAsync(IServiceProvider sp)
    {
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();

        await db.Database.EnsureCreatedAsync();

        // For new tables added after the DB was first created, EnsureCreated is a no-op.
        // Make the schema additive by running CREATE TABLE IF NOT EXISTS for those.
        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS ""RaceTemplates"" (
                ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_RaceTemplates"" PRIMARY KEY AUTOINCREMENT,
                ""Name"" TEXT NOT NULL,
                ""Summary"" TEXT NULL,
                ""Rules"" TEXT NULL,
                ""Category"" TEXT NULL,
                ""DiagramJson"" TEXT NULL,
                ""IsBuiltIn"" INTEGER NOT NULL DEFAULT 0,
                ""CreatedAt"" TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS ""IX_RaceTemplates_Name"" ON ""RaceTemplates"" (""Name"");
        ");
        await EnsureColumnAsync(db, "Teams", "IsHorsConcours", "INTEGER NOT NULL DEFAULT 0");
        await EnsureColumnAsync(db, "ChatMessages", "IpAddress", "TEXT NULL");
        await EnsureColumnAsync(db, "Competitions", "StreamUrl", "TEXT NULL");

        foreach (var r in Roles.All)
        {
            if (!await roles.RoleExistsAsync(r))
                await roles.CreateAsync(new IdentityRole(r));
        }

        await SeedRaceTemplatesAsync(db);

        // Canonical UK Pony Clubs list. Add only — never delete clubs that already exist
        // in the DB (they may be referenced by teams or saved riders).
        var presetClubs = new[]
        {
            "Albrighton Hunt", "Albrighton Woodland Hunt", "Amman Valley & District", "Anglesey",
            "Angus", "Argyll South", "Ashford Valley", "Atherstone", "Avon Vale", "Axe Vale Hunt",
            "Badsworth Hunt", "Banwell", "Banwen & District", "Barlow Hunt", "Beaufort Hunt",
            "Bedale & West of Yore Hunt", "Bedfordshire South", "Belvoir Hunt", "Bennachie",
            "Berkeley Hunt", "Berkeley South", "Berwickshire Hunt", "Berwyn & Dee",
            "Bicester & Warden Hill Hunt", "Bisley and Sandown Chase", "Blackburn & District",
            "Blackmore & Sparkford Vale", "Blankney Hunt", "Braes of Derwent South",
            "Bramham Moor Hunt", "Brecon & Talybont", "Brocklesby Hunt", "Burghley", "Burton",
            "Burton Cheshire Forest", "Caithness", "Cambridgeshire Hunt", "Carmarthen Bay",
            "Cattistock Hunt", "Cheshire Hunt North", "Cheshire Hunt South", "Chiddingfold",
            "Chiddingfold Farmers", "Chipping", "Cleveland Hunt", "Cobham and Wimbledon",
            "Cotley Hunt", "Cotswold", "Cotswold Vale Farmers’ Hunt", "Cottesmore Hunt",
            "Cowdray Hunt", "Craven Hunt", "Crawley & Horsham Hunt", "Crawley & Horsham Hunt South",
            "Crickhowell & District", "Croome Hunt", "Cumberland Farmers Hunt North",
            "Cumberland Farmers’ Hunt (South)", "Cumberland Foxhounds", "Curre Hunt", "Cury Hunt",
            "Dalkeith & District", "Dare Valley", "Dartmoor", "Deeside", "Derwent Hunt", "Deveron",
            "Devon & Somerset", "Dinas Powys", "Dolgellau & District", "Duke of Buccleuch’s Hunt",
            "Dulverton West Foxhounds (North Molton) Hunt", "Dumfriesshire Hunt",
            "Dwyfor and Gwynedd", "East Aberdeenshire (Buchan)", "East Antrim", "East Cheshire",
            "East Cornwall", "East Devon Hunt", "East Down", "East Essex", "East Hertfordshire Hunt",
            "East Kent Hunt", "East Lothian", "East Stirlingshire", "East Sussex",
            "Easton Harriers Hunt", "Edinburgh", "Eggesford Hunt", "Eglinton Hunt",
            "Enfield Chace Hunt", "Eridge", "Eskdale", "Essex & Suffolk Hunt", "Essex Farmers",
            "Essex Hunt North", "Essex Union", "Essex Union South", "Fermanagh Harriers",
            "Fernie Hunt", "Fife", "Fitzwilliam Hunt", "Flamstead", "Flint & Denbigh Hunt",
            "Four Burrow", "Furness & District", "Fylde & District", "Galloway", "Garth Hunt",
            "Garth South", "Glaisdale Hunt", "Glamorgan Hunt", "Glenrothes", "Glossop & District",
            "Gogerddan", "Golden Valley", "Goodwood", "Grafton Hunt", "Grove", "Guernsey",
            "Hambledon Hunt (North)", "Hampshire Hunt", "Haydock Park", "Heart of England",
            "Hertfordshire Hunt", "Heythrop Hunt", "High Peak Hunt", "Holcombe Hunt",
            "Holderness Hunt", "Hursley Hunt", "Hurworth Hunt", "Inverness-shire", "Isle of Man",
            "Isle of Mull", "Isle of Wight", "Isles of Scilly", "Iveagh", "Ivel Valley",
            "Jersey Drag Hunt", "Kenfig Hill", "Kent Border",
            "Killultagh Old Rock & Chichester Harriers", "Kincardineshire", "Lamerton Hunt",
            "Lanark & Upperward", "Lanarkshire & Renfrewshire Hunt", "Lancaster & District",
            "Lauderdale Hunt", "Ledbury Hunt", "Linlithgow & Stirlingshire", "Llandeilo & District",
            "Llangeinor Hunt", "Lord Leconfield Hunt", "Ludlow Hunt", "Malvern", "Mendip Farmers",
            "Meynell", "Mid Antrim", "Mid Devon Hunt", "Mid Surrey", "Middleton Hunt",
            "Middleton Hunt (East Side)", "Minchinhampton", "Monmouthshire", "Moray & Nairn",
            "Morpeth Hunt", "Neath", "New Forest Hunts", "Newcastle & North Durham",
            "Newmarket & Thurlow Hunt", "Nithsdale", "North Argyll", "North Cornwall",
            "North Cotswold Hunt", "North Derry", "North Down", "North Herefordshire",
            "North Norfolk", "North Northumberland Hunt", "North Shropshire Hunt",
            "North Staffordshire Hunt", "North Warwickshire", "Oakley Hunt North",
            "Oakley Hunt West", "Old Berkeley Hunt (Chilterns)", "Old Berkeley Hunt (Hughenden)",
            "Old Berkeley Hunt (North)", "Old Berkeley Hunt (South)", "Old Berkshire Hunt",
            "Old Surrey & Burstow Hunt", "Orkney", "Oxenholme", "Parc Howard", "Peak",
            "Peebles Tweeddale", "Pembrokeshire Hunt", "Pendle Forest & Craven", "Pentyrch",
            "Percy Hunt", "Perth Hunt", "Petersfield", "Polden Hills", "Poole & District",
            "Portman", "Puckeridge Hunt", "Puckeridge Hunt Western", "Pytchley Hunt",
            "Quantock Hunt", "Quorn Hunt", "Radnor & West Hereford Hunt", "Rockwood Harriers",
            "Romney Marsh", "Ross-shire", "Route Hunt", "Royal Artillery", "Rufford Hunt",
            "Ryburn Valley", "Saddleworth & District", "Scunthorpe & District", "Seavington",
            "Sennybridge & District", "Seskinore Harriers", "Silverton Hunt", "Sinnington Hunt",
            "Soham & District", "South & West Wilts Hunt", "South Berkshire",
            "South Devon Hunt (Moorland)", "South Devon West", "South Dorset Hunt",
            "South Durham Hunt", "South Hereford and Ross Harriers", "South Hertfordshire",
            "South Norfolk", "South Northumberland", "South Nottinghamshire",
            "South Oxfordshire Hunt (South)", "South Oxfordshire Hunt Central",
            "South Pembrokeshire & Cresselly Hunt", "South Pool", "South Shropshire Hunt",
            "South Staffordshire Hunt", "South Trent", "South Wold Hunt North",
            "Southdown Hunt (East)", "Southdown West", "Spooners & West Dartmoor",
            "Staff College & Sandhurst", "Staintondale Hunt",
            "Stevenstone & Torrington Farmers Hunt", "Stewartry", "Strathblane & District",
            "Strathearn", "Stroud", "Suffolk", "Surrey Union", "Swansea & District", "Syston",
            "Tanatside Hunt", "Taunton Vale", "Taunton Vale Harriers", "Tedworth Hunt",
            "Teme Valley Hunt", "Tetcott & South Tetcott Hunts", "The Wynnstay", "Thetford Chase",
            "Tickham", "Tiverton Hunt", "Tivyside", "Tredegar Farmers Hunt", "Tullylagan",
            "Tynedale Hunt", "United Pack", "Vale of Aylesbury Hunt", "Vale of Clettwr",
            "Vale of Taf", "Vale of York", "Vine", "VWH Hunt", "Waen-y-Llyn", "Walpole & District",
            "Warwickshire Hunt", "Waveney Harriers", "West Hants", "West Kent (Sevenoaks)",
            "West Kent Meopham", "West Lancashire County", "West Lancashire Ince Blundell",
            "West Midlands", "West Norfolk", "West Perthshire", "West Somerset",
            "West Warwickshire", "Western", "Western Isles", "Weston Harriers Hunt",
            "Whaddon Chase", "Wheatland Hunt", "Wheelton & District", "Wilton Hunt", "Wokingham",
            "Woodland Hunt", "Woodland Pytchley Hunt", "Worcestershire Hunt", "Wylye Valley",
            "Wyndham", "Wyre Forest", "Ynysybwl",
        };
        var existingClubNames = await db.Clubs.Select(c => c.Name).ToListAsync();
        var existingSet = existingClubNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var toAdd = presetClubs
            .Where(name => !existingSet.Contains(name))
            .Select(name => new Club { Name = name })
            .ToList();
        if (toAdd.Count > 0)
        {
            db.Clubs.AddRange(toAdd);
            await db.SaveChangesAsync();
        }

        var admin = await users.FindByEmailAsync("admin@mg.local");
        if (admin is null)
        {
            admin = new AppUser
            {
                UserName = "admin@mg.local",
                Email = "admin@mg.local",
                FullName = "Demo Admin",
                EmailConfirmed = true
            };
            await users.CreateAsync(admin, "Admin!234");
            await users.AddToRoleAsync(admin, Roles.Admin);
        }

        // Demo data references real clubs from the preset list above.
        var warwickshire = await db.Clubs.FirstAsync(c => c.Name == "Warwickshire Hunt");
        var cotswold = await db.Clubs.FirstAsync(c => c.Name == "Cotswold");

        var trainer1 = await users.FindByEmailAsync("trainer@mg.local");
        if (trainer1 is null)
        {
            trainer1 = new AppUser
            {
                UserName = "trainer@mg.local",
                Email = "trainer@mg.local",
                FullName = "Jamie Carter",
                PhoneNumber = "07700 900123",
                ClubId = warwickshire.Id,
                EmailConfirmed = true
            };
            await users.CreateAsync(trainer1, "Trainer!234");
            await users.AddToRoleAsync(trainer1, Roles.Trainer);
        }

        var trainer2 = await users.FindByEmailAsync("coach@mg.local");
        if (trainer2 is null)
        {
            trainer2 = new AppUser
            {
                UserName = "coach@mg.local",
                Email = "coach@mg.local",
                FullName = "Robin Page",
                PhoneNumber = "07700 900456",
                ClubId = cotswold.Id,
                EmailConfirmed = true
            };
            await users.CreateAsync(trainer2, "Trainer!234");
            await users.AddToRoleAsync(trainer2, Roles.Trainer);
        }

        if (!await db.SavedRiders.AnyAsync())
        {
            db.SavedRiders.AddRange(
                new SavedRider { ClubId = warwickshire.Id, FullName = "Olivia Hart", HorseName = "Misty" },
                new SavedRider { ClubId = warwickshire.Id, FullName = "Noah Reed", HorseName = "Sparrow" },
                new SavedRider { ClubId = warwickshire.Id, FullName = "Ava Bell", HorseName = "Captain" },
                new SavedRider { ClubId = warwickshire.Id, FullName = "Leo Frost", HorseName = "Pepper" },
                new SavedRider { ClubId = warwickshire.Id, FullName = "Isla Knight", HorseName = "Biscuit" },
                new SavedRider { ClubId = cotswold.Id, FullName = "Theo Lane", HorseName = "Rocket" },
                new SavedRider { ClubId = cotswold.Id, FullName = "Maya Quinn", HorseName = "Hazel" },
                new SavedRider { ClubId = cotswold.Id, FullName = "Sam Vale", HorseName = "Trigger" });
            await db.SaveChangesAsync();
        }

        if (!await db.Competitions.AnyAsync())
        {
            var comp = new Competition
            {
                Name = "Spring Open 2026",
                Location = "Stoneleigh Park, Warwickshire",
                Description = "Demo competition seeded for the MG app.",
                Latitude = 52.2569,
                Longitude = -1.5398,
                StartDate = DateTime.UtcNow.Date,
                EndDate = DateTime.UtcNow.Date.AddDays(1),
                IsActive = true,
                CreatedByUserId = admin!.Id
            };
            db.Competitions.Add(comp);
            await db.SaveChangesAsync();

            var secPairsU15 = new CompetitionSection
            {
                CompetitionId = comp.Id, Format = SectionFormat.Pairs, AgeGroup = "Under 15",
                DisplayName = "Pairs Under 15"
            };
            var secTeamsU12 = new CompetitionSection
            {
                CompetitionId = comp.Id, Format = SectionFormat.Teams, AgeGroup = "Under 12",
                DisplayName = "Teams Under 12"
            };
            db.CompetitionSections.AddRange(secPairsU15, secTeamsU12);
            await db.SaveChangesAsync();

            var clubs = await db.Clubs.ToListAsync();
            var teams = new List<Team>();
            foreach (var (club, suffix) in new[]
            {
                (warwickshire, "A"), (warwickshire, "B"),
                (cotswold, "A"),
                (clubs.First(c => c.Name == "Cheshire Hunt North"), "A"),
                (clubs.First(c => c.Name == "Surrey Union"), "A"),
                (clubs.First(c => c.Name == "East Lothian"), "A")
            })
            {
                teams.Add(new Team
                {
                    CompetitionId = comp.Id,
                    CompetitionSectionId = secTeamsU12.Id,
                    ClubId = club.Id,
                    Suffix = suffix,
                    DisplayName = $"{club.Name} {suffix}",
                    BibColour = club.BibColour,
                    TrainerUserId = club.Id == warwickshire.Id ? trainer1!.Id
                                  : club.Id == cotswold.Id ? trainer2!.Id
                                  : null
                });
            }
            db.Teams.AddRange(teams);
            await db.SaveChangesAsync();

            var session1 = new Session
            {
                CompetitionId = comp.Id,
                CompetitionSectionId = secTeamsU12.Id,
                Name = "Teams U12 — Morning",
                ArenaName = "Main Arena",
                OrderIndex = 1,
                Status = SessionStatus.InArena,
                StartedAt = DateTime.UtcNow.AddMinutes(-30),
                ScheduledStart = DateTime.UtcNow.AddMinutes(-30)
            };
            var lunchBreak = new Session
            {
                CompetitionId = comp.Id,
                Name = "Lunch break",
                OrderIndex = 2,
                Status = SessionStatus.Upcoming,
                IsBreak = true,
                DurationMinutes = 45,
                ScheduledStart = DateTime.UtcNow.AddHours(2)
            };
            var session2 = new Session
            {
                CompetitionId = comp.Id,
                CompetitionSectionId = secTeamsU12.Id,
                Name = "Teams U12 — Afternoon",
                ArenaName = "Main Arena",
                OrderIndex = 3,
                Status = SessionStatus.Upcoming,
                ScheduledStart = DateTime.UtcNow.AddHours(3)
            };
            var session3 = new Session
            {
                CompetitionId = comp.Id,
                CompetitionSectionId = secPairsU15.Id,
                Name = "Pairs U15 — Heats",
                ArenaName = "Second Arena",
                OrderIndex = 4,
                Status = SessionStatus.Upcoming,
                ScheduledStart = DateTime.UtcNow.AddHours(5)
            };
            db.Sessions.AddRange(session1, lunchBreak, session2, session3);
            await db.SaveChangesAsync();

            var raceNames = new[] { "Bending", "Litter Lifter", "Five Flag", "Stepping Stones", "Tack Shop" };
            var heat1 = new Heat
            {
                SessionId = session1.Id,
                Label = "Heat 1",
                OrderIndex = 1
            };
            db.Heats.Add(heat1);
            await db.SaveChangesAsync();
            var laneIdx = 1;
            foreach (var t in teams)
            {
                db.HeatEntries.Add(new HeatEntry { HeatId = heat1.Id, TeamId = t.Id, LaneIndex = laneIdx++ });
            }
            for (var ri = 0; ri < raceNames.Length; ri++)
            {
                db.Races.Add(new Race
                {
                    HeatId = heat1.Id,
                    Name = raceNames[ri],
                    OrderIndex = ri + 1
                });
            }
            await db.SaveChangesAsync();

            var firstRace = await db.Races
                .OrderBy(r => r.OrderIndex)
                .FirstAsync(r => r.HeatId == heat1.Id);
            var sessionBase = teams.Count;
            var place = 1;
            foreach (var entry in heat1.Entries.OrderBy(e => e.LaneIndex))
            {
                var elim = place == teams.Count;
                db.Results.Add(new Result
                {
                    RaceId = firstRace.Id,
                    TeamId = entry.TeamId,
                    Placing = elim ? null : place,
                    Eliminated = elim,
                    Points = elim ? 0 : sessionBase - place + 1
                });
                place++;
            }
            firstRace.IsComplete = true;
            firstRace.FinishedAt = DateTime.UtcNow.AddMinutes(-15);
            await db.SaveChangesAsync();

            db.ChatMessages.AddRange(
                new ChatMessage
                {
                    CompetitionId = comp.Id,
                    AuthorName = "System",
                    Body = $"Welcome to {comp.Name}! Live updates will appear here.",
                    Type = ChatMessageType.System,
                    Tag = "welcome",
                    CreatedAt = DateTime.UtcNow.AddMinutes(-45)
                },
                new ChatMessage
                {
                    CompetitionId = comp.Id,
                    AuthorName = "Demo Admin",
                    UserId = admin.Id,
                    Body = "Riders please check in at the secretary's tent.",
                    Type = ChatMessageType.Announcement,
                    Tag = "general",
                    CreatedAt = DateTime.UtcNow.AddMinutes(-40)
                },
                new ChatMessage
                {
                    CompetitionId = comp.Id,
                    AuthorName = "System",
                    Body = $"{session1.Name} is now in the arena.",
                    Type = ChatMessageType.System,
                    Tag = "session",
                    CreatedAt = DateTime.UtcNow.AddMinutes(-30)
                });
            await db.SaveChangesAsync();

            var warwickshireA = teams.First(t => t.ClubId == warwickshire.Id && t.Suffix == "A");
            var savedW = await db.SavedRiders.Where(r => r.ClubId == warwickshire.Id).Take(5).ToListAsync();
            var decForm = new DeclarationForm
            {
                TeamId = warwickshireA.Id,
                SubmittedByUserId = trainer1!.Id,
                Notes = "All set for Spring Open."
            };
            var bibs = new[] { "Red", "Yellow", "Blue", "Green", "White" };
            var idx = 0;
            foreach (var sr in savedW)
            {
                decForm.Riders.Add(new RiderEntry
                {
                    SavedRiderId = sr.Id,
                    FullName = sr.FullName,
                    HorseName = sr.HorseName,
                    BibColour = bibs[idx % bibs.Length],
                    OrderIndex = idx,
                    IsCaptain = idx == 0,
                    IsReserve = idx == 4
                });
                idx++;
            }
            db.DeclarationForms.Add(decForm);
            await db.SaveChangesAsync();
        }
    }

    /// <summary>
    /// Adds a column to an existing table if it isn't present yet. Idempotent.
    /// SQLite-only (uses PRAGMA table_info).
    /// </summary>
    private static async Task EnsureColumnAsync(AppDbContext db, string table, string column, string columnDef)
    {
        var conn = db.Database.GetDbConnection();
        await conn.OpenAsync();
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"PRAGMA table_info(\"{table}\");";
            using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var existing = reader.GetString(1);
                if (string.Equals(existing, column, StringComparison.OrdinalIgnoreCase))
                    return;
            }
        }
        finally
        {
            await conn.CloseAsync();
        }
        await db.Database.ExecuteSqlRawAsync($"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" {columnDef};");
    }

    private static async Task SeedRaceTemplatesAsync(AppDbContext db)
    {
        // Marker race exists only in the new canonical seed. If it's missing, we still need
        // to refresh the built-in library: wipe any built-ins (made-up starters from earlier
        // versions) and re-seed from RaceLibrarySeed.
        var hasNewLibrary = await db.RaceTemplates.AnyAsync(r => r.Name == "Two Flag");
        if (!hasNewLibrary)
        {
            var oldBuiltIns = await db.RaceTemplates.Where(r => r.IsBuiltIn).ToListAsync();
            if (oldBuiltIns.Count > 0)
            {
                db.RaceTemplates.RemoveRange(oldBuiltIns);
                await db.SaveChangesAsync();
            }
        }

        var existing = await db.RaceTemplates.Select(r => r.Name).ToListAsync();
        var have = existing.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var toAdd = RaceLibrarySeed.All
            .Where(r => !have.Contains(r.Name))
            .Select(r => new Entities.RaceTemplate
            {
                Name = r.Name,
                Category = r.Category,
                Summary = r.Summary,
                Rules = r.Rules,
                DiagramJson = r.DiagramJson,
                IsBuiltIn = true,
            })
            .ToList();
        if (toAdd.Count > 0)
        {
            db.RaceTemplates.AddRange(toAdd);
            await db.SaveChangesAsync();
        }
    }

}
