using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Shop;

public class ShopImagesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task LeanResponsesKeepLegacyImages_ExcludePrivateCommentCounts_AndImagesRevalidateDeletionAndReplacement()
    {
        var admin = await factory.AdminAsync();
        var response = await admin.PostAsJsonAsync("/api/shop/posts", new CreateShopPostRequest("Synthetic item", "Synthetic description", 100, null, "Test seller", null, "data:image/png;base64,iVBORw0KGgo="));
        response.EnsureSuccessStatusCode();
        var post = await response.ReadAsync<ShopPostDto>();
        await factory.InDbAsync(async db =>
        {
            db.ShopComments.AddRange(new ShopComment { PostId = post.Id, Body = "Public" },
                new ShopComment { PostId = post.Id, Body = "Private", IsPrivate = true },
                new ShopComment { PostId = post.Id, Body = "Deleted", IsDeleted = true });
            await db.SaveChangesAsync();
        });
        var anon = factory.CreateClient();
        var legacy = await (await anon.GetAsync($"/api/shop/posts/{post.Id}")).ReadAsync<ShopPostDto>();
        var lean = await (await anon.GetAsync($"/api/shop/posts/{post.Id}?imageMode=urls")).ReadAsync<ShopPostDto>();
        Assert.Equal("data:image/png;base64,iVBORw0KGgo=", legacy.ImageBase64);
        Assert.Equal($"/api/shop/posts/{post.Id}/images/0", lean.ImageBase64);
        Assert.Equal(1, lean.CommentCount);
        var list = await (await anon.GetAsync("/api/shop/posts?imageMode=urls")).ReadAsync<List<ShopPostDto>>();
        Assert.Equal(lean.ImageBase64, list.Single(p => p.Id == post.Id).ImageBase64);
        var image = await anon.GetAsync(lean.ImageBase64);
        Assert.Equal("image/png", image.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Convert.FromBase64String("iVBORw0KGgo="), await image.Content.ReadAsByteArrayAsync());
        Assert.True(image.Headers.CacheControl?.Private);
        Assert.True(image.Headers.CacheControl?.NoCache);
        using var unchanged = new HttpRequestMessage(HttpMethod.Get, lean.ImageBase64);
        unchanged.Headers.IfNoneMatch.Add(image.Headers.ETag!);
        Assert.Equal(HttpStatusCode.NotModified, (await anon.SendAsync(unchanged)).StatusCode);
        (await admin.PutAsJsonAsync($"/api/shop/posts/{post.Id}", new UpdateShopPostRequest(ImageBase64: "data:image/webp;base64,UklGRgAAAABXRUJQ"))).EnsureSuccessStatusCode();
        var replaced = await anon.GetAsync(lean.ImageBase64);
        Assert.NotEqual(image.Headers.ETag, replaced.Headers.ETag);
        Assert.Equal(Convert.FromBase64String("UklGRgAAAABXRUJQ"), await replaced.Content.ReadAsByteArrayAsync());
        Assert.Equal("image/webp", replaced.Content.Headers.ContentType?.MediaType);
        (await admin.DeleteAsync($"/api/shop/posts/{post.Id}")).EnsureSuccessStatusCode();
        using var deleted = new HttpRequestMessage(HttpMethod.Get, lean.ImageBase64);
        deleted.Headers.IfNoneMatch.Add(replaced.Headers.ETag!);
        Assert.Equal(HttpStatusCode.NotFound, (await anon.SendAsync(deleted)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync(lean.ImageBase64)).StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("data:image/png;base64,AQID")]
    [InlineData("https://example.invalid/tracker")]
    [InlineData("data:image/svg+xml;base64,AQID")]
    [InlineData("data:image/png;base64,===")]
    public async Task MissingOrMalformedLegacyImagesAreNotServed(string? data)
    {
        var id = await factory.InDbAsync(async db =>
        {
            var p = new ShopPost { Title = "Synthetic legacy", ImageBase64 = data };
            db.Add(p); await db.SaveChangesAsync(); return p.Id;
        });
        Assert.Equal(HttpStatusCode.NotFound, (await factory.CreateClient().GetAsync($"/api/shop/posts/{id}/images/0")).StatusCode);
    }
}
