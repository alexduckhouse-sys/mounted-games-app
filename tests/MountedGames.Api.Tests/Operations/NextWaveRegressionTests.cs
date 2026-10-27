using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

public class NextWaveRegressionTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task AnonymousBriefing_DoesNotExposeAnUnlockedDeclaration()
    {
        var arena = await factory.CreateArenaAsync(1);
        var (heatId, _) = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds);
        var trainerId = await factory.TrainerIdAsync();
        await factory.WithDbAsync(async db =>
        {
            db.DeclarationForms.Add(new DeclarationForm
            {
                TeamId = arena.TeamIds[0], SubmittedByUserId = trainerId, IsLocked = false,
                Riders = { new RiderEntry { FullName = "Synthetic Private Rider", HorseName = "Synthetic Private Pony" } },
            });
            await db.SaveChangesAsync();
        });

        var briefing = await BriefingAsync(arena, arena.SessionId, heatId);

        Assert.Empty(Assert.Single(briefing.Lanes).RidersAndPonies);
    }

    [Fact]
    public async Task AnonymousBriefing_UsesTheLockedFormAndRespectsInitialOnly()
    {
        var arena = await factory.CreateArenaAsync(1);
        var (heatId, _) = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds);
        var trainerId = await factory.TrainerIdAsync();
        await factory.WithDbAsync(async db =>
        {
            db.DeclarationForms.AddRange(
                new DeclarationForm
                {
                    TeamId = arena.TeamIds[0], SubmittedByUserId = trainerId, IsLocked = true,
                    SubmittedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                    Riders = { new RiderEntry { FullName = "Synthetic Public", HorseName = "Synthetic Pony", UseInitialOnly = true } },
                },
                new DeclarationForm
                {
                    TeamId = arena.TeamIds[0], SubmittedByUserId = trainerId, IsLocked = false,
                    SubmittedAt = new DateTime(2026, 1, 2, 0, 0, 0, DateTimeKind.Utc),
                    Riders = { new RiderEntry { FullName = "Synthetic Private Rider", HorseName = "Synthetic Private Pony" } },
                });
            await db.SaveChangesAsync();
        });

        var briefing = await BriefingAsync(arena, arena.SessionId, heatId);

        Assert.Equal("Synthetic P. on Synthetic Pony", Assert.Single(Assert.Single(briefing.Lanes).RidersAndPonies));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task InvalidDutyReplacement_PreservesExistingDutiesAndClaims(bool withdrawnTeam)
    {
        var arena = await factory.CreateArenaAsync(2);
        var original = await SeedClaimedDutyAsync(arena);
        var invalidTeamId = arena.TeamIds[1];
        if (withdrawnTeam)
            await factory.WithDbAsync(db => db.Teams.Where(t => t.Id == invalidTeamId)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.EntryStatus, TeamEntryStatus.Withdrawn)));
        else
            invalidTeamId = (await factory.CreateArenaAsync(1)).TeamIds[0];
        var admin = await factory.AdminAsync();

        var response = await admin.PostAsJsonAsync(DutiesUrl(arena), new AssignSessionDutiesRequest(
            Duties: [new("Synthetic Valid", AssignedTeamId: arena.TeamIds[0]), new("Synthetic Invalid", AssignedTeamId: invalidTeamId)]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await AssertOriginalDutyAsync(arena, original);
    }

    [Fact]
    public async Task FailedDutyReplacement_RollsBackDeletedDutiesClaimsAndEarlierInserts()
    {
        var arena = await factory.CreateArenaAsync(1);
        var original = await SeedClaimedDutyAsync(arena);
        await factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("""
            CREATE TRIGGER reject_synthetic_duty BEFORE INSERT ON VolunteerShift
            WHEN NEW.Role = 'Synthetic Failure'
            BEGIN SELECT RAISE(ABORT, 'Synthetic insertion failure'); END;
            """));
        try
        {
            var admin = await factory.AdminAsync();
            var response = await admin.PostAsJsonAsync(DutiesUrl(arena), new AssignSessionDutiesRequest(
                Duties: [new("Synthetic Valid", AssignedTeamId: arena.TeamIds[0]), new("Synthetic Failure", AssignedTeamId: arena.TeamIds[0])]));

            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
            await AssertOriginalDutyAsync(arena, original);
        }
        finally
        {
            await factory.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("DROP TRIGGER reject_synthetic_duty;"));
        }
    }

    [Fact]
    public async Task Briefing_UsesFinalOnlyTotalsAndRanksWhenEarlierPointsDoNotCarry()
    {
        var arena = await factory.CreateArenaAsync(2);
        var (_, raceIds) = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 2);
        await ScoreAsync(raceIds[0], (arena.TeamIds[0], 1, 2), (arena.TeamIds[1], 2, 1));
        await ScoreAsync(raceIds[1], (arena.TeamIds[0], 1, 2), (arena.TeamIds[1], 2, 1));
        var finalSessionId = await NewSessionAsync(arena, 2);
        var (finalHeatId, finals) = await factory.AddHeatAsync(finalSessionId, arena.TeamIds, label: "A Final");
        await ScoreAsync(finals[0], (arena.TeamIds[0], 2, 1), (arena.TeamIds[1], 1, 2));
        await factory.WithDbAsync(db => db.CompetitionSections.Where(s => s.Id == arena.SectionId)
            .ExecuteUpdateAsync(s => s.SetProperty(s => s.CarryPointsIntoFinal, false)));

        var briefing = await BriefingAsync(arena, finalSessionId, finalHeatId);

        await AssertMatchesStandingsAsync(arena, briefing);
        Assert.Equal(2, briefing.Lanes.Single(l => l.TeamId == arena.TeamIds[1]).TotalPoints);
        Assert.Equal(1, briefing.Lanes.Single(l => l.TeamId == arena.TeamIds[1]).CurrentRank);
        Assert.Contains("Team 2 climbed 1 place to #1", briefing.BiggestMoverHeadline);

        var previous = await factory.WithDbAsync(db => new StandingsService(db)
            .RowsBeforeSessionAsync(arena.CompetitionId, finalSessionId, arena.SectionId));
        Assert.Equal(arena.TeamIds[0], previous[0].TeamId);
        Assert.Equal(4, previous[0].TotalPoints);
        Assert.All(previous, row => Assert.Null(row.FinalTier));
        await AssertMatchesStandingsAsync(arena, briefing);
    }

    [Theory]
    [InlineData(TieBreakRule.LastRace)]
    [InlineData(TieBreakRule.Manual)]
    public async Task Briefing_UsesTheConfiguredTieBreak(TieBreakRule rule)
    {
        var arena = await factory.CreateArenaAsync(2);
        var (heatId, races) = await factory.AddHeatAsync(arena.SessionId, arena.TeamIds, raceCount: 2);
        await ScoreAsync(races[0], (arena.TeamIds[0], 1, 2), (arena.TeamIds[1], 2, 1));
        await ScoreAsync(races[1], (arena.TeamIds[0], 2, 1), (arena.TeamIds[1], 1, 2));
        await factory.WithDbAsync(db => db.CompetitionSections.Where(s => s.Id == arena.SectionId)
            .ExecuteUpdateAsync(s => s.SetProperty(s => s.TieBreakRule, rule)));
        if (rule == TieBreakRule.Manual)
            await factory.WithDbAsync(async db =>
            {
                db.FinalsTieOrders.AddRange(
                    new FinalsTieOrder { CompetitionId = arena.CompetitionId, TeamId = arena.TeamIds[0], Points = 3, Position = 2 },
                    new FinalsTieOrder { CompetitionId = arena.CompetitionId, TeamId = arena.TeamIds[1], Points = 3, Position = 1 });
                await db.SaveChangesAsync();
            });

        var briefing = await BriefingAsync(arena, arena.SessionId, heatId);

        await AssertMatchesStandingsAsync(arena, briefing);
        Assert.Equal(1, briefing.Lanes.Single(l => l.TeamId == arena.TeamIds[1]).CurrentRank);
    }

    [Fact]
    public async Task PriorStandings_RejectABoundaryFromAnotherCompetition()
    {
        var arena = await factory.CreateArenaAsync(1);
        var other = await factory.CreateArenaAsync(1);

        await Assert.ThrowsAsync<KeyNotFoundException>(() => factory.WithDbAsync(db => new StandingsService(db)
            .RowsBeforeSessionAsync(arena.CompetitionId, other.SessionId, arena.SectionId)));
    }

    private async Task<CommentatorBriefingDto> BriefingAsync(Arena arena, int sessionId, int heatId)
    {
        var response = await factory.CreateClient().GetAsync(
            $"/api/competitions/{arena.CompetitionId}/sessions/{sessionId}/heats/{heatId}/commentator-briefing");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<CommentatorBriefingDto>();
    }

    private async Task AssertMatchesStandingsAsync(Arena arena, CommentatorBriefingDto briefing)
    {
        var rows = await factory.WithDbAsync(db => new StandingsService(db).RowsAsync(arena.CompetitionId, arena.SectionId));
        foreach (var lane in briefing.Lanes)
        {
            Assert.Equal(rows.FindIndex(r => r.TeamId == lane.TeamId) + 1, lane.CurrentRank);
            Assert.Equal(rows.Single(r => r.TeamId == lane.TeamId).TotalPoints, lane.TotalPoints);
        }
    }

    private Task ScoreAsync(int raceId, params (int TeamId, int Place, double Points)[] results)
        => factory.WithDbAsync(async db =>
        {
            (await db.Races.SingleAsync(r => r.Id == raceId)).IsComplete = true;
            db.Results.AddRange(results.Select(r => new Result { RaceId = raceId, TeamId = r.TeamId, Placing = r.Place, Points = r.Points }));
            await db.SaveChangesAsync();
        });

    private Task<int> NewSessionAsync(Arena arena, int order)
        => factory.WithDbAsync(async db =>
        {
            var session = new Session
            {
                CompetitionId = arena.CompetitionId, CompetitionSectionId = arena.SectionId,
                Name = $"Synthetic Session {order}", OrderIndex = order,
            };
            db.Sessions.Add(session);
            await db.SaveChangesAsync();
            return session.Id;
        });

    private async Task<(int ShiftId, int ClaimId)> SeedClaimedDutyAsync(Arena arena)
    {
        var trainerId = await factory.TrainerIdAsync();
        return await factory.WithDbAsync(async db =>
        {
            var shift = new VolunteerShift
            {
                CompetitionId = arena.CompetitionId, SessionId = arena.SessionId, AssignedTeamId = arena.TeamIds[0],
                Role = "Synthetic Original", Claims = { new VolunteerClaim { UserId = trainerId, VolunteerName = "Synthetic Volunteer" } },
            };
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            return (shift.Id, shift.Claims.Single().Id);
        });
    }

    private async Task AssertOriginalDutyAsync(Arena arena, (int ShiftId, int ClaimId) original)
    {
        var shifts = await factory.WithDbAsync(db => db.VolunteerShifts.AsNoTracking().Include(s => s.Claims)
            .Where(s => s.CompetitionId == arena.CompetitionId).ToListAsync());
        var shift = Assert.Single(shifts);
        Assert.Equal(original.ShiftId, shift.Id);
        Assert.Equal("Synthetic Original", shift.Role);
        Assert.Equal(original.ClaimId, Assert.Single(shift.Claims).Id);
    }

    private static string DutiesUrl(Arena arena)
        => $"/api/competitions/{arena.CompetitionId}/sessions/{arena.SessionId}/duty-assignments";
}
