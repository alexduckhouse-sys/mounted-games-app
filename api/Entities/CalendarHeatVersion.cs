namespace MountedGames.Api.Entities;

/// <summary>
/// What a team's calendar feed last said about one of its heats. The feed compares the heat's current details
/// with <see cref="Fingerprint"/>; when they differ it raises <see cref="Sequence"/> and
/// <see cref="ModifiedAt"/>, which is how calendar apps know the event has moved. Holds no personal data.
/// </summary>
public class CalendarHeatVersion
{
    public int Id { get; set; }
    public int HeatId { get; set; }
    public int TeamId { get; set; }
    /// <summary>Hex SHA-256 of the event details the feed publishes for this heat.</summary>
    public string Fingerprint { get; set; } = string.Empty;
    /// <summary>iCalendar SEQUENCE: 0 for the first version, plus one for every later change.</summary>
    public int Sequence { get; set; }
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}
