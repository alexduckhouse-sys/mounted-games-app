using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Seasons;

public class SeasonRiderPublicationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private sealed record World(HttpClient Owner, string OwnerId, int ClubId, int SectionId,
        int[] TeamIds, int[] FormIds, int[] RiderIds, Guid SeasonId, Guid RoundId);

    private async Task<World> CreateWorldAsync(bool saved = true, bool locked = true, bool initials = true)
    {
        var owner = await factory.TrainerAsync();
        var ownerId = await factory.TrainerIdAsync();
        var data = await factory.WithDbAsync(async db =>
        {
            var club = new Club { Name = $"Fake pairs club {Guid.NewGuid():N}" };
            var competition = new Competition { Name = "Fake pairs event", CreatedByUserId = ownerId };
            db.AddRange(club, competition);
            await db.SaveChangesAsync();
            var section = new CompetitionSection { CompetitionId = competition.Id, Format = SectionFormat.Pairs, AgeGroup = "Open", DisplayName = "Open pairs" };
            db.Add(section);
            await db.SaveChangesAsync();
            var teams = new[] { "Fake pair A", "Fake pair B" }.Select(name => new Team
            {
                CompetitionId = competition.Id, CompetitionSectionId = section.Id, ClubId = club.Id, DisplayName = name,
            }).ToArray();
            db.Teams.AddRange(teams);
            var roster = new[] { "Fake AlphaSurname", "Fake BetaSurname", "Fake GammaSurname", "Fake DeltaSurname" }
                .Select(name => new SavedRider { ClubId = club.Id, CreatedByUserId = ownerId, FullName = name, UseInitialOnly = initials }).ToArray();
            if (saved) db.SavedRiders.AddRange(roster);
            await db.SaveChangesAsync();
            var forms = teams.Select((team, index) => new DeclarationForm
            {
                TeamId = team.Id, SubmittedByUserId = ownerId, IsLocked = locked,
                Riders = roster.Skip(index * 2).Take(2).Select((rider, order) => new RiderEntry
                {
                    SavedRiderId = saved ? rider.Id : null, FullName = rider.FullName, HorseName = "Fake Pony",
                    UseInitialOnly = initials, OrderIndex = order, MedicalNotes = "FAKE_PRIVATE_NOTE",
                }).ToList(),
            }).ToArray();
            db.DeclarationForms.AddRange(forms);
            var session = new Session { CompetitionId = competition.Id, CompetitionSectionId = section.Id, Name = "Fake session" };
            db.Sessions.Add(session);
            await db.SaveChangesAsync();
            var heat = new Heat { SessionId = session.Id, Entries = teams.Select((team, index) => new HeatEntry { TeamId = team.Id, LaneIndex = index + 1 }).ToList() };
            db.Heats.Add(heat);
            await db.SaveChangesAsync();
            db.Races.Add(new Race
            {
                HeatId = heat.Id, Name = "Fake race", IsComplete = true,
                Results = teams.Select((team, index) => new Result { TeamId = team.Id, Placing = index + 1, Points = 5.5 - index }).ToList(),
            });
            await db.SaveChangesAsync();
            return (club.Id, Section: section.Id, Teams: teams.Select(x => x.Id).ToArray(), Forms: forms.Select(x => x.Id).ToArray(), Riders: forms.SelectMany(x => x.Riders).Select(x => x.Id).ToArray());
        });
        var (season, round) = await LinkSeasonAsync(owner, data.Section);
        return new World(owner, ownerId, data.Id, data.Section, data.Teams, data.Forms, data.Riders, season.Id, round.Id);
    }

    private static async Task<(SeasonDto Season, SeasonRoundDto Round)> LinkSeasonAsync(HttpClient owner, int sectionId)
    {
        var created = await owner.PostAsJsonAsync("/api/seasons",
            new CreateSeasonRequest("Fake rider league", 2035, SectionFormat.Pairs, "Open", null, [new(1, 10), new(2, 7)]));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var season = await created.ReadAsync<SeasonDto>();
        var linked = await owner.PostAsJsonAsync($"/api/seasons/{season.Id}/rounds", new AddSeasonRoundRequest(sectionId));
        Assert.Equal(HttpStatusCode.Created, linked.StatusCode);
        return (season, await linked.ReadAsync<SeasonRoundDto>());
    }

    private static string RoundUrl(World world) => $"/api/seasons/{world.SeasonId}/rounds/{world.RoundId}";

    private static async Task<SeasonPublicationPreviewDto> PreviewAsync(World world)
    {
        var response = await world.Owner.GetAsync($"{RoundUrl(world)}/publication-preview");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<SeasonPublicationPreviewDto>();
    }

    private static async Task<SeasonRoundPublicationDto> PublishAsync(World world, SeasonPublicationPreviewDto preview)
    {
        var response = await world.Owner.PostAsJsonAsync($"{RoundUrl(world)}/publications",
            new PublishSeasonRoundRequest(preview.SourceFingerprint, preview.NextVersion));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<SeasonRoundPublicationDto>();
    }

    [Fact]
    public async Task Preview_IsReadOnly_UsesPublicNames_AndIgnoresNewerUnlockedForms()
    {
        var world = await CreateWorldAsync();
        await factory.WithDbAsync(async db =>
        {
            db.DeclarationForms.Add(new DeclarationForm
            {
                TeamId = world.TeamIds[0], SubmittedByUserId = world.OwnerId, SubmittedAt = DateTime.UtcNow.AddDays(1),
                Riders = [new RiderEntry { FullName = "Fake UnlockedSurname" }],
            });
            await db.SaveChangesAsync();
        });
        var before = await factory.WithDbAsync(db => db.Set<TeamProfile>().CountAsync());
        var preview = await PreviewAsync(world);
        var again = await PreviewAsync(world);
        Assert.Equal(preview.SourceFingerprint, again.SourceFingerprint);
        Assert.Equal(4, preview.Results.Count);
        Assert.Equal([5.5, 5.5, 4.5, 4.5], preview.Results.Select(x => x.EventPoints));
        Assert.All(preview.Results, row => Assert.EndsWith(".", row.TeamName));
        Assert.Equal(before, await factory.WithDbAsync(db => db.Set<TeamProfile>().CountAsync()));

        var publication = await PublishAsync(world, preview);
        Assert.Equal(preview.Results.OrderBy(x => x.TeamProfileId), publication.Results.OrderBy(x => x.TeamProfileId));
        var ids = preview.Results.Select(x => x.TeamProfileId).ToArray();
        var names = await factory.WithDbAsync(db => db.Set<TeamProfile>().Where(x => ids.Contains(x.Id)).Select(x => x.DisplayName).ToListAsync());
        Assert.Equal(4, names.Count);
        Assert.All(names, name => Assert.EndsWith(".", name));
        foreach (var url in new[] { $"{RoundUrl(world)}/publications/1", $"/api/seasons/{world.SeasonId}/standings" })
        {
            var body = await factory.CreateClient().GetStringAsync(url);
            Assert.DoesNotContain("Surname", body, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("FAKE_PRIVATE_NOTE", body);
        }
        Assert.Equal(before + 4, await factory.WithDbAsync(db => db.Set<TeamProfile>().CountAsync()));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CurrentRosterPrivacyProtectsPublishedNamesWithoutRepublishingOrWritingOnRead(bool changeSectionFormat)
    {
        var world = await CreateWorldAsync(initials: false);
        var preview = await PreviewAsync(world);
        Assert.Contains(preview.Results, row => row.TeamName.Contains("Surname"));
        await PublishAsync(world, preview);
        var profileId = preview.Results[0].TeamProfileId;
        await factory.WithDbAsync(async db =>
        {
            var entries = await db.RiderEntries.Where(x => world.RiderIds.Contains(x.Id)).Include(x => x.SavedRider).ToListAsync();
            foreach (var entry in entries) entry.SavedRider!.UseInitialOnly = true;
            if (changeSectionFormat)
                (await db.CompetitionSections.FindAsync(world.SectionId))!.Format = SectionFormat.Teams;
            // A replacement form does not erase the published rider's historical membership.
            db.DeclarationForms.Add(new DeclarationForm
            {
                TeamId = world.TeamIds[0], IsLocked = true, SubmittedAt = DateTime.UtcNow.AddDays(1),
                Riders = entries.Take(2).Select(x => new RiderEntry { FullName = x.FullName, SavedRiderId = x.SavedRiderId, HorseName = x.HorseName }).ToList(),
            });
            await db.SaveChangesAsync();
        });
        var storedName = await factory.WithDbAsync(db => db.Set<TeamProfile>().Where(x => x.Id == profileId).Select(x => x.DisplayName).SingleAsync());
        Assert.Contains("Surname", storedName);
        foreach (var url in new[]
        {
            $"{RoundUrl(world)}/publications/1", $"/api/seasons/{world.SeasonId}/standings",
            $"/api/team-profiles/{profileId}/history", $"/api/share/team-profiles/{profileId}",
            $"/api/stats/team-profiles/{profileId}",
        })
        {
            var response = await factory.CreateClient().GetAsync(url);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.DoesNotContain("Surname", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        }
        var (member, _) = await factory.SignupAsync("Member");
        var memberStatsResponse = await member.GetAsync($"/api/stats/team-profiles/{profileId}");
        var memberStats = await memberStatsResponse.ReadAsync<StatsProfileDto>();
        Assert.NotEmpty(memberStats.Partnerships!);
        Assert.DoesNotContain("Surname", await memberStatsResponse.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        var ponyStatsResponse = await member.GetAsync("/api/stats/ponies?name=Fake%20Pony");
        Assert.Equal(HttpStatusCode.OK, ponyStatsResponse.StatusCode);
        Assert.DoesNotContain("Surname", await ponyStatsResponse.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        var publicProfiles = await (await factory.CreateClient().GetAsync("/api/team-profiles")).ReadAsync<List<TeamProfileDto>>();
        Assert.DoesNotContain("Surname", publicProfiles.Single(x => x.Id == profileId).DisplayName);
        if (!changeSectionFormat)
        {
            var fresh = await PreviewAsync(world);
            Assert.All(fresh.Results, row => Assert.EndsWith(".", row.TeamName));
        }
        Assert.Equal(storedName, await factory.WithDbAsync(db => db.Set<TeamProfile>().Where(x => x.Id == profileId).Select(x => x.DisplayName).SingleAsync()));
        Assert.Equal(1, await factory.WithDbAsync(db => db.Set<SeasonRoundPublication>().CountAsync(x => x.SeasonRoundId == world.RoundId)));
    }

    [Fact]
    public async Task DeletedRiderSourcesAndChangedFormatsCannotUnmaskPublishedNames()
    {
        var world = await CreateWorldAsync(initials: false);
        var preview = await PreviewAsync(world);
        await PublishAsync(world, preview);
        var profileId = preview.Results[0].TeamProfileId;
        await factory.WithDbAsync(async db =>
        {
            db.RiderEntries.RemoveRange(await db.RiderEntries.Where(x => world.RiderIds.Contains(x.Id)).ToListAsync());
            (await db.CompetitionSections.FindAsync(world.SectionId))!.Format = SectionFormat.Teams;
            await db.SaveChangesAsync();
        });
        foreach (var url in new[] { $"{RoundUrl(world)}/publications/1", $"/api/seasons/{world.SeasonId}/standings", $"/api/team-profiles/{profileId}/history" })
            Assert.DoesNotContain("Surname", await factory.CreateClient().GetStringAsync(url), StringComparison.OrdinalIgnoreCase);
        // Profiles can outlive all their results; absence of lineage must stay private too.
        await factory.WithDbAsync(async db =>
        {
            db.Set<SeasonRoundResult>().RemoveRange(await db.Set<SeasonRoundResult>().Where(x => x.TeamProfileId == profileId).ToListAsync());
            await db.SaveChangesAsync();
        });
        Assert.DoesNotContain("Surname", await factory.CreateClient().GetStringAsync($"/api/team-profiles/{profileId}/history"), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Surname", await factory.CreateClient().GetStringAsync($"/api/share/team-profiles/{profileId}"), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task PairProfileStatsUseOnlyItsLatestPublishedEventMemberships()
    {
        var world = await CreateWorldAsync();
        var preview = await PreviewAsync(world);
        await PublishAsync(world, preview);
        var profileId = preview.Results[0].TeamProfileId;
        var url = $"/api/stats/team-profiles/{profileId}";
        var stats = await (await world.Owner.GetAsync(url)).ReadAsync<StatsProfileDto>();
        Assert.Equal(1, stats.Summary.Entries);
        Assert.Equal(5.5, stats.Summary.Points);
        Assert.Equal(world.TeamIds[0], Assert.Single(stats.Entries).TeamId);
        Assert.EndsWith(".", stats.Name);
        Assert.False(await factory.WithDbAsync(db => db.Set<EventTeamProfileLink>().AnyAsync(x => x.TeamProfileId == profileId)));

        await factory.WithDbAsync(async db =>
        {
            var latest = new SeasonRoundPublication
            {
                SeasonRoundId = world.RoundId, Version = 2, PublishedByUserId = world.OwnerId,
                SourceFingerprint = new string('F', 64),
                Results = [new SeasonRoundResult
                {
                    TeamProfileId = profileId, EventTeamId = world.TeamIds[1], TeamName = "Fake A.", ClubName = "Fake Club",
                    EventRank = 2, EventPoints = 4.5, SeasonPoints = 7,
                }],
            };
            db.Add(latest);
            await db.SaveChangesAsync();
        });
        var changed = await (await world.Owner.GetAsync(url)).ReadAsync<StatsProfileDto>();
        Assert.Equal(1, changed.Summary.Entries);
        Assert.Equal(4.5, changed.Summary.Points);
        Assert.Equal(world.TeamIds[1], Assert.Single(changed.Entries).TeamId);
    }

    [Fact]
    public async Task SameNames_KeepSeparateUnsavedIdentities_AndNeverReuseNameMatchedProfiles()
    {
        var world = await CreateWorldAsync(saved: false);
        var manualId = await factory.WithDbAsync(async db =>
        {
            foreach (var rider in await db.RiderEntries.Where(x => world.RiderIds.Contains(x.Id)).ToListAsync())
                rider.FullName = "Fake SharedSurname";
            var manual = new TeamProfile { OwnerUserId = world.OwnerId, ClubId = world.ClubId, DisplayName = "Fake S." };
            db.Add(manual);
            await db.SaveChangesAsync();
            return manual.Id;
        });
        var preview = await PreviewAsync(world);
        Assert.Equal(4, preview.Results.Select(x => x.TeamProfileId).Distinct().Count());
        Assert.All(preview.Results, row => Assert.Equal("Fake S.", row.TeamName));
        Assert.DoesNotContain(preview.Results, row => row.TeamProfileId == manualId);
        Assert.Equal(preview.Results.Select(x => x.TeamProfileId), (await PreviewAsync(world)).Results.Select(x => x.TeamProfileId));
        await PublishAsync(world, preview);
    }

    [Fact]
    public async Task TheSameSavedRiders_HaveSeparateProfilesForDifferentSeasonOwners()
    {
        var world = await CreateWorldAsync();
        var first = await PreviewAsync(world);
        var admin = await factory.AdminAsync();
        var (season, round) = await LinkSeasonAsync(admin, world.SectionId);
        var other = world with { Owner = admin, SeasonId = season.Id, RoundId = round.Id };
        var second = await PreviewAsync(other);
        Assert.Empty(first.Results.Select(x => x.TeamProfileId).Intersect(second.Results.Select(x => x.TeamProfileId)));
        await PublishAsync(world, first);
        await PublishAsync(other, second);
    }

    [Fact]
    public async Task UnlockedDeclarations_CannotSupplyRidersForPublication()
    {
        var world = await CreateWorldAsync(locked: false);
        var response = await world.Owner.GetAsync($"{RoundUrl(world)}/publication-preview");
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("locked declaration", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task AnEmptyLatestLockedForm_DoesNotRestoreRidersFromAnOlderForm()
    {
        var world = await CreateWorldAsync();
        await factory.WithDbAsync(async db =>
        {
            db.DeclarationForms.Add(new DeclarationForm
            {
                TeamId = world.TeamIds[0], IsLocked = true, SubmittedAt = DateTime.UtcNow.AddDays(1),
                Riders = [new RiderEntry { FullName = "Fake ReserveSurname", IsReserve = true }],
            });
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.Conflict, (await world.Owner.GetAsync($"{RoundUrl(world)}/publication-preview")).StatusCode);
    }

    [Fact]
    public async Task ARejectedStalePreview_CannotPersistAnyRiderProfiles()
    {
        var world = await CreateWorldAsync();
        var preview = await PreviewAsync(world);
        var before = await factory.WithDbAsync(db => db.Set<TeamProfile>().CountAsync());
        await factory.WithDbAsync(async db =>
        {
            var rider = await db.RiderEntries.FindAsync(world.RiderIds[0]);
            rider!.FullName = "Fake ChangedSurname";
            await db.SaveChangesAsync();
        });
        var response = await world.Owner.PostAsJsonAsync($"{RoundUrl(world)}/publications",
            new PublishSeasonRoundRequest(preview.SourceFingerprint, preview.NextVersion));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(before, await factory.WithDbAsync(db => db.Set<TeamProfile>().CountAsync()));
        var fresh = await PreviewAsync(world);
        Assert.NotEqual(preview.SourceFingerprint, fresh.SourceFingerprint);
        await PublishAsync(world, fresh);
    }
}
