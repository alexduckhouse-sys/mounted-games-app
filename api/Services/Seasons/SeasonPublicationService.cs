using System.Security.Cryptography;
using System.Globalization;
using System.Text;
using System.Data;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;

namespace MountedGames.Api.Services.Seasons;

public sealed class SeasonPublicationService(AppDbContext db)
{
    public const string RankingBasis = "Section total points across all completed races";

    public async Task<SeasonPublicationPreviewDto> PreviewAsync(Guid seasonId, Guid roundId, CancellationToken ct)
        => (await BuildPreviewAsync(seasonId, roundId, ct)).Preview;

    private async Task<PublicationPlan> BuildPreviewAsync(Guid seasonId, Guid roundId, CancellationToken ct)
    {
        var round = await db.Set<SeasonRound>().AsNoTracking()
            .Include(x => x.Season).ThenInclude(x => x!.PlacePoints)
            .Include(x => x.CompetitionSection)
            .Include(x => x.Publications)
            .SingleOrDefaultAsync(x => x.Id == roundId && x.SeasonId == seasonId, ct)
            ?? throw new SeasonPublicationException("Season round not found.", 404);

        var sessions = await db.Sessions.AsNoTracking()
            .Where(x => x.CompetitionId == round.CompetitionId
                && x.CompetitionSectionId == round.CompetitionSectionId
                && x.Kind == SessionKind.Race && !x.IsBreak)
            .Include(x => x.Heats).ThenInclude(x => x.Entries)
            .Include(x => x.Heats).ThenInclude(x => x.Races).ThenInclude(x => x.Results).ThenInclude(x => x.Team)!.ThenInclude(x => x!.Club)
            .OrderBy(x => x.OrderIndex)
            .ToListAsync(ct);

        var races = sessions.SelectMany(x => x.Heats).SelectMany(x => x.Races).OrderBy(x => x.Id).ToList();
        if (races.Count == 0)
            throw new SeasonPublicationException("The section has no races to publish.", 409);
        if (races.Any(x => !x.IsComplete))
            throw new SeasonPublicationException("Every race in the section must be complete before publication.", 409);
        if (races.Any(r => r.Heat is not null
                && r.Heat.Entries.Select(e => e.TeamId).Order().SequenceEqual(r.Results.Select(x => x.TeamId).Order()) == false))
            throw new SeasonPublicationException("Every team in every completed race must have a recorded result.", 409);

        var tiers = FinalsTiers.From(sessions);
        var totals = races.SelectMany(x => x.Results)
            .Where(x => x.Team is { IsHorsConcours: false })
            .GroupBy(x => x.TeamId)
            .Select(x => new
            {
                TeamId = x.Key,
                Team = x.First().Team!,
                Points = x.Sum(y => y.Points),
                Tier = tiers.SortKey(x.Key),
            })
            .OrderBy(x => x.Tier)
            .ThenByDescending(x => x.Points)
            .ThenBy(x => x.Team.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(x => x.TeamId)
            .ToList();

        var teamIds = totals.Select(x => x.TeamId).ToArray();
        var links = await db.Set<EventTeamProfileLink>()
            .Where(x => x.CompetitionId == round.CompetitionId && teamIds.Contains(x.TeamId))
            .ToDictionaryAsync(x => x.TeamId, ct);

        var isPairs = (round.CompetitionSection?.Format ?? round.Season?.Format) == SectionFormat.Pairs;
        var profilesByTeam = new Dictionary<int, List<RiderProfile>>();
        if (isPairs)
        {
            // Read only the identity and public-name inputs, never dates of birth, contacts or private notes.
            var forms = await db.DeclarationForms.AsNoTracking()
                .Where(x => teamIds.Contains(x.TeamId) && x.IsLocked)
                .OrderByDescending(x => x.SubmittedAt).ThenByDescending(x => x.Id)
                .Select(form => new
                {
                    form.TeamId,
                    Riders = form.Riders.Where(r => !r.IsReserve && r.FullName.Trim() != "")
                        .OrderBy(r => r.OrderIndex).ThenBy(r => r.Id)
                        .Select(r => new RiderIdentity(r.Id, r.SavedRiderId, r.FullName,
                            r.UseInitialOnly || (r.SavedRider != null && r.SavedRider.UseInitialOnly),
                            r.SavedRider != null ? r.SavedRider.ClubId : (int?)null)).ToList(),
                })
                .ToListAsync(ct);
            var ridersByTeam = forms.GroupBy(x => x.TeamId).ToDictionary(x => x.Key, x => x.First().Riders);
            if (totals.Any(x => !ridersByTeam.TryGetValue(x.TeamId, out var riders) || riders.Count == 0))
                throw new SeasonPublicationException("Every pairs team needs a locked declaration with its active riders before publication.", 409);

            var ownerId = round.Season!.OwnerUserId;
            var identities = ridersByTeam.Values.SelectMany(x => x)
                .GroupBy(r => SeasonRiderPrivacy.ProfileId(ownerId, r.EntryId, r.SavedRiderId))
                .ToDictionary(g => g.Key, g => new
                {
                    Rider = g.First(),
                    Name = RiderNames.Display(g.First().FullName, g.Any(r => r.UseInitialOnly), viewerSeesFullNames: false),
                });
            var protectedProfiles = await SeasonRiderPrivacy.InitialOnlyProfilesAsync(db, identities.Keys, ct);
            foreach (var total in totals)
            {
                profilesByTeam[total.TeamId] = ridersByTeam[total.TeamId]
                    .Select(r => SeasonRiderPrivacy.ProfileId(ownerId, r.EntryId, r.SavedRiderId)).Distinct()
                    .Select(id => new RiderProfile(id, ownerId, identities[id].Rider.SavedClubId ?? total.Team.ClubId, SeasonRiderPrivacy.Display(id, identities[id].Name, protectedProfiles)))
                    .ToList();
            }
        }
        else
        {
            var missing = totals.Where(x => !links.ContainsKey(x.TeamId)).Select(x => x.Team.DisplayName).ToArray();
            if (missing.Length > 0)
                throw new SeasonPublicationException($"Every placed team needs an explicit team profile link. Missing: {string.Join(", ", missing)}.", 409);
        }

        var points = round.Season!.PlacePoints.ToDictionary(x => x.Place, x => x.Points);
        var multiplier = round.PointsMultiplier > 0 ? round.PointsMultiplier : 1.0;
        var rows = new List<SeasonPublicationPreviewRow>();
        var seenProfileIds = new HashSet<Guid>();
        (int Tier, double Points)? previous = null;
        var rank = 0;
        for (var index = 0; index < totals.Count; index++)
        {
            var total = totals[index];
            // Teams only tie on the same points within the same final.
            if (previous != (total.Tier, total.Points)) rank = index + 1;
            previous = (total.Tier, total.Points);
            var basePoints = points.GetValueOrDefault(rank);
            var seasonPoints = (int)Math.Round(basePoints * multiplier, MidpointRounding.AwayFromZero);
            if (profilesByTeam.TryGetValue(total.TeamId, out var riderProfiles))
            {
                foreach (var riderProfile in riderProfiles)
                {
                    if (!seenProfileIds.Add(riderProfile.Id)) continue;
                    rows.Add(new SeasonPublicationPreviewRow(
                        riderProfile.Id,
                        total.TeamId,
                        riderProfile.DisplayName,
                        total.Team.Club?.Name ?? string.Empty,
                        rank,
                        total.Points,
                        seasonPoints));
                }
            }
            else
            {
                var profileId = links[total.TeamId].TeamProfileId;
                if (!seenProfileIds.Add(profileId)) continue;
                rows.Add(new SeasonPublicationPreviewRow(
                    profileId,
                    total.TeamId,
                    total.Team.DisplayName,
                    total.Team.Club?.Name ?? string.Empty,
                    rank,
                    total.Points,
                    seasonPoints));
            }
        }

        var fingerprint = Fingerprint(round.Season, races, links, multiplier, profilesByTeam);
        var nextVersion = round.Publications.Select(x => x.Version).DefaultIfEmpty(0).Max() + 1;
        var preview = new SeasonPublicationPreviewDto(
            seasonId, roundId, round.CompetitionId, round.CompetitionSectionId,
            fingerprint, nextVersion, RankingBasis, rows);
        return new PublicationPlan(preview, profilesByTeam.Values.SelectMany(x => x).DistinctBy(x => x.Id).ToArray());
    }

    public async Task<SeasonRoundPublicationDto> PublishAsync(
        Guid seasonId, Guid roundId, string expectedFingerprint, int expectedVersion, string userId, CancellationToken ct)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                db.ChangeTracker.Clear();
                await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
                var plan = await BuildPreviewAsync(seasonId, roundId, ct);
                var preview = plan.Preview;
                if (expectedVersion != preview.NextVersion)
                    throw new SeasonPublicationException("Another publication was saved after preview. Preview again before publishing.", 409);
                if (string.IsNullOrWhiteSpace(expectedFingerprint)
                    || expectedFingerprint.Trim().Length != preview.SourceFingerprint.Length
                    || !CryptographicOperations.FixedTimeEquals(
                        Encoding.ASCII.GetBytes(preview.SourceFingerprint),
                        Encoding.ASCII.GetBytes(expectedFingerprint.Trim().ToUpperInvariant())))
                    throw new SeasonPublicationException("The event results or season rules changed after preview. Preview again before publishing.", 409);

                await PersistRiderProfilesAsync(plan.RiderProfiles, ct);

                var publication = new SeasonRoundPublication
                {
                    SeasonRoundId = roundId,
                    Version = preview.NextVersion,
                    SourceFingerprint = preview.SourceFingerprint,
                    PublishedByUserId = userId,
                    Results = preview.Results.Select(x => new SeasonRoundResult
                    {
                        TeamProfileId = x.TeamProfileId,
                        EventTeamId = x.EventTeamId,
                        TeamName = x.TeamName,
                        ClubName = x.ClubName,
                        EventRank = x.EventRank,
                        EventPoints = x.EventPoints,
                        SeasonPoints = x.SeasonPoints,
                    }).ToList(),
                };
                db.Set<SeasonRoundPublication>().Add(publication);
                await db.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return ToDto(publication);
            });
        }
        catch (DbUpdateException)
        {
            throw new SeasonPublicationException("Another publication was saved at the same time. Preview again before publishing.", 409);
        }
    }

    // Saved roster identity follows a rider between pairs. An unsaved entry has only event-specific identity:
    // names (including shortened names) never join unrelated people or somebody else's profiles.
    private async Task PersistRiderProfilesAsync(IReadOnlyList<RiderProfile> candidates, CancellationToken ct)
    {
        if (candidates.Count == 0) return;
        var ids = candidates.Select(x => x.Id).ToArray();
        var existing = await db.Set<TeamProfile>().Where(x => ids.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
        foreach (var candidate in candidates)
        {
            if (!existing.TryGetValue(candidate.Id, out var profile))
            {
                db.Set<TeamProfile>().Add(new TeamProfile
                {
                    Id = candidate.Id, OwnerUserId = candidate.OwnerUserId, ClubId = candidate.ClubId,
                    DisplayName = candidate.DisplayName, Suffix = string.Empty,
                });
            }
            else
            {
                if (profile.OwnerUserId != candidate.OwnerUserId)
                    throw new SeasonPublicationException("The rider profile belongs to another organiser. Preview again before publishing.", 409);
                if (profile.DisplayName != candidate.DisplayName)
                {
                    profile.DisplayName = candidate.DisplayName;
                    profile.UpdatedAt = DateTime.UtcNow;
                }
            }
        }
    }

    private sealed record RiderIdentity(int EntryId, int? SavedRiderId, string FullName, bool UseInitialOnly, int? SavedClubId);
    private sealed record RiderProfile(Guid Id, string OwnerUserId, int ClubId, string DisplayName);
    private sealed record PublicationPlan(SeasonPublicationPreviewDto Preview, IReadOnlyList<RiderProfile> RiderProfiles);

    public static SeasonRoundPublicationDto ToDto(SeasonRoundPublication publication)
        => new(
            publication.Id,
            publication.SeasonRoundId,
            publication.Version,
            publication.SourceFingerprint,
            publication.PublishedAt,
            RankingBasis,
            publication.Results.OrderBy(x => x.EventRank).ThenBy(x => x.TeamName)
                .Select(x => new SeasonPublicationPreviewRow(
                    x.TeamProfileId, x.EventTeamId, x.TeamName, x.ClubName,
                    x.EventRank, x.EventPoints, x.SeasonPoints)).ToArray());

    private static string Fingerprint(
        Season season,
        IReadOnlyList<Race> races,
        IReadOnlyDictionary<int, EventTeamProfileLink> links,
        double multiplier,
        IReadOnlyDictionary<int, List<RiderProfile>> profilesByTeam)
    {
        var value = new StringBuilder()
            .Append(season.Id).Append('|').Append(season.Format).Append('|').Append(season.AgeGroup).Append('|');
        if (multiplier != 1.0)
            value.Append("M:").Append(multiplier.ToString("R", CultureInfo.InvariantCulture)).Append('|');
        foreach (var rule in season.PlacePoints.OrderBy(x => x.Place))
            value.Append(rule.Place).Append(':').Append(rule.Points).Append('|');
        foreach (var race in races.OrderBy(x => x.Id))
        {
            value.Append('R').Append(race.Id).Append(':').Append(race.IsComplete).Append('|');
            foreach (var result in race.Results.OrderBy(x => x.TeamId))
            {
                var identity = profilesByTeam.TryGetValue(result.TeamId, out var riders) && riders.Count > 0
                    ? string.Join(",", riders.Select(p => $"{p.Id}:{p.DisplayName}"))
                    : links.GetValueOrDefault(result.TeamId)?.TeamProfileId.ToString();
                value.Append(result.TeamId).Append(':')
                    .Append(result.Placing).Append(':').Append(result.Eliminated).Append(':').Append(PointValues.Format(result.Points)).Append(':')
                    .Append(result.Team?.IsHorsConcours).Append(':')
                    .Append(result.Team?.DisplayName).Append(':')
                    .Append(result.Team?.Club?.Name).Append(':')
                    .Append(identity).Append('|');
            }
        }
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value.ToString())));
    }
}

public sealed class SeasonPublicationException(string message, int statusCode) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}
