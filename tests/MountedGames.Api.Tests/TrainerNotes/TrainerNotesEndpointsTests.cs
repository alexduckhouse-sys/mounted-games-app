using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.TrainerNotes;

public class TrainerNotesEndpointsTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public TrainerNotesEndpointsTests(ApiFactory f) => _f = f;

    private const string Url = "/api/trainer/notes";

    [Fact]
    public async Task Create_StoresNoteForCaller()
    {
        var (client, auth) = await _f.SignupAsync();

        var r = await client.PostAsJsonAsync(Url, new SaveTrainerNoteRequest("Plan", "Practise bending"));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<TrainerNoteDto>();
        Assert.Equal(auth.User.Id, dto.UserId);
        Assert.Equal("Plan", dto.Title);
        Assert.Equal("Practise bending", dto.Body);
        Assert.Null(dto.UpdatedAt);
        Assert.True(await _f.WithDbAsync(db => db.TrainerNotes.AnyAsync(n => n.Id == dto.Id && n.UserId == auth.User.Id)));
    }

    [Fact]
    public async Task Create_AllowsNullTitle()
    {
        var (client, _) = await _f.SignupAsync();
        var dto = await (await client.PostAsJsonAsync(Url, new SaveTrainerNoteRequest(null, "body only"))).ReadAsync<TrainerNoteDto>();
        Assert.Null(dto.Title);
    }

    [Fact]
    public async Task List_ReturnsOnlyOwnNotes_MostRecentlyTouchedFirst()
    {
        var (client, auth) = await _f.SignupAsync();
        var (other, _) = await _f.SignupAsync();
        await other.PostAsJsonAsync(Url, new SaveTrainerNoteRequest("theirs", "x"));
        await _f.WithDbAsync(async db =>
        {
            var now = DateTime.UtcNow;
            db.TrainerNotes.Add(new TrainerNote { UserId = auth.User.Id, Title = "oldest", Body = "b", CreatedAt = now.AddDays(-3) });
            db.TrainerNotes.Add(new TrainerNote { UserId = auth.User.Id, Title = "edited recently", Body = "b", CreatedAt = now.AddDays(-5), UpdatedAt = now.AddDays(-1) });
            db.TrainerNotes.Add(new TrainerNote { UserId = auth.User.Id, Title = "middle", Body = "b", CreatedAt = now.AddDays(-2) });
            await db.SaveChangesAsync();
        });

        var list = await (await client.GetAsync(Url)).ReadAsync<List<TrainerNoteDto>>();

        Assert.Equal(new[] { "edited recently", "middle", "oldest" }, list.Select(n => n.Title));
    }

    [Fact]
    public async Task Update_ChangesNote_AndStampsUpdatedAt()
    {
        var (client, _) = await _f.SignupAsync();
        var created = await (await client.PostAsJsonAsync(Url, new SaveTrainerNoteRequest("a", "b"))).ReadAsync<TrainerNoteDto>();

        var r = await client.PutAsJsonAsync($"{Url}/{created.Id}", new SaveTrainerNoteRequest("a2", "b2"));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<TrainerNoteDto>();
        Assert.Equal("a2", dto.Title);
        Assert.Equal("b2", dto.Body);
        Assert.NotNull(dto.UpdatedAt);
    }

    [Fact]
    public async Task Update_Returns404_ForSomeoneElsesNote_AndLeavesItUnchanged()
    {
        var (owner, _) = await _f.SignupAsync();
        var (intruder, _) = await _f.SignupAsync();
        var note = await (await owner.PostAsJsonAsync(Url, new SaveTrainerNoteRequest("mine", "secret"))).ReadAsync<TrainerNoteDto>();

        var r = await intruder.PutAsJsonAsync($"{Url}/{note.Id}", new SaveTrainerNoteRequest("hacked", "x"));

        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.Equal("mine", (await _f.WithDbAsync(db => db.TrainerNotes.SingleAsync(n => n.Id == note.Id))).Title);
    }

    [Fact]
    public async Task Update_Returns404_WhenMissing()
    {
        var (client, _) = await _f.SignupAsync();
        var r = await client.PutAsJsonAsync($"{Url}/999999", new SaveTrainerNoteRequest("a", "b"));
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Delete_RemovesOwnNote()
    {
        var (client, _) = await _f.SignupAsync();
        var note = await (await client.PostAsJsonAsync(Url, new SaveTrainerNoteRequest("a", "b"))).ReadAsync<TrainerNoteDto>();

        var r = await client.DeleteAsync($"{Url}/{note.Id}");

        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.False(await _f.WithDbAsync(db => db.TrainerNotes.AnyAsync(n => n.Id == note.Id)));
    }

    [Fact]
    public async Task Delete_Returns404_ForSomeoneElsesNote()
    {
        var (owner, _) = await _f.SignupAsync();
        var (intruder, _) = await _f.SignupAsync();
        var note = await (await owner.PostAsJsonAsync(Url, new SaveTrainerNoteRequest("a", "b"))).ReadAsync<TrainerNoteDto>();

        var r = await intruder.DeleteAsync($"{Url}/{note.Id}");

        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.True(await _f.WithDbAsync(db => db.TrainerNotes.AnyAsync(n => n.Id == note.Id)));
    }

    [Fact]
    public async Task Delete_Returns404_WhenMissing()
    {
        var (client, _) = await _f.SignupAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync($"{Url}/999999")).StatusCode);
    }

    [Fact]
    public async Task Admin_HasTheirOwnNotes()
    {
        var admin = await _f.AdminAsync();
        var note = await (await admin.PostAsJsonAsync(Url, new SaveTrainerNoteRequest("admin note", "b"))).ReadAsync<TrainerNoteDto>();

        var list = await (await admin.GetAsync(Url)).ReadAsync<List<TrainerNoteDto>>();

        Assert.Contains(list, n => n.Id == note.Id);
    }

    [Theory]
    [InlineData("Manager")]
    [InlineData("Member")]
    public async Task Returns403_ForNonTrainerRoles(string role)
    {
        var (client, _) = await _f.SignupAsync(role);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(Url)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(Url, new SaveTrainerNoteRequest("a", "b"))).StatusCode);
    }

    [Fact]
    public async Task Returns401_WhenAnonymous()
    {
        var c = _f.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync(Url)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.PostAsJsonAsync(Url, new SaveTrainerNoteRequest("a", "b"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.PutAsJsonAsync($"{Url}/1", new SaveTrainerNoteRequest("a", "b"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.DeleteAsync($"{Url}/1")).StatusCode);
    }
}
