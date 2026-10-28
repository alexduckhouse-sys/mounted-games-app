namespace MountedGames.Api.Entities;

public class SavedRider
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string? CreatedByUserId { get; set; }
    public Club? Club { get; set; }

    public string FullName { get; set; } = string.Empty;
    public DateTime? DateOfBirth { get; set; }
    public string? HorseName { get; set; }
    /// <summary>The pony's height in hands, written as a decimal: 13.2 means 13 hands 2 inches.</summary>
    public decimal? PonyHeightHands { get; set; }
    public string? PonyPassportNumber { get; set; }
    public string? PonyOwnerFullName { get; set; }
    public string? Notes { get; set; }

    /// <summary>Show only the surname's initial on public pages ("Oliver S.").</summary>
    public bool UseInitialOnly { get; set; }
    /// <summary>Legacy column from the removed per-rider filming opt-out. Nothing reads or writes it; kept so no migration is needed.</summary>
    public bool NoFilming { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}
