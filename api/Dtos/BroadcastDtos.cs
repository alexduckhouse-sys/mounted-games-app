namespace MountedGames.Api.Dtos;

public sealed record BroadcastRow(int TeamId, string Name, string? BibColour, int? Lane, bool SitOut, bool Hc,
    int? Place, bool Joint, double? Points, bool Eliminated);
public sealed record BroadcastHeat(int HeatId, string Label, string SessionName, int? SectionId, string SectionName,
    int? RaceId, string? RaceName, bool Started, IReadOnlyList<BroadcastRow> Rows);
public sealed record BroadcastScore(int RaceId, string RaceName, string HeatLabel, IReadOnlyList<BroadcastRow> Rows, DateTime? ExpiresAt = null);
public sealed record BroadcastSponsor(string Name, string? LogoData);
public sealed record BroadcastCueDto(long Revision, Guid CommandId, string Kind, string Action, DateTime StartsAt,
    DateTime ExpiresAt, System.Text.Json.JsonElement Payload);
public sealed record BroadcastGraphics(string CompetitionName, string Arena, BroadcastHeat? Current, BroadcastHeat? Next,
    BroadcastScore? Score, IReadOnlyList<StandingRow> Standings, string? Banner, IReadOnlyList<BroadcastSponsor> Sponsors,
    IReadOnlyList<BroadcastCueDto> Cues, string Card = "auto", int ToplistRows = 8, PrizeGivingDto? Podium = null,
    string Background = "#0F1E3D", string Accent = "#F5B82E");
public sealed record BroadcastSnapshotDto(long Revision, DateTime ServerTime, DateTime? ObservedAt, DateTime PlaybackAt,
    DateTime ExpiresAt, bool Hidden, bool WarmingUp, BroadcastGraphics? Graphics);
public sealed record BroadcastVisibilityRequest(string Arena, bool Hidden, int? ExpectedRevision);
