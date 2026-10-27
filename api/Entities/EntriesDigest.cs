namespace MountedGames.Api.Entities;

public enum EntriesDigestRunStatus
{
    /// <summary>People are being worked through, a batch at a time.</summary>
    Sending = 0,
    Done = 1,
    /// <summary>The first run ever: it only records the competitions already open, so switching the digest on never mails a backlog.</summary>
    Baseline = 2,
}

public enum EntriesDigestRecipientStatus
{
    Pending = 0,
    /// <summary>Taken by a batch that is sending it now. A claim older than a couple of minutes is treated as abandoned.</summary>
    Claimed = 1,
    Sent = 2,
    /// <summary>The provider refused it, or couldn't be reached. Tried again later, up to a few attempts.</summary>
    Failed = 3,
    /// <summary>Left out: unsubscribed since the run began, or nothing in it was still open for them.</summary>
    Skipped = 4,
}

/// <summary>
/// One digest of newly opened competitions. <see cref="RunDate"/> is the UK calendar date (<c>yyyy-MM-dd</c>) or
/// <see cref="BaselineKey"/>; its unique index is how several API instances agree on who sends the day's email.
/// The run freezes which competitions it announces (<see cref="EntriesDigestCompetition"/>) and who gets it
/// (<see cref="EntriesDigestRecipient"/>), so a later tick, on any instance, carries on where it stopped.
/// </summary>
public class EntriesDigestRun
{
    public const string BaselineKey = "baseline";

    public int Id { get; set; }
    public string RunDate { get; set; } = string.Empty;
    public DateTime ClaimedAt { get; set; } = DateTime.UtcNow;
    public EntriesDigestRunStatus Status { get; set; }
    /// <summary>Started by a site admin's Send now rather than by the evening tick.</summary>
    public bool Manual { get; set; }
    public int Competitions { get; set; }
    public int Total { get; set; }
    public DateTime? CompletedAt { get; set; }

    public ICollection<EntriesDigestCompetition> CompetitionRows { get; set; } = new List<EntriesDigestCompetition>();
    public ICollection<EntriesDigestRecipient> Recipients { get; set; } = new List<EntriesDigestRecipient>();
}

/// <summary>
/// A competition announced by a run. The competition id is the key, so no competition is ever announced twice. What the email
/// says about it (name, venue, dates) is copied here when the run is claimed and sent from these values, never read again from
/// the competition, so an organiser editing their event between batches can't put different text in front of the rest of the list.
/// </summary>
public class EntriesDigestCompetition
{
    public int CompetitionId { get; set; }
    public int RunId { get; set; }
    public EntriesDigestRun? Run { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Location { get; set; }
    public DateTime StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public DateTime? EntriesCloseAt { get; set; }
}

/// <summary>
/// One person's place in a run. It holds the consent row's id, not an address: the address is read from
/// <see cref="EmailOptIn"/> when the message is made, so an unsubscribe is honoured right up to the send.
/// </summary>
public class EntriesDigestRecipient
{
    public long Id { get; set; }
    public int RunId { get; set; }
    public EntriesDigestRun? Run { get; set; }
    public int OptInId { get; set; }
    public EntriesDigestRecipientStatus Status { get; set; }
    public DateTime? ClaimedAt { get; set; }
    public Guid? ClaimToken { get; set; }
    public int Attempts { get; set; }
}
