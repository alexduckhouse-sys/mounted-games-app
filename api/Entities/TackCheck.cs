
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
    /// <summary>The most points each rider can get in one sector, in the points modes.</summary>
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
    public string? RiderScoresJson { get; set; }
    public string? RecordedByUserId { get; set; }
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Legacy manual inspection, retained as history. Name-only keys do not establish horse identity or current admission.</summary>
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

    public string? PassportCode { get; set; }
    public string? OwnerFullName { get; set; }
    public string? LastFluVaccineDate { get; set; }
    public string? FluValidUntil { get; set; }
    public string? LastTetanusDate { get; set; }
    public string? TetanusValidUntil { get; set; }
    public string? InspectorRole { get; set; }
    public string? OfficialNotes { get; set; }
}

/// <summary>Legacy cross-event manual evidence. No new automatic matching or certification uses this record.</summary>
public class CertifiedHorse
{
    public int Id { get; set; }
    public string? PassportCode { get; set; }
    public string HorseName { get; set; } = string.Empty;
    public string HorseKey { get; set; } = string.Empty;
    public string? OwnerFullName { get; set; }
    public string? OwnerKey { get; set; }
    public string? LastFluVaccineDate { get; set; }
    public string? FluValidUntil { get; set; }
    public string? LastTetanusDate { get; set; }
    public string? TetanusValidUntil { get; set; }
    public string InspectorRole { get; set; } = "Official";
    public string? InspectedByUserId { get; set; }
    public string InspectedByName { get; set; } = string.Empty;
    public DateTime InspectedAt { get; set; } = DateTime.UtcNow;
    public string? OfficialNotes { get; set; }
}
