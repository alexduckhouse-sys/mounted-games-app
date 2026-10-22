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
            var post = new ShopPost { AuthorUserId = userId, AuthorName = "Real Name", Title = "Saddle", Body = "For sale", ContactInfo = "07700 900000", IpAddress = "203.0.113.50", DeletedByUserId = userId };
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
    public async Task Deleting_RemovesPrivateData_AnonymisesHistory_AndClearsOwnership()
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

            // Chat and marketplace content stays, anonymised, with no IP.
            var chat = await db.ChatMessages.SingleAsync(x => x.Id == s.ChatId);
            Assert.Equal((null, AccountDeletionService.DeletedName, null, "Hello"), (chat.UserId, chat.AuthorName, chat.IpAddress, chat.Body));
            var post = await db.ShopPosts.SingleAsync(x => x.Id == s.PostId);
            Assert.Equal((null, AccountDeletionService.DeletedName, null, null, null, "For sale"),
                (post.AuthorUserId, post.AuthorName, post.ContactInfo, post.IpAddress, post.DeletedByUserId, post.Body));
            var comment = await db.ShopComments.SingleAsync(x => x.Id == s.PublicCommentId);
            Assert.Equal((null, AccountDeletionService.DeletedName, null, "Interested"), (comment.AuthorUserId, comment.AuthorName, comment.IpAddress, comment.Body));
            var report = await db.ShopReports.SingleAsync(x => x.Id == s.ReportId);
            Assert.Equal((null, null, "Spam"), (report.ReporterUserId, report.IpAddress, report.Reason));
            // A private message sent to them stays for its author but is no longer addressed to anyone.
            Assert.Null((await db.ShopComments.SingleAsync(x => x.Id == s.DmToUserId)).ToUserId);

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
            Assert.Null((await db.ChatMessages.SingleAsync(m => m.CompetitionId == arena.CompetitionId && m.AuthorName == AccountDeletionService.DeletedName)).IpAddress);
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

        var again = await _f.CreateClient().PostAsJsonAsync("/api/auth/signup-trainer", new SignupTrainerRequest(auth.User.Email, Password));
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
    }
}
