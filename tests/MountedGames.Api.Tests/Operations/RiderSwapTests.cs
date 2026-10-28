using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

public class RiderSwapTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public RiderSwapTests(ApiFactory f) => _f = f;

    private sealed record Form(Arena Arena, int TeamId, int FormId, int CaptainId, int RiderId, int ReserveId);

    private async Task<Form> BuildAsync(bool locked = true)
    {
        var arena = await _f.CreateArenaAsync(2);
        var (formId, ids) = await _f.WithDbAsync(async db =>
        {
            var form = new DeclarationForm { TeamId = arena.TeamIds[0], IsLocked = locked, Notes = "private note" };
            form.Riders.Add(new RiderEntry { FullName = "Alice Captain", IsCaptain = true, OrderIndex = 0 });
            form.Riders.Add(new RiderEntry { FullName = "Bea Rider", OrderIndex = 1 });
            form.Riders.Add(new RiderEntry { FullName = "Cara Reserve", IsReserve = true, OrderIndex = 2 });
            db.DeclarationForms.Add(form);
            await db.SaveChangesAsync();
            return (form.Id, form.Riders.OrderBy(r => r.OrderIndex).Select(r => r.Id).ToArray());
        });
        return new Form(arena, arena.TeamIds[0], formId, ids[0], ids[1], ids[2]);
    }

    private static string SwapUrl(Form f) => $"/api/competitions/{f.Arena.CompetitionId}/declaration-forms/{f.FormId}/swap";
    private static string HistoryUrl(Form f) => $"/api/competitions/{f.Arena.CompetitionId}/declaration-forms/{f.FormId}/swaps";

    private Task<List<RiderEntry>> RidersAsync(int formId) => _f.WithDbAsync(db =>
        db.RiderEntries.AsNoTracking().Where(r => r.DeclarationFormId == formId).OrderBy(r => r.Id).ToListAsync());

    [Fact]
    public async Task Swap_BringsTheReserveIn_AndWritesAnAuditEntry()
    {
        var f = await BuildAsync(locked: false);
        var admin = await _f.AdminAsync();

        var response = await admin.PostAsJsonAsync(SwapUrl(f),
            new SwapRiderRequest(f.RiderId, f.ReserveId, "Pony lame", false, "swap-1"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var swap = await response.ReadAsync<RiderSwapDto>();
        Assert.False(swap.OverrodeLock);
        Assert.Equal("Pony lame", swap.Reason);
        Assert.NotNull(swap.ActorUserId);
        Assert.True(swap.Before.Single(r => r.RiderEntryId == f.ReserveId).IsReserve);
        Assert.False(swap.After.Single(r => r.RiderEntryId == f.ReserveId).IsReserve);
        Assert.True(swap.After.Single(r => r.RiderEntryId == f.RiderId).IsReserve);
        var riders = await RidersAsync(f.FormId);
        Assert.False(riders.Single(r => r.Id == f.ReserveId).IsReserve);
        Assert.True(riders.Single(r => r.Id == f.RiderId).IsReserve);
        var history = await (await admin.GetAsync(HistoryUrl(f))).ReadAsync<List<RiderSwapDto>>();
        Assert.Equal(swap.Id, Assert.Single(history).Id);
        Assert.True(history[0].CreatedAt > DateTime.UtcNow.AddMinutes(-1));
    }

    [Fact]
    public async Task Swap_MovesTheCaptainBadgeWithTheSeat()
    {
        var f = await BuildAsync(locked: false);

        var response = await (await _f.AdminAsync()).PostAsJsonAsync(SwapUrl(f),
            new SwapRiderRequest(f.CaptainId, f.ReserveId, null, false, "swap-captain"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var riders = await RidersAsync(f.FormId);
        Assert.True(riders.Single(r => r.Id == f.ReserveId).IsCaptain);
        Assert.False(riders.Single(r => r.Id == f.CaptainId).IsCaptain);
        Assert.Single(riders, r => r.IsCaptain);
        Assert.Equal(2, riders.Single(r => r.Id == f.CaptainId).OrderIndex);
        Assert.Equal(0, riders.Single(r => r.Id == f.ReserveId).OrderIndex);
    }

    [Fact]
    public async Task LockedDeclaration_NeedsAnExplicitOverrideAndAReason()
    {
        var f = await BuildAsync(locked: true);
        var admin = await _f.AdminAsync();

        var plain = await admin.PostAsJsonAsync(SwapUrl(f), new SwapRiderRequest(f.RiderId, f.ReserveId, "Lame", false, "s1"));
        var noReason = await admin.PostAsJsonAsync(SwapUrl(f), new SwapRiderRequest(f.RiderId, f.ReserveId, "  ", true, "s2"));
        var overridden = await admin.PostAsJsonAsync(SwapUrl(f), new SwapRiderRequest(f.RiderId, f.ReserveId, "Lame", true, "s3"));

        Assert.Equal(HttpStatusCode.Conflict, plain.StatusCode);
        Assert.Contains("locked", await plain.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.BadRequest, noReason.StatusCode);
        Assert.Equal(HttpStatusCode.OK, overridden.StatusCode);
        Assert.True((await overridden.ReadAsync<RiderSwapDto>()).OverrodeLock);
        Assert.Equal(1, await _f.WithDbAsync(db => db.Set<RiderSwapEvent>().CountAsync(e => e.DeclarationFormId == f.FormId)));
    }

    [Fact]
    public async Task Swap_RetriedWithTheSameRequestId_IsAppliedOnce()
    {
        var f = await BuildAsync(locked: false);
        var admin = await _f.AdminAsync();
        var request = new SwapRiderRequest(f.RiderId, f.ReserveId, "Lame", false, "swap-retry");

        var first = await admin.PostAsJsonAsync(SwapUrl(f), request);
        var second = await admin.PostAsJsonAsync(SwapUrl(f), request);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.True((await second.ReadAsync<RiderSwapDto>()).Replayed);
        Assert.Equal(1, await _f.WithDbAsync(db => db.Set<RiderSwapEvent>().CountAsync(e => e.DeclarationFormId == f.FormId)));
        Assert.True((await RidersAsync(f.FormId)).Single(r => r.Id == f.RiderId).IsReserve);
    }

    [Fact]
    public async Task Swap_RejectsBadPairs()
    {
        var f = await BuildAsync(locked: false);
        var admin = await _f.AdminAsync();
        async Task<HttpStatusCode> Try(int outId, int inId, string requestId = "bad")
            => (await admin.PostAsJsonAsync(SwapUrl(f), new SwapRiderRequest(outId, inId, "x", false, requestId))).StatusCode;

        Assert.Equal(HttpStatusCode.BadRequest, await Try(f.RiderId, f.RiderId));
        Assert.Equal(HttpStatusCode.BadRequest, await Try(f.ReserveId, f.RiderId));
        Assert.Equal(HttpStatusCode.BadRequest, await Try(f.RiderId, f.CaptainId));
        Assert.Equal(HttpStatusCode.BadRequest, await Try(f.RiderId, 9_999_999));
        Assert.Equal(HttpStatusCode.BadRequest, await Try(f.RiderId, f.ReserveId, ""));
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(SwapUrl(f),
            new SwapRiderRequest(f.RiderId, f.ReserveId, new string('x', 501), false, "long"))).StatusCode);
        Assert.Empty(await _f.WithDbAsync(db => db.Set<RiderSwapEvent>().Where(e => e.DeclarationFormId == f.FormId).ToListAsync()));
    }

    [Fact]
    public async Task Swap_OnlyOnTheTeamsCurrentDeclaration()
    {
        var f = await BuildAsync(locked: false);
        await _f.WithDbAsync(async db =>
        {
            db.DeclarationForms.Add(new DeclarationForm { TeamId = f.TeamId, SubmittedAt = DateTime.UtcNow.AddHours(1) });
            await db.SaveChangesAsync();
        });

        var response = await (await _f.AdminAsync()).PostAsJsonAsync(SwapUrl(f),
            new SwapRiderRequest(f.RiderId, f.ReserveId, "x", false, "old"));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Swap_FromAnotherCompetition_IsNotFound_AndHistoryIsOrganiserOnly()
    {
        var f = await BuildAsync(locked: false);
        var other = await _f.CreateArenaAsync(1);
        var admin = await _f.AdminAsync();

        var wrongCompetition = await admin.PostAsJsonAsync(
            $"/api/competitions/{other.CompetitionId}/declaration-forms/{f.FormId}/swap",
            new SwapRiderRequest(f.RiderId, f.ReserveId, "x", false, "cross"));
        var wrongHistory = await admin.GetAsync($"/api/competitions/{other.CompetitionId}/declaration-forms/{f.FormId}/swaps");
        await admin.PostAsJsonAsync(SwapUrl(f), new SwapRiderRequest(f.RiderId, f.ReserveId, "x", false, "real"));

        Assert.Equal(HttpStatusCode.NotFound, wrongCompetition.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, wrongHistory.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await _f.CreateClient().GetAsync(HistoryUrl(f))).StatusCode);
    }

    [Fact]
    public async Task PublicDeclarations_DoNotExposeTheSwapAudit()
    {
        var f = await BuildAsync(locked: true);
        await (await _f.AdminAsync()).PostAsJsonAsync(SwapUrl(f),
            new SwapRiderRequest(f.RiderId, f.ReserveId, "Secret medical reason", true, "pub"));

        var body = await _f.CreateClient().GetStringAsync($"/api/declaration-forms?teamId={f.TeamId}");

        Assert.DoesNotContain("Secret medical reason", body);
        Assert.DoesNotContain("private note", body);
    }

    [Fact]
    public async Task Swap_EmergencyReplacementWithoutDeclaredReserve_AddsReplacementRiderAndLogsAudit()
    {
        var arena = await _f.CreateArenaAsync(1);
        var (formId, captainId) = await _f.WithDbAsync(async db =>
        {
            var form = new DeclarationForm { TeamId = arena.TeamIds[0], IsLocked = true };
            form.Riders.Add(new RiderEntry { FullName = "Pair Rider 1", HorseName = "Star", DateOfBirth = new DateTime(2000, 1, 1), PonyHeightHands = 13.2m, IsCaptain = true, OrderIndex = 0 });
            form.Riders.Add(new RiderEntry { FullName = "Pair Rider 2", HorseName = "Moon", OrderIndex = 1 });
            db.DeclarationForms.Add(form);
            await db.SaveChangesAsync();
            return (form.Id, form.Riders.OrderBy(r => r.OrderIndex).First().Id);
        });

        var admin = await _f.AdminAsync();
        var response = await admin.PostAsJsonAsync(
            $"/api/competitions/{arena.CompetitionId}/declaration-forms/{formId}/swap",
            new SwapRiderRequest(
                captainId,
                0,
                "[Emergency: Emergency Sam | Comet] Referee approved replacement",
                true,
                "emerg-1"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var swap = await response.ReadAsync<RiderSwapDto>();
        Assert.True(swap.OverrodeLock);
        Assert.Contains(swap.After, r => r.FullName == "Emergency Sam" && !r.IsReserve && r.IsCaptain);

        var riders = await RidersAsync(formId);
        var replacement = Assert.Single(riders, r => r.FullName == "Emergency Sam");
        Assert.Equal("Comet", replacement.HorseName);
        Assert.Null(replacement.DateOfBirth);
        Assert.Null(replacement.PonyHeightHands);
        Assert.True(replacement.IsCaptain);
        Assert.False(replacement.IsReserve);
        Assert.True(riders.Single(r => r.Id == captainId).IsReserve);
    }

    [Fact]
    public async Task PonyOnlyReplacement_ClearsOldPonyIdentityButPreservesRiderAndPrivacy()
    {
        var f = await BuildAsync(locked: false);
        var savedId = await _f.WithDbAsync(async db =>
        {
            var rider = await db.RiderEntries.SingleAsync(r => r.Id == f.CaptainId);
            var team = await db.Teams.SingleAsync(t => t.Id == f.TeamId);
            var saved = new SavedRider { ClubId = team.ClubId, FullName = "Example Rider", HorseName = "Example Old Pony" };
            db.SavedRiders.Add(saved);
            await db.SaveChangesAsync();
            rider.SavedRiderId = saved.Id;
            rider.HorseName = saved.HorseName;
            rider.PonyHeightHands = 13.2m;
            rider.PonyPassportNumber = "TEST-PONY-ONLY";
            rider.PonyOwnerFullName = "Example Owner";
            rider.PonyAge = 10;
            rider.UseInitialOnly = true;
            rider.MedicalNotes = "Example rider note";
            await db.SaveChangesAsync();
            return saved.Id;
        });

        var response = await (await _f.AdminAsync()).PostAsJsonAsync(SwapUrl(f),
            new SwapRiderRequest(f.CaptainId, 0, "[Emergency: | Example New Pony] Approved replacement", false, "pony-only"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var riders = await RidersAsync(f.FormId);
        Assert.Equal(3, riders.Count);
        var rider = riders.Single(r => r.Id == f.CaptainId);
        Assert.Equal("Example New Pony", rider.HorseName);
        Assert.Null(rider.PonyHeightHands);
        Assert.Null(rider.PonyPassportNumber);
        Assert.Null(rider.PonyOwnerFullName);
        Assert.Null(rider.PonyAge);
        Assert.Null(rider.SavedRiderId);
        Assert.True(rider.UseInitialOnly);
        Assert.True(rider.IsCaptain);
        Assert.False(rider.IsReserve);
        Assert.Equal(0, rider.OrderIndex);
        Assert.Equal("Example rider note", rider.MedicalNotes);
        Assert.Equal("Example Old Pony", await _f.WithDbAsync(db => db.SavedRiders.Where(r => r.Id == savedId).Select(r => r.HorseName).SingleAsync()));
    }
}
