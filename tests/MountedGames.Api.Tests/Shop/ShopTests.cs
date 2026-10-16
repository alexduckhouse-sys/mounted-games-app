using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Shop;

public class ShopTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ShopTests(ApiFactory f) => _f = f;

    private static CreateShopPostRequest Post(string title = "Saddle", string body = "Barely used", int? price = 5000,
        string name = "Seller", string? image = null)
        => new(title, body, price, "07000 000000", name, "Test PC", image);

    private static async Task<ShopPostDto> CreateAsync(HttpClient c, CreateShopPostRequest req)
    {
        var r = await c.PostAsJsonAsync("/api/shop/posts", req);
        r.EnsureSuccessStatusCode();
        return await r.ReadAsync<ShopPostDto>();
    }

    [Fact]
    public async Task Create_Returns401_WhenAnonymous()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/shop/posts", Post());

        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Create_StoresTrimmedPostAgainstUser()
    {
        var (me, auth) = await _f.SignupAsync();

        var post = await CreateAsync(me, Post("  Title  ", "  Body  ", name: "  Me  "));

        Assert.Equal(("Title", "Body", "Me", auth.User.Id), (post.Title, post.Body, post.AuthorName, post.AuthorUserId));
    }

    [Fact]
    public async Task Create_TruncatesOverlongFields()
    {
        var (me, _) = await _f.SignupAsync();

        var post = await CreateAsync(me, Post(new string('t', 250), new string('b', 5000), name: new string('n', 200)));

        Assert.Equal((200, 4000, 150), (post.Title.Length, post.Body.Length, post.AuthorName.Length));
    }

    [Theory]
    [InlineData("", "body", "name")]
    [InlineData("title", " ", "name")]
    [InlineData("title", "body", "")]
    public async Task Create_Returns400_WhenRequiredFieldBlank(string title, string body, string name)
    {
        var (me, _) = await _f.SignupAsync();

        var r = await me.PostAsJsonAsync("/api/shop/posts", Post(title, body, name: name));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_Returns400_WhenImageTooLarge()
    {
        var (me, _) = await _f.SignupAsync();

        var r = await me.PostAsJsonAsync("/api/shop/posts", Post(image: new string('a', 700_001)));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Create_KeepsImage_WhenWithinLimit()
    {
        var (me, _) = await _f.SignupAsync();

        var post = await CreateAsync(me, Post(image: "data:image/png;base64,AAAA"));

        Assert.Equal("data:image/png;base64,AAAA", post.ImageBase64);
    }

    [Fact]
    public async Task Create_DropsNegativePrice()
    {
        var (me, _) = await _f.SignupAsync();

        var post = await CreateAsync(me, Post(price: -5));

        Assert.Null(post.PriceMinor);
    }

    [Fact]
    public async Task Create_Returns403_WhenIpBlocked()
    {
        var (me, _) = await _f.SignupAsync();
        await _f.InDbAsync(async db =>
        {
            db.IpBlocks.Add(new IpBlock { IpAddress = "10.8.8.8" });
            await db.SaveChangesAsync();
        });
        me.DefaultRequestHeaders.Add(TestIpStartupFilter.Header, "10.8.8.8");

        var r = await me.PostAsJsonAsync("/api/shop/posts", Post());

        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task List_ReturnsNewestFirst_AndRespectsTake()
    {
        var f = new ApiFactory();
        using var _ = f;
        var (me, _a) = await f.SignupAsync();
        await CreateAsync(me, Post("first"));
        await CreateAsync(me, Post("second"));
        await CreateAsync(me, Post("third"));

        var rows = await (await f.CreateClient().GetAsync("/api/shop/posts?take=2")).ReadAsync<List<ShopPostDto>>();

        Assert.Equal(new[] { "third", "second" }, rows.Select(r => r.Title));
    }

    [Fact]
    public async Task List_ClampsTakeToAtLeastOne()
    {
        var (me, _) = await _f.SignupAsync();
        await CreateAsync(me, Post());

        var rows = await (await _f.CreateClient().GetAsync("/api/shop/posts?take=-4")).ReadAsync<List<ShopPostDto>>();

        Assert.Single(rows);
    }

    [Fact]
    public async Task List_HidesDeletedPosts_FromEveryoneButAdminWhoAsks()
    {
        var (me, _) = await _f.SignupAsync();
        var post = await CreateAsync(me, Post($"gone-{Guid.NewGuid():N}"));
        await me.DeleteAsync($"/api/shop/posts/{post.Id}");
        var admin = await _f.AdminAsync();

        var anon = await (await _f.CreateClient().GetAsync("/api/shop/posts?take=200&includeDeleted=true")).ReadAsync<List<ShopPostDto>>();
        var adminDefault = await (await admin.GetAsync("/api/shop/posts?take=200")).ReadAsync<List<ShopPostDto>>();
        var adminAll = await (await admin.GetAsync("/api/shop/posts?take=200&includeDeleted=true")).ReadAsync<List<ShopPostDto>>();

        Assert.Equal(
            (false, false, true),
            (anon.Any(p => p.Id == post.Id), adminDefault.Any(p => p.Id == post.Id), adminAll.Any(p => p.Id == post.Id)));
    }

    [Fact]
    public async Task Get_ReturnsPost_WithCounts()
    {
        var (me, _) = await _f.SignupAsync();
        var post = await CreateAsync(me, Post());
        await me.PostAsJsonAsync($"/api/shop/posts/{post.Id}/comments", new CreateShopCommentRequest("hi", "Bob", false, null));
        await _f.CreateClient().PostAsJsonAsync($"/api/shop/posts/{post.Id}/report", new CreateShopReportRequest("spam"));

        var got = await (await _f.CreateClient().GetAsync($"/api/shop/posts/{post.Id}")).ReadAsync<ShopPostDto>();

        Assert.Equal((1, 1), (got.CommentCount, got.ReportCount));
    }

    [Fact]
    public async Task Get_Returns404_WhenMissing()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await _f.CreateClient().GetAsync("/api/shop/posts/999999")).StatusCode);
    }

    [Fact]
    public async Task Get_Returns404_ForDeletedPost_UnlessAdmin()
    {
        var (me, _) = await _f.SignupAsync();
        var post = await CreateAsync(me, Post());
        await me.DeleteAsync($"/api/shop/posts/{post.Id}");
        var admin = await _f.AdminAsync();

        Assert.Equal(
            (HttpStatusCode.NotFound, HttpStatusCode.OK),
            ((await _f.CreateClient().GetAsync($"/api/shop/posts/{post.Id}")).StatusCode,
             (await admin.GetAsync($"/api/shop/posts/{post.Id}")).StatusCode));
    }

    [Fact]
    public async Task Delete_SoftDeletesOwnPost()
    {
        var (me, auth) = await _f.SignupAsync();
        var post = await CreateAsync(me, Post());

        var r = await me.DeleteAsync($"/api/shop/posts/{post.Id}");

        var row = await _f.InDbAsync(db => db.ShopPosts.SingleAsync(p => p.Id == post.Id));
        Assert.Equal((HttpStatusCode.NoContent, true, auth.User.Id), (r.StatusCode, row.IsDeleted, row.DeletedByUserId));
    }

    [Fact]
    public async Task Delete_AllowsAdminToRemoveAnyPost()
    {
        var (me, _) = await _f.SignupAsync();
        var post = await CreateAsync(me, Post());
        var admin = await _f.AdminAsync();

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/shop/posts/{post.Id}")).StatusCode);
    }

    [Fact]
    public async Task Delete_Returns403_ForSomeoneElsesPost()
    {
        var (owner, _) = await _f.SignupAsync();
        var (other, _) = await _f.SignupAsync();
        var post = await CreateAsync(owner, Post());

        Assert.Equal(HttpStatusCode.Forbidden, (await other.DeleteAsync($"/api/shop/posts/{post.Id}")).StatusCode);
    }

    [Fact]
    public async Task Delete_Returns404_WhenMissing()
    {
        var (me, _) = await _f.SignupAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await me.DeleteAsync("/api/shop/posts/999999")).StatusCode);
    }

    // ---- comments ----

    private static CreateShopCommentRequest Comment(string body = "Is this available?", string name = "Bob",
        bool priv = false, string? to = null) => new(body, name, priv, to);

    [Fact]
    public async Task Comment_Returns404_WhenPostMissingOrDeleted()
    {
        var (me, _) = await _f.SignupAsync();
        var post = await CreateAsync(me, Post());
        await me.DeleteAsync($"/api/shop/posts/{post.Id}");

        Assert.Equal(
            (HttpStatusCode.NotFound, HttpStatusCode.NotFound),
            ((await me.PostAsJsonAsync("/api/shop/posts/999999/comments", Comment())).StatusCode,
             (await me.PostAsJsonAsync($"/api/shop/posts/{post.Id}/comments", Comment())).StatusCode));
    }

    [Theory]
    [InlineData("", "Bob")]
    [InlineData("hello", "  ")]
    public async Task Comment_Returns400_WhenBodyOrNameBlank(string body, string name)
    {
        var (me, _) = await _f.SignupAsync();
        var post = await CreateAsync(me, Post());

        var r = await me.PostAsJsonAsync($"/api/shop/posts/{post.Id}/comments", Comment(body, name));

        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Comment_Returns401_WhenAnonymous()
    {
        var (me, _) = await _f.SignupAsync();
        var post = await CreateAsync(me, Post());

        var r = await _f.CreateClient().PostAsJsonAsync($"/api/shop/posts/{post.Id}/comments", Comment());

        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [Fact]
    public async Task Comment_PrivateWithoutRecipient_GoesToPostAuthor()
    {
        var (owner, ownerAuth) = await _f.SignupAsync();
        var (buyer, _) = await _f.SignupAsync();
        var post = await CreateAsync(owner, Post());

        var c = await (await buyer.PostAsJsonAsync($"/api/shop/posts/{post.Id}/comments", Comment(priv: true)))
            .ReadAsync<ShopCommentDto>();

        Assert.Equal(ownerAuth.User.Id, c.ToUserId);
    }

    [Fact]
    public async Task Comment_Public_HasNoRecipient_AndTruncatesBody()
    {
        var (me, _) = await _f.SignupAsync();
        var post = await CreateAsync(me, Post());

        var c = await (await me.PostAsJsonAsync($"/api/shop/posts/{post.Id}/comments",
            Comment(new string('c', 2500), to: "ignored"))).ReadAsync<ShopCommentDto>();

        Assert.Equal((2000, (string?)null), (c.Body.Length, c.ToUserId));
    }

    [Fact]
    public async Task Comments_Returns_Empty_WhenPostMissing()
    {
        var rows = await (await _f.CreateClient().GetAsync("/api/shop/posts/999999/comments")).ReadAsync<List<ShopCommentDto>>();

        Assert.Empty(rows);
    }

    [Fact]
    public async Task Comments_PrivateOnesVisibleOnlyToParties()
    {
        var (owner, _) = await _f.SignupAsync();
        var (buyer, _) = await _f.SignupAsync();
        var (stranger, _) = await _f.SignupAsync();
        var admin = await _f.AdminAsync();
        var post = await CreateAsync(owner, Post());
        await buyer.PostAsJsonAsync($"/api/shop/posts/{post.Id}/comments", Comment("public"));
        await buyer.PostAsJsonAsync($"/api/shop/posts/{post.Id}/comments", Comment("secret", priv: true));

        async Task<int> CountFor(HttpClient c)
            => (await (await c.GetAsync($"/api/shop/posts/{post.Id}/comments")).ReadAsync<List<ShopCommentDto>>()).Count;

        Assert.Equal(
            new[] { 2, 2, 2, 1, 1 },
            new[] { await CountFor(owner), await CountFor(buyer), await CountFor(admin), await CountFor(stranger), await CountFor(_f.CreateClient()) });
    }

    [Fact]
    public async Task Comments_PrivateVisibleToNamedRecipient()
    {
        var (owner, _) = await _f.SignupAsync();
        var (buyer, _) = await _f.SignupAsync();
        var (friend, friendAuth) = await _f.SignupAsync();
        var post = await CreateAsync(owner, Post());
        await buyer.PostAsJsonAsync($"/api/shop/posts/{post.Id}/comments", Comment("for friend", priv: true, to: friendAuth.User.Id));

        var rows = await (await friend.GetAsync($"/api/shop/posts/{post.Id}/comments")).ReadAsync<List<ShopCommentDto>>();

        Assert.Single(rows);
    }

    [Fact]
    public async Task DeleteComment_HidesItFromList_ForAuthor()
    {
        var (me, _) = await _f.SignupAsync();
        var post = await CreateAsync(me, Post());
        var c = await (await me.PostAsJsonAsync($"/api/shop/posts/{post.Id}/comments", Comment())).ReadAsync<ShopCommentDto>();

        var r = await me.DeleteAsync($"/api/shop/comments/{c.Id}");

        var rows = await (await me.GetAsync($"/api/shop/posts/{post.Id}/comments")).ReadAsync<List<ShopCommentDto>>();
        Assert.Equal((HttpStatusCode.NoContent, 0), (r.StatusCode, rows.Count));
    }

    [Fact]
    public async Task DeleteComment_AllowsAdmin()
    {
        var (me, _) = await _f.SignupAsync();
        var post = await CreateAsync(me, Post());
        var c = await (await me.PostAsJsonAsync($"/api/shop/posts/{post.Id}/comments", Comment())).ReadAsync<ShopCommentDto>();
        var admin = await _f.AdminAsync();

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/shop/comments/{c.Id}")).StatusCode);
    }

    [Fact]
    public async Task DeleteComment_Returns403_ForOtherUser()
    {
        var (me, _) = await _f.SignupAsync();
        var (other, _) = await _f.SignupAsync();
        var post = await CreateAsync(me, Post());
        var c = await (await me.PostAsJsonAsync($"/api/shop/posts/{post.Id}/comments", Comment())).ReadAsync<ShopCommentDto>();

        Assert.Equal(HttpStatusCode.Forbidden, (await other.DeleteAsync($"/api/shop/comments/{c.Id}")).StatusCode);
    }

    [Fact]
    public async Task DeleteComment_Returns404_WhenMissing()
    {
        var (me, _) = await _f.SignupAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await me.DeleteAsync("/api/shop/comments/999999")).StatusCode);
    }

    // ---- reports ----

    [Fact]
    public async Task Report_StoresTrimmedReason_ForAnonymous()
    {
        var (me, _) = await _f.SignupAsync();
        var post = await CreateAsync(me, Post());

        var r = await _f.CreateClient().PostAsJsonAsync($"/api/shop/posts/{post.Id}/report", new CreateShopReportRequest("  spam  "));

        var reason = await _f.InDbAsync(db => db.ShopReports.Where(x => x.PostId == post.Id).Select(x => x.Reason).SingleAsync());
        Assert.Equal((HttpStatusCode.NoContent, "spam"), (r.StatusCode, reason));
    }

    [Fact]
    public async Task Report_RecordsReporter_WhenSignedIn()
    {
        var (me, auth) = await _f.SignupAsync();
        var post = await CreateAsync(me, Post());

        await me.PostAsJsonAsync($"/api/shop/posts/{post.Id}/report", new CreateShopReportRequest(null));

        var reporter = await _f.InDbAsync(db => db.ShopReports.Where(x => x.PostId == post.Id).Select(x => x.ReporterUserId).SingleAsync());
        Assert.Equal(auth.User.Id, reporter);
    }

    [Fact]
    public async Task Report_Returns404_WhenPostMissing()
    {
        var r = await _f.CreateClient().PostAsJsonAsync("/api/shop/posts/999999/report", new CreateShopReportRequest("x"));

        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }
}
