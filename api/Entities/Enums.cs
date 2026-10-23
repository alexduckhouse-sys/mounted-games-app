namespace MountedGames.Api.Entities;

public enum SectionFormat
{
    Pairs = 1,
    Teams = 2,
    Individual = 3
}

public enum SessionStatus
{
    Upcoming = 0,
    InArena = 1,
    Finished = 2
}

public enum ChatMessageType
{
    Chat = 0,
    System = 1,
    Announcement = 2
}

/// <summary>How teams change lane from one race of a heat to the next.</summary>
public enum LaneRotationMode
{
    // MoveUp is 0 on purpose: it is what every session did before this was a choice, so existing rows and
    // new sessions need no stored default.
    /// <summary>Every team moves up one lane after each race (the last wraps round to the first).</summary>
    MoveUp = 0,
    /// <summary>Every team stays in its drawn lane.</summary>
    Stay = 1,
    /// <summary>Every team moves down one lane after each race.</summary>
    MoveDown = 2
}

/// <summary>How a team's race ended. Anything but Finished scores 0 and shows its letter (E, DNS, DNF, R).</summary>
public enum ResultStatus
{
    Finished = 0,
    Eliminated = 1,
    DidNotStart = 2,
    DidNotFinish = 3,
    Retired = 4
}

public enum SessionKind
{
    Race = 0,
    Break = 1,
    Briefing = 2,
    Custom = 3
}

/// <summary>
/// Used by sections in "race-finals" format. A round is the 3 heats that share
/// a race: two qualifiers and one race-final.
/// </summary>
public enum RaceRoundStage
{
    None = 0,
    Qualifier = 1,
    Final = 2
}

/// <summary>
/// Whether a team is still taking part. Withdrawn and NoShow behave the same in the draw and on the
/// timetable; the difference is only recorded for the organiser.
/// </summary>
public enum TeamEntryStatus
{
    Active = 0,
    Withdrawn = 1,
    NoShow = 2,
}
