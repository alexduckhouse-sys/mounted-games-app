namespace MountedGames.Api.Entities;

/// <summary>
/// A no-account way to score one arena of one competition: a volunteer opens a link and can enter or replace
/// scores for that arena's heats, and nothing else. Only a SHA-256 hash of the random token is stored; the
/// token itself is shown once, when the link is created.
/// </summary>
public class ScorerLink
{
    public const int MaxLabelLength = 60;
    public const int MaxArenaLength = 120;
    public const int ScopeScore = 0;
    public const int ScopeCamera = 1;
    public const int ScopeScoreAndStream = 2;

    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }

    /// <summary>The scorer's name. Recorded against every score they enter.</summary>
    public string Label { get; set; } = "";

    /// <summary>Matches <see cref="Session.ArenaName"/> exactly; the link reaches heats in sessions with this arena.</summary>
    public string ArenaName { get; set; } = "";

    /// <summary>0 = Score only, 1 = Tripod camera only, 2 = Score + Stream controller.</summary>
    public int Scope { get; set; }

    /// <summary>Lower-case hex SHA-256 of the token. The token itself is never stored.</summary>
    public string TokenHash { get; set; } = "";

    public string CreatedByUserId { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public DateTime? LastUsedAt { get; set; }
}
