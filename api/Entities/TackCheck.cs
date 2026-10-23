namespace MountedGames.Api.Entities;

/// <summary>What a section's tack check counts for.</summary>
public enum TackCheckMode
{
    /// <summary>A checklist: each sector passes or fails, and nothing is scored.</summary>
    PassFail = 0,
    /// <summary>Points per sector, shown as a separate "Tack &amp; Turnout" table. The main standings are unchanged.</summary>
    Leaderboard = 1,
    /// <summary>Points per sector, and each team's tack total is added to its main standings as bonus points.</summary>
    BonusPoints = 2,
}

/// <summary>
/// The tack check set-up for one section (age group): whether it runs, what it counts for and the sectors
/// (columns) the stewards mark. Turning it off keeps the marks, so it can be turned back on.
/// </summary>
public class TackCheckSection
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }
    public int CompetitionSectionId { get; set; }
    public CompetitionSection? Section { get; set; }

    public bool IsEnabled { get; set; }
    public TackCheckMode Mode { get; set; }
    /// <summary>The most points a team can get in one sector, in the points modes.</summary>
    public int MaxPoints { get; set; } = 10;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<TackCheckSector> Sectors { get; set; } = new List<TackCheckSector>();
}

/// <summary>One column of a tack check ("Saddle/Girth", "Bridle/Bit"...).</summary>
public class TackCheckSector
{
    public int Id { get; set; }
    public int TackCheckSectionId { get; set; }
    public TackCheckSection? TackCheckSection { get; set; }
    public string Name { get; set; } = string.Empty;
    public int OrderIndex { get; set; }

    public ICollection<TackCheckMark> Marks { get; set; } = new List<TackCheckMark>();
}

/// <summary>
/// A team's result in one sector. <c>Passed</c> is used in <see cref="TackCheckMode.PassFail"/>, <c>Points</c> in
/// the points modes; both are kept so switching mode loses nothing.
/// </summary>
public class TackCheckMark
{
    public int Id { get; set; }
    public int TackCheckSectorId { get; set; }
    public TackCheckSector? Sector { get; set; }
    public int TeamId { get; set; }
    public Team? Team { get; set; }

    public bool? Passed { get; set; }
    public int? Points { get; set; }
    public string? RecordedByUserId { get; set; }
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A pony whose passport (and vaccinations) a steward has checked on arrival, for a competition with
/// <see cref="Competition.EnablePassportCheck"/> on. Staff only. There is no pony entity, so a pony is its name
/// within one team: <c>PonyKey</c> is the name trimmed and lower-cased, which keeps the tick when the declaration
/// is edited. Ponies in different teams are never compared, because many ponies share a name.
/// </summary>
public class PassportCheck
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }
    public int TeamId { get; set; }
    public Team? Team { get; set; }

    public string PonyName { get; set; } = string.Empty;
    public string PonyKey { get; set; } = string.Empty;
    public DateTime CheckedAt { get; set; } = DateTime.UtcNow;
    public string? CheckedByUserId { get; set; }
    public string? CheckedByName { get; set; }
}
