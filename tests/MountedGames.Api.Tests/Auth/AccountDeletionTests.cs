using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Commerce;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

public class AccountDeletionTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public AccountDeletionTests(ApiFactory f) => _f = f;

    private const string Url = "/api/auth/me";
    private const string Password = "Passw0rd!x";

    private static Task<HttpResponseMessage> Delete(HttpClient client, string? password)
        => client.SendAsync(new HttpRequestMessage(HttpMethod.Delete, Url) { Content = JsonContent.Create(new { password }) });

    private async Task<string> MessageAsync(HttpResponseMessage r)
        => (await r.Content.ReadFromJsonAsync<Dictionary<string, string>>(TestClients.Json))!["message"];

    private async Task<bool> CanSignInAsync(string email)
    {
        using var r = await _f.CreateClient().PostAsJsonAsync("/api/auth/login", new LoginRequest(email, Password));
        return r.IsSuccessStatusCode;
    }

    // ---- refusals ----

    [Fact]
    public async Task Anonymous_Gets401()
    {
        using var r = await Delete(_f.CreateClient(), Password);
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task MissingPassword_Gets400_AndNothingChanges(string? password)
    {
        var (client, auth) = await _f.SignupAsync();
        using var r = await Delete(client, password);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.True(await _f.WithDbAsync(db => db.Users.AnyAsync(u => u.Id == auth.User.Id)));
    }

    [Fact]
    public async Task WrongPassword_Gets400_AndFiveWrongGuessesLockTheAccount()
    {
        var (client, auth) = await _f.SignupAsync();
        for (var i = 0; i < 5; i++)
        {
            using var wrong = await Delete(client, "not-the-password");
            Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
            // The fifth wrong guess is the one that triggers the lockout.
            Assert.Contains(i < 4 ? "isn't right" : "Too many", await MessageAsync(wrong), StringComparison.Ordinal);
        }
        // A lockout after wrong passwords doesn't end the session itself.
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/auth/me")).StatusCode);
        // Even the right password is refused once the account is locked, like signing in.
        using var locked = await Delete(client, Password);
        Assert.Equal(HttpStatusCode.BadRequest, locked.StatusCode);
        Assert.Contains("Too many", await MessageAsync(locked), StringComparison.Ordinal);
        Assert.True(await _f.WithDbAsync(db => db.Users.AnyAsync(u => u.Id == auth.User.Id)));
    }

    [Fact]
    public async Task TheSharedAdminAccount_CannotBeDeleted()
    {
        var admin = await _f.AdminAsync();
        using var r = await Delete(admin, "anything");
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.Contains("without a password", await MessageAsync(r), StringComparison.Ordinal);
        Assert.True(await _f.WithDbAsync(db => db.Users.AnyAsync(u => u.Email == TestClients.AdminEmail)));
    }

    [Fact]
    public async Task AnAccountWithNoPassword_IsRefusedWithAClearMessage()
    {
        var (client, auth) = await _f.SignupAsync();
        await _f.WithDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == auth.User.Id)).PasswordHash = null;
            await db.SaveChangesAsync();
        });
        using var r = await Delete(client, Password);
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.Contains("without a password", await MessageAsync(r), StringComparison.Ordinal);
        Assert.True(await _f.WithDbAsync(db => db.Users.AnyAsync(u => u.Id == auth.User.Id)));
    }

    [Fact]
    public async Task AnotherAdmin_CanBeDeleted_ButNotTheLastOne()
    {
        using var f = new ApiFactory();
        var admin = await f.AdminAsync();
        var email = $"admin{Guid.NewGuid():N}"[..14] + "@mg.local";
        (await admin.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, Password, "Second Admin", Roles.Admin, null))).EnsureSuccessStatusCode();
        var second = f.WithToken((await f.LoginAsync(email, Password)).Token);

        // The shared admin is still an Admin, so this one is not the last.
        using var ok = await Delete(second, Password);
        Assert.Equal(HttpStatusCode.NoContent, ok.StatusCode);
        Assert.False(await f.WithDbAsync(db => db.Users.AnyAsync(u => u.Email == email)));

        // Make a new admin the only one by taking the shared account out of the role.
        var email2 = $"admin{Guid.NewGuid():N}"[..14] + "@mg.local";
        (await admin.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email2, Password, "Only Admin", Roles.Admin, null))).EnsureSuccessStatusCode();
        using (var scope = f.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            await users.RemoveFromRoleAsync((await users.FindByEmailAsync(TestClients.AdminEmail))!, Roles.Admin);
        }
        var only = f.WithToken((await f.LoginAsync(email2, Password)).Token);

        using var refused = await Delete(only, Password);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Contains("only administrator", await MessageAsync(refused), StringComparison.Ordinal);
        Assert.True(await f.WithDbAsync(db => db.Users.AnyAsync(u => u.Email == email2)));
    }

    // ---- what happens to each kind of data ----

    private sealed record Seeded(Arena Arena, Arena Other, int ChatId, int PostId, int PublicCommentId, int PrivateOwnCommentId,
        int DmToUserId, int ReportId, int FormId, int SignupId, int NoteId, int SavedRiderId, int RiderEntryId, int LookId, int SupporterId,
        int CollaboratorId, int OthersNoteId, int OthersChatId);

    private async Task<Seeded> SeedEverythingAsync(string userId)
    {
        var arena = await _f.CreateArenaAsync(2);
        var other = await _f.CreateArenaAsync(1);
        var (_, bystander) = await _f.SignupAsync();
        return await _f.WithDbAsync(async db =>
        {
            var comp = await db.Competitions.SingleAsync(c => c.Id == arena.CompetitionId);
            comp.CreatedByUserId = userId;
            (await db.Teams.SingleAsync(t => t.Id == arena.TeamIds[0])).TrainerUserId = userId;
            var club = await db.Clubs.SingleAsync(c => c.Id == db.Teams.Single(t => t.Id == arena.TeamIds[0]).ClubId);

            var collaborator = new CompetitionCollaborator { CompetitionId = other.CompetitionId, UserId = userId, Role = CollaboratorRole.CompetitionAdmin, AddedByUserId = bystander.User.Id, AddedAt = DateTime.UtcNow };
            var chat = new ChatMessage { CompetitionId = arena.CompetitionId, UserId = userId, AuthorName = "Real Name", Body = "Hello", IpAddress = "203.0.113.50" };
            var othersChat = new ChatMessage { CompetitionId = arena.CompetitionId, UserId = bystander.User.Id, AuthorName = "Bystander", Body = "Hi", IpAddress = "203.0.113.51" };
            var post = new ShopPost { AuthorUserId = userId, AuthorName = "Synthetic seller", Title = "Synthetic saddle", Body = "For sale", PonyClubName = "Synthetic club", PriceMinor = 1234, ImageBase64 = "data:image/png;base64,c3ludGhldGlj", ContactInfo = "seller@example.invalid", IpAddress = "203.0.113.50", DeletedByUserId = userId };
            var othersPost = new ShopPost { AuthorUserId = bystander.User.Id, AuthorName = "Bystander", Title = "Boots", Body = "For sale" };
            db.AddRange(collaborator, chat, othersChat, post, othersPost);
            await db.SaveChangesAsync();

            var publicComment = new ShopComment { PostId = othersPost.Id, AuthorUserId = userId, AuthorName = "Real Name", Body = "Interested", IpAddress = "203.0.113.50" };
            var privateOwn = new ShopComment { PostId = othersPost.Id, AuthorUserId = userId, AuthorName = "Real Name", Body = "My DM", IsPrivate = true, ToUserId = bystander.User.Id };
            var dmToUser = new ShopComment { PostId = post.Id, AuthorUserId = bystander.User.Id, AuthorName = "Bystander", Body = "Their DM", IsPrivate = true, ToUserId = userId };
            var report = new ShopReport { PostId = othersPost.Id, ReporterUserId = userId, Reason = "Spam", IpAddress = "203.0.113.50" };
            db.AddRange(publicComment, privateOwn, dmToUser, report);

            var saved = new SavedRider { ClubId = club.Id, CreatedByUserId = userId, FullName = "Synthetic Rider", HorseName = "Synthetic Horse" };
            db.SavedRiders.Add(saved);
            await db.SaveChangesAsync();
            var form = new DeclarationForm { TeamId = arena.TeamIds[0], SubmittedByUserId = userId, IsLocked = true };
            form.Riders.Add(new RiderEntry { SavedRiderId = saved.Id, FullName = "Synthetic Rider", HorseName = "Synthetic Horse" });
            db.DeclarationForms.Add(form);
            var signup = new SectionSignup { CompetitionSectionId = arena.SectionId, UserId = userId, FullName = "Real Name", ContactInfo = "real@example.test", AmountMinor = 1500, Status = SignupPaymentStatus.Paid };
            var note = new TrainerNote { UserId = userId, Body = "Private note" };
            var othersNote = new TrainerNote { UserId = bystander.User.Id, Body = "Someone else's note" };
            db.PushSubscriptions.Add(new PushSubscription { UserId = userId, Endpoint = "https://push.invalid/1", P256dh = "k", Auth = "a" });
            var look = new OverlayLook { OwnerUserId = userId, Name = "Mine", LookJson = "{}" };
            var supporter = new TeamSupporter { TeamId = other.TeamIds[0], UserId = userId, Status = TeamSupporterStatus.Accepted };
            db.AddRange(signup, note, othersNote, look, supporter);
            await db.SaveChangesAsync();
            return new Seeded(arena, other, chat.Id, post.Id, publicComment.Id, privateOwn.Id, dmToUser.Id, report.Id, form.Id, signup.Id,
                note.Id, saved.Id, form.Riders.Single().Id, look.Id, supporter.Id, collaborator.Id, othersNote.Id, othersChat.Id);
        });
    }

    [Fact]
    public async Task Deleting_ErasesGuestChildDetailsVehicleAndArrivalNotes_AndClearsProtestAccountLinks()
    {
        var (client, auth) = await _f.SignupAsync();
        var id = auth.User.Id;
        var arena = await _f.CreateArenaAsync(2);
        var (heatId, _) = await _f.AddHeatAsync(arena.SessionId, arena.TeamIds);
        var (signupId, otherSignupId, protestId) = await _f.WithDbAsync(async db =>
        {
            var mine = new SectionSignup { CompetitionSectionId = arena.SectionId, UserId = id, FullName = "Real Name", AmountMinor = 0, Status = SignupPaymentStatus.Paid };
            var others = new SectionSignup { CompetitionSectionId = arena.SectionId, FullName = "Someone Else", AmountMinor = 0, Status = SignupPaymentStatus.Paid };
            db.AddRange(mine, others);
            await db.SaveChangesAsync();
            foreach (var sid in new[] { mine.Id, others.Id })
            {
                db.Add(new SignupGuestDetails { SignupId = sid, RiderName = "Child Name", RiderDateOfBirth = new DateTime(2015, 4, 5), PonyName = "Pony",
                    GuardianName = "Guardian", GuardianPhone = "+447123456789", EmergencyContactName = "Emergency", EmergencyContactPhone = "+447123456780" });
                db.Add(new SignupExtras { SignupId = sid, VehicleRegistration = "AB12 CDE", ArrivalNotes = "Arriving late" });
            }
            var protest = new MountedGames.Api.Entities.Operations.Protest
            {
                CompetitionId = arena.CompetitionId, HeatId = heatId, Reason = "Test", RequestId = Guid.NewGuid().ToString("N"),
                CreatedByUserId = id, DecidedByUserId = id,
            };
            db.Add(protest);
            await db.SaveChangesAsync();
            return (mine.Id, others.Id, protest.Id);
        });

        using var r = await Delete(client, Password);
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);

        await _f.WithDbAsync(async db =>
        {
            var g = await db.Set<SignupGuestDetails>().SingleAsync(x => x.SignupId == signupId);
            Assert.Null(g.RiderDateOfBirth);
            Assert.Null(g.GuardianName);
            Assert.Null(g.GuardianPhone);
            Assert.Null(g.EmergencyContactName);
            Assert.Null(g.EmergencyContactPhone);
            var e = await db.Set<SignupExtras>().SingleAsync(x => x.SignupId == signupId);
            Assert.Null(e.VehicleRegistration);
            Assert.Null(e.ArrivalNotes);
            var p = await db.Set<MountedGames.Api.Entities.Operations.Protest>().SingleAsync(x => x.Id == protestId);
            Assert.Null(p.CreatedByUserId);
            Assert.Null(p.DecidedByUserId);

            // Someone else's entry is untouched.
            var og = await db.Set<SignupGuestDetails>().SingleAsync(x => x.SignupId == otherSignupId);
            Assert.NotNull(og.RiderDateOfBirth);
            Assert.Equal("Guardian", og.GuardianName);
            Assert.Equal("AB12 CDE", (await db.Set<SignupExtras>().SingleAsync(x => x.SignupId == otherSignupId)).VehicleRegistration);
        });
    }

    [Fact]
    public async Task Deleting_RemovesAuthoredContent_PreservesAccounting_AndClearsOwnership()
    {
        var (client, auth) = await _f.SignupAsync();
        var id = auth.User.Id;
        var s = await SeedEverythingAsync(id);

        using var r = await Delete(client, Password);

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.False(await CanSignInAsync(auth.User.Email));
        // The session they deleted from ends with the account.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
        await _f.WithDbAsync(async db =>
        {
            Assert.False(await db.Users.AnyAsync(u => u.Id == id));
            Assert.False(await db.UserRoles.AnyAsync(x => x.UserId == id));

            // Private to them: gone.
            Assert.False(await db.TrainerNotes.AnyAsync(x => x.Id == s.NoteId));
            Assert.False(await db.PushSubscriptions.AnyAsync(x => x.UserId == id));
            Assert.False(await db.OverlayLooks.AnyAsync(x => x.Id == s.LookId));
            Assert.False(await db.TeamSupporters.AnyAsync(x => x.Id == s.SupporterId));
            Assert.False(await db.CompetitionCollaborators.AnyAsync(x => x.Id == s.CollaboratorId));
            Assert.False(await db.SavedRiders.AnyAsync(x => x.Id == s.SavedRiderId));
            Assert.False(await db.ShopComments.AnyAsync(x => x.Id == s.PrivateOwnCommentId));

            // Their roster is gone but the declaration made from it is event history and stays.
            var entry = await db.RiderEntries.SingleAsync(x => x.Id == s.RiderEntryId);
            Assert.Null(entry.SavedRiderId);
            Assert.Equal("Synthetic Rider", entry.FullName);
            var form = await db.DeclarationForms.SingleAsync(x => x.Id == s.FormId);
            Assert.Null(form.SubmittedByUserId);

            // Authored text and images are gone, including content an admin could otherwise still read.
            Assert.False(await db.ChatMessages.AnyAsync(x => x.Id == s.ChatId));
            var post = await db.ShopPosts.SingleAsync(x => x.Id == s.PostId);
            Assert.Equal((null, AccountDeletionService.DeletedName, null, null, null, string.Empty),
                (post.AuthorUserId, post.AuthorName, post.ContactInfo, post.IpAddress, post.DeletedByUserId, post.Body));
            Assert.Equal(string.Empty, post.Title);
            Assert.Null(post.PonyClubName);
            Assert.Null(post.PriceMinor);
            Assert.Null(post.ImageBase64);
            Assert.True(post.IsDeleted);
            Assert.NotNull(post.DeletedAt);
            Assert.False(await db.ShopComments.AnyAsync(x => x.Id == s.PublicCommentId));
            var report = await db.ShopReports.SingleAsync(x => x.Id == s.ReportId);
            Assert.Null(report.ReporterUserId);
            Assert.Null(report.IpAddress);
            Assert.Null(report.Reason);
            // A private message sent to them stays for its author but is no longer addressed to anyone.
            var incoming = await db.ShopComments.SingleAsync(x => x.Id == s.DmToUserId);
            Assert.Null(incoming.ToUserId);
            Assert.Equal("Their DM", incoming.Body);
            Assert.Equal("Bystander", incoming.AuthorName);
            Assert.NotNull(incoming.AuthorUserId);

            // A signup is a payment record: kept with the payer's name, linked to no account, contact details gone.
            var signup = await db.SectionSignups.SingleAsync(x => x.Id == s.SignupId);
            Assert.Equal((null, null, "Real Name", 1500), (signup.UserId, signup.ContactInfo, signup.FullName, signup.AmountMinor));

            // Ownership links are cleared; the competition and team carry on.
            Assert.Null((await db.Competitions.SingleAsync(c => c.Id == s.Arena.CompetitionId)).CreatedByUserId);
            Assert.Null((await db.Teams.SingleAsync(t => t.Id == s.Arena.TeamIds[0])).TrainerUserId);
            Assert.Equal(2, await db.Teams.CountAsync(t => t.CompetitionId == s.Arena.CompetitionId));

            // Other people's data is untouched.
            Assert.True(await db.TrainerNotes.AnyAsync(x => x.Id == s.OthersNoteId));
            var others = await db.ChatMessages.SingleAsync(x => x.Id == s.OthersChatId);
            Assert.Equal(("Bystander", "203.0.113.51"), (others.AuthorName, others.IpAddress));
        });
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync($"/api/shop/posts/{s.PostId}")).StatusCode);
    }

    [Fact]
    public async Task Deleting_RemovesAnnouncementsAndPrivateChat_ButPreservesOtherAuthors()
    {
        var (client, auth) = await _f.SignupAsync();
        var (_, bystander) = await _f.SignupAsync();
        var arena = await _f.CreateArenaAsync(1);
        var ids = await _f.WithDbAsync(async db =>
        {
            var announcement = new ChatMessage
            {
                CompetitionId = arena.CompetitionId, UserId = auth.User.Id, AuthorName = "Synthetic author",
                Type = ChatMessageType.Announcement, Tag = "pinned", Body = "Synthetic announcement",
            };
            var outgoing = new ChatMessage
            {
                CompetitionId = arena.CompetitionId, UserId = auth.User.Id, AuthorName = "Synthetic author",
                AdminOnly = true, RecipientUserId = bystander.User.Id, Body = "Synthetic outgoing message",
            };
            var incoming = new ChatMessage
            {
                CompetitionId = arena.CompetitionId, UserId = bystander.User.Id, AuthorName = "Synthetic bystander",
                AdminOnly = true, RecipientUserId = auth.User.Id, Body = "Synthetic incoming message",
            };
            db.AddRange(announcement, outgoing, incoming);
            await db.SaveChangesAsync();
            return (Announcement: announcement.Id, Outgoing: outgoing.Id, Incoming: incoming.Id);
        });

        using var response = await Delete(client, Password);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        await _f.WithDbAsync(async db =>
        {
            Assert.False(await db.ChatMessages.AnyAsync(m => m.Id == ids.Announcement || m.Id == ids.Outgoing));
            var retained = await db.ChatMessages.SingleAsync(m => m.Id == ids.Incoming);
            Assert.Equal(bystander.User.Id, retained.UserId);
            Assert.Equal("Synthetic incoming message", retained.Body);
            Assert.True(retained.AdminOnly);
            Assert.Null(retained.RecipientUserId);
        });
        // Clearing the recipient never turns someone else's private reply into a public message.
        var feed = await _f.CreateClient().GetFromJsonAsync<MountedGames.Api.Dtos.ChatMessageDto[]>(
            $"/api/competitions/{arena.CompetitionId}/chat");
        Assert.NotNull(feed);
        Assert.DoesNotContain(feed, message => message.Id == ids.Incoming);
    }

    [Fact]
    public async Task Deleting_ClearsPreviouslyHiddenMarketplaceContent_WithoutCascadingToOtherPeople()
    {
        var (client, auth) = await _f.SignupAsync();
        var (_, bystander) = await _f.SignupAsync();
        var earlierDeletion = new DateTime(2030, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var ids = await _f.WithDbAsync(async db =>
        {
            var post = new ShopPost
            {
                AuthorUserId = auth.User.Id, AuthorName = "Synthetic seller", Title = "Synthetic listing",
                Body = "Synthetic description", ContactInfo = "seller@example.invalid", PonyClubName = "Synthetic club",
                PriceMinor = 1000, ImageBase64 = "data:image/png;base64,c3ludGhldGlj", IpAddress = "203.0.113.52",
                IsDeleted = true, DeletedAt = earlierDeletion, DeletedByUserId = bystander.User.Id,
            };
            db.ShopPosts.Add(post);
            await db.SaveChangesAsync();
            var ownComment = new ShopComment
            {
                PostId = post.Id, AuthorUserId = auth.User.Id, AuthorName = "Synthetic seller",
                Body = "Synthetic hidden comment", IsDeleted = true,
            };
            var otherComment = new ShopComment
            {
                PostId = post.Id, AuthorUserId = bystander.User.Id, AuthorName = "Synthetic bystander",
                Body = "Synthetic retained comment",
            };
            var ownReport = new ShopReport { PostId = post.Id, ReporterUserId = auth.User.Id, Reason = "Synthetic resolved report", IsResolved = true };
            var otherReport = new ShopReport { PostId = post.Id, ReporterUserId = bystander.User.Id, Reason = "Synthetic retained report" };
            db.AddRange(ownComment, otherComment, ownReport, otherReport);
            await db.SaveChangesAsync();
            return (Post: post.Id, OwnComment: ownComment.Id, OtherComment: otherComment.Id, OwnReport: ownReport.Id, OtherReport: otherReport.Id);
        });

        using var response = await Delete(client, Password);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        await _f.WithDbAsync(async db =>
        {
            var retained = await db.ShopPosts.SingleAsync(p => p.Id == ids.Post);
            Assert.True(retained.IsDeleted);
            Assert.Equal(earlierDeletion, retained.DeletedAt);
            Assert.Equal(bystander.User.Id, retained.DeletedByUserId);
            Assert.Null(retained.AuthorUserId);
            Assert.Equal(AccountDeletionService.DeletedName, retained.AuthorName);
            Assert.Equal(string.Empty, retained.Title);
            Assert.Equal(string.Empty, retained.Body);
            Assert.Null(retained.ContactInfo);
            Assert.Null(retained.PonyClubName);
            Assert.Null(retained.ImageBase64);
            Assert.Null(retained.PriceMinor);
            Assert.Null(retained.IpAddress);
            Assert.False(await db.ShopComments.AnyAsync(c => c.Id == ids.OwnComment));
            var otherComment = await db.ShopComments.SingleAsync(c => c.Id == ids.OtherComment);
            Assert.Equal(bystander.User.Id, otherComment.AuthorUserId);
            Assert.Equal("Synthetic retained comment", otherComment.Body);
            var ownReport = await db.ShopReports.SingleAsync(r => r.Id == ids.OwnReport);
            Assert.Null(ownReport.ReporterUserId);
            Assert.Null(ownReport.Reason);
            Assert.True(ownReport.IsResolved);
            var otherReport = await db.ShopReports.SingleAsync(r => r.Id == ids.OtherReport);
            Assert.Equal(bystander.User.Id, otherReport.ReporterUserId);
            Assert.Equal("Synthetic retained report", otherReport.Reason);
        });
    }

    [Fact]
    public async Task AnAccountThatOwnsSeasonsOrSellsItems_IsEmptiedInPlace_NotRemoved()
    {
        var (client, auth) = await _f.SignupAsync();
        var id = auth.User.Id;
        var arena = await _f.CreateArenaAsync(1);
        await _f.WithDbAsync(async db =>
        {
            var club = await db.Clubs.SingleAsync(c => c.Id == db.Teams.Single(t => t.Id == arena.TeamIds[0]).ClubId);
            var season = new Season { OwnerUserId = id, Title = "Synthetic season", Year = 2030, AgeGroup = "Synthetic" };
            db.Add(season);
            db.Add(new TeamProfile { OwnerUserId = id, ClubId = club.Id, Suffix = "A", DisplayName = "Synthetic stable" });
            db.Add(new CatalogueItem { SellerUserId = id, Title = "Synthetic item", PriceMinor = 500, StockQuantity = 3 });
            db.TrainerNotes.Add(new TrainerNote { UserId = id, Body = "Private note" });
            db.ChatMessages.Add(new ChatMessage { CompetitionId = arena.CompetitionId, UserId = id, AuthorName = "Real Name", Body = "Hello", IpAddress = "203.0.113.60" });
            await db.SaveChangesAsync();
            var user = await db.Users.SingleAsync(u => u.Id == id);
            user.PhoneNumber = "07700 900001";
            await db.SaveChangesAsync();
        });

        using var r = await Delete(client, Password);

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.False(await CanSignInAsync(auth.User.Email));
        await _f.WithDbAsync(async db =>
        {
            var shell = await db.Users.SingleAsync(u => u.Id == id);
            Assert.Equal($"deleted-{id}@deleted.invalid", shell.Email);
            Assert.Equal(AccountDeletionService.DeletedName, shell.FullName);
            Assert.DoesNotContain(auth.User.Email, new[] { shell.UserName, shell.Email, shell.NormalizedEmail, shell.NormalizedUserName });
            Assert.Null(shell.PasswordHash);
            Assert.Null(shell.PhoneNumber);
            Assert.Null(shell.ClubId);
            Assert.Equal(DateTimeOffset.MaxValue, shell.LockoutEnd);
            Assert.False(await db.UserRoles.AnyAsync(x => x.UserId == id));
            // The records that kept it alive are still there, but nothing is for sale.
            Assert.True(await db.Set<Season>().AnyAsync(x => x.OwnerUserId == id));
            Assert.True(await db.Set<TeamProfile>().AnyAsync(x => x.OwnerUserId == id));
            Assert.False((await db.Set<CatalogueItem>().SingleAsync(x => x.SellerUserId == id)).IsActive);
            // And the rest of the clean-up still happened.
            Assert.False(await db.TrainerNotes.AnyAsync(x => x.UserId == id));
            Assert.False(await db.ChatMessages.AnyAsync(m => m.CompetitionId == arena.CompetitionId));
        });
    }

    [Fact]
    public async Task AnAccountWithAnOrder_IsEmptiedInPlace()
    {
        var (client, auth) = await _f.SignupAsync();
        var arena = await _f.CreateArenaAsync(1);
        await _f.WithDbAsync(async db =>
        {
            db.Add(new EventOrder { CompetitionId = arena.CompetitionId, BuyerUserId = auth.User.Id, IdempotencyKey = Guid.NewGuid().ToString(), RequestHash = "h", Status = CommerceOrderStatus.Paid, TotalMinor = 100 });
            await db.SaveChangesAsync();
        });

        using var r = await Delete(client, Password);

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(AccountDeletionService.DeletedName, (await _f.WithDbAsync(db => db.Users.SingleAsync(u => u.Id == auth.User.Id))).FullName);
        Assert.Equal(1, await _f.WithDbAsync(db => db.Set<EventOrder>().CountAsync(o => o.BuyerUserId == auth.User.Id)));
    }

    [Fact]
    public async Task ADeletedAccount_FreesItsUsernameForAnotherSignup()
    {
        var (client, auth) = await _f.SignupAsync();
        using var r = await Delete(client, Password);
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);

        var again = await _f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(auth.User.Email, Password, null, "Deletion Test Club"));
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
    }

    // ---- blocks, volunteer duties and private replies ----

    private async Task<AccountDeletionOutcome> DeleteThroughServiceAsync(string userId)
    {
        using var scope = _f.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        return await scope.ServiceProvider.GetRequiredService<AccountDeletionService>().DeleteAsync((await users.FindByIdAsync(userId))!);
    }

    [Fact]
    public async Task ABlockedAccount_KeepsItsBlockAndItsNetworks_WhenDeleted()
    {
        var (_, auth) = await _f.SignupAsync();
        var id = auth.User.Id;
        var hash = $"h1:{Guid.NewGuid():N}"[..30];
        await _f.InDbAsync(async db =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == id);
            user.BlockedAt = DateTime.UtcNow;
            user.BlockReason = "Abuse in chat";
            db.AccountIps.Add(new AccountIp { UserId = id, IpHash = hash });
            db.IpBlocks.Add(new IpBlock { IpAddress = hash, Reason = "Account blocked", BlockedAccountUserId = id });
            await db.SaveChangesAsync();
        });

        Assert.Equal(AccountDeletionOutcome.Anonymised, await DeleteThroughServiceAsync(id));

        await _f.WithDbAsync(async db =>
        {
            // Emptied, but still blocked, so it stays on the admins' blocked list and can be lifted from there.
            var shell = await db.Users.SingleAsync(u => u.Id == id);
            Assert.Equal((AccountDeletionService.DeletedName, $"deleted-{id}@deleted.invalid", "Abuse in chat"), (shell.FullName, shell.Email, shell.BlockReason));
            Assert.NotNull(shell.BlockedAt);
            Assert.True(await db.IpBlocks.AnyAsync(b => b.BlockedAccountUserId == id && b.IpAddress == hash));
            Assert.True(await db.AccountIps.AnyAsync(a => a.UserId == id && a.IpHash == hash));
        });

        // An account that isn't blocked loses its networks as before.
        var (client, other) = await _f.SignupAsync();
        await _f.InDbAsync(async db =>
        {
            db.AccountIps.Add(new AccountIp { UserId = other.User.Id, IpHash = $"h1:{Guid.NewGuid():N}"[..30] });
            await db.SaveChangesAsync();
        });
        Assert.Equal(HttpStatusCode.NoContent, (await Delete(client, Password)).StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.AccountIps.AnyAsync(a => a.UserId == other.User.Id)));
    }

    [Fact]
    public async Task Deleting_RemovesVolunteerDutiesAndUnaddressesPrivateReplies()
    {
        var (client, auth) = await _f.SignupAsync();
        var id = auth.User.Id;
        var (_, bystander) = await _f.SignupAsync();
        var arena = await _f.CreateArenaAsync(1);
        var (shiftId, othersClaimId, replyId, othersReplyId) = await _f.WithDbAsync(async db =>
        {
            var shift = new MountedGames.Api.Entities.Operations.VolunteerShift
            {
                CompetitionId = arena.CompetitionId, Role = "Steward", CheckedInByUserId = id, CheckedInByName = "Real Name", CheckedInAt = DateTime.UtcNow,
            };
            db.VolunteerShifts.Add(shift);
            await db.SaveChangesAsync();
            db.VolunteerClaims.Add(new MountedGames.Api.Entities.Operations.VolunteerClaim { ShiftId = shift.Id, UserId = id, VolunteerName = "Real Name", ContactPhone = "07700 900123" });
            var othersClaim = new MountedGames.Api.Entities.Operations.VolunteerClaim { ShiftId = shift.Id, UserId = bystander.User.Id, VolunteerName = "Bystander", ContactPhone = "07700 900456" };
            var reply = new ChatMessage { CompetitionId = arena.CompetitionId, UserId = bystander.User.Id, AuthorName = "Organiser", Body = "Private reply", AdminOnly = true, RecipientUserId = id };
            var othersReply = new ChatMessage { CompetitionId = arena.CompetitionId, UserId = id, AuthorName = "Organiser", Body = "Other reply", AdminOnly = true, RecipientUserId = bystander.User.Id };
            db.AddRange(othersClaim, reply, othersReply);
            await db.SaveChangesAsync();
            return (shift.Id, othersClaim.Id, reply.Id, othersReply.Id);
        });

        Assert.Equal(HttpStatusCode.NoContent, (await Delete(client, Password)).StatusCode);

        await _f.WithDbAsync(async db =>
        {
            Assert.False(await db.VolunteerClaims.AnyAsync(c => c.UserId == id));
            Assert.False(await db.VolunteerClaims.AnyAsync(c => c.VolunteerName == "Real Name" || c.ContactPhone == "07700 900123"));
            Assert.Equal("07700 900456", (await db.VolunteerClaims.SingleAsync(c => c.Id == othersClaimId)).ContactPhone);
            var shift = await db.VolunteerShifts.SingleAsync(v => v.Id == shiftId);
            Assert.Equal((null, AccountDeletionService.DeletedName), (shift.CheckedInByUserId, shift.CheckedInByName));
            Assert.NotNull(shift.CheckedInAt);

            // The organiser's reply stays staff-only, addressed to nobody; what the deleted person wrote is gone.
            var reply = await db.ChatMessages.SingleAsync(m => m.Id == replyId);
            Assert.Equal((null, true, "Private reply"), (reply.RecipientUserId, reply.AdminOnly, reply.Body));
            Assert.False(await db.ChatMessages.AnyAsync(m => m.Id == othersReplyId));
        });
    }

    [Fact]
    public async Task Deleting_ErasesTheAccountsEmailOptIns_AndNobodyElses()
    {
        var (client, auth) = await _f.SignupAsync();
        var other = $"someone-else-{Guid.NewGuid():N}@example.test";
        await _f.WithDbAsync(async db =>
        {
            // Stored the way the opt-in form stores them: trimmed and lower-case.
            db.EmailOptIns.AddRange(
                new EmailOptIn { Email = auth.User.Email!.ToLowerInvariant(), WordingVersion = "v1", Source = "signup-form", UnsubscribeTokenHash = Guid.NewGuid().ToString("N") },
                new EmailOptIn { Email = other, WordingVersion = "v1", Source = "signup-form", UnsubscribeTokenHash = Guid.NewGuid().ToString("N") });
            await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.NoContent, (await Delete(client, Password)).StatusCode);

        await _f.WithDbAsync(async db =>
        {
            Assert.False(await db.EmailOptIns.AnyAsync(o => o.Email == auth.User.Email!.ToLowerInvariant()));
            Assert.True(await db.EmailOptIns.AnyAsync(o => o.Email == other));
        });
    }
}
