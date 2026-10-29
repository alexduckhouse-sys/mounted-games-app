namespace MountedGames.Api.Entities;

/// <summary>Committed versions of public read models. Id 0 covers shared payout/account details.</summary>
public sealed class CompetitionReadRevision
{
    public int CompetitionId { get; set; }
    public long Standings { get; set; }
    public long Detail { get; set; }
}
