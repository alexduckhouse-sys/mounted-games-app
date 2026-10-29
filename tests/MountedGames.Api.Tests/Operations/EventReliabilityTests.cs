using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Operations;
using MountedGames.Api.Services.Notifications;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

public class EventReliabilityTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private async Task<(Arena Arena, DeclarationForm Form, HttpClient Trainer)> Create()
    {
        var arena = await f.CreateArenaAsync(2);
        var (trainer, auth) = await f.ApprovedTrainerAsync();
        var form = await f.WithDbAsync(async db => {
            var form = new DeclarationForm { TeamId = arena.TeamIds[0], SubmittedByUserId = auth.User.Id, IsLocked = true };
            form.Riders.Add(new RiderEntry { FullName = "Example Rider", HorseName = "Example Pony" });
            form.Riders.Add(new RiderEntry { FullName = "Example Reserve", IsReserve = true });
            db.Add(form); await db.SaveChangesAsync(); return form;
        });
        return (arena, form, trainer);
    }
    private static string Url(int id) => $"/api/competitions/{id}/substitution-requests";
    private static RequestSubstitutionDto Input(DeclarationForm form) => new(form.Riders.First(r => !r.IsReserve).Id,
        form.Riders.First(r => r.IsReserve).Id, "Example private reason");

    [Fact]
    public async Task RequestIsPrivateAndApprovalIsAuditedOnce()
    {
        var (arena, form, trainer) = await Create();
        var response = await trainer.PostAsJsonAsync($"{Url(arena.CompetitionId)}/declarations/{form.Id}", Input(form));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var request = await response.ReadAsync<SubstitutionRequestDto>();
        var retry = await trainer.PostAsJsonAsync($"{Url(arena.CompetitionId)}/declarations/{form.Id}", Input(form));
        Assert.Equal(request.Id, (await retry.ReadAsync<SubstitutionRequestDto>()).Id);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync(Url(arena.CompetitionId))).StatusCode);
        var (stranger, _) = await f.ApprovedTrainerAsync();
        Assert.Empty(await (await stranger.GetAsync(Url(arena.CompetitionId))).ReadAsync<List<SubstitutionRequestDto>>());
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync($"{Url(arena.CompetitionId)}/declarations/{form.Id}", Input(form))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync($"{Url(arena.CompetitionId)}/{request.Id}/decision", new { approve = true })).StatusCode);
        var admin = await f.AdminAsync();
        for (var i = 0; i < 2; i++) Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"{Url(arena.CompetitionId)}/{request.Id}/decision", new { approve = true })).StatusCode);
        await f.WithDbAsync(async db => {
            var swap = Assert.Single(await db.Set<RiderSwapEvent>().Where(x => x.DeclarationFormId == form.Id).ToListAsync());
            Assert.Equal("Example private reason", swap.Reason);
            Assert.True(swap.OverrodeLock);
            Assert.Equal("approved", (await db.Set<SubstitutionRequest>().FindAsync(request.Id))!.Status);
            Assert.True((await db.RiderEntries.FindAsync(Input(form).OutRiderEntryId))!.IsReserve);
        });
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ApprovalRefusesChangedAndSupersededDeclarations(bool newerForm)
    {
        var (arena, form, trainer) = await Create();
        var request = await (await trainer.PostAsJsonAsync($"{Url(arena.CompetitionId)}/declarations/{form.Id}", Input(form))).ReadAsync<SubstitutionRequestDto>();
        await f.WithDbAsync(async db => {
            if (newerForm) db.Add(new DeclarationForm { TeamId = form.TeamId, SubmittedAt = DateTime.UtcNow.AddMinutes(1) });
            else (await db.RiderEntries.FindAsync(Input(form).OutRiderEntryId))!.HorseName = "Different Example Pony";
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.Conflict, (await (await f.AdminAsync()).PostAsJsonAsync($"{Url(arena.CompetitionId)}/{request.Id}/decision", new { approve = true })).StatusCode);
        await f.WithDbAsync(async db => Assert.Empty(await db.Set<RiderSwapEvent>().Where(x => x.DeclarationFormId == form.Id).ToListAsync()));
    }

    [Fact]
    public async Task DeclineDoesNotChangeRidersAndCannotBeApprovedLater()
    {
        var (arena, form, trainer) = await Create();
        var request = await (await trainer.PostAsJsonAsync($"{Url(arena.CompetitionId)}/declarations/{form.Id}", Input(form))).ReadAsync<SubstitutionRequestDto>();
        var admin = await f.AdminAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"{Url(arena.CompetitionId)}/{request.Id}/decision", new { approve = false })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync($"{Url(arena.CompetitionId)}/{request.Id}/decision", new { approve = true })).StatusCode);
        await f.WithDbAsync(async db => Assert.False((await db.RiderEntries.FindAsync(Input(form).OutRiderEntryId))!.IsReserve));
    }

    [Fact]
    public async Task PonyOnlyReplacementUsesExistingAuditedSwap()
    {
        var (arena, form, trainer) = await Create();
        var input = new RequestSubstitutionDto(Input(form).OutRiderEntryId, 0, "Example pony change", ReplacementHorseName: "Example Replacement Pony");
        var request = await (await trainer.PostAsJsonAsync($"{Url(arena.CompetitionId)}/declarations/{form.Id}", input)).ReadAsync<SubstitutionRequestDto>();
        Assert.Equal(HttpStatusCode.NoContent, (await (await f.AdminAsync()).PostAsJsonAsync($"{Url(arena.CompetitionId)}/{request.Id}/decision", new { approve = true })).StatusCode);
        await f.WithDbAsync(async db => {
            var rider = (await db.RiderEntries.FindAsync(input.OutRiderEntryId))!;
            Assert.Equal("Example Replacement Pony", rider.HorseName); Assert.False(rider.IsReserve);
            var audit = Assert.Single(await new RiderSwapService(db).HistoryAsync(arena.CompetitionId, form.Id));
            Assert.Equal("Example Pony", audit.Before.First(r => r.RiderEntryId == input.OutRiderEntryId).HorseName);
            Assert.Equal("Example Replacement Pony", audit.After.First(r => r.RiderEntryId == input.OutRiderEntryId).HorseName);
        });
    }

    [Fact]
    public async Task CallsAreSharedIdempotentScopedAndDisappearOnStart()
    {
        var arena = await f.CreateArenaAsync(2);
        var heat = await f.AddHeatAsync(arena.SessionId, arena.TeamIds);
        var url = $"/api/competitions/{arena.CompetitionId}/heat-calls";
        var admin = await f.AdminAsync();
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().PostAsync($"{url}/{heat.HeatId}", null)).StatusCode);
        var (stranger, _) = await f.ApprovedTrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsync($"{url}/{heat.HeatId}", null)).StatusCode);
        var first = await (await admin.PostAsync($"{url}/{heat.HeatId}", null)).ReadAsync<HeatCallDto>();
        var second = await (await admin.PostAsync($"{url}/{heat.HeatId}", null)).ReadAsync<HeatCallDto>();
        Assert.Equal(first, second);
        Assert.Equal(first, Assert.Single(await (await f.CreateClient().GetAsync(url)).ReadAsync<List<HeatCallDto>>()));
        await f.WithDbAsync(async db => { (await db.Races.FindAsync(heat.RaceIds[0]))!.StartedAt = DateTime.UtcNow; await db.SaveChangesAsync(); });
        Assert.Empty(await (await f.CreateClient().GetAsync(url)).ReadAsync<List<HeatCallDto>>());
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"{url}/{heat.HeatId}", null)).StatusCode);
        var other = await f.CreateArenaAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync($"/api/competitions/{other.CompetitionId}/heat-calls/{heat.HeatId}", null)).StatusCode);
    }

    [Fact]
    public async Task AdditiveSchemaCanRunTwiceWithoutLosingData()
    {
        var arena = await f.CreateArenaAsync();
        await f.WithDbAsync(async db => {
            await db.Database.ExecuteSqlRawAsync("DROP TABLE HeatCall; DROP TABLE SubstitutionRequest;");
            await EventReliabilitySqliteSchema.EnsureAsync(db);
            await EventReliabilitySqliteSchema.EnsureAsync(db);
            Assert.True(await db.Competitions.AnyAsync(x => x.Id == arena.CompetitionId));
            Assert.Empty(await db.Set<HeatCall>().ToListAsync());
            Assert.Empty(await db.Set<SubstitutionRequest>().ToListAsync());
        });
    }
    [Fact]
    public async Task ConcurrentRequestsCreateOnePendingRowAndDifferentReplacementConflicts()
    {
        var (arena, form, trainer) = await Create();
        var url = $"{Url(arena.CompetitionId)}/declarations/{form.Id}";
        var replies = await Task.WhenAll(trainer.PostAsJsonAsync(url, Input(form)), trainer.PostAsJsonAsync(url, Input(form)));
        Assert.All(replies, reply => Assert.Equal(HttpStatusCode.OK, reply.StatusCode));
        var ids = await Task.WhenAll(replies.Select(reply => reply.ReadAsync<SubstitutionRequestDto>()));
        Assert.Equal(ids[0].Id, ids[1].Id);
        Assert.Equal(HttpStatusCode.Conflict, (await trainer.PostAsJsonAsync(url, Input(form) with { Reason = "Changed example reason" })).StatusCode);
    }

    [Fact]
    public async Task ConcurrentApprovalAndDeclineNeverDisagreeWithTheAudit()
    {
        var (arena, form, trainer) = await Create();
        var request = await (await trainer.PostAsJsonAsync($"{Url(arena.CompetitionId)}/declarations/{form.Id}", Input(form))).ReadAsync<SubstitutionRequestDto>();
        var admin = await f.AdminAsync();
        var url = $"{Url(arena.CompetitionId)}/{request.Id}/decision";
        var responses = await Task.WhenAll(admin.PostAsJsonAsync(url, new { approve = true }), admin.PostAsJsonAsync(url, new { approve = false }));
        Assert.Contains(responses, r => r.StatusCode == HttpStatusCode.NoContent);
        Assert.All(responses, r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.NoContent, HttpStatusCode.Conflict }));
        await f.WithDbAsync(async db => {
            var status = (await db.Set<SubstitutionRequest>().FindAsync(request.Id))!.Status;
            var swaps = await db.Set<RiderSwapEvent>().CountAsync(x => x.DeclarationFormId == form.Id);
            Assert.Equal(status == "approved" ? 1 : 0, swaps);
        });
    }

    [Fact]
    public async Task ReviewCleanupRemovesReliabilityRows()
    {
        var (arena, form, trainer) = await Create();
        var heat = await f.AddHeatAsync(arena.SessionId, arena.TeamIds);
        (await trainer.PostAsJsonAsync($"{Url(arena.CompetitionId)}/declarations/{form.Id}", Input(form))).EnsureSuccessStatusCode();
        (await (await f.AdminAsync()).PostAsync($"/api/competitions/{arena.CompetitionId}/heat-calls/{heat.HeatId}", null)).EnsureSuccessStatusCode();
        await f.WithDbAsync(async db => {
            await ReviewCompetitionSeeder.DeleteCompetitionGraphAsync(db, [arena.CompetitionId]);
            Assert.False(await db.Set<HeatCall>().AnyAsync(x => x.HeatId == heat.HeatId));
            Assert.False(await db.Set<SubstitutionRequest>().AnyAsync(x => x.CompetitionId == arena.CompetitionId));
        });
    }

    [Fact]
    public async Task CollectingRingNotificationPlanSurvivesRequestsAndStopsWhenHeatStarts()
    {
        var (arena, form, trainer) = await Create();
        var heat = await f.AddHeatAsync(arena.SessionId, arena.TeamIds);
        await f.WithDbAsync(async db => {
            (await db.Teams.FindAsync(form.TeamId))!.TrainerUserId = form.SubmittedByUserId;
            db.Add(new HeatCall { HeatId = heat.HeatId, CalledAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
            var plan = Assert.Single(await ReminderPlan.LoadAsync(db, DateTime.UtcNow, default, arena.CompetitionId),
                x => x.Key == $"collecting-ring:{heat.HeatId}");
            Assert.Contains(form.SubmittedByUserId!, plan.Users);
            Assert.Equal(TimeSpan.FromMinutes(15), plan.ExpiresAt - plan.DueAt);
            Assert.Contains("collecting ring", plan.Payload.Body);
            (await db.Races.FindAsync(heat.RaceIds[0]))!.StartedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            Assert.DoesNotContain(await ReminderPlan.LoadAsync(db, DateTime.UtcNow, default, arena.CompetitionId), x => x.Key == plan.Key);
        });
    }

    [Fact]
    public async Task DeletingRequesterRemovesTheirPrivateSubstitutionRecords()
    {
        var (arena, form, trainer) = await Create();
        (await trainer.PostAsJsonAsync($"{Url(arena.CompetitionId)}/declarations/{form.Id}", Input(form))).EnsureSuccessStatusCode();
        var response = await trainer.SendAsync(new HttpRequestMessage(HttpMethod.Delete, "/api/auth/me")
            { Content = JsonContent.Create(new { password = "Passw0rd!x" }) });
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await f.WithDbAsync(async db => Assert.False(await db.Set<SubstitutionRequest>().AnyAsync(x => x.DeclarationFormId == form.Id)));
    }

}
