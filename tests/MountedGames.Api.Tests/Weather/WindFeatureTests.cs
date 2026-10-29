using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Weather;

public class WindFeatureTests : IClassFixture<WindRetryApiFactory>
{
    private readonly WindRetryApiFactory f;
    public WindFeatureTests(WindRetryApiFactory factory) => f = factory;

    [Fact]
    public void GustAdapter_UsesPrecedingUtcHour_AndNeverInventsMissingWind()
    {
        using var json = JsonDocument.Parse("""{"hourly":{"time":[1792886400,1792890000,1792893600,1792897200],"wind_gusts_10m":[56.32704,null,-1,"bad"]}}""");
        var result = JsonSerializer.SerializeToElement(WindForecast.Enrich(json.RootElement, DateTimeOffset.Parse("2026-10-25T00:00:00Z")));
        var interval = Assert.Single(result.GetProperty("gustIntervals").EnumerateArray());
        Assert.Equal(1792882800, interval.GetProperty("startsAt").GetInt64());
        Assert.Equal(1792886400, interval.GetProperty("endsAt").GetInt64());
        Assert.Equal(35, interval.GetProperty("gustMph").GetDouble(), 6);
    }

    [Theory]
    [InlineData("eguk-unverified-v1")]
    [InlineData("struk-2026-v1")]
    [InlineData("mgagb-2026-v1")]
    [InlineData("unverified")]
    public void UnverifiedSubstitutionAuthority_NeverEnablesAlternative(string profile)
    {
        var selection = new WindRulesSelection { ProfileId = profile, EventLevel = "Open", AdoptionConfirmed = true };
        Assert.Null(WindRuleCatalogue.ReplacementName(selection, SectionFormat.Teams, WindRuleCatalogue.HooplaName(SectionFormat.Teams)));
    }

    [Fact]
    public void Profiles_DoNotCrossFormats_AndPcRequiresPublishedSpare()
    {
        var selection = new WindRulesSelection { ProfileId = "imga-2026-v1", EventLevel = "Open", AdoptionConfirmed = true };
        Assert.Null(WindRuleCatalogue.ReplacementName(selection, SectionFormat.Pairs, WindRuleCatalogue.HooplaName(SectionFormat.Teams)));
        selection.ProfileId = "pc-2026-v1"; selection.PublishedSpare = "Two Flag";
        Assert.Null(WindRuleCatalogue.ReplacementName(selection, SectionFormat.Teams, "Bottle"));
        Assert.Null(WindRuleCatalogue.ReplacementName(selection, SectionFormat.Individual, "Two Flag"));
        Assert.Equal("Two Flag (Pairs)", WindRuleCatalogue.ReplacementName(selection, SectionFormat.Pairs, "Two Flag"));
    }

    private async Task<(Arena Arena, int RaceId, HttpClient Client, string Replacement)> Arrange()
    {
        var a = await f.CreateArenaAsync();
        var first = await f.AddHeatAsync(a.SessionId, a.TeamIds.Take(2), "Heat 1");
        await f.AddHeatAsync(a.SessionId, a.TeamIds.Skip(2), "Heat 2", 2);
        await f.WithDbAsync(async db => { var c = await db.Competitions.FindAsync(a.CompetitionId); c!.StartDate = new DateTime(2026, 10, 29); await db.SaveChangesAsync(); });
        var client = await f.AdminAsync(); var replacement = WindRuleCatalogue.HooplaName(SectionFormat.Teams);
        var settings = await client.PutAsJsonAsync($"/api/competitions/{a.CompetitionId}/wind-review/rules",
            new WindRulesRequest(0, "imga-2026-v1", "Open teams", "", [replacement], "Synthetic venue requirements", AdoptionConfirmed: true));
        settings.EnsureSuccessStatusCode();
        return (a, first.RaceIds[0], client, replacement);
    }

