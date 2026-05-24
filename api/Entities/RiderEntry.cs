namespace MountedGames.Api.Entities;

public class RiderEntry
{
    public int Id { get; set; }
    public int DeclarationFormId { get; set; }
    public DeclarationForm? DeclarationForm { get; set; }

    public int? SavedRiderId { get; set; }
    public SavedRider? SavedRider { get; set; }

    public string FullName { get; set; } = string.Empty;
    public DateTime? DateOfBirth { get; set; }
    public string? HorseName { get; set; }
    public string? BibColour { get; set; }
    public bool IsCaptain { get; set; }
    public bool IsReserve { get; set; }
    public int OrderIndex { get; set; }
}
