namespace MountedGames.Api.Entities;

/// <summary>
/// A named set-up an organiser saved from a competition, to begin new competitions from ("Copy a past competition").
/// <c>SetupJson</c> is a <c>CompetitionSetup</c>: sections, scoring settings, race lists, timetable plan, hatbands, dec form
/// setup and payment details. It never holds teams, heats, results, entries or payments. Private to its owner; admins see all.
/// </summary>
public class StartingPoint
{
    public const int MaxNameLength = 120;
    public const int MaxPerOwner = 50;

    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string OwnerUserId { get; set; } = string.Empty;
    /// <summary>The competition's name when it was saved, to show where it came from. Not a link: the competition may go.</summary>
    public string? SourceName { get; set; }
    public string SetupJson { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
