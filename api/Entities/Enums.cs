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
