namespace MountedGames.Api.Entities;

public class SignupMatchmaking
{
    public int SignupId { get; set; }
    // Granted only when an organiser forms a team or a pair request is accepted.
    public bool DeclarationAccessGranted { get; set; }
    public bool LookingForPair { get; set; }
    public bool LookingForGuestRiders { get; set; }
    public bool WaitingForGuestSpot { get; set; }
    public int? PairRequestFromSignupId { get; set; }
    public int? PairRequestToSignupId { get; set; }
    public string? PairRequestStatus { get; set; }
}

public class SignupExtras
{
    public int SignupId { get; set; }
    public int StablesCount { get; set; }
    public string? StablingClubOrTeam { get; set; }
    public string? PaymentMethod { get; set; }
    public bool IsWaitlist { get; set; }
    public bool IsWithdrawn { get; set; }
    public bool RefundPending { get; set; }
    public int TeamsCount { get; set; } = 1;
}

public class CompetitionEntrySettings
{
    public int CompetitionId { get; set; }
    public DateTime? EntriesCloseAt { get; set; }
}

public class CompetitionDeclarationLock
{
    public int CompetitionId { get; set; }
    public DateTime? DeclarationsCloseAt { get; set; }
}

/// <summary>All teams formed from one entry, including whole-team purchases with multiple teams.</summary>
public class SignupTeamLink
{
    public int SignupId { get; set; }
    public int TeamId { get; set; }
}
