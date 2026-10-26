using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Dtos;
using MountedGames.Api.Services;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Chat;

public class ProfanityFilterTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _f;
    public ProfanityFilterTests(ApiFactory f) => _f = f;

    [Theory]
    [InlineData("bloody", "b*****")]
    [InlineData("Bloody hell", "B***** hell")]
    [InlineData("BLOODY", "B*****")]
    [InlineData("that is fucking rubbish", "that is f****** rubbish")]
    [InlineData("What a Wanker, you twat!", "What a W*****, you t***!")]
    [InlineData("shit.", "s***.")]
    [InlineData("Arsehole", "A*******")]
    [InlineData("crap and piss", "c*** and p***")]
    [InlineData("Shit shit SHIT", "S*** s*** S***")]
    public void Clean_KeepsFirstLetterAndMasksTheRest(string input, string expected)
        => Assert.Equal(expected, ProfanityFilter.Clean(input));

    [Theory]
    [InlineData("class")]
    [InlineData("Scunthorpe")]
    [InlineData("assess the arsenal")]
    [InlineData("Dickens and Pickwick")]
    [InlineData("Lunch at 12, then the finals")]
    [InlineData("")]
    public void Clean_LeavesOtherWordsAlone(string input)
        => Assert.Equal(input, ProfanityFilter.Clean(input));

    [Fact]
    public async Task Post_FiltersTheBody_BeforeItIsSavedAndReturned()
    {
        var a = await _f.CreateArenaAsync(1);
        var trainer = await _f.TrainerAsync();

        var dto = await (await trainer.PostAsJsonAsync($"/api/competitions/{a.CompetitionId}/chat",
            new PostChatMessageRequest("This is bloody late"))).ReadAsync<ChatMessageDto>();

        Assert.Equal("This is b***** late", dto.Body);
        var stored = await _f.WithDbAsync(db => db.ChatMessages.SingleAsync(m => m.Id == dto.Id));
        Assert.Equal("This is b***** late", stored.Body);
    }

    [Fact]
    public async Task Announce_FiltersTheBody_BeforeItIsSavedAndReturned()
    {
        var a = await _f.CreateArenaAsync(1);
        var admin = await _f.AdminAsync();

        var r = await admin.PostAsJsonAsync($"/api/competitions/{a.CompetitionId}/chat/announcement",
            new AnnouncementRequest("Move the crap off the course", "general"));

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var dto = await r.ReadAsync<ChatMessageDto>();
        Assert.Equal("Move the c*** off the course", dto.Body);
        Assert.Equal("Move the c*** off the course",
            (await _f.WithDbAsync(db => db.ChatMessages.SingleAsync(m => m.Id == dto.Id))).Body);
    }
}