    [Fact]
    public async Task OfficialChange_IsAtomicIdempotent_AndRejectsOfflineOldProgramme()
    {
        var (a, race, client, name) = await Arrange();
        var prefix = $"/api/competitions/{a.CompetitionId}";
        var preview = await (await client.PostAsJsonAsync(prefix + "/wind-review/preview", new WindPreviewRequest(a.SessionId, race, name))).ReadAsync<WindPreviewDto>();
        Assert.True(preview.CanApply); Assert.Equal(2, preview.Races.Count); Assert.Equal("Referee with organiser", preview.Authority);
        var change = new WindApplyRequest(a.SessionId, race, name, preview.Fingerprint, Guid.NewGuid().ToString(), preview.Authority, "Referee consulted organiser and approved replacement.", true);
        f.Failure.Armed = true;
        (await client.PostAsJsonAsync(prefix + "/race-changes", change)).EnsureSuccessStatusCode();
        Assert.False(f.Failure.Armed);
        Assert.Equal(1, f.Failure.Failures);
        (await client.PostAsJsonAsync(prefix + "/race-changes", change)).EnsureSuccessStatusCode();
        await f.WithDbAsync(async db => { Assert.Equal(1, await db.Set<WindRaceDecision>().CountAsync(d => d.CompetitionId == a.CompetitionId));
            Assert.All(await db.Races.Where(r => r.Heat!.SessionId == a.SessionId).ToListAsync(), r => { Assert.Equal(name, r.Name); Assert.Equal(1, r.ProgrammeRevision); }); });
        var places = new[] { new FinishingPlaceDto(a.TeamIds[0], 1, false), new FinishingPlaceDto(a.TeamIds[1], 2, false) };
        var old = await client.PostAsJsonAsync($"/api/races/{race}/results", new SubmitRaceResultsRequest(places, []));
        Assert.Equal(HttpStatusCode.Conflict, old.StatusCode);
        var score = await client.PostAsJsonAsync($"/api/races/{race}/results", new SubmitRaceResultsRequest(places, [], ExpectedProgrammeRevision: 1));
        score.EnsureSuccessStatusCode();
        var heat = await score.ReadAsync<HeatDto>(); Assert.Equal(2, heat.Races[0].Results.First(r => r.TeamId == a.TeamIds[0]).Points);
    }

