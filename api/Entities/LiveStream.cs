namespace MountedGames.Api.Entities;

public enum LiveStreamStatus { Live = 0, Paused = 1, Ended = 2, Starting = 3 }

public class LiveStream
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }
    public string ArenaName { get; set; } = "";
    public string AngleName { get; set; } = "";
    public LiveStreamStatus Status { get; set; } = LiveStreamStatus.Starting;
    public string? Caption { get; set; }
    public bool AudioMuted { get; set; }
    public bool HasAudio { get; set; }
    public bool Simulcast { get; set; }
    public string StartedByUserId { get; set; } = "";
    public DateTime StartedAt { get; set; }
    public DateTime LastHeartbeatAt { get; set; }
    public DateTime? EndedAt { get; set; }
    public string? SfuSessionId { get; set; }
    public int Generation { get; set; }
    public string? PendingSfuSessionId { get; set; }
    public int? PendingAttempt { get; set; }
    public bool PendingHasAudio { get; set; }
    public bool PendingSimulcast { get; set; }
    public DateTime? PendingSince { get; set; }
    public int? TakeOverStreamId { get; set; }
    // Persist the SFU's mids so best-effort track cleanup also works after an API restart.
    public string SfuTrackMids { get; set; } = "[]";
    public string PendingTrackMids { get; set; } = "[]";
}
