using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

public class NextWaveFeaturesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task SavedTeamsEndpoint_ReturnsDistinctPreviousTeamDeclarationsForTrainer()
    {
        var (trainer, trainerAuth) = await factory.ApprovedTrainerAsync();
        var trainerId = trainerAuth.User.Id;
        var comp1 = await factory.SeedCompetitionAsync("Spring Opener", ownerUserId: trainerId);
        var secU12 = await factory.SeedSectionAsync(comp1, "U12");
        var secU15 = await factory.SeedSectionAsync(comp1, "U15");
        var clubId = await factory.SeedClubAsync("Synthetic Kent Club", "Red");
        var teamU12 = await factory.SeedTeamAsync(comp1, secU12, clubId, "Kent A", trainerUserId: trainerId);
        var teamU15 = await factory.SeedTeamAsync(comp1, secU15, clubId, "Kent B", trainerUserId: trainerId);

        await factory.WithDbAsync(async db =>
        {
            db.DeclarationForms.AddRange(
                new DeclarationForm
                {
                    TeamId = teamU12,
                    SubmittedByUserId = trainerId,
                    SubmittedAt = DateTime.UtcNow.AddDays(-10),
                    IsLocked = true,
                    TrainerName = "Synthetic Coach",
                    TrainerPhone = "07700 900111",
                    Riders =
                    {
                        new RiderEntry { OrderIndex = 0, FullName = "Synthetic Rider One", HorseName = "Pickle", PonyHeightHands = 12.2m },
                    },
                },
                new DeclarationForm
                {
                    TeamId = teamU15,
                    SubmittedByUserId = trainerId,
                    SubmittedAt = DateTime.UtcNow.AddDays(-5),
                    IsLocked = true,
                    TrainerName = "Synthetic Coach",
                    TrainerPhone = "07700 900111",
                    Riders =
                    {
                        new RiderEntry { OrderIndex = 0, FullName = "Synthetic Rider Two", HorseName = "Bramble", PonyHeightHands = 13.2m },
                    },
                });
            await db.SaveChangesAsync();
        });

        var resp = await trainer.GetAsync("/api/declaration-forms/my-saved-teams");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var savedTeams = await resp.ReadAsync<List<SavedTeamDeclarationDto>>();
        Assert.Equal(2, savedTeams.Count);
        Assert.Contains(savedTeams, t => t.TeamId == teamU12 && t.Riders.Any(r => r.HorseName == "Pickle"));
        Assert.Contains(savedTeams, t => t.TeamId == teamU15 && t.Riders.Any(r => r.HorseName == "Bramble"));
    }

    [Fact]
    public async Task ProvisionalResultsWindow_StartsOnSessionFinish_RefusesConfirmWhenUnderReview_AndConfirmsOfficial()
    {
        var trainerId = await factory.TrainerIdAsync();
        var compId = await factory.SeedCompetitionAsync("Synthetic Provisional Cup", ownerUserId: trainerId);
        var sectionId = await factory.SeedSectionAsync(compId, "Open");
        var clubId = await factory.SeedClubAsync("Synthetic Club", "Blue");
        var team1 = await factory.SeedTeamAsync(compId, sectionId, clubId, "A", trainerUserId: trainerId);
        var team2 = await factory.SeedTeamAsync(compId, sectionId, clubId, "B", trainerUserId: trainerId);

        int sessionId = 0;
        int raceId = 0;
        await factory.WithDbAsync(async db =>
        {
            var s = new Session
            {
                CompetitionId = compId,
                CompetitionSectionId = sectionId,
                Name = "Session 1",
                OrderIndex = 1,
                Kind = SessionKind.Race,
            };
            db.Sessions.Add(s);
            await db.SaveChangesAsync();
            sessionId = s.Id;

            var h = new Heat { SessionId = s.Id, Label = "Heat 1", OrderIndex = 1 };
            db.Heats.Add(h);
            await db.SaveChangesAsync();

            db.HeatEntries.AddRange(
                new HeatEntry { HeatId = h.Id, TeamId = team1, LaneIndex = 1 },
                new HeatEntry { HeatId = h.Id, TeamId = team2, LaneIndex = 2 });
            var r = new Race { HeatId = h.Id, Name = "Bending", OrderIndex = 1 };
            db.Races.Add(r);
            await db.SaveChangesAsync();
            raceId = r.Id;
        });

        var trainer = await factory.TrainerAsync();
        var statusResp = await trainer.PutAsJsonAsync(
            $"/api/competitions/{compId}/sessions/{sessionId}/status",
            new UpdateSessionStatusRequest(SessionStatus.Finished));
        Assert.Equal(HttpStatusCode.OK, statusResp.StatusCode);
        var finishedSession = await statusResp.ReadAsync<SessionDto>();
        Assert.NotNull(finishedSession.ProvisionalUntil);
        Assert.Null(finishedSession.OfficialConfirmedAt);

        // Flag a result under review -> confirm-official must refuse with 409 Conflict
        await factory.WithDbAsync(async db =>
        {
            db.Results.Add(new Result
            {
                RaceId = raceId,
                TeamId = team1,
                Placing = 1,
                Points = 2,
                RefereeNote = "[under-review] Photo finish check",
            });
            await db.SaveChangesAsync();
        });

        var blockedConfirm = await trainer.PostAsJsonAsync(
            $"/api/competitions/{compId}/sessions/{sessionId}/confirm-official",
            new ConfirmSessionOfficialRequest());
        Assert.Equal(HttpStatusCode.Conflict, blockedConfirm.StatusCode);

        // Clear under-review flag -> confirm-official succeeds
        await factory.WithDbAsync(async db =>
        {
            var res = await db.Results.FirstAsync(r => r.RaceId == raceId);
            res.RefereeNote = null;
            await db.SaveChangesAsync();
        });

        var okConfirm = await trainer.PostAsJsonAsync(
            $"/api/competitions/{compId}/sessions/{sessionId}/confirm-official",
            new ConfirmSessionOfficialRequest());
        Assert.Equal(HttpStatusCode.OK, okConfirm.StatusCode);
        var confirmedDto = await okConfirm.ReadAsync<SessionDto>();
        Assert.NotNull(confirmedDto.OfficialConfirmedAt);
    }

    [Fact]
    public async Task StewardDutySystem_SupportsAutoAssign_PhoneCheckIn_StaffOverride_AndMissingCallAutoClear()
    {
        var trainerId = await factory.TrainerIdAsync();
        var compId = await factory.SeedCompetitionAsync("Synthetic Steward Duty Cup", ownerUserId: trainerId);
        var sec1 = await factory.SeedSectionAsync(compId, "U12");
        var sec2 = await factory.SeedSectionAsync(compId, "Open");
        var clubA = await factory.SeedClubAsync("Synthetic Kent", "Red");
        var clubB = await factory.SeedClubAsync("Synthetic Surrey", "Blue");

        var (teamTrainerClient, teamTrainerAuth) = await factory.ApprovedTrainerAsync();
        var teamTrainerId = teamTrainerAuth.User.Id;
        var ridingTeam = await factory.SeedTeamAsync(compId, sec1, clubA, "A", trainerUserId: trainerId);
        var stewardTeam = await factory.SeedTeamAsync(compId, sec2, clubB, "A", trainerUserId: teamTrainerId);

        var sessionId = await factory.WithDbAsync(async db =>
        {
            var s = new Session
            {
                CompetitionId = compId,
                CompetitionSectionId = sec1,
                Name = "U12 Session 1",
                ArenaName = "Main Arena",
                LanesPerHeat = 2,
                OrderIndex = 1,
                Kind = SessionKind.Race,
            };
            db.Sessions.Add(s);
            await db.SaveChangesAsync();
            var h = new Heat { SessionId = s.Id, Label = "Heat 1", OrderIndex = 1 };
            db.Heats.Add(h);
            await db.SaveChangesAsync();
            db.HeatEntries.Add(new HeatEntry { HeatId = h.Id, TeamId = ridingTeam, LaneIndex = 1 });
            await db.SaveChangesAsync();
            return s.Id;
        });

        var staff = await factory.TrainerAsync();

        // 1. Auto-assign non-riding teams to session duties
        var assignResp = await staff.PostAsJsonAsync(
            $"/api/competitions/{compId}/sessions/{sessionId}/duty-assignments",
            new AssignSessionDutiesRequest(AutoAssignNonRidingTeams: true));
        Assert.Equal(HttpStatusCode.OK, assignResp.StatusCode);
        var duties = await assignResp.ReadAsync<List<VolunteerShiftDto>>();
        Assert.Equal(3, duties.Count); // 1 Arena Crew + 2 Start/Finish Line Stewards (LanesPerHeat = 2)
        Assert.All(duties, d => Assert.Equal(stewardTeam, d.AssignedTeamId));
        Assert.All(duties, d => Assert.Equal("Assigned", d.AttendanceStatus));

        var targetDuty = duties[0];

        // 2. Call missing steward -> marks Missing and posts announcement
        var callResp = await staff.PostAsJsonAsync(
            $"/api/competitions/{compId}/volunteer-shifts/{targetDuty.Id}/call-missing",
            new CallMissingStewardRequest());
        Assert.Equal(HttpStatusCode.OK, callResp.StatusCode);
        var callResult = await callResp.ReadAsync<CallMissingStewardResultDto>();
        Assert.Equal("Missing", callResult.Shift.AttendanceStatus);
        Assert.Equal($"missing-steward:{targetDuty.Id}", callResult.Announcement.Tag);

        // 3. Assigned team's trainer checks in on phone -> marks Here and auto-clears the missing-steward announcement
        var checkInResp = await teamTrainerClient.PostAsJsonAsync(
            $"/api/competitions/{compId}/volunteer-shifts/{targetDuty.Id}/check-in",
            new CheckInVolunteerShiftRequest("Pat Steward"));
        Assert.Equal(HttpStatusCode.OK, checkInResp.StatusCode);
        var checkedInDto = await checkInResp.ReadAsync<VolunteerShiftDto>();
        Assert.Equal("Here", checkedInDto.AttendanceStatus);
        Assert.Equal("Pat Steward", checkedInDto.CheckedInByName);
        Assert.False(checkedInDto.CheckedInByStaffOverride);

        var remainingCalls = await factory.WithDbAsync(db =>
            db.ChatMessages.CountAsync(m => m.CompetitionId == compId && m.Tag == $"missing-steward:{targetDuty.Id}"));
        Assert.Equal(0, remainingCalls);

        // 4. Staff manual "They're Here" override on the second duty
        var overrideResp = await staff.PutAsJsonAsync(
            $"/api/competitions/{compId}/volunteer-shifts/{duties[1].Id}/attendance",
            new UpdateVolunteerAttendanceRequest("Here", "Ringmaster Override"));
        Assert.Equal(HttpStatusCode.OK, overrideResp.StatusCode);
        var overriddenDto = await overrideResp.ReadAsync<VolunteerShiftDto>();
        Assert.Equal("Here", overriddenDto.AttendanceStatus);
        Assert.True(overriddenDto.CheckedInByStaffOverride);
    }

    [Fact]
    public async Task ArenaCrewSheet_And_CommentatorBriefing_ReturnStructuredPayloads()
    {
        var trainerId = await factory.TrainerIdAsync();
        var compId = await factory.SeedCompetitionAsync("Synthetic Arena & Commentator Cup", ownerUserId: trainerId);
        var secId = await factory.SeedSectionAsync(compId, "Open");
        var clubId = await factory.SeedClubAsync("Synthetic Briefing Kent", "Red");
        var teamId = await factory.SeedTeamAsync(compId, secId, clubId, "A", trainerUserId: trainerId);

        int sessionId = 0;
        int heatId = 0;
        await factory.WithDbAsync(async db =>
        {
            db.DeclarationForms.Add(new DeclarationForm
            {
                TeamId = teamId,
                SubmittedByUserId = trainerId,
                SubmittedAt = DateTime.UtcNow,
                IsLocked = true,
                Riders =
                {
                    new RiderEntry
                    {
                        OrderIndex = 0,
                        FullName = "Ella Hughes",
                        HorseName = "Pickle",
                        UseInitialOnly = true,
                        IsCaptain = true,
                    },
                },
            });

            var s = new Session
            {
                CompetitionId = compId,
                CompetitionSectionId = secId,
                Name = "Open Session 1",
                ArenaName = "Arena 1",
                Status = SessionStatus.InArena,
                LanesPerHeat = 5,
                OrderIndex = 1,
                Kind = SessionKind.Race,
            };
            db.Sessions.Add(s);
            await db.SaveChangesAsync();
            sessionId = s.Id;

            var h = new Heat { SessionId = s.Id, Label = "Heat 1", OrderIndex = 1 };
            db.Heats.Add(h);
            await db.SaveChangesAsync();
            heatId = h.Id;

            db.HeatEntries.Add(new HeatEntry { HeatId = h.Id, TeamId = teamId, LaneIndex = 1 });
            db.Races.AddRange(
                new Race { HeatId = h.Id, Name = "Five Flag", OrderIndex = 1, IsComplete = false },
                new Race { HeatId = h.Id, Name = "Two Mug", OrderIndex = 2, IsComplete = false });
            await db.SaveChangesAsync();
        });

        var anon = factory.CreateClient();

        // Arena Crew Prop Sheet
        var sheetResp = await anon.GetAsync($"/api/competitions/{compId}/arena-crew-sheet?sessionId={sessionId}&heatId={heatId}");
        Assert.Equal(HttpStatusCode.OK, sheetResp.StatusCode);
        var sheet = await sheetResp.ReadAsync<ArenaCrewPropSheetDto>();
        Assert.Equal("Five Flag", sheet.CurrentRace?.RaceName);
        Assert.Equal("Two Mug", sheet.NextRace?.RaceName);
        Assert.NotNull(sheet.Transition);
        Assert.Equal(3, sheet.CurrentRace!.Zones.Count);

        // Commentator Briefing
        var briefResp = await anon.GetAsync($"/api/competitions/{compId}/sessions/{sessionId}/heats/{heatId}/commentator-briefing");
        Assert.Equal(HttpStatusCode.OK, briefResp.StatusCode);
        var briefing = await briefResp.ReadAsync<CommentatorBriefingDto>();
        Assert.Equal("Five Flag", briefing.CurrentRaceName);
        var lane1 = Assert.Single(briefing.Lanes);
        Assert.Contains("Ella H. on Pickle (Capt)", lane1.RidersAndPonies);
    }

    [Fact]
    public async Task TwoPhaseFairDraw_EliminatesLaneRepeatsAndClubClashesAcrossFourSessions()
    {
        var trainerId = await factory.TrainerIdAsync();
        var compId = await factory.SeedCompetitionAsync("Synthetic Two-Phase Draw Cup", ownerUserId: trainerId);
        var secId = await factory.SeedSectionAsync(compId, "Open");

        // 12 teams across 9 clubs (3 clubs have A & B teams) in 3 heats of 4 over 4 sessions
        int[] clubSetup = [1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9];
        var clubIds = new Dictionary<int, int>();
        for (var c = 1; c <= 9; c++)
            clubIds[c] = await factory.SeedClubAsync($"Synthetic Club {c}", "Red");

        for (var i = 0; i < clubSetup.Length; i++)
        {
            var cNum = clubSetup[i];
            var suffix = i % 2 == 0 ? "A" : "B";
            await factory.SeedTeamAsync(compId, secId, clubIds[cNum], $"{cNum}-{suffix}", trainerUserId: trainerId);
        }

        await factory.WithDbAsync(async db =>
        {
            for (var sIdx = 1; sIdx <= 4; sIdx++)
            {
                var s = new Session
                {
                    CompetitionId = compId,
                    CompetitionSectionId = secId,
                    Name = $"Session {sIdx}",
                    LanesPerHeat = 4,
                    OrderIndex = sIdx,
                    Kind = SessionKind.Race,
                };
                db.Sessions.Add(s);
                await db.SaveChangesAsync();
                for (var hIdx = 1; hIdx <= 3; hIdx++)
                {
                    db.Heats.Add(new Heat { SessionId = s.Id, Label = $"Heat {hIdx}", OrderIndex = hIdx });
                }
                await db.SaveChangesAsync();
            }
        });

        var admin = await factory.AdminAsync();
        var previewResp = await admin.PostAsJsonAsync(
            $"/api/competitions/{compId}/sections/{secId}/draw/preview",
            new DrawRequest(1001));
        Assert.Equal(HttpStatusCode.OK, previewResp.StatusCode);
        var preview = await previewResp.ReadAsync<DrawPreviewDto>();

        // Every team uses each of the 4 lanes at most once across 4 sessions -> MaximumLaneUseSpread <= 1
        Assert.True(preview.Fairness.MaximumLaneUseSpread <= 1, $"Expected MaximumLaneUseSpread <= 1, got {preview.Fairness.MaximumLaneUseSpread}");
        Assert.True(preview.Fairness.EveryTeamAppearsOncePerSession);
    }
}