    [Fact]
    public async Task BulkProgrammeEdit_CannotRevertAnApprovedReplacement()
    {
        var (a, race, client, replacement) = await Arrange();
        var prefix = $"/api/competitions/{a.CompetitionId}";
        var sessionUrl = prefix + $"/sessions/{a.SessionId}";
        var earlier = await (await client.GetAsync(sessionUrl)).ReadAsync<SessionDto>();
        var expectedProgramme = new {
            plannedRaces = earlier.PlannedRaces ?? [],
            heatIds = earlier.Heats.Select(h => h.Id).ToArray(),
            races = earlier.Heats.SelectMany(h => h.Races.Select(r => new {
                raceId = r.Id, heatId = h.Id, r.OrderIndex, r.Name, r.ProgrammeRevision,
            })).ToArray(),
        };
        var preview = await (await client.PostAsJsonAsync(prefix + "/wind-review/preview", new WindPreviewRequest(a.SessionId, race, replacement))).ReadAsync<WindPreviewDto>();
        (await client.PostAsJsonAsync(prefix + "/race-changes", new WindApplyRequest(a.SessionId, race, replacement,
            preview.Fingerprint, Guid.NewGuid().ToString(), preview.Authority, "Replacement approved.", true))).EnsureSuccessStatusCode();

        var rejected = await client.PutAsJsonAsync(sessionUrl + "/races", new {
            raceNames = earlier.Heats.First().Races.Select(r => r.Name).Append("Extra game").ToArray(), expectedProgramme,
        });

        Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode);
        Assert.Contains("programme changed", await rejected.Content.ReadAsStringAsync());
        var current = await (await client.GetAsync(sessionUrl)).ReadAsync<SessionDto>();
        Assert.All(current.Heats.SelectMany(h => h.Races), r => { Assert.Equal(replacement, r.Name); Assert.Equal(1, r.ProgrammeRevision); });
        Assert.Equal(earlier.Heats.Sum(h => h.Races.Count), current.Heats.Sum(h => h.Races.Count));
    }

    [Fact]
    public async Task PublishedPcSpare_StoresTheReviewedPairsVariant()
    {
        var (a, race, client, _) = await Arrange();
        await f.WithDbAsync(async db => { (await db.CompetitionSections.FindAsync(a.SectionId))!.Format = SectionFormat.Pairs; await db.SaveChangesAsync(); });
        var prefix = $"/api/competitions/{a.CompetitionId}";
        (await client.PutAsJsonAsync(prefix + "/wind-review/rules", new WindRulesRequest(1, "pc-2026-v1", "Published pairs competition", "Two Flag", ["Two Flag"], "", AdoptionConfirmed: true))).EnsureSuccessStatusCode();
        var preview = await (await client.PostAsJsonAsync(prefix + "/wind-review/preview", new WindPreviewRequest(a.SessionId, race, "Two Flag"))).ReadAsync<WindPreviewDto>();
        Assert.True(preview.CanApply); Assert.All(preview.Races, r => Assert.Equal("Two Flag (Pairs)", r.After));
        (await client.PostAsJsonAsync(prefix + "/race-changes", new WindApplyRequest(a.SessionId, race, "Two Flag", preview.Fingerprint, Guid.NewGuid().ToString(), preview.Authority, "Published spare approved.", true))).EnsureSuccessStatusCode();
        Assert.Equal("Two Flag (Pairs)", await f.InDbAsync(db => db.Races.Where(r => r.Id == race).Select(r => r.Name).SingleAsync()));
    }

    [Fact]
    public async Task StalePreview_AndAllLegacyRoutes_CannotOverwriteStartedContest()
    {
        var (a, race, client, name) = await Arrange();
        var prefix = $"/api/competitions/{a.CompetitionId}";
        var preview = await (await client.PostAsJsonAsync(prefix + "/wind-review/preview", new WindPreviewRequest(a.SessionId, race, name))).ReadAsync<WindPreviewDto>();
        (await client.PostAsJsonAsync($"/api/races/{race}/start", new RaceClockRequest(null))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(prefix + "/race-changes", new WindApplyRequest(a.SessionId, race, name, preview.Fingerprint, Guid.NewGuid().ToString(), preview.Authority, "Approved", true))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync(prefix + $"/sessions/{a.SessionId}/races/{race}", new { newName = "Different", applyToAllHeats = true })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PutAsJsonAsync(prefix + $"/sessions/{a.SessionId}/races", new { raceNames = new[] { "Different" } })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.DeleteAsync(prefix + $"/sessions/{a.SessionId}/races/{race}")).StatusCode);
    }

    [Fact]
    public async Task RulesAndPreviews_RequireCompetitionAccess()
    {
        var (a, race, _, name) = await Arrange(); var path = $"/api/competitions/{a.CompetitionId}/wind-review/preview";
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().PostAsJsonAsync(path, new WindPreviewRequest(a.SessionId, race, name))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await (await f.TrainerAsync()).PostAsJsonAsync(path, new WindPreviewRequest(a.SessionId, race, name))).StatusCode);
    }

    [Fact]
    public void RaceRounds_AndLetteredFinals_KeepTheirOwnProgrammeSlots()
    {
        var s = new Session { PlannedRaces = "[\"First\",\"Second\"]" };
        var h1 = new Heat { Id = 1, OrderIndex = 1, RaceRoundId = 1 }; var h2 = new Heat { Id = 2, OrderIndex = 2, RaceRoundId = 2 };
        var r1 = new Race { Id = 1, HeatId = 1, Name = "First", OrderIndex = 1 }; var r2 = new Race { Id = 2, HeatId = 2, Name = "Second", OrderIndex = 1 };
        h1.Races.Add(r1); h2.Races.Add(r2); s.Heats.Add(h1); s.Heats.Add(h2);
        var scope = WindRaceGuard.Scope(s, r2); Assert.Single(scope);
        WindRaceGuard.Replace(s, r2, scope, "Replacement"); Assert.Equal(new[] { "First", "Replacement" }, PlannedRaceList.Read(s.PlannedRaces));
        h1.RaceRoundId = h2.RaceRoundId = null; h1.Label = "A Final"; h2.Label = "B Final"; s.PlannedRaces = "[\"First\"]";
        WindRaceGuard.Replace(s, r1, WindRaceGuard.Scope(s, r1), "New A");
        Assert.Equal("First", PlannedFinalRaceLists.Read(s.PlannedFinalRaces)!["B"][0]);
        Assert.Equal("New A", PlannedRaceList.Read(s.PlannedRaces)![0]);
    }
    [Fact]
    public async Task ConcurrentStartAndReplacement_OnlyOneCanWin()
    {
        var (a, race, client, name) = await Arrange();
        var prefix = $"/api/competitions/{a.CompetitionId}";
        var preview = await (await client.PostAsJsonAsync(prefix + "/wind-review/preview", new WindPreviewRequest(a.SessionId, race, name))).ReadAsync<WindPreviewDto>();
        var responses = await Task.WhenAll(
            client.PostAsJsonAsync($"/api/races/{race}/start", new RaceClockRequest(null)),
            client.PostAsJsonAsync(prefix + "/race-changes", new WindApplyRequest(a.SessionId, race, name, preview.Fingerprint, Guid.NewGuid().ToString(), preview.Authority, "Approved after inspection.", true)));
        Assert.Single(responses, r => r.IsSuccessStatusCode);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task SqliteUpgrade_PreservesRaces_AndAcknowledgementsAreShared()
    {
        var (a, race, client, _) = await Arrange();
        await f.WithDbAsync(async db => {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Races\" DROP COLUMN \"ProgrammeRevision\"");
            await WindFeature.EnsureSqliteAsync(db);
            await WindFeature.EnsureSqliteAsync(db);
            Assert.Equal("Race 1", (await db.Races.AsNoTracking().SingleAsync(r => r.Id == race)).Name);
        });
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        (await client.PostAsJsonAsync($"/api/competitions/{a.CompetitionId}/wind-review/acknowledge", new WindAcknowledgeRequest("Main", now - 1000, now + 3_600_000, 30, 1))).EnsureSuccessStatusCode();
        var response = await (await client.GetAsync($"/api/competitions/{a.CompetitionId}/wind-review/rules")).ReadAsync<JsonElement>();
        Assert.Equal("Main", Assert.Single(response.GetProperty("acknowledgements").EnumerateArray()).GetProperty("arena").GetString());
    }

    [Fact]
    public async Task ResumingWind_DoesNotClearAnotherHazardsPause()
    {
        var (a, _, client, _) = await Arrange();
        var prefix = $"/api/competitions/{a.CompetitionId}/sessions";
        (await client.PostAsJsonAsync(prefix + "/pause", new { reason = "thunder" })).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync(prefix + "/pause", new { reason = "wind" })).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync(prefix + "/resume", new { reason = "wind" })).EnsureSuccessStatusCode();
        await f.WithDbAsync(async db => { var notes = (await db.Sessions.FindAsync(a.SessionId))!.Notes;
            Assert.Contains("[pausefor:thunder]", notes); Assert.Contains("[paused:", notes); Assert.DoesNotContain("[pausefor:wind]", notes); });
    }

    [Fact]
    public async Task ConcurrentWeatherChanges_KeepEveryHazard_AndRetryTheWholeTransaction()
    {
        // Sessions without heats must be locked too.
        var a = await f.CreateArenaAsync();
        var client = await f.AdminAsync();
        var prefix = $"/api/competitions/{a.CompetitionId}/sessions";
        var responses = await Task.WhenAll(new[] { "thunder", "wind" }.Select(reason => client.PostAsJsonAsync(prefix + "/pause", new { reason })));
        Assert.All(responses, response => response.EnsureSuccessStatusCode());
        var notes = await f.InDbAsync(db => db.Sessions.Where(s => s.Id == a.SessionId).Select(s => s.Notes).SingleAsync());
        Assert.Contains("[pausefor:thunder]", notes); Assert.Contains("[pausefor:wind]", notes);

        var failuresBefore = f.Failure.PauseFailures;
        f.Failure.PauseArmed = true;
        (await client.PostAsJsonAsync(prefix + "/resume", new { reason = "wind" })).EnsureSuccessStatusCode();
        Assert.False(f.Failure.PauseArmed); Assert.Equal(failuresBefore + 1, f.Failure.PauseFailures);
        notes = await f.InDbAsync(db => db.Sessions.Where(s => s.Id == a.SessionId).Select(s => s.Notes).SingleAsync());
        Assert.Contains("[paused:", notes); Assert.Contains("[pausefor:thunder]", notes); Assert.DoesNotContain("[pausefor:wind]", notes);

        responses = await Task.WhenAll(client.PostAsJsonAsync(prefix + "/resume", new { reason = "thunder" }),
            client.PostAsJsonAsync(prefix + "/pause", new { reason = "wind" }));
        Assert.All(responses, response => response.EnsureSuccessStatusCode());
        notes = await f.InDbAsync(db => db.Sessions.Where(s => s.Id == a.SessionId).Select(s => s.Notes).SingleAsync());
        Assert.Contains("[paused:", notes); Assert.Contains("[pausefor:wind]", notes); Assert.DoesNotContain("[pausefor:thunder]", notes);
    }

    [Theory]
    [InlineData("gate-check")]
    [InlineData("shift-times")]
    [InlineData("combined-scoring")]
    [InlineData("combine-heat")]
    public async Task TimetableNoteWrites_RetryWithoutDroppingWeatherPause(string action)
    {
        var a = await f.CreateArenaAsync();
        var heat = await f.AddHeatAsync(a.SessionId, a.TeamIds);
        var client = await f.AdminAsync();
        var prefix = $"/api/competitions/{a.CompetitionId}/sessions";
        await f.WithDbAsync(async db => {
            var session = (await db.Sessions.FindAsync(a.SessionId))!;
            session.ScheduledStart = new DateTime(2030, 6, 1, 10, 0, 0, DateTimeKind.Utc);
            await db.SaveChangesAsync();
        });
        (await client.PostAsJsonAsync(prefix + "/pause", new { reason = "wind" })).EnsureSuccessStatusCode();
        var failuresBefore = f.Failure.PauseFailures;
        f.Failure.PauseArmed = true;
        var response = action switch {
            "gate-check" => await client.PutAsJsonAsync(prefix + $"/{a.SessionId}/heats/{heat.HeatId}/gate-check", new { teamId = a.TeamIds[0], status = "at-gate" }),
            "shift-times" => await client.PostAsJsonAsync(prefix + "/shift-times", new { deltaMinutes = 10 }),
            "combined-scoring" => await client.PutAsJsonAsync(prefix + $"/{a.SessionId}/combined-scoring", new { scoringMode = "Combined" }),
            _ => await client.PostAsJsonAsync(prefix + $"/{a.SessionId}/combine-heat", new { scoringMode = "Combined", teamIds = a.TeamIds }),
        };
        response.EnsureSuccessStatusCode();
        Assert.False(f.Failure.PauseArmed); Assert.Equal(failuresBefore + 1, f.Failure.PauseFailures);
        var notes = await f.InDbAsync(db => db.Sessions.Where(session => session.Id == a.SessionId).Select(session => session.Notes).SingleAsync());
        Assert.Contains("[paused:", notes); Assert.Contains("[pausefor:wind]", notes);
        if (action == "gate-check") Assert.Contains($"[gate:{heat.HeatId}:{a.TeamIds[0]}=at-gate]", notes);
        if (action == "shift-times") {
            var start = await f.InDbAsync(db => db.Sessions.Where(session => session.Id == a.SessionId).Select(session => session.ScheduledStart).SingleAsync());
            Assert.Equal(new DateTime(2030, 6, 1, 10, 10, 0, DateTimeKind.Utc), start);
        }
    }

}

