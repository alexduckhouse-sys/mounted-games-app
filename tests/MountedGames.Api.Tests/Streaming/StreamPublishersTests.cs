using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Controllers;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Tests.Infrastructure;
using static MountedGames.Api.Tests.Infrastructure.StreamingApiFactory;

namespace MountedGames.Api.Tests.Streaming;

/// <summary>The go-live screen names who is already streaming; only staff can ask, and the public list never carries a name.</summary>
public class StreamPublishersTests(StreamingApiFactory f) : IClassFixture<StreamingApiFactory>
{
    private static string PublishersPath(int competition) => Path(competition, suffix: "/publishers");

    [Fact]
    public async Task NamesThePersonWhoStartedEachRunningStream_ForStaffOnly()
    {
        var (owner, auth) = await f.ApprovedTrainerAsync();
        var competition = await f.SeedCompetitionAsync(ownerUserId: auth.User.Id);
        await f.WithDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == auth.User.Id)).FullName = "  Jo Bloggs ";
            await db.SaveChangesAsync();
        });
        var attempt = await f.StartAsync(owner, competition);
        await f.ReadyAsync(owner, competition, attempt);

        var rows = await owner.GetFromJsonAsync<List<StreamPublisherDto>>(PublishersPath(competition));
        Assert.Equal(new StreamPublisherDto(attempt.StreamId, "Jo Bloggs"), Assert.Single(rows!));

        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync(PublishersPath(competition))).StatusCode);
        var (member, _) = await f.SignupAsync("Member");
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(PublishersPath(competition))).StatusCode);
        var other = await f.TrainerAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(PublishersPath(competition))).StatusCode);

        // The public list, which anyone can read, has no name in it.
        var publicBody = await f.CreateClient().GetStringAsync(Path(competition));
        Assert.DoesNotContain("Jo Bloggs", publicBody);
        Assert.DoesNotContain("startedBy", publicBody, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ALinksStreamIsNamedByItsLabel_AndAnEndedStreamIsLeftOut()
    {
        var competition = await f.SeedCompetitionAsync();
        var token = ScorerLinkTokens.Generate();
        var now = f.Clock.GetUtcNow().UtcDateTime;
        await f.WithDbAsync(async db =>
        {
            db.ScorerLinks.Add(new ScorerLink
            {
                CompetitionId = competition, Scope = 1, ArenaName = "All arenas", Label = "Fake camera",
                TokenHash = ScorerLinkTokens.Hash(token), CreatedAt = now, ExpiresAt = now.AddMinutes(60),
            });
            await db.SaveChangesAsync();
        });
        using var link = f.CreateClient();
        link.DefaultRequestHeaders.Add(ScorerLinkTokens.Header, token);
        var linkAttempt = await f.StartAsync(link, competition, angle: "Linked");
        await f.ReadyAsync(link, competition, linkAttempt);
        using var admin = await f.AdminAsync();
        var finished = await f.StartAsync(admin, competition, angle: "Finished");
        await f.ReadyAsync(admin, competition, finished);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync(Path(competition, finished.StreamId, "/end"), null)).StatusCode);

        var rows = await admin.GetFromJsonAsync<List<StreamPublisherDto>>(PublishersPath(competition));

        Assert.Equal(new StreamPublisherDto(linkAttempt.StreamId, "Fake camera"), Assert.Single(rows!));
    }

    [Fact]
    public async Task AStreamWhoseStarterHasNoNameComesBackWithNull()
    {
        var competition = await f.SeedCompetitionAsync();
        using var admin = await f.AdminAsync();
        var attempt = await f.StartAsync(admin, competition);
        await f.WithDbAsync(async db =>
        {
            var stream = await db.LiveStreams.SingleAsync(s => s.Id == attempt.StreamId);
            stream.StartedByUserId = "scorer-link:999999";
            await db.SaveChangesAsync();
        });

        var rows = await admin.GetFromJsonAsync<List<StreamPublisherDto>>(PublishersPath(competition));

        Assert.Equal(new StreamPublisherDto(attempt.StreamId, null), Assert.Single(rows!));
    }
}
