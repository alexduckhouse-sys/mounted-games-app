namespace MountedGames.Api.Entities.Apple;

public class NativeInstallation
{
    public Guid Id { get; set; }
    public string CapabilityHash { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime LastSeenAt { get; set; }
}

// A registration is also its durable, coalescing delivery slot. Tokens never leave protected storage.
public class LiveActivityRegistration
{
    public Guid Id { get; set; }
    public Guid InstallationId { get; set; }
    public string ActivityId { get; set; } = "";
    public int CompetitionId { get; set; }
    public int TeamId { get; set; }
    public string ProtectedPushToken { get; set; } = "";
    public bool Sandbox { get; set; }
    public DateTime ExpiresAt { get; set; }
    public bool EndRequested { get; set; }
    public bool Ended { get; set; }
    public long Version { get; set; } = 1;
    public long LastTimestamp { get; set; }
    public DateTime NextAttemptAt { get; set; }
    public string? LeaseToken { get; set; }
    public DateTime? LeaseUntil { get; set; }
    public int Attempts { get; set; }
}

public class ArrivalBooking
{
    public Guid Id { get; set; }
    public int CompetitionId { get; set; }
    public string OwnerUserId { get; set; } = "";
    public int? SignupId { get; set; }
    public string Reference { get; set; } = "";
    public string VehicleRegistration { get; set; } = "";
    public DateTime? LegacyReconciledAt { get; set; }
    public string? LegacyAllocationSnapshot { get; set; }
    public long Revision { get; set; } = 1;
    public DateTime UpdatedAt { get; set; }
    public ICollection<ArrivalBookingSource> Sources { get; set; } = new List<ArrivalBookingSource>();
}

public class ArrivalBookingSource
{
    public int Id { get; set; }
    public Guid ArrivalBookingId { get; set; }
    public ArrivalBooking? Booking { get; set; }
    public int EventOrderLineId { get; set; }
    public int Quantity { get; set; }
    public ICollection<ArrivalAllocation> Allocations { get; set; } = new List<ArrivalAllocation>();
}

public class ArrivalAllocation
{
    public int Id { get; set; }
    public int ArrivalBookingSourceId { get; set; }
    public ArrivalBookingSource? Source { get; set; }
    public int CompetitionId { get; set; }
    public string Resource { get; set; } = "";
    public string Night { get; set; } = "";
    public int Kind { get; set; }
}

public class WalletPass
{
    public Guid Id { get; set; }
    public Guid ArrivalBookingId { get; set; }
    public string Serial { get; set; } = "";
    public string ProtectedAuthenticationToken { get; set; } = "";
    public string AuthenticationTokenHash { get; set; } = "";
    public string ContentHash { get; set; } = "";
    public long Revision { get; set; }
    public long ChangeCursor { get; set; }
    public DateTime ChangedAt { get; set; }
    public DateTime LastCheckedAt { get; set; }
}

// Incremented by UPDATE inside the same transaction as all pass changes, never by a sequence.
// The exclusive row lock is retained until COMMIT, so a lower cursor cannot commit after a higher one.
public class AppleChangeClock { public int Id { get; set; } = 1; public long Value { get; set; } }

public class WalletDeviceRegistration
{
    public int Id { get; set; }
    public Guid WalletPassId { get; set; }
    public string DeviceHash { get; set; } = "";
    public string ProtectedPushToken { get; set; } = "";
    public long PendingCursor { get; set; }
    public long DeliveredCursor { get; set; }
    public DateTime NextAttemptAt { get; set; }
    public string? LeaseToken { get; set; }
    public DateTime? LeaseUntil { get; set; }
    public int Attempts { get; set; }
}
