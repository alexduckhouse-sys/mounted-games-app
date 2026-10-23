namespace MountedGames.Api.Entities;

/// <summary>
/// A prize the organiser gives outside the points table ("Best turned out", "Spirit of the Games"), printed in the
/// results book. It is public once the results are, so it holds nothing private. A null section means the
/// award is for the whole event.
/// </summary>
public class SpecialAward
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }
    public int? CompetitionSectionId { get; set; }
    public CompetitionSection? Section { get; set; }

    public string Title { get; set; } = string.Empty;
    public string Recipient { get; set; } = string.Empty;
    public string? Note { get; set; }
    public int OrderIndex { get; set; }
}
