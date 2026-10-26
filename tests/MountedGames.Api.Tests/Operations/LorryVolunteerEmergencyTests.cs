using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Operations;

public class LorryVolunteerEmergencyTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task CompetitionSupportsDedicatedLorryEntrancePinAndDirections()
    {
        var trainer = await factory.TrainerAsync();
        var createReq = new CreateCompetitionRequest(
            Name: "Synthetic Lorry Pin Cup",
            Location: "Synthetic Showground",
            Description: "Test event",
            Latitude: 51.5001,
            Longitude: -1.2001,
            What3Words: "///main.spectator.gate",
            AppleMapsUrl: null,
            StartDate: DateTime.UtcNow.Date.AddDays(14),
            EndDate: DateTime.UtcNow.Date.AddDays(15),
            LorryWhat3Words: "///synthetic.lorry.gate",
            LorryLatitude: 51.5099,
            LorryLongitude: -1.2099,
            LorryDirectionsNote: "Do not use Hollow Lane — approach from the A40 roundabout and enter Gate B.");

        var createResp = await trainer.PostAsJsonAsync("/api/competitions", createReq);
        Assert.Equal(HttpStatusCode.Created, createResp.StatusCode);
        var createdSummary = await createResp.ReadAsync<CompetitionSummary>();

        var anon = factory.CreateClient();
        var created = await (await anon.GetAsync($"/api/competitions/{createdSummary.Id}")).ReadAsync<CompetitionDetail>();
        Assert.Equal("synthetic.lorry.gate", created.LorryWhat3Words);
        Assert.Equal(51.5099, created.LorryLatitude);
        Assert.Equal(-1.2099, created.LorryLongitude);
        Assert.Equal("Do not use Hollow Lane — approach from the A40 roundabout and enter Gate B.", created.LorryDirectionsNote);

        // Update lorry entrance fields and verify public GET returns them
        var updateReq = new UpdateCompetitionRequest(
            Name: created.Name,
            Location: created.Location,
            Description: created.Description,
            Latitude: created.Latitude,
            Longitude: created.Longitude,
            What3Words: created.What3Words,
            AppleMapsUrl: created.AppleMapsUrl,
            StartDate: created.StartDate,
            EndDate: created.EndDate,
            IsActive: created.IsActive,
            IsArchived: false,
            LorryWhat3Words: "///updated.lorry.entrance",
            LorryLatitude: 51.515,
            LorryLongitude: -1.215,
            LorryDirectionsNote: "Follow yellow HGV signs to Lorry Park North.");

        var updateResp = await trainer.PutAsJsonAsync($"/api/competitions/{created.Id}", updateReq);
        Assert.Equal(HttpStatusCode.OK, updateResp.StatusCode);

        var fetched = await (await anon.GetAsync($"/api/competitions/{created.Id}")).ReadAsync<CompetitionDetail>();
        Assert.Equal("updated.lorry.entrance", fetched.LorryWhat3Words);
        Assert.Equal(51.515, fetched.LorryLatitude);
        Assert.Equal(-1.215, fetched.LorryLongitude);
        Assert.Equal("Follow yellow HGV signs to Lorry Park North.", fetched.LorryDirectionsNote);
    }

    [Fact]
    public async Task VolunteerShiftsSupportCrudClaimUnclaimAndHidePhoneNumbersFromNonStaff()
    {
        var trainerId = await factory.TrainerIdAsync();
        var compId = await factory.SeedCompetitionAsync("Synthetic Volunteer Cup", ownerUserId: trainerId);
        var sessionId = await factory.WithDbAsync(async db =>
        {
            var s = new Session
            {
                CompetitionId = compId,
                Name = "Morning Heats",
                ArenaName = "Arena 1",
                OrderIndex = 1,
            };
            db.Sessions.Add(s);
            await db.SaveChangesAsync();
            return s.Id;
        });

        var trainer = await factory.TrainerAsync();
        var (memberA, _) = await factory.SignupAsync("Member", "Synthetic Club Alpha");
        var (memberB, _) = await factory.SignupAsync("Member", "Synthetic Club Beta");
        var anon = factory.CreateClient();

        // Non-staff cannot create volunteer shifts
        var forbidCreate = await memberA.PostAsJsonAsync(
            $"/api/competitions/{compId}/volunteer-shifts",
            new CreateVolunteerShiftRequest("Arena Party", sessionId, null, "09:00", "Wear stout boots", 2));
        Assert.Equal(HttpStatusCode.Forbidden, forbidCreate.StatusCode);

        // Staff creates a shift with RequiredCount = 2
        var createResp = await trainer.PostAsJsonAsync(
            $"/api/competitions/{compId}/volunteer-shifts",
            new CreateVolunteerShiftRequest("Arena Party", sessionId, null, "09:00", "Wear stout boots", 2));
        Assert.Equal(HttpStatusCode.OK, createResp.StatusCode);
        var shift = await createResp.ReadAsync<VolunteerShiftDto>();
        Assert.Equal("Arena Party", shift.Role);
        Assert.Equal("Morning Heats", shift.SessionName);
        Assert.Equal("Arena 1", shift.ArenaName);
        Assert.Equal(2, shift.RequiredCount);
        Assert.Equal(0, shift.ClaimedCount);
        Assert.Equal(2, shift.RemainingCount);
        Assert.False(shift.IsFilled);

        // Anonymous user cannot claim
        var anonClaim = await anon.PostAsJsonAsync(
            $"/api/competitions/{compId}/volunteer-shifts/{shift.Id}/claim",
            new ClaimVolunteerShiftRequest("Anon Volunteer", "Anon Club", "07700 900111"));
        Assert.Equal(HttpStatusCode.Unauthorized, anonClaim.StatusCode);

        // Member A claims slot 1 with a phone number
        var claimAResp = await memberA.PostAsJsonAsync(
            $"/api/competitions/{compId}/volunteer-shifts/{shift.Id}/claim",
            new ClaimVolunteerShiftRequest("Synthetic Volunteer One", "Synthetic Club Alpha", "07700 900111"));
        Assert.Equal(HttpStatusCode.OK, claimAResp.StatusCode);
        var afterClaimA = await claimAResp.ReadAsync<VolunteerShiftDto>();
        Assert.Equal(1, afterClaimA.ClaimedCount);
        Assert.Equal(1, afterClaimA.RemainingCount);
        Assert.False(afterClaimA.IsFilled);
        var claimA = Assert.Single(afterClaimA.Claims);
        Assert.True(claimA.IsMine);
        // Member A is not competition staff, so ContactPhone is not returned in public/member DTOs
        Assert.Null(claimA.ContactPhone);

        // Duplicate claim by the same user & name is rejected with 409 Conflict
        var dupClaim = await memberA.PostAsJsonAsync(
            $"/api/competitions/{compId}/volunteer-shifts/{shift.Id}/claim",
            new ClaimVolunteerShiftRequest("Synthetic Volunteer One", "Synthetic Club Alpha", "07700 900111"));
        Assert.Equal(HttpStatusCode.Conflict, dupClaim.StatusCode);

        // Member B claims slot 2 -> shift becomes filled
        var claimBResp = await memberB.PostAsJsonAsync(
            $"/api/competitions/{compId}/volunteer-shifts/{shift.Id}/claim",
            new ClaimVolunteerShiftRequest("Synthetic Volunteer Two", "Synthetic Club Beta", "07700 900222"));
        Assert.Equal(HttpStatusCode.OK, claimBResp.StatusCode);
        var afterClaimB = await claimBResp.ReadAsync<VolunteerShiftDto>();
        Assert.Equal(2, afterClaimB.ClaimedCount);
        Assert.Equal(0, afterClaimB.RemainingCount);
        Assert.True(afterClaimB.IsFilled);

        // Over-capacity claim is rejected with 409 Conflict
        var overClaim = await trainer.PostAsJsonAsync(
            $"/api/competitions/{compId}/volunteer-shifts/{shift.Id}/claim",
            new ClaimVolunteerShiftRequest("Extra Volunteer", "Extra Club", "07700 900333"));
        Assert.Equal(HttpStatusCode.Conflict, overClaim.StatusCode);

        // Anonymous listing hides phone numbers and unfilledOnly filters out filled shifts
        var anonList = await (await anon.GetAsync($"/api/competitions/{compId}/volunteer-shifts")).ReadAsync<List<VolunteerShiftDto>>();
        var anonShift = Assert.Single(anonList);
        Assert.All(anonShift.Claims, c => Assert.Null(c.ContactPhone));

        var unfilledList = await (await anon.GetAsync($"/api/competitions/{compId}/volunteer-shifts?unfilledOnly=true")).ReadAsync<List<VolunteerShiftDto>>();
        Assert.Empty(unfilledList);

        // Staff listing includes volunteer phone numbers
        var staffList = await (await trainer.GetAsync($"/api/competitions/{compId}/volunteer-shifts")).ReadAsync<List<VolunteerShiftDto>>();
        var staffShift = Assert.Single(staffList);
        Assert.Equal(new[] { "07700 900111", "07700 900222" }, staffShift.Claims.Select(c => c.ContactPhone).ToArray());

        // Member B cannot delete Member A's claim (403 Forbidden)
        var forbidUnclaim = await memberB.DeleteAsync($"/api/competitions/{compId}/volunteer-shifts/{shift.Id}/claims/{claimA.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, forbidUnclaim.StatusCode);

        // Member A can unclaim their own slot
        var unclaimAResp = await memberA.DeleteAsync($"/api/competitions/{compId}/volunteer-shifts/{shift.Id}/claims/{claimA.Id}");
        Assert.Equal(HttpStatusCode.OK, unclaimAResp.StatusCode);
        var afterUnclaimA = await unclaimAResp.ReadAsync<VolunteerShiftDto>();
        Assert.Equal(1, afterUnclaimA.ClaimedCount);
        Assert.False(afterUnclaimA.IsFilled);

        // Staff can delete the shift entirely
        var deleteResp = await trainer.DeleteAsync($"/api/competitions/{compId}/volunteer-shifts/{shift.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResp.StatusCode);
    }

    [Fact]
    public async Task EmergencyContactsEndpointIsStrictlyStaffOnlyAndSearchesRidersPoniesTeamsClubsAndBibs()
    {
        var trainerId = await factory.TrainerIdAsync();
        var compId = await factory.SeedCompetitionAsync("Synthetic Emergency Lookup Cup", ownerUserId: trainerId);
        var sectionId = await factory.SeedSectionAsync(compId, "Under 17");
        var clubId = await factory.SeedClubAsync("Synthetic Valley Club", "Purple");
        var teamId = await factory.SeedTeamAsync(compId, sectionId, clubId, "Synthetic Valley A", trainerUserId: trainerId);

        await factory.WithDbAsync(async db =>
        {
            var team = await db.Teams.SingleAsync(t => t.Id == teamId);
            team.BibColour = "Purple";
            team.BibDescription = "Gold Stars";

            var olderForm = new DeclarationForm
            {
                TeamId = teamId,
                SubmittedByUserId = trainerId,
                SubmittedAt = DateTime.UtcNow.AddHours(-3),
                TrainerName = "Outdated Trainer",
                TrainerPhone = "07700 900000",
                Riders =
                {
                    new RiderEntry
                    {
                        OrderIndex = 1,
                        FullName = "Outdated Rider",
                        HorseName = "Outdated Pony",
                        EmergencyContactName = "Outdated Contact",
                        EmergencyContactPhone = "07700 900000",
                    },
                },
            };

            var latestForm = new DeclarationForm
            {
                TeamId = teamId,
                SubmittedByUserId = trainerId,
                SubmittedAt = DateTime.UtcNow.AddHours(-1),
                TrainerName = "Synthetic Trainer Pat",
                TrainerPhone = "07700 900555",
                Riders =
                {
                    new RiderEntry
                    {
                        OrderIndex = 1,
                        FullName = "Synthetic Junior Rider",
                        UseInitialOnly = true, // Even when UseInitialOnly is true publicly, emergency staff see full name
                        HorseName = "Bramble Star",
                        BibColour = "Yellow",
                        IsCaptain = true,
                        EmergencyContactName = "Synthetic Parent One",
                        EmergencyContactPhone = "07700 900101",
                        MedicalNotes = "Synthetic asthma inhaler in lorry",
                    },
                    new RiderEntry
                    {
                        OrderIndex = 2,
                        FullName = "Synthetic Reserve Rider",
                        HorseName = "Copper Cob",
                        IsReserve = true,
                        EmergencyContactName = "Synthetic Parent Two",
                        EmergencyContactPhone = "07700 900202",
                    },
                },
            };

            db.DeclarationForms.AddRange(olderForm, latestForm);
            await db.SaveChangesAsync();
        });

        // 1. Anonymous user receives 401 Unauthorized
        var anon = factory.CreateClient();
        var anonResp = await anon.GetAsync($"/api/competitions/{compId}/emergency-contacts?q=Bramble");
        Assert.Equal(HttpStatusCode.Unauthorized, anonResp.StatusCode);

        // 2. Non-staff signed-in Member receives 403 Forbidden
        var (memberClient, _) = await factory.SignupAsync("Member", "Synthetic Valley Club");
        var memberResp = await memberClient.GetAsync($"/api/competitions/{compId}/emergency-contacts?q=Bramble");
        Assert.Equal(HttpStatusCode.Forbidden, memberResp.StatusCode);

        // 3. Non-staff Approved Manager receives 403 Forbidden
        var (managerClient, _) = await factory.ApprovedManagerAsync("Synthetic Valley Club");
        var managerResp = await managerClient.GetAsync($"/api/competitions/{compId}/emergency-contacts?q=Bramble");
        Assert.Equal(HttpStatusCode.Forbidden, managerResp.StatusCode);

        // 4. Another trainer who does not organise/collaborate on this competition receives 404 NotFound (via CompetitionAccessFilter)
        var (otherTrainer, _) = await factory.ApprovedTrainerAsync();
        var otherTrainerResp = await otherTrainer.GetAsync($"/api/competitions/{compId}/emergency-contacts?q=Bramble");
        Assert.Equal(HttpStatusCode.NotFound, otherTrainerResp.StatusCode);

        // 5. Competition organiser (staff) can search across Rider, Pony, Team, Club, and Bib Colour
        var organiser = await factory.TrainerAsync();
        var allResp = await organiser.GetAsync($"/api/competitions/{compId}/emergency-contacts");
        Assert.Equal(HttpStatusCode.OK, allResp.StatusCode);
        Assert.Contains("no-store", allResp.Headers.CacheControl?.ToString() ?? string.Empty);

        var allRows = await allResp.ReadAsync<List<EmergencyContactLookupDto>>();
        Assert.Equal(2, allRows.Count);
        // Only the latest declaration form is returned
        Assert.DoesNotContain(allRows, r => r.RiderName == "Outdated Rider");

        // Search by Pony Name
        var byPony = await (await organiser.GetAsync($"/api/competitions/{compId}/emergency-contacts?q=Bramble")).ReadAsync<List<EmergencyContactLookupDto>>();
        var junior = Assert.Single(byPony);
        Assert.Equal("Synthetic Junior Rider", junior.RiderName);
        Assert.Equal("Bramble Star", junior.PonyName);
        Assert.Equal("Synthetic Valley A", junior.TeamName);
        Assert.Equal("Under 17", junior.SectionName);
        Assert.Equal("Synthetic Valley Club", junior.ClubName);
        Assert.Equal("Yellow", junior.BibColour);
        Assert.Equal("Gold Stars", junior.BibDescription);
        Assert.False(junior.IsReserve);
        Assert.Equal("Synthetic Parent One", junior.EmergencyContactName);
        Assert.Equal("07700 900101", junior.EmergencyContactPhone);
        Assert.Equal("Synthetic asthma inhaler in lorry", junior.MedicalNotes);
        Assert.Equal("Synthetic Trainer Pat", junior.TrainerName);
        Assert.Equal("07700 900555", junior.TrainerPhone);

        // Search by inherited Team/Club Bib Colour + Pony token
        var byBibAndPony = await (await organiser.GetAsync($"/api/competitions/{compId}/emergency-contacts?q=Purple%20Copper")).ReadAsync<List<EmergencyContactLookupDto>>();
        var reserve = Assert.Single(byBibAndPony);
        Assert.Equal("Synthetic Reserve Rider", reserve.RiderName);
        Assert.True(reserve.IsReserve);
        Assert.Equal("Purple", reserve.BibColour);
        Assert.Equal("07700 900202", reserve.EmergencyContactPhone);
    }
}
