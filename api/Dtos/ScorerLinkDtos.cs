using System.ComponentModel.DataAnnotations;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Dtos;

/// <summary>A link as the organiser sees it. The token and its hash are never part of this.</summary>
public record ScorerLinkDto(
    int Id, string Label, string ArenaName,
    DateTime CreatedAt, DateTime ExpiresAt, DateTime? LastUsedAt, DateTime? RevokedAt);

public record ScorerLinkListDto(
    IReadOnlyList<string> Arenas, DateTime DefaultExpiresAt, IReadOnlyList<ScorerLinkDto> Links);

public record CreateScorerLinkRequest(
    [Required, StringLength(ScorerLink.MaxLabelLength)] string Label,
    [Required, StringLength(ScorerLink.MaxArenaLength)] string ArenaName,
    DateTime? ExpiresAt = null);

/// <summary>
/// The reply to creating a link, and the only time the token is ever returned. <c>Path</c> is the page address with
/// the token in the fragment (<c>/score#t=…</c>), which browsers never send to a server; the web app puts its
/// origin in front. <c>Token</c> is the bare string, for anything that wants to build its own link (a QR code).
/// </summary>
public record CreatedScorerLinkDto(ScorerLinkDto Link, string Token, string Path);

/// <summary>What a scorer link holder sees: their arena's timetable and nothing else.</summary>
public record ScorerSessionDto(
    string Label, int CompetitionId, string CompetitionName, string ArenaName,
    DateTime ExpiresAt, IReadOnlyList<SessionDto> Sessions);
