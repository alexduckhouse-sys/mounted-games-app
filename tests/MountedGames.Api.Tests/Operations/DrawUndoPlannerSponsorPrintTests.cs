using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

public class DrawUndoPlannerSponsorPrintTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public DrawUndoPlannerSponsorPrintTests(ApiFactory f) => _f = f;

    [Fact]
    public async Task SectionDraw_CreatesUndoSnapshot_AndUndoRestoresPreviousHeatEntries()
    {
        var arena = await _f.CreateArenaAsync(4);
        await _f.AddHeatAsync(arena.SessionId, arena.TeamIds.Take(2), "Heat 1", 1, 2);
        await _f.AddHeatAsync(arena.SessionId, arena.TeamIds.Skip(2), "Heat 2", 2, 2);

        var admin = await _f.AdminAsync();
        var beforeEntries = await GetEntriesSnapshotAsync(arena.CompetitionId);

        var preview = await (await admin.PostAsJsonAsync(
            $"/api/competitions/{arena.CompetitionId}/sections/{arena.SectionId}/draw/preview",
            new DrawRequest(77))).ReadAsync<DrawPreviewDto>();

        var applyResp = await admin.PostAsJsonAsync(
            $"/api/competitions/{arena.CompetitionId}/sections/{arena.SectionId}/draw/apply",
            new ApplyDrawRequest(77, preview.Fingerprint));
        Assert.Equal(HttpStatusCode.OK, applyResp.StatusCode);
        var applied = await applyResp.ReadAsync<DrawPreviewDto>();
        Assert.NotNull(applied.DrawUndo);
        Assert.True(applied.DrawUndo!.Available);
        Assert.Equal("SectionDraw", applied.DrawUndo.Kind);

        var status = await (await admin.GetAsync($"/api/competitions/{arena.CompetitionId}/draw-undo"))
            .ReadAsync<DrawUndoStatusDto>();
        Assert.True(status.Available);
        Assert.Equal(2, status.AffectedHeats);

        var readiness = await (await admin.GetAsync($"/api/competitions/{arena.CompetitionId}/operations/readiness"))
            .ReadAsync<CompetitionReadinessDto>();
        Assert.NotNull(readiness.DrawUndo);
        Assert.True(readiness.DrawUndo!.Available);

        var undoResp = await admin.PostAsJsonAsync($"/api/competitions/{arena.CompetitionId}/draw-undo", new { });
        Assert.Equal(HttpStatusCode.OK, undoResp.StatusCode);
        var undoResult = await undoResp.ReadAsync<DrawUndoResultDto>();
        Assert.True(undoResult.Restored);
        Assert.Equal(2, undoResult.RestoredHeats);
        Assert.False(undoResult.UndoStatus.Available);

        var afterUndoEntries = await GetEntriesSnapshotAsync(arena.CompetitionId);
        Assert.Equal(beforeEntries, afterUndoEntries);
    }

    [Fact]
    public async Task DeleteHeat_AndClearHeats_CanBeRestoredViaDrawUndo()
    {
        var arena = await _f.CreateArenaAsync(4);
        var (heat1Id, _) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds.Take(2), "Heat 1", 1, 2);
        var (heat2Id, _) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds.Skip(2), "Heat 2", 2, 2);

        var admin = await _f.AdminAsync();

        // Delete Heat 2
        var delResp = await admin.DeleteAsync(
            $"/api/competitions/{arena.CompetitionId}/sessions/{arena.SessionId}/heats/{heat2Id}");
        Assert.Equal(HttpStatusCode.OK, delResp.StatusCode);
        var afterDeleteSession = await delResp.ReadAsync<SessionDto>();
        Assert.Single(afterDeleteSession.Heats);
        Assert.Equal(heat1Id, afterDeleteSession.Heats[0].Id);

        // Undo deletion of Heat 2
        var undoDeleteResp = await admin.PostAsJsonAsync($"/api/competitions/{arena.CompetitionId}/draw-undo", new { });
        Assert.Equal(HttpStatusCode.OK, undoDeleteResp.StatusCode);
        var undoDelete = await undoDeleteResp.ReadAsync<DrawUndoResultDto>();
        Assert.True(undoDelete.Restored);
        Assert.Contains("Deleted Heat 2", undoDelete.Label);

        var restoredSession = await (await admin.GetAsync($"/api/competitions/{arena.CompetitionId}/sessions/{arena.SessionId}"))
            .ReadAsync<SessionDto>();
        Assert.Equal(2, restoredSession.Heats.Count);
        Assert.Equal(2, restoredSession.Heats[1].Entries.Count);
        Assert.Equal(2, restoredSession.Heats[1].Races.Count);

        // Clear all heats in session
        var clearResp = await admin.DeleteAsync(
            $"/api/competitions/{arena.CompetitionId}/sessions/{arena.SessionId}/heats");
        Assert.Equal(HttpStatusCode.OK, clearResp.StatusCode);
        var clearedSession = await clearResp.ReadAsync<SessionDto>();
        Assert.Empty(clearedSession.Heats);

        // Undo clear heats
        var undoClearResp = await admin.PostAsJsonAsync($"/api/competitions/{arena.CompetitionId}/draw-undo", new { });
        Assert.Equal(HttpStatusCode.OK, undoClearResp.StatusCode);
        var afterUndoClear = await (await admin.GetAsync($"/api/competitions/{arena.CompetitionId}/sessions/{arena.SessionId}"))
            .ReadAsync<SessionDto>();
        Assert.Equal(2, afterUndoClear.Heats.Count);
    }

    [Fact]
    public async Task DeleteHeat_ClearHeats_AndUndo_RejectScoredHeats_AndEnforceAuth()
    {
        var arena = await _f.CreateArenaAsync(2);
        var (heatId, _) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, "Heat 1", 1, 1);

        var anon = _f.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await anon.GetAsync($"/api/competitions/{arena.CompetitionId}/draw-undo")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await anon.PostAsJsonAsync($"/api/competitions/{arena.CompetitionId}/draw-undo", new { })).StatusCode);

        var admin = await _f.AdminAsync();
        Assert.Equal(HttpStatusCode.NotFound,
            (await admin.GetAsync("/api/competitions/999999/draw-undo")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await admin.PostAsJsonAsync("/api/competitions/999999/draw-undo", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await admin.PostAsJsonAsync($"/api/competitions/{arena.CompetitionId}/draw-undo", new { })).StatusCode);

        // Score the heat and verify DeleteHeat & ClearHeats return 409 Conflict
        await _f.WithDbAsync(async db =>
        {
            var race = await db.Races.FirstAsync(r => r.HeatId == heatId);
            race.IsComplete = true;
            db.Results.Add(new Result { RaceId = race.Id, TeamId = arena.TeamIds[0], Placing = 1, Points = 2 });
            await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.Conflict,
            (await admin.DeleteAsync($"/api/competitions/{arena.CompetitionId}/sessions/{arena.SessionId}/heats/{heatId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await admin.DeleteAsync($"/api/competitions/{arena.CompetitionId}/sessions/{arena.SessionId}/heats")).StatusCode);
    }

    [Fact]
    public async Task SponsorStats_ReturnsHumanFriendlyPlacements_ViewsAndFormattedOnScreenTime()
    {
        var arena = await _f.CreateArenaAsync(1);
        var admin = await _f.AdminAsync();

        var created = await (await admin.PostAsJsonAsync(
            $"/api/competitions/{arena.CompetitionId}/sponsors",
            new SponsorRequest(
                "Baileys Horse Feeds",
                "https://baileys.example",
                SponsorTier.Headline,
                SponsorPlacement.Details | SponsorPlacement.Results | SponsorPlacement.Stream | SponsorPlacement.SponsorPage | SponsorPlacement.Replays,
                true,
                null,
                null))).ReadAsync<SponsorAdminDto>();

        var exposureResp = await admin.PostAsJsonAsync(
            $"/api/competitions/{arena.CompetitionId}/sponsors/exposures",
            new SponsorExposureBatch(
            [
                new SponsorExposureItem(created.Id, SponsorPlacement.Details, 120, 0),
                new SponsorExposureItem(created.Id, SponsorPlacement.Results, 80, 0),
                new SponsorExposureItem(created.Id, SponsorPlacement.Stream, 25, 3600),
                new SponsorExposureItem(created.Id, SponsorPlacement.BreakStream, 20, 65),
                new SponsorExposureItem(created.Id, SponsorPlacement.SponsorPage, 15, 0),
                new SponsorExposureItem(created.Id, SponsorPlacement.Replays, 10, 0),
            ]));
        Assert.Equal(HttpStatusCode.NoContent, exposureResp.StatusCode);

        var report = await (await admin.GetAsync(
            $"/api/competitions/{arena.CompetitionId}/sponsor-stats")).ReadAsync<SponsorValueReportDto>();

        Assert.Equal(arena.CompetitionId, report.CompetitionId);
        Assert.Equal(270, report.TotalViews);
        Assert.Equal(3665, report.TotalSeconds);
        Assert.Equal("1h 1m 5s", report.FormattedTotalOnScreenTime);
        Assert.Single(report.Sponsors);

        var item = report.Sponsors[0];
        Assert.Equal("Baileys Horse Feeds", item.SponsorName);
        Assert.Equal("Headline", item.TierLabel);
        Assert.Equal(["Overview", "Standings", "Live Stream Overlay", "Sponsor Page"], item.PlacementLabels);
        Assert.Equal("1h 1m 5s", item.FormattedOnScreenTime);

        var streamPlacement = item.Placements.Single(p => p.Label == "Live Stream Overlay");
        Assert.Equal(55, streamPlacement.Views);
        Assert.Equal(3665, streamPlacement.Seconds);
        Assert.Equal("1h 1m 5s", streamPlacement.FormattedOnScreenTime);
    }

    [Fact]
    public async Task PrintableResults_IncludesSessionSummariesAndSupportsSingleSessionFilter()
    {
        var arena = await _f.CreateArenaAsync(2);
        var (heat1Id, _) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds, "Heat 1", 1, 1);
        await _f.WithDbAsync(async db =>
        {
            var race = await db.Races.FirstAsync(r => r.HeatId == heat1Id);
            race.IsComplete = true;
            db.Results.Add(new Result { RaceId = race.Id, TeamId = arena.TeamIds[0], Placing = 1, Points = 2 });
            db.Results.Add(new Result { RaceId = race.Id, TeamId = arena.TeamIds[1], Placing = 2, Points = 1 });
            await db.SaveChangesAsync();
        });

        var anon = _f.CreateClient();
        var full = await (await anon.GetAsync(
            $"/api/event-tools/competitions/{arena.CompetitionId}/print/results")).ReadAsync<PrintableResultsDto>();

        Assert.NotNull(full.Sessions);
        Assert.Single(full.Sessions!);
        Assert.True(full.Sessions![0].IsCompleted);
        Assert.Equal(1, full.Sessions[0].CompletedHeats);
        Assert.NotNull(full.Heats);
        Assert.Single(full.Heats!);

        var filtered = await (await anon.GetAsync(
            $"/api/event-tools/competitions/{arena.CompetitionId}/print/results?sessionId={arena.SessionId}"))
            .ReadAsync<PrintableResultsDto>();
        Assert.NotNull(filtered.Heats);
        Assert.Single(filtered.Heats!);
        Assert.Equal(arena.SessionId, filtered.Heats![0].SessionId);
    }

    private Task<string> GetEntriesSnapshotAsync(int competitionId) =>
        _f.WithDbAsync(async db => string.Join('|',
            await db.HeatEntries
                .Where(e => e.Heat!.Session!.CompetitionId == competitionId)
                .OrderBy(e => e.Heat!.OrderIndex)
                .ThenBy(e => e.LaneIndex)
                .Select(e => $"{e.Heat!.OrderIndex}:{e.TeamId}:{e.LaneIndex}")
                .ToListAsync()));
}
