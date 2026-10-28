using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Operations;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Notifications;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

public class HeatDutiesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private sealed record SeededEvent(
        int CompetitionId,
        int SectionId,
        int SessionId,
        int Heat1Id,
        int Heat2Id,
        int Heat3Id,
        IReadOnlyList<Team> Teams);

    private async Task<SeededEvent> SeedSessionWithHeatsAsync(int teamCount = 6, bool markLastTeamHc = false)
    {
        var trainerId = await factory.TrainerIdAsync();
        var compId = await factory.SeedCompetitionAsync($"Heat Duties Cup {Guid.NewGuid():N}", ownerUserId: trainerId);

        return await factory.WithDbAsync(async db =>
        {
            var section = new CompetitionSection
            {
                CompetitionId = compId,
                AgeGroup = "Open",
                Format = SectionFormat.Teams,
                DisplayName = "Open Teams",
            };
            db.CompetitionSections.Add(section);
            await db.SaveChangesAsync();

            var names = new[] { "Stockport A", "Oakley A", "wicklow A", "Monmouthshire A", "Romney Marsh A", " Fife A", "vale of Aylesbury A", "rockwood A" };
            var teams = new List<Team>();
            for (var i = 0; i < teamCount; i++)
            {
                var label = i < names.Length ? names[i].Trim() : $"Club {i + 1} A";
                var club = new Club { Name = $"Club {label} {Guid.NewGuid():N}" };
                db.Clubs.Add(club);
                await db.SaveChangesAsync();

                var team = new Team
                {
                    CompetitionId = compId,
                    CompetitionSectionId = section.Id,
                    ClubId = club.Id,
                    DisplayName = label,
                    EntryStatus = TeamEntryStatus.Active,
                    IsHorsConcours = markLastTeamHc && i == teamCount - 1,
                };
                db.Teams.Add(team);
                teams.Add(team);
            }
            await db.SaveChangesAsync();

            var session = new Session
            {
                CompetitionId = compId,
                CompetitionSectionId = section.Id,
                Name = "Session 1",
                ArenaName = "Main Ring",
                OrderIndex = 1,
                LanesPerHeat = 2,
                ScheduledStart = new DateTime(2026, 7, 11, 13, 0, 0, DateTimeKind.Utc),
            };
            db.Sessions.Add(session);
            await db.SaveChangesAsync();

            // Heat 1: teams[0], teams[1]
            // Heat 2: teams[2], teams[3]
            // Heat 3: teams[4], teams[5] (if present)
            var h1 = new Heat
            {
                SessionId = session.Id,
                OrderIndex = 1,
                Label = "Heat 1",
                DurationMinutes = 20,
                ScheduledStart = new DateTime(2026, 7, 11, 13, 0, 0, DateTimeKind.Utc),
            };
            var h2 = new Heat
            {
                SessionId = session.Id,
                OrderIndex = 2,
                Label = "Heat 2",
                DurationMinutes = 20,
                ScheduledStart = new DateTime(2026, 7, 11, 13, 20, 0, DateTimeKind.Utc),
            };
            var h3 = new Heat
            {
                SessionId = session.Id,
                OrderIndex = 3,
                Label = "Heat 3",
                DurationMinutes = 20,
                ScheduledStart = new DateTime(2026, 7, 11, 13, 40, 0, DateTimeKind.Utc),
            };
            db.Heats.AddRange(h1, h2, h3);
            await db.SaveChangesAsync();

            if (teams.Count >= 2)
            {
                db.HeatEntries.AddRange(
                    new HeatEntry { HeatId = h1.Id, TeamId = teams[0].Id, LaneIndex = 1 },
                    new HeatEntry { HeatId = h1.Id, TeamId = teams[1].Id, LaneIndex = 2 });
            }
            if (teams.Count >= 4)
            {
                db.HeatEntries.AddRange(
                    new HeatEntry { HeatId = h2.Id, TeamId = teams[2].Id, LaneIndex = 1 },
                    new HeatEntry { HeatId = h2.Id, TeamId = teams[3].Id, LaneIndex = 2 });
            }
            if (teams.Count >= 6)
            {
                db.HeatEntries.AddRange(
                    new HeatEntry { HeatId = h3.Id, TeamId = teams[4].Id, LaneIndex = 1 },
                    new HeatEntry { HeatId = h3.Id, TeamId = teams[5].Id, LaneIndex = 2 });
            }
            await db.SaveChangesAsync();

            return new SeededEvent(compId, section.Id, session.Id, h1.Id, h2.Id, h3.Id, teams);
        });
    }

    [Fact]
    public async Task CreateAndUpdateHeatShift_ValidatesRidingTeamDuplicateDutyAndHeatOwnership_AndCascadeDeletesWithHeat()
    {
        var ev = await SeedSessionWithHeatsAsync();
        var trainer = await factory.TrainerAsync();
        var stockport = ev.Teams[0]; // Rides in Heat 1
        var oakley = ev.Teams[1];    // Rides in Heat 1
        var wicklow = ev.Teams[2];   // Rides in Heat 2
        var monmouth = ev.Teams[3];  // Rides in Heat 2

        // 1. Rejects assigning a team to a heat it rides in.
        var ownHeatResp = await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts",
            new CreateVolunteerShiftRequest(
                Role: "Start/Finish Line Steward — Lane 1",
                SessionId: ev.SessionId,
                DutyCategory: "LineSteward",
                AssignedTeamId: stockport.Id,
                LaneNumber: 1,
                HeatId: ev.Heat1Id));
        Assert.Equal(HttpStatusCode.BadRequest, ownHeatResp.StatusCode);
        var ownHeatBody = await ownHeatResp.Content.ReadAsStringAsync();
        Assert.Contains("Stockport A rides in this heat.", ownHeatBody);

        // 2. Allows assigning a non-riding team to Heat 1, and populates HeatId + HeatLabel.
        var validResp = await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts",
            new CreateVolunteerShiftRequest(
                Role: "Start/Finish Line Steward — Lane 1",
                SessionId: null, // Inferred from Heat 1
                DutyCategory: "LineSteward",
                AssignedTeamId: wicklow.Id,
                LaneNumber: 1,
                HeatId: ev.Heat1Id));
        Assert.Equal(HttpStatusCode.OK, validResp.StatusCode);
        var createdShift = await validResp.ReadAsync<VolunteerShiftDto>();
        Assert.Equal(ev.Heat1Id, createdShift.HeatId);
        Assert.Equal("Heat 1", createdShift.HeatLabel);
        Assert.Equal(ev.SessionId, createdShift.SessionId);
        Assert.Equal(wicklow.Id, createdShift.AssignedTeamId);

        // 3. Rejects assigning the same team a second duty in the same heat (Create).
        var dupCreateResp = await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts",
            new CreateVolunteerShiftRequest(
                Role: "Changeover Line Steward — Lane 1",
                SessionId: ev.SessionId,
                DutyCategory: "ChangeoverSteward",
                AssignedTeamId: wicklow.Id,
                LaneNumber: 1,
                HeatId: ev.Heat1Id));
        Assert.Equal(HttpStatusCode.BadRequest, dupCreateResp.StatusCode);
        Assert.Contains("wicklow A already has a duty in this heat.", await dupCreateResp.Content.ReadAsStringAsync());

        // 4. Create a second shift in Heat 1 for Monmouthshire, then try updating it to Stockport (rides in Heat 1) or Wicklow (already has duty in Heat 1).
        var secondResp = await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts",
            new CreateVolunteerShiftRequest(
                Role: "Start/Finish Line Steward — Lane 2",
                SessionId: ev.SessionId,
                DutyCategory: "LineSteward",
                AssignedTeamId: monmouth.Id,
                LaneNumber: 2,
                HeatId: ev.Heat1Id));
        Assert.Equal(HttpStatusCode.OK, secondResp.StatusCode);
        var secondShift = await secondResp.ReadAsync<VolunteerShiftDto>();

        var updateOwnHeat = await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{secondShift.Id}",
            new UpdateVolunteerShiftRequest(
                Role: secondShift.Role,
                SessionId: ev.SessionId,
                DutyCategory: "LineSteward",
                AssignedTeamId: oakley.Id,
                LaneNumber: 2,
                HeatId: ev.Heat1Id));
        Assert.Equal(HttpStatusCode.BadRequest, updateOwnHeat.StatusCode);
        Assert.Contains("Oakley A rides in this heat.", await updateOwnHeat.Content.ReadAsStringAsync());

        var updateDupTeam = await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{secondShift.Id}",
            new UpdateVolunteerShiftRequest(
                Role: secondShift.Role,
                SessionId: ev.SessionId,
                DutyCategory: "LineSteward",
                AssignedTeamId: wicklow.Id,
                LaneNumber: 2,
                HeatId: ev.Heat1Id));
        Assert.Equal(HttpStatusCode.BadRequest, updateDupTeam.StatusCode);
        Assert.Contains("wicklow A already has a duty in this heat.", await updateDupTeam.Content.ReadAsStringAsync());

        // 5. Stockport CAN have a duty in Heat 2 (same session, different heat).
        var stockportHeat2 = await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts",
            new CreateVolunteerShiftRequest(
                Role: "Start/Finish Line Steward — Lane 1",
                SessionId: ev.SessionId,
                DutyCategory: "LineSteward",
                AssignedTeamId: stockport.Id,
                LaneNumber: 1,
                HeatId: ev.Heat2Id));
        Assert.Equal(HttpStatusCode.OK, stockportHeat2.StatusCode);

        // 6. Rejects mismatched sessionId and heatId.
        var otherSessionId = await factory.WithDbAsync(async db =>
        {
            var s2 = new Session { CompetitionId = ev.CompetitionId, Name = "Session 2", OrderIndex = 2 };
            db.Sessions.Add(s2);
            await db.SaveChangesAsync();
            return s2.Id;
        });
        var mismatchResp = await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts",
            new CreateVolunteerShiftRequest(
                Role: "Starter",
                SessionId: otherSessionId,
                HeatId: ev.Heat1Id));
        Assert.Equal(HttpStatusCode.BadRequest, mismatchResp.StatusCode);

        // 7. Deleting Heat 1 cascade-deletes Heat 1's shifts while keeping Heat 2's shift.
        var delHeatResp = await trainer.DeleteAsync($"/api/competitions/{ev.CompetitionId}/sessions/{ev.SessionId}/heats/{ev.Heat1Id}");
        Assert.Equal(HttpStatusCode.OK, delHeatResp.StatusCode);

        var remaining = await (await trainer.GetAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts")).ReadAsync<List<VolunteerShiftDto>>();
        Assert.DoesNotContain(remaining, s => s.HeatId == ev.Heat1Id);
        Assert.Contains(remaining, s => s.HeatId == ev.Heat2Id && s.AssignedTeamId == stockport.Id);
    }

    [Fact]
    public async Task SaveHeatDuties_DiffsCreatesUpdatesDeletes_IsIdempotent_AndProtectsCheckedInShiftsWith409()
    {
        var ev = await SeedSessionWithHeatsAsync();
        var trainer = await factory.TrainerAsync();
        var (memberClient, _) = await factory.SignupAsync("Member", "Member Club");
        var (otherTrainerClient, _) = await factory.SignupAsync("Trainer", "Other Trainer Club");
        var anon = factory.CreateClient();

        var initialDuties = new List<HeatDutyItemInput>
        {
            new(ev.Heat1Id, "Start/Finish Line Steward — Lane 1", "LineSteward", 1, ev.Teams[2].Id),
            new(ev.Heat1Id, "Start/Finish Line Steward — Lane 2", "LineSteward", 2, ev.Teams[3].Id),
            new(ev.Heat2Id, "Start/Finish Line Steward — Lane 1", "LineSteward", 1, ev.Teams[0].Id),
        };
        var saveReq = new SaveHeatDutiesRequest([ev.SessionId], initialDuties);

        // Auth checks: 401 anon, 403 member, 403 other trainer
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.PutAsJsonAsync($"/api/competitions/{ev.CompetitionId}/heat-duties", saveReq)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await memberClient.PutAsJsonAsync($"/api/competitions/{ev.CompetitionId}/heat-duties", saveReq)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await otherTrainerClient.PutAsJsonAsync($"/api/competitions/{ev.CompetitionId}/heat-duties", saveReq)).StatusCode);

        // 1. Initial save creates 3 shifts.
        var firstResp = await trainer.PutAsJsonAsync($"/api/competitions/{ev.CompetitionId}/heat-duties", saveReq);
        Assert.Equal(HttpStatusCode.OK, firstResp.StatusCode);
        var firstResult = await firstResp.ReadAsync<SaveHeatDutiesResultDto>();
        Assert.Equal(3, firstResult.Created);
        Assert.Equal(0, firstResult.Updated);
        Assert.Equal(0, firstResult.Deleted);
        Assert.Equal(3, firstResult.Shifts.Count);
        var originalIds = firstResult.Shifts.Select(s => s.Id).ToList();

        // 2. Saving the exact same list a second time changes nothing and preserves IDs.
        var secondResp = await trainer.PutAsJsonAsync($"/api/competitions/{ev.CompetitionId}/heat-duties", saveReq);
        Assert.Equal(HttpStatusCode.OK, secondResp.StatusCode);
        var secondResult = await secondResp.ReadAsync<SaveHeatDutiesResultDto>();
        Assert.Equal(0, secondResult.Created);
        Assert.Equal(0, secondResult.Updated);
        Assert.Equal(0, secondResult.Deleted);
        Assert.Equal(originalIds, secondResult.Shifts.Select(s => s.Id).ToList());

        // 3. Mark the Heat 2 Lane 1 shift as "TeamSaysHere", then try deleting it without confirmRemoveCheckedIn.
        var heat2Shift = secondResult.Shifts.Single(s => s.HeatId == ev.Heat2Id);
        var teamHereResp = await anon.PostAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{heat2Shift.Id}/team-here", null);
        Assert.Equal(HttpStatusCode.OK, teamHereResp.StatusCode);

        // Try modifying Heat 1 Lane 2, adding Heat 3 Lane 1, and removing Heat 2 Lane 1 (which is TeamSaysHere).
        var modifiedDuties = new List<HeatDutyItemInput>
        {
            new(ev.Heat1Id, "Start/Finish Line Steward — Lane 1", "LineSteward", 1, ev.Teams[2].Id), // unchanged
            new(ev.Heat1Id, "Start/Finish Line Steward — Lane 2", "LineSteward", 2, ev.Teams[4].Id), // updated team
            new(ev.Heat3Id, "Start/Finish Line Steward — Lane 1", "LineSteward", 1, ev.Teams[0].Id), // created
            // heat2Shift is omitted -> would be deleted!
        };

        var conflictResp = await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/heat-duties",
            new SaveHeatDutiesRequest([ev.SessionId], modifiedDuties, ConfirmRemoveCheckedIn: false));
        Assert.Equal(HttpStatusCode.Conflict, conflictResp.StatusCode);
        var conflictDto = await conflictResp.ReadAsync<HeatDutiesConflictDto>();
        Assert.Single(conflictDto.CheckedInShifts);
        Assert.Equal(heat2Shift.Id, conflictDto.CheckedInShifts[0].Id);

        // 4. Resending with ConfirmRemoveCheckedIn: true applies the diff (1 created, 1 updated, 1 deleted).
        var confirmedResp = await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/heat-duties",
            new SaveHeatDutiesRequest([ev.SessionId], modifiedDuties, ConfirmRemoveCheckedIn: true));
        Assert.Equal(HttpStatusCode.OK, confirmedResp.StatusCode);
        var confirmedResult = await confirmedResp.ReadAsync<SaveHeatDutiesResultDto>();
        Assert.Equal(1, confirmedResult.Created);
        Assert.Equal(1, confirmedResult.Updated);
        Assert.Equal(1, confirmedResult.Deleted);
        Assert.Equal(3, confirmedResult.Shifts.Count);
        // Unchanged Heat 1 Lane 1 kept its original ID
        Assert.Equal(originalIds[0], confirmedResult.Shifts.Single(s => s.HeatId == ev.Heat1Id && s.LaneNumber == 1).Id);
    }

    [Fact]
    public async Task AutoFillHeatDuties_IsFairDeterministicRespectsRulesIncludesHcTeamsAndReportsUnfilledRoles()
    {
        // 6 teams, with the 6th team marked Hors Concours (HC).
        var ev = await SeedSessionWithHeatsAsync(teamCount: 6, markLastTeamHc: true);
        var trainer = await factory.TrainerAsync();
        var hcTeam = ev.Teams[5];
        Assert.True(hcTeam.IsHorsConcours);

        var roles = new List<HeatDutyRoleTemplateInput>
        {
            new("Start/Finish Line Steward — Lane 1", "LineSteward", 1),
            new("Start/Finish Line Steward — Lane 2", "LineSteward", 2),
        };
        var req = new AutoFillHeatDutiesRequest(roles);

        var resp1 = await trainer.PostAsJsonAsync($"/api/competitions/{ev.CompetitionId}/sessions/{ev.SessionId}/heat-duties/auto-fill", req);
        Assert.Equal(HttpStatusCode.OK, resp1.StatusCode);
        var proposal1 = await resp1.ReadAsync<AutoFillHeatDutiesResultDto>();

        var resp2 = await trainer.PostAsJsonAsync($"/api/competitions/{ev.CompetitionId}/sessions/{ev.SessionId}/heat-duties/auto-fill", req);
        Assert.Equal(HttpStatusCode.OK, resp2.StatusCode);
        var proposal2 = await resp2.ReadAsync<AutoFillHeatDutiesResultDto>();

        // 1. Deterministic: identical input produces identical proposal.
        Assert.Equal(
            proposal1.Duties.Select(d => (d.HeatId, d.Role, d.AssignedTeamId)),
            proposal2.Duties.Select(d => (d.HeatId, d.Role, d.AssignedTeamId)));

        // 2. Does not persist anything to the database.
        var dbShifts = await (await trainer.GetAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts")).ReadAsync<List<VolunteerShiftDto>>();
        Assert.Empty(dbShifts);

        // 3. All 6 slots filled (3 heats * 2 roles), 0 unfilled, no warnings.
        Assert.Equal(6, proposal1.Duties.Count);
        Assert.Equal(0, proposal1.UnfilledCount);
        Assert.Empty(proposal1.Warnings);
        Assert.All(proposal1.Duties, d => Assert.NotNull(d.AssignedTeamId));

        // 4. In Heat 1 (Teams 0 & 1 ride), adjacent Heat 2 has Teams 2 & 3 riding, so non-adjacent Teams 4 & 5 (including HC team 5!) are preferred for Heat 1!
        var heat1AssignedIds = proposal1.Duties.Where(d => d.HeatId == ev.Heat1Id).Select(d => d.AssignedTeamId!.Value).ToHashSet();
        Assert.DoesNotContain(ev.Teams[0].Id, heat1AssignedIds);
        Assert.DoesNotContain(ev.Teams[1].Id, heat1AssignedIds);
        Assert.Contains(ev.Teams[4].Id, heat1AssignedIds);
        Assert.Contains(hcTeam.Id, heat1AssignedIds);

        // 5. At most one duty per team per heat, and spread fairly across the 6 teams (1 duty each).
        foreach (var byHeat in proposal1.Duties.GroupBy(d => d.HeatId))
        {
            var distinctTeams = byHeat.Select(d => d.AssignedTeamId!.Value).Distinct().Count();
            Assert.Equal(byHeat.Count(), distinctTeams);
        }
        Assert.All(proposal1.TeamDutyCounts.Values, count => Assert.Equal(1, count));

        // 6. Too few teams: request 5 roles per heat when only 4 teams are non-riding in each heat.
        var fiveRoles = Enumerable.Range(1, 5)
            .Select(lane => new HeatDutyRoleTemplateInput($"Lane {lane} Steward", "LineSteward", lane))
            .ToList();
        var underResp = await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/sessions/{ev.SessionId}/heat-duties/auto-fill",
            new AutoFillHeatDutiesRequest(fiveRoles));
        Assert.Equal(HttpStatusCode.OK, underResp.StatusCode);
        var underResult = await underResp.ReadAsync<AutoFillHeatDutiesResultDto>();
        Assert.Equal(3, underResult.UnfilledCount); // 1 unfilled role in each of the 3 heats
        Assert.Equal(3, underResult.Warnings.Count);
        Assert.Equal(3, underResult.Duties.Count(d => d.AssignedTeamId is null));
    }

    private static string AutoFillUrl(SeededEvent ev, int? sessionId = null) =>
        $"/api/competitions/{ev.CompetitionId}/sessions/{sessionId ?? ev.SessionId}/heat-duties/auto-fill";

    private static readonly List<HeatDutyRoleTemplateInput> TwoLanes =
    [
        new("Start/Finish Line Steward — Lane 1", "LineSteward", 1),
        new("Start/Finish Line Steward — Lane 2", "LineSteward", 2),
    ];

    private async Task<int> AddSecondSessionRidingAsync(SeededEvent ev, int teamId)
    {
        return await factory.WithDbAsync(async db =>
        {
            var session = new Session
            {
                CompetitionId = ev.CompetitionId,
                CompetitionSectionId = ev.SectionId,
                Name = "Session 2",
                ArenaName = "Second Ring",
                OrderIndex = 2,
                LanesPerHeat = 2,
                ScheduledStart = new DateTime(2026, 7, 11, 15, 0, 0, DateTimeKind.Utc),
            };
            db.Sessions.Add(session);
            await db.SaveChangesAsync();
            var heat = new Heat { SessionId = session.Id, OrderIndex = 1, Label = "S2 Heat 1", DurationMinutes = 20 };
            db.Heats.Add(heat);
            await db.SaveChangesAsync();
            db.HeatEntries.Add(new HeatEntry { HeatId = heat.Id, TeamId = teamId, LaneIndex = 1 });
            await db.SaveChangesAsync();
            return session.Id;
        });
    }

    [Fact]
    public async Task AutoFillHeatDuties_TeamSessionIdsLimitsCandidatesAndRejectsForeignSessions()
    {
        // 8 teams: 0-5 ride in session 1, team 6 rides only in session 2, team 7 rides nowhere.
        var ev = await SeedSessionWithHeatsAsync(teamCount: 8);
        var trainer = await factory.TrainerAsync();
        var session2 = await AddSecondSessionRidingAsync(ev, ev.Teams[6].Id);

        // Default: every active team is a candidate, so the idle teams 6 and 7 get picked.
        var all = await (await trainer.PostAsJsonAsync(AutoFillUrl(ev), new AutoFillHeatDutiesRequest(TwoLanes)))
            .ReadAsync<AutoFillHeatDutiesResultDto>();
        Assert.Contains(all.Duties, d => d.AssignedTeamId == ev.Teams[7].Id);

        // This session only: teams 6 and 7 are not candidates; riders still skip their own heat.
        var thisSession = await (await trainer.PostAsJsonAsync(AutoFillUrl(ev),
            new AutoFillHeatDutiesRequest(TwoLanes, TeamSessionIds: [ev.SessionId]))).ReadAsync<AutoFillHeatDutiesResultDto>();
        var session1TeamIds = ev.Teams.Take(6).Select(t => t.Id).ToHashSet();
        Assert.All(thisSession.Duties, d => Assert.Contains(d.AssignedTeamId!.Value, session1TeamIds));
        Assert.Equal(0, thisSession.UnfilledCount);
        foreach (var d in thisSession.Duties)
        {
            var heatRiders = d.HeatId == ev.Heat1Id ? new[] { 0, 1 } : d.HeatId == ev.Heat2Id ? new[] { 2, 3 } : new[] { 4, 5 };
            Assert.DoesNotContain(d.AssignedTeamId!.Value, heatRiders.Select(ix => ev.Teams[ix].Id));
        }

        // Another session's teams: only team 6 qualifies, so each heat fills one lane and leaves one empty.
        var other = await (await trainer.PostAsJsonAsync(AutoFillUrl(ev),
            new AutoFillHeatDutiesRequest(TwoLanes, TeamSessionIds: [session2]))).ReadAsync<AutoFillHeatDutiesResultDto>();
        Assert.All(other.Duties.Where(d => d.AssignedTeamId is not null), d => Assert.Equal(ev.Teams[6].Id, d.AssignedTeamId));
        Assert.Equal(3, other.UnfilledCount);

        // A session from another competition is rejected.
        var foreign = await SeedSessionWithHeatsAsync();
        var bad = await trainer.PostAsJsonAsync(AutoFillUrl(ev),
            new AutoFillHeatDutiesRequest(TwoLanes, TeamSessionIds: [ev.SessionId, foreign.SessionId]));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task AutoFillHeatDuties_AvoidNeighbouringHeatsCanBeSwitchedOff()
    {
        var ev = await SeedSessionWithHeatsAsync();
        var trainer = await factory.TrainerAsync();
        var oneRole = new List<HeatDutyRoleTemplateInput> { TwoLanes[0] };

        // Heat 1: teams 2-5 are free and tied on duties. Teams 2 and 3 ride in Heat 2, straight after.
        var avoid = await (await trainer.PostAsJsonAsync(AutoFillUrl(ev),
            new AutoFillHeatDutiesRequest(oneRole, HeatIds: [ev.Heat1Id]))).ReadAsync<AutoFillHeatDutiesResultDto>();
        Assert.Equal(ev.Teams[4].Id, avoid.Duties.Single().AssignedTeamId);

        var explicitTrue = await (await trainer.PostAsJsonAsync(AutoFillUrl(ev),
            new AutoFillHeatDutiesRequest(oneRole, HeatIds: [ev.Heat1Id], AvoidNeighbouringHeats: true))).ReadAsync<AutoFillHeatDutiesResultDto>();
        Assert.Equal(ev.Teams[4].Id, explicitTrue.Duties.Single().AssignedTeamId);

        var allow = await (await trainer.PostAsJsonAsync(AutoFillUrl(ev),
            new AutoFillHeatDutiesRequest(oneRole, HeatIds: [ev.Heat1Id], AvoidNeighbouringHeats: false))).ReadAsync<AutoFillHeatDutiesResultDto>();
        Assert.Equal(ev.Teams[2].Id, allow.Duties.Single().AssignedTeamId);

        // Fairness still wins: with team 2 already carrying a duty elsewhere, the next fairest is picked.
        await factory.InDbAsync(async db =>
        {
            db.VolunteerShifts.Add(new VolunteerShift
            {
                CompetitionId = ev.CompetitionId,
                SessionId = ev.SessionId,
                Role = "Whole Session Marshal",
                AssignedTeamId = ev.Teams[2].Id,
            });
            await db.SaveChangesAsync();
        });
        var fair = await (await trainer.PostAsJsonAsync(AutoFillUrl(ev),
            new AutoFillHeatDutiesRequest(oneRole, HeatIds: [ev.Heat1Id], AvoidNeighbouringHeats: false))).ReadAsync<AutoFillHeatDutiesResultDto>();
        Assert.Equal(ev.Teams[3].Id, fair.Duties.Single().AssignedTeamId);
    }

    [Fact]
    public async Task AutoFillHeatDuties_KeepExistingKeepsAssignedSlotsFillsGapsAndNeverDoublesATeam()
    {
        var ev = await SeedSessionWithHeatsAsync();
        var trainer = await factory.TrainerAsync();
        await factory.InDbAsync(async db =>
        {
            db.VolunteerShifts.AddRange(
                // Heat 1 lane 1 is assigned, lane 2 is an empty slot.
                new VolunteerShift { CompetitionId = ev.CompetitionId, SessionId = ev.SessionId, HeatId = ev.Heat1Id, Role = "Start/Finish Line Steward — Lane 1", DutyCategory = "LineSteward", LaneNumber = 1, AssignedTeamId = ev.Teams[4].Id },
                new VolunteerShift { CompetitionId = ev.CompetitionId, SessionId = ev.SessionId, HeatId = ev.Heat1Id, Role = "Start/Finish Line Steward — Lane 2", DutyCategory = "LineSteward", LaneNumber = 2 },
                // Heat 2 has an assigned duty that matches no requested role.
                new VolunteerShift { CompetitionId = ev.CompetitionId, SessionId = ev.SessionId, HeatId = ev.Heat2Id, Role = "Medic Liaison", DutyCategory = "Custom", AssignedTeamId = ev.Teams[0].Id });
            await db.SaveChangesAsync();
        });
        var before = await (await trainer.GetAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts")).ReadAsync<List<VolunteerShiftDto>>();

        var result = await (await trainer.PostAsJsonAsync(AutoFillUrl(ev),
            new AutoFillHeatDutiesRequest(TwoLanes, KeepExisting: true))).ReadAsync<AutoFillHeatDutiesResultDto>();

        var heat1 = result.Duties.Where(d => d.HeatId == ev.Heat1Id).ToList();
        var kept = heat1.Single(d => d.LaneNumber == 1);
        Assert.Equal(ev.Teams[4].Id, kept.AssignedTeamId);
        Assert.Equal(ev.Teams[4].DisplayName, kept.AssignedTeamName);
        Assert.Equal("Start/Finish Line Steward — Lane 1", kept.Role);
        var gap = heat1.Single(d => d.LaneNumber == 2);
        Assert.NotNull(gap.AssignedTeamId);
        Assert.NotEqual(ev.Teams[4].Id, gap.AssignedTeamId);

        var heat2 = result.Duties.Where(d => d.HeatId == ev.Heat2Id).ToList();
        Assert.Equal(3, heat2.Count);
        Assert.Contains(heat2, d => d.Role == "Medic Liaison" && d.AssignedTeamId == ev.Teams[0].Id);

        foreach (var byHeat in result.Duties.GroupBy(d => d.HeatId))
            Assert.Equal(byHeat.Count(), byHeat.Select(d => d.AssignedTeamId!.Value).Distinct().Count());
        Assert.Equal(0, result.UnfilledCount);

        // Nothing is saved, and without KeepExisting the proposal ignores the existing shifts.
        var after = await (await trainer.GetAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts")).ReadAsync<List<VolunteerShiftDto>>();
        Assert.Equal(before.Count, after.Count);
        var plain = await (await trainer.PostAsJsonAsync(AutoFillUrl(ev), new AutoFillHeatDutiesRequest(TwoLanes)))
            .ReadAsync<AutoFillHeatDutiesResultDto>();
        Assert.DoesNotContain(plain.Duties, d => d.Role == "Medic Liaison");
    }

    [Fact]
    public async Task AutoFillHeatDuties_ExplicitDefaultsMatchOmittedOptions()
    {
        var ev = await SeedSessionWithHeatsAsync(teamCount: 6, markLastTeamHc: true);
        var trainer = await factory.TrainerAsync();
        var plain = await (await trainer.PostAsJsonAsync(AutoFillUrl(ev), new AutoFillHeatDutiesRequest(TwoLanes)))
            .ReadAsync<AutoFillHeatDutiesResultDto>();
        var explicitDefaults = await (await trainer.PostAsJsonAsync(AutoFillUrl(ev),
            new AutoFillHeatDutiesRequest(TwoLanes, TeamSessionIds: [], AvoidNeighbouringHeats: true, KeepExisting: false)))
            .ReadAsync<AutoFillHeatDutiesResultDto>();
        Assert.Equal(
            plain.Duties.Select(d => (d.HeatId, d.Role, d.AssignedTeamId)),
            explicitDefaults.Duties.Select(d => (d.HeatId, d.Role, d.AssignedTeamId)));
        Assert.Equal(plain.TeamDutyCounts, explicitDefaults.TeamDutyCounts);
    }

    [Fact]
    public async Task TeamHere_AllowsAnonymous_IsIdempotent_DoesNotOverwriteStaffHere_RejectsNonHeatShifts_AndRateLimitsPerIp()
    {
        var ev = await SeedSessionWithHeatsAsync();
        var trainer = await factory.TrainerAsync();
        var anon = factory.CreateClient();

        // Create a valid heat-level team shift and a session-level shift.
        var heatShiftResp = await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts",
            new CreateVolunteerShiftRequest(
                Role: "Start/Finish Line Steward — Lane 1",
                SessionId: ev.SessionId,
                DutyCategory: "LineSteward",
                AssignedTeamId: ev.Teams[2].Id,
                LaneNumber: 1,
                HeatId: ev.Heat1Id));
        var heatShift = await heatShiftResp.ReadAsync<VolunteerShiftDto>();

        var sessionShiftResp = await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts",
            new CreateVolunteerShiftRequest(
                Role: "Whole Session Steward",
                SessionId: ev.SessionId,
                DutyCategory: "LineSteward",
                AssignedTeamId: ev.Teams[2].Id,
                LaneNumber: 1,
                HeatId: null));
        var sessionShift = await sessionShiftResp.ReadAsync<VolunteerShiftDto>();

        var unassignedHeatShiftResp = await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts",
            new CreateVolunteerShiftRequest(
                Role: "Unassigned Heat Steward",
                SessionId: ev.SessionId,
                DutyCategory: "LineSteward",
                AssignedTeamId: null,
                LaneNumber: 2,
                HeatId: ev.Heat1Id));
        var unassignedHeatShift = await unassignedHeatShiftResp.ReadAsync<VolunteerShiftDto>();

        // 1. Rejects session-level shift (HeatId == null) and unassigned heat shift (AssignedTeamId == null).
        var badSessionResp = await anon.PostAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{sessionShift.Id}/team-here", null);
        Assert.Equal(HttpStatusCode.BadRequest, badSessionResp.StatusCode);

        var badUnassignedResp = await anon.PostAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{unassignedHeatShift.Id}/team-here", null);
        Assert.Equal(HttpStatusCode.BadRequest, badUnassignedResp.StatusCode);

        // 2. Staff calls missing steward first (creates announcement), then anonymous viewer presses "We're here".
        var callMissing = await trainer.PostAsJsonAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{heatShift.Id}/call-missing", new CallMissingStewardRequest(null));
        Assert.Equal(HttpStatusCode.OK, callMissing.StatusCode);

        var firstHereResp = await anon.PostAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{heatShift.Id}/team-here", null);
        Assert.Equal(HttpStatusCode.OK, firstHereResp.StatusCode);
        var firstHere = await firstHereResp.ReadAsync<VolunteerShiftDto>();
        Assert.Equal("TeamSaysHere", firstHere.AttendanceStatus);
        Assert.NotNull(firstHere.CheckedInAt);
        Assert.Null(firstHere.CheckedInByName);

        // Missing-steward chat announcement was cleared.
        var remainingAnnouncements = await factory.WithDbAsync(db =>
            db.ChatMessages.CountAsync(m => m.CompetitionId == ev.CompetitionId && m.Tag == $"missing-steward:{heatShift.Id}"));
        Assert.Equal(0, remainingAnnouncements);

        // 3. Idempotent: pressing "We're here" a second time keeps TeamSaysHere and original CheckedInAt.
        var secondHereResp = await anon.PostAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{heatShift.Id}/team-here", null);
        Assert.Equal(HttpStatusCode.OK, secondHereResp.StatusCode);
        var secondHere = await secondHereResp.ReadAsync<VolunteerShiftDto>();
        Assert.Equal("TeamSaysHere", secondHere.AttendanceStatus);
        Assert.Equal(firstHere.CheckedInAt, secondHere.CheckedInAt);

        // 4. Staff confirms "Here" via PUT attendance; subsequent anonymous team-here does NOT downgrade "Here" to "TeamSaysHere".
        var staffConfirmResp = await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{heatShift.Id}/attendance",
            new UpdateVolunteerAttendanceRequest("Here", "Chief Steward"));
        Assert.Equal(HttpStatusCode.OK, staffConfirmResp.StatusCode);
        var staffConfirmed = await staffConfirmResp.ReadAsync<VolunteerShiftDto>();
        Assert.Equal("Here", staffConfirmed.AttendanceStatus);
        Assert.True(staffConfirmed.CheckedInByStaffOverride);

        var afterStaffResp = await anon.PostAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{heatShift.Id}/team-here", null);
        Assert.Equal(HttpStatusCode.OK, afterStaffResp.StatusCode);
        var afterStaff = await afterStaffResp.ReadAsync<VolunteerShiftDto>();
        Assert.Equal("Here", afterStaff.AttendanceStatus);
        Assert.True(afterStaff.CheckedInByStaffOverride);
    }

    [Fact]
    public async Task TeamHere_RateLimitEnforcedPerIp()
    {
        var ev = await SeedSessionWithHeatsAsync();
        var trainer = await factory.TrainerAsync();
        var createResp = await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts",
            new CreateVolunteerShiftRequest(
                Role: "Start/Finish Line Steward — Lane 1",
                SessionId: ev.SessionId,
                DutyCategory: "LineSteward",
                AssignedTeamId: ev.Teams[2].Id,
                LaneNumber: 1,
                HeatId: ev.Heat1Id));
        var shift = await createResp.ReadAsync<VolunteerShiftDto>();

        using var rateLimitedFactory = factory.WithWebHostBuilder(b => b.UseSetting("RateLimits:TeamHerePerMinute", "2"));
        var anon = rateLimitedFactory.CreateClient();

        var r1 = await anon.PostAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{shift.Id}/team-here", null);
        var r2 = await anon.PostAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{shift.Id}/team-here", null);
        var r3 = await anon.PostAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{shift.Id}/team-here", null);

        Assert.Equal(HttpStatusCode.OK, r1.StatusCode);
        Assert.Equal(HttpStatusCode.OK, r2.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, r3.StatusCode);
    }

    [Fact]
    public async Task ReminderPlan_IncludesHeatDutyRemindersForSupportersAndTrainer_AndReplansWhenTimetableMoves()
    {
        var ev = await SeedSessionWithHeatsAsync();
        var (_, supporterAuth) = await factory.SignupAsync("Member", "Supporter Club");
        var (_, trainerUserAuth) = await factory.SignupAsync("Trainer", "Team Trainer Club");
        var (_, pendingSupporterAuth) = await factory.SignupAsync("Member", "Pending Supporter Club");

        var stockport = ev.Teams[0];
        var heatStartUtc = new DateTime(2026, 7, 11, 13, 20, 0, DateTimeKind.Utc); // 14:20 BST (UK time)

        var shiftId = await factory.WithDbAsync(async db =>
        {
            var comp = await db.Competitions.SingleAsync(c => c.Id == ev.CompetitionId);
            comp.StartDate = heatStartUtc.Date;
            comp.EndDate = heatStartUtc.Date.AddDays(1);

            var team = await db.Teams.SingleAsync(t => t.Id == stockport.Id);
            team.TrainerUserId = trainerUserAuth.User.Id;

            var heat2 = await db.Heats.SingleAsync(h => h.Id == ev.Heat2Id);
            heat2.Label = "Heat 4";
            heat2.ScheduledStart = heatStartUtc;

            db.TeamSupporters.AddRange(
                new TeamSupporter
                {
                    TeamId = stockport.Id,
                    UserId = supporterAuth.User.Id,
                    Status = TeamSupporterStatus.Accepted,
                },
                new TeamSupporter
                {
                    TeamId = stockport.Id,
                    UserId = pendingSupporterAuth.User.Id,
                    Status = TeamSupporterStatus.Pending,
                });

            var shift = new VolunteerShift
            {
                CompetitionId = ev.CompetitionId,
                SessionId = ev.SessionId,
                HeatId = ev.Heat2Id,
                Role = "Changeover steward",
                DutyCategory = "ChangeoverSteward",
                LaneNumber = 2,
                AssignedTeamId = stockport.Id,
                AttendanceStatus = "Assigned",
                RequiredCount = 1,
            };
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            return shift.Id;
        });

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // 30 minutes before heatStartUtc (12:50 UTC, before Heat 1 starts at 13:00 UTC) -> within the 90-minute planning window.
        var nowUtc = heatStartUtc.AddMinutes(-30);
        var planned = await ReminderPlan.LoadAsync(db, nowUtc, CancellationToken.None, ev.CompetitionId);
        var dutyReminder = Assert.Single(planned, r => r.Key == $"duty:{shiftId}");

        Assert.Equal("15 minutes until your duty", dutyReminder.Payload.Title);
        Assert.Equal("Stockport A: Changeover steward, lane 2, Heat 4 around 14:20.", dutyReminder.Payload.Body);
        Assert.Equal(heatStartUtc.AddMinutes(-15), dutyReminder.DueAt);
        Assert.Contains(supporterAuth.User.Id, dutyReminder.Users);
        Assert.Contains(trainerUserAuth.User.Id, dutyReminder.Users);
        Assert.DoesNotContain(pendingSupporterAuth.User.Id, dutyReminder.Users);

        // Move the heat 10 minutes later (13:30 UTC / 14:30 BST) and verify the same key re-plans to the new time.
        var shiftedStartUtc = heatStartUtc.AddMinutes(10);
        await factory.WithDbAsync(async db2 =>
        {
            var h = await db2.Heats.SingleAsync(x => x.Id == ev.Heat2Id);
            h.ScheduledStart = shiftedStartUtc;
            await db2.SaveChangesAsync();
        });

        db.ChangeTracker.Clear();
        var replanned = await ReminderPlan.LoadAsync(db, nowUtc, CancellationToken.None, ev.CompetitionId);
        var updatedDutyReminder = Assert.Single(replanned, r => r.Key == $"duty:{shiftId}");
        Assert.Equal(shiftedStartUtc.AddMinutes(-15), updatedDutyReminder.DueAt);
        Assert.Equal("Stockport A: Changeover steward, lane 2, Heat 4 around 14:30.", updatedDutyReminder.Payload.Body);
    }

    [Fact]
    public async Task SaveHeatDuties_AndAutoFill_ValidationBranchesDefaultTemplatesCrossSessionFairnessAndSectionDelete()
    {
        var ev = await SeedSessionWithHeatsAsync();
        var trainer = await factory.TrainerAsync();

        // 1. SaveHeatDuties validation branches
        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/heat-duties",
            new SaveHeatDutiesRequest([], []))).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/heat-duties",
            new SaveHeatDutiesRequest([999999], []))).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/heat-duties",
            new SaveHeatDutiesRequest([ev.SessionId], [new HeatDutyItemInput(999999, "Starter")]))).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/heat-duties",
            new SaveHeatDutiesRequest([ev.SessionId], [new HeatDutyItemInput(ev.Heat1Id, "   ")]))).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/heat-duties",
            new SaveHeatDutiesRequest([ev.SessionId], [new HeatDutyItemInput(ev.Heat1Id, "Starter", AssignedTeamId: 999999)]))).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/heat-duties",
            new SaveHeatDutiesRequest([ev.SessionId], [new HeatDutyItemInput(ev.Heat1Id, "Starter", AssignedTeamId: ev.Teams[0].Id)]))).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/heat-duties",
            new SaveHeatDutiesRequest([ev.SessionId],
            [
                new HeatDutyItemInput(ev.Heat1Id, "Starter", AssignedTeamId: ev.Teams[2].Id),
                new HeatDutyItemInput(ev.Heat1Id, "Referee", AssignedTeamId: ev.Teams[2].Id),
            ]))).StatusCode);

        // 2. SaveHeatDuties without sessionIds (scopes by duty heatIds) and match by explicit Id + 409 plural message when 2 checked-in shifts are replaced
        var initialSave = await (await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/heat-duties",
            new SaveHeatDutiesRequest(null,
            [
                new HeatDutyItemInput(ev.Heat1Id, "Lane 1 Steward", "LineSteward", 1, ev.Teams[2].Id),
                new HeatDutyItemInput(ev.Heat1Id, "Lane 2 Steward", "LineSteward", 2, ev.Teams[3].Id),
            ]))).ReadAsync<SaveHeatDutiesResultDto>();
        Assert.Equal(2, initialSave.Created);

        // Mark one "Here" and one "TeamSaysHere" via PUT attendance
        var s1 = initialSave.Shifts[0];
        var s2 = initialSave.Shifts[1];
        Assert.Equal(HttpStatusCode.OK, (await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{s1.Id}/attendance",
            new UpdateVolunteerAttendanceRequest("Here"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts/{s2.Id}/attendance",
            new UpdateVolunteerAttendanceRequest("TeamSaysHere"))).StatusCode);

        // Reassign both checked-in shifts by explicit Id without confirmRemoveCheckedIn -> 409 with 2 shifts
        var pluralConflictResp = await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/heat-duties",
            new SaveHeatDutiesRequest([ev.SessionId],
            [
                new HeatDutyItemInput(ev.Heat1Id, "Lane 1 Steward", "LineSteward", 1, ev.Teams[4].Id, Id: s1.Id),
                new HeatDutyItemInput(ev.Heat1Id, "Lane 2 Steward", "LineSteward", 2, ev.Teams[5].Id, Id: s2.Id),
            ], ConfirmRemoveCheckedIn: false));
        Assert.Equal(HttpStatusCode.Conflict, pluralConflictResp.StatusCode);
        var pluralConflict = await pluralConflictResp.ReadAsync<HeatDutiesConflictDto>();
        Assert.Equal(2, pluralConflict.CheckedInShifts.Count);
        Assert.Contains("2 stewards have already checked in", pluralConflict.Message);

        // Confirm replacement by explicit Id -> resets AttendanceStatus to "Assigned"
        var replaced = await (await trainer.PutAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/heat-duties",
            new SaveHeatDutiesRequest([ev.SessionId],
            [
                new HeatDutyItemInput(ev.Heat1Id, "Lane 1 Steward", "LineSteward", 1, ev.Teams[4].Id, Id: s1.Id),
                new HeatDutyItemInput(ev.Heat1Id, "Lane 2 Steward", "LineSteward", 2, ev.Teams[5].Id, Id: s2.Id),
            ], ConfirmRemoveCheckedIn: true))).ReadAsync<SaveHeatDutiesResultDto>();
        Assert.Equal(2, replaced.Updated);
        Assert.All(replaced.Shifts, s => Assert.Equal("Assigned", s.AttendanceStatus));

        // 3. AutoFill: 404 on unknown session, 400 on unknown heatId, default role templates with IncludeChangeoverLineStewards and subset HeatIds
        Assert.Equal(HttpStatusCode.NotFound, (await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/sessions/999999/heat-duties/auto-fill",
            new AutoFillHeatDutiesRequest())).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/sessions/{ev.SessionId}/heat-duties/auto-fill",
            new AutoFillHeatDutiesRequest(HeatIds: [999999]))).StatusCode);

        // Give Teams[4] and Teams[5] duties in Heat 1 (already saved above), then auto-fill only Heat 3 with default templates (ArenaCrew + 2 LineStewards + 2 ChangeoverStewards = 5 roles, 4 non-riding teams -> 1 unfilled).
        var defaultTemplateResp = await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/sessions/{ev.SessionId}/heat-duties/auto-fill",
            new AutoFillHeatDutiesRequest(Roles: null, HeatIds: [ev.Heat3Id], IncludeChangeoverLineStewards: true));
        Assert.Equal(HttpStatusCode.OK, defaultTemplateResp.StatusCode);
        var defaultProposal = await defaultTemplateResp.ReadAsync<AutoFillHeatDutiesResultDto>();
        Assert.Equal(5, defaultProposal.Duties.Count);
        Assert.Equal(1, defaultProposal.UnfilledCount);

        // 4. DeleteSection removes heat-level shifts on that section's heats while unlinking session-level shifts.
        await trainer.PostAsJsonAsync(
            $"/api/competitions/{ev.CompetitionId}/volunteer-shifts",
            new CreateVolunteerShiftRequest("Whole Session Marshall", ev.SessionId, HeatId: null));
        var admin = await factory.AdminAsync();
        var delSectionResp = await admin.DeleteAsync($"/api/competitions/{ev.CompetitionId}/sections/{ev.SectionId}?force=true");
        Assert.Equal(HttpStatusCode.NoContent, delSectionResp.StatusCode);

        var shiftsAfterSectionDelete = await (await trainer.GetAsync($"/api/competitions/{ev.CompetitionId}/volunteer-shifts")).ReadAsync<List<VolunteerShiftDto>>();
        Assert.DoesNotContain(shiftsAfterSectionDelete, s => s.HeatId.HasValue);
        Assert.Contains(shiftsAfterSectionDelete, s => s.Role == "Whole Session Marshall" && s.SessionId is null);
    }
}
