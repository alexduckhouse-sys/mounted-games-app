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
    private sealed record Membership(Guid TeamProfileId, int EventTeamId, string OwnerUserId, SectionFormat Format);

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
        var persisted = await db.Set<TeamProfile>().AsNoTracking().Where(x => ids.Contains(x.Id))
            .Select(x => new { x.Id, x.DisplayName }).ToListAsync(ct);
        var initialOnly = persisted.Select(x => x.Id).Where(IsRiderProfile).ToHashSet();
        var pairNames = persisted.Where(x => x.DisplayName.Contains(" & ", StringComparison.Ordinal)).Select(x => x.Id).ToHashSet();
        var published = await db.Set<SeasonRoundResult>().AsNoTracking()
            .Where(x => ids.Contains(x.TeamProfileId))
            .Select(x => new Membership(x.TeamProfileId, x.EventTeamId,
                x.SeasonRoundPublication!.SeasonRound!.Season!.OwnerUserId,
                x.SeasonRoundPublication.SeasonRound.CompetitionSection!.Format))
            .ToListAsync(ct);
        // Rider-named profiles are public as soon as they are linked, before any round is published.
        var linked = await db.Set<EventTeamProfileLink>().AsNoTracking()
            .Where(x => ids.Contains(x.TeamProfileId) && x.Team!.Section!.Format != SectionFormat.Teams)
            .Select(x => new Membership(x.TeamProfileId, x.TeamId, x.TeamProfile!.OwnerUserId, x.Team!.Section!.Format))
            .ToListAsync(ct);
        var memberships = published.Concat(linked).Distinct().ToList();
        if (memberships.Count == 0) return initialOnly;
        var teamIds = memberships.Select(x => x.EventTeamId).Distinct().ToArray();
        var identities = await db.RiderEntries.AsNoTracking()
            .Where(r => r.DeclarationForm!.IsLocked && teamIds.Contains(r.DeclarationForm.TeamId))
            .Select(r => new
            {
                r.DeclarationForm!.TeamId, r.Id, r.SavedRiderId, r.IsReserve,
                InitialOnly = r.UseInitialOnly || (r.SavedRider != null && r.SavedRider.UseInitialOnly),
            }).ToListAsync(ct);
        var byTeam = identities.ToLookup(x => x.TeamId);
        foreach (var profile in memberships.GroupBy(x => x.TeamProfileId))
        {
            var knownIdentity = false;
            var protect = false;
            foreach (var membership in profile)
            {
                // Ordinary pairs labels (for example "Fake Club A") are team names, not rider identities.
                var riderProfile = IsRiderProfile(membership.TeamProfileId);
                var namedPair = membership.Format == SectionFormat.Pairs && pairNames.Contains(membership.TeamProfileId);
                if (!riderProfile && membership.Format != SectionFormat.Individual && !namedPair) continue;
                var matches = byTeam[membership.EventTeamId]
                    .Where(r => !riderProfile && (membership.Format == SectionFormat.Individual || namedPair)
                        ? !r.IsReserve
                        : ProfileId(membership.OwnerUserId, r.Id, r.SavedRiderId) == membership.TeamProfileId).ToList();
                knownIdentity |= matches.Count > 0;
                protect |= (matches.Count == 0 && (membership.Format is SectionFormat.Pairs or SectionFormat.Individual || IsRiderProfile(membership.TeamProfileId)))
                    || matches.Any(r => r.InitialOnly);
            }
            if (protect) initialOnly.Add(profile.Key);
            else if (knownIdentity) initialOnly.Remove(profile.Key);
        }
        return initialOnly;
    }

    /// <summary>Rider-named event labels need the same privacy in search, profile headings and linked history.</summary>
    public static async Task<Dictionary<int, string>> ProtectedEventTeamNamesAsync(AppDbContext db, IEnumerable<int> teamIds, CancellationToken ct)
    {
        var ids = teamIds.Distinct().ToArray();
        if (ids.Length == 0) return [];
        // Pairs may instead have ordinary club labels, which must remain unchanged.
        var candidates = await db.Teams.AsNoTracking()
            .Where(t => ids.Contains(t.Id) && (t.Section!.Format == SectionFormat.Individual || t.DisplayName.Contains(" & ")))
            .Select(t => new { t.Id, t.DisplayName }).ToListAsync(ct);
        if (candidates.Count == 0) return [];
        var candidateIds = candidates.Select(t => t.Id).ToArray();
        var riders = await db.RiderEntries.AsNoTracking()
            .Where(r => candidateIds.Contains(r.DeclarationForm!.TeamId) && !r.IsReserve && r.DeclarationForm.IsLocked
                && r.DeclarationFormId == db.DeclarationForms.Where(f => f.TeamId == r.DeclarationForm.TeamId && f.IsLocked)
                    .OrderByDescending(f => f.SubmittedAt).ThenByDescending(f => f.Id).Select(f => f.Id).FirstOrDefault())
            .Select(r => new
            {
                r.DeclarationForm!.TeamId,
                InitialOnly = r.UseInitialOnly || (r.SavedRider != null && r.SavedRider.UseInitialOnly),
            }).ToListAsync(ct);
        var byTeam = riders.ToLookup(r => r.TeamId);
        return candidates.Where(t => !byTeam[t.Id].Any() || byTeam[t.Id].Any(r => r.InitialOnly))
            .ToDictionary(t => t.Id, t => ShortenRiderNames(t.DisplayName));
    }

    public static string Display(Guid profileId, string name, IReadOnlySet<Guid> initialOnly)
        => initialOnly.Contains(profileId) ? ShortenRiderNames(name) : name;

    /// <summary>A pair can name two riders; shortening the whole label would leave the first surname intact.</summary>
    public static string ShortenRiderNames(string name)
        => string.Join(" & ", name.Split(" & ").Select(part => RiderNames.Display(part, true, viewerSeesFullNames: false)));
}