// Enforce the same transaction boundary as production Npgsql, using the isolated SQLite fixture.
public sealed class WindRetryApiFactory : ApiFactory
{
    public FailWindSave Failure { get; } = new();
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureServices(services => services.AddDbContext<AppDbContext>(options =>
            options.ReplaceService<IExecutionStrategyFactory, RetryFactory>().AddInterceptors(Failure)));
    }
    private sealed class TransientWindException : Exception;
    private sealed class RetryFactory(ExecutionStrategyDependencies dependencies) : IExecutionStrategyFactory
    {
        public IExecutionStrategy Create() => new Retry(dependencies);
    }
    private sealed class Retry(ExecutionStrategyDependencies dependencies) : ExecutionStrategy(dependencies, 1, TimeSpan.Zero)
    {
        protected override bool ShouldRetryOn(Exception exception) => exception is TransientWindException;
    }
    public sealed class FailWindSave : SaveChangesInterceptor
    {
        public bool Armed { get; set; }
        public bool PauseArmed { get; set; }
        public int PauseFailures { get; private set; }
        public int Failures { get; private set; }
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (PauseArmed && eventData.Context?.ChangeTracker.Entries<Session>().Any(e => e.State == EntityState.Modified && e.Property(s => s.Notes).IsModified) == true)
            {
                Assert.NotNull(eventData.Context.Database.CurrentTransaction);
                PauseArmed = false; PauseFailures++; throw new TransientWindException();
            }
            if (Armed && eventData.Context?.ChangeTracker.Entries<WindRaceDecision>().Any(e => e.State == EntityState.Added) == true)
            {
                Armed = false; Failures++; throw new TransientWindException();
            }
            return ValueTask.FromResult(result);
        }
    }
}
