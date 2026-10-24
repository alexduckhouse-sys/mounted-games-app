using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;

namespace MountedGames.Api.Services.Seasons;

/// <summary>Stable, organiser-scoped rider identity and read-only privacy for published pairs results.</summary>
public static class SeasonRiderPrivacy
{
    // Reserved application namespace: 32 marker bits plus 96 bits of the owner-scoped identity hash.
    // These profiles are new in this feature. The marker keeps privacy enforceable after source deletion.
    private static readonly byte[] RiderNamespace = [0x4D, 0x47, 0x53, 0x52];

    private static bool IsRiderProfile(Guid id) => id.ToByteArray().AsSpan(0, 4).SequenceEqual(RiderNamespace);
    public static Guid ProfileId(string ownerId, int entryId, int? savedRiderId)
    {
        var identity = savedRiderId is { } savedId ? $"saved:{savedId}" : $"entry:{entryId}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"season-rider:v1:{ownerId}:{identity}"));
        RiderNamespace.CopyTo(hash, 0);
        return new Guid(hash.AsSpan(0, 16));
    }

    /// <summary>Resolve identities from publication memberships, never names or another owner's profiles.
    /// Historical locked declarations keep an older publication connected to the current roster privacy flag.
    /// If the identity source has gone, shorten the stored name conservatively.</summary>
    public static async Task<HashSet<Guid>> InitialOnlyProfilesAsync(AppDbContext db, IEnumerable<Guid> profileIds, CancellationToken ct)
    {
        var ids = profileIds.Distinct().ToArray();
        if (ids.Length == 0) return [];
        // Preview candidates are not persisted profiles yet; their current declaration supplies privacy.
        var persistedIds = await db.Set<TeamProfile>().AsNoTracking().Where(x => ids.Contains(x.Id))
            .Select(x => x.Id).ToListAsync(ct);
        var initialOnly = persistedIds.Where(IsRiderProfile).ToHashSet();
        var memberships = await db.Set<SeasonRoundResult>().AsNoTracking()
            .Where(x => ids.Contains(x.TeamProfileId))
            .Select(x => new
            {
                x.TeamProfileId, x.EventTeamId, x.SeasonRoundPublication!.SeasonRound!.Season!.OwnerUserId,
                IsPairs = x.SeasonRoundPublication.SeasonRound.CompetitionSection!.Format == SectionFormat.Pairs,
            })
            .Distinct().ToListAsync(ct);
        if (memberships.Count == 0) return initialOnly;
        var teamIds = memberships.Select(x => x.EventTeamId).Distinct().ToArray();
        var identities = await db.RiderEntries.AsNoTracking()
            .Where(r => r.DeclarationForm!.IsLocked && teamIds.Contains(r.DeclarationForm.TeamId))
            .Select(r => new
            {
                r.DeclarationForm!.TeamId, r.Id, r.SavedRiderId,
                InitialOnly = r.UseInitialOnly || (r.SavedRider != null && r.SavedRider.UseInitialOnly),
            }).ToListAsync(ct);
        var byTeam = identities.ToLookup(x => x.TeamId);
        foreach (var profile in memberships.GroupBy(x => x.TeamProfileId))
        {
            var knownIdentity = false;
            var protect = false;
            foreach (var membership in profile)
            {
                var matches = byTeam[membership.EventTeamId]
                    .Where(r => ProfileId(membership.OwnerUserId, r.Id, r.SavedRiderId) == membership.TeamProfileId).ToList();
                knownIdentity |= matches.Count > 0;
                protect |= (matches.Count == 0 && (membership.IsPairs || IsRiderProfile(membership.TeamProfileId)))
                    || matches.Any(r => r.InitialOnly);
            }
            if (protect) initialOnly.Add(profile.Key);
            else if (knownIdentity) initialOnly.Remove(profile.Key);
        }
        return initialOnly;
    }

    public static string Display(Guid profileId, string name, IReadOnlySet<Guid> initialOnly)
        => initialOnly.Contains(profileId) ? RiderNames.Display(name, true, viewerSeesFullNames: false) : name;
}
