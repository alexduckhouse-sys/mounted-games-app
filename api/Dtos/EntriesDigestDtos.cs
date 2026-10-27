using MountedGames.Api.Entities;

namespace MountedGames.Api.Dtos;

/// <summary>A competition waiting for the next entries-open email. Public facts only.</summary>
public record DigestPendingCompetitionDto(int Id, string Name, DateTime StartDate, string? Location);

/// <summary>How one digest went, as counts. No addresses.</summary>
public record EntriesDigestRunDto(
    int Id, string RunDate, EntriesDigestRunStatus Status, bool Manual, int Competitions, int Total,
    int Sent, int Failed, int Skipped, int Remaining, DateTime ClaimedAt, DateTime? CompletedAt);

/// <summary>What the Admin → Email card shows. <see cref="NextSendUtc"/> is when the evening tick may next start a run.</summary>
public record EntriesDigestStatusDto(
    bool CanSend, string? CannotSendBecause, int Recipients, int PendingCount, IReadOnlyList<DigestPendingCompetitionDto> Pending,
    EntriesDigestRunDto? Last, bool TodayClaimed, DateTime NextSendUtc);

public record SendEntriesDigestRequest(bool Confirm, int ExpectedRecipients);
