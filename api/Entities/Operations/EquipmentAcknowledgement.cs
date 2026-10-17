namespace MountedGames.Api.Entities.Operations;

public class EquipmentAcknowledgement
{
    public int Id { get; set; }
    public int CompetitionId { get; set; }
    public Competition? Competition { get; set; }
    public string ItemKey { get; set; } = string.Empty;
    public DateTime AcknowledgedAt { get; set; } = DateTime.UtcNow;
    public string? AcknowledgedByUserId { get; set; }
}
