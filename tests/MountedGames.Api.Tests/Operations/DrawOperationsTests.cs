using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

public class DrawOperationsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public DrawOperationsTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task Preview_IsDeterministic_Balanced_AndCoversEveryTeamPerSession()
    {
        var arena = await CreateDrawArenaAsync(7, 3, 3);
        var admin = await _f.AdminAsync();
        var url = PreviewUrl(arena);

        var first = await (await admin.PostAsJsonAsync(url, new DrawRequest(4201))).ReadAsync<DrawPreviewDto>();
        var second = await (await admin.PostAsJsonAsync(url, new DrawRequest(4201))).ReadAsync<DrawPreviewDto>();

        Assert.Equal(first.Fingerprint, second.Fingerprint);
        Assert.Equal(JsonSerializer.Serialize(first.Sessions), JsonSerializer.Serialize(second.Sessions));
        Assert.True(first.Fairness.EveryTeamAppearsOncePerSession);
        Assert.InRange(first.Fairness.HeatSizeSpread, 0, 1);
        Assert.All(first.Sessions, session =>
            Assert.Equal(arena.TeamIds.Order(), session.Heats.SelectMany(h => h.Teams).Select(t => t.TeamId).Order()));
    }

    [Fact]
    public async Task Apply_ReplacesAssignmentsAtomically_AndKeepsHeatAndRaceMetadata()
    {
        var arena = await CreateDrawArenaAsync(6, 2, 1);
        var metadata = await RaceMetadataAsync(arena.CompetitionId);
        var admin = await _f.AdminAsync();
        var preview = await (await admin.PostAsJsonAsync(PreviewUrl(arena), new DrawRequest(17))).ReadAsync<DrawPreviewDto>();

        var response = await admin.PostAsJsonAsync(ApplyUrl(arena), new ApplyDrawRequest(17, preview.Fingerprint));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var entries = await _f.WithDbAsync(db => db.HeatEntries
            .Where(e => e.Heat!.Session!.CompetitionId == arena.CompetitionId)
            .Select(e => new { e.HeatId, e.TeamId, e.LaneIndex }).ToListAsync());
        Assert.Equal(12, entries.Count);
        Assert.Equal(preview.Sessions.SelectMany(s => s.Heats).Sum(h => h.Teams.Count), entries.Count);
        var after = await RaceMetadataAsync(arena.CompetitionId);
        Assert.Equal(metadata, after);
    }

    [Fact]
    public async Task Apply_RejectsChangedInputs_WithoutChangingAssignments()
    {
        var arena = await CreateDrawArenaAsync(4, 2, 1);
        var admin = await _f.AdminAsync();
        var preview = await (await admin.PostAsJsonAsync(PreviewUrl(arena), new DrawRequest(9))).ReadAsync<DrawPreviewDto>();
        await _f.WithDbAsync(async db =>
        {
            var team = await db.Teams.SingleAsync(t => t.Id == arena.TeamIds[0]);
            team.DisplayName += " changed";
            await db.SaveChangesAsync();
        });
        var before = await EntryKeyAsync(arena.CompetitionId);

        var response = await admin.PostAsJsonAsync(ApplyUrl(arena), new ApplyDrawRequest(9, preview.Fingerprint));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(before, await EntryKeyAsync(arena.CompetitionId));
    }

    [Fact]
    public async Task Preview_RejectsAnyScoredRace()
    {
        var arena = await CreateDrawArenaAsync(4, 2, 1);
        await _f.WithDbAsync(async db =>
        {
            var race = await db.Races.Include(r => r.Heat).ThenInclude(h => h!.Entries)
                .FirstAsync(r => r.Heat!.Session!.CompetitionId == arena.CompetitionId);
            race.IsComplete = true;
            db.Results.Add(new Result { RaceId = race.Id, TeamId = race.Heat!.Entries.First().TeamId, Placing = 1, Points = 4 });
            await db.SaveChangesAsync();
        });

        var response = await (await _f.AdminAsync()).PostAsJsonAsync(PreviewUrl(arena), new DrawRequest(1));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Preview_RejectsRaceFinalsHeats()
    {
        var arena = await CreateDrawArenaAsync(4, 2, 0);
        await _f.WithDbAsync(async db =>
        {
            (await db.Heats.FirstAsync(h => h.SessionId == arena.SessionId)).RaceRoundStage = RaceRoundStage.Qualifier;
            await db.SaveChangesAsync();
        });

        var response = await (await _f.AdminAsync()).PostAsJsonAsync(PreviewUrl(arena), new DrawRequest(1));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Preview_RejectsStartedRacesEvenBeforeAResultIsRecorded()
    {
        var arena = await CreateDrawArenaAsync(4, 2, 0);
        await _f.WithDbAsync(async db =>
        {
            (await db.Races.FirstAsync(r => r.Heat!.SessionId == arena.SessionId)).StartedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        });

        var response = await (await _f.AdminAsync()).PostAsJsonAsync(PreviewUrl(arena), new DrawRequest(1));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Preview_RejectsDrawThatExceedsSessionLaneLimit()
    {
        var arena = await CreateDrawArenaAsync(5, 2, 0);
        await _f.WithDbAsync(async db =>
        {
            (await db.Sessions.FindAsync(arena.SessionId))!.LanesPerHeat = 2;
            await db.SaveChangesAsync();
        });

        var response = await (await _f.AdminAsync()).PostAsJsonAsync(PreviewUrl(arena), new DrawRequest(1));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Draw_RequiresOwnerOrAdmin()
    {
        var arena = await CreateDrawArenaAsync(4, 2, 1);
        var ownerId = await _f.TrainerIdAsync();
        await _f.WithDbAsync(async db =>
        {
            (await db.Competitions.FindAsync(arena.CompetitionId))!.CreatedByUserId = ownerId;
            await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.Unauthorized,
            (await _f.CreateClient().PostAsJsonAsync(PreviewUrl(arena), new DrawRequest(1))).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await (await _f.TrainerAsync()).PostAsJsonAsync(PreviewUrl(arena), new DrawRequest(1))).StatusCode);
        var (pendingTrainer, _) = await _f.SignupAsync("Trainer");
        Assert.Equal(HttpStatusCode.Forbidden,
            (await pendingTrainer.PostAsJsonAsync(PreviewUrl(arena), new DrawRequest(1))).StatusCode);
        var (other, _) = await _f.ApprovedTrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound,
            (await other.PostAsJsonAsync(PreviewUrl(arena), new DrawRequest(1))).StatusCode);
    }

    private async Task<Arena> CreateDrawArenaAsync(int teamCount, int heatsPerSession, int additionalSessions)
    {
        var arena = await _f.CreateArenaAsync(teamCount);
        for (var h = 0; h < heatsPerSession; h++)
            await _f.AddHeatAsync(arena.SessionId, arena.TeamIds.Where((_, i) => i % heatsPerSession == h), $"Heat {h + 1}", h + 1, 2);
        for (var s = 0; s < additionalSessions; s++)
        {
            var sessionId = await _f.WithDbAsync(async db =>
            {
                var session = new Session
                {
                    CompetitionId = arena.CompetitionId, CompetitionSectionId = arena.SectionId,
                    Name = $"Session {s + 2}", OrderIndex = s + 2, Kind = SessionKind.Race,
                };
                db.Sessions.Add(session);
                await db.SaveChangesAsync();
                return session.Id;
            });
            for (var h = 0; h < heatsPerSession; h++)
                await _f.AddHeatAsync(sessionId, arena.TeamIds.Where((_, i) => i % heatsPerSession == h), $"Heat {h + 1}", h + 1, 2);
        }
        return arena;
    }

    private Task<string> EntryKeyAsync(int competitionId) => _f.WithDbAsync(async db => string.Join(',',
        await db.HeatEntries.Where(e => e.Heat!.Session!.CompetitionId == competitionId)
            .OrderBy(e => e.HeatId).ThenBy(e => e.LaneIndex)
            .Select(e => $"{e.HeatId}:{e.TeamId}:{e.LaneIndex}").ToListAsync()));

    private Task<List<(int HeatId, int RaceId, string Name, int OrderIndex)>> RaceMetadataAsync(int competitionId)
        => _f.WithDbAsync(async db => (await db.Heats
                .Where(h => h.Session!.CompetitionId == competitionId)
                .Include(h => h.Races).ToListAsync())
            .SelectMany(h => h.Races.Select(r => (HeatId: h.Id, RaceId: r.Id, r.Name, r.OrderIndex)))
            .OrderBy(row => row.RaceId).ToList());

    private static string PreviewUrl(Arena a) => $"/api/competitions/{a.CompetitionId}/sections/{a.SectionId}/draw/preview";
    private static string ApplyUrl(Arena a) => $"/api/competitions/{a.CompetitionId}/sections/{a.SectionId}/draw/apply";
}
