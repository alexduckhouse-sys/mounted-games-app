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
