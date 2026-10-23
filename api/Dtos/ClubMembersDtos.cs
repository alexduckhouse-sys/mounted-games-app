using System.ComponentModel.DataAnnotations;
using MountedGames.Api.Auth;

namespace MountedGames.Api.Dtos;

/// <summary>One person in a club. <c>Role</c> is the most senior of Manager, Trainer and Member.</summary>
/// <param name="Teams">For a trainer: the club's teams they look after, newest event first.</param>
/// <param name="AwaitingAdmin">A team manager request for this person is waiting for an admin.</param>
public record ClubMemberDto(
    string UserId, string FullName, string Role, IReadOnlyList<string> Teams, bool AwaitingAdmin = false);

/// <param name="Pending">People who asked to join the club as a trainer (or, for an admin, as a team manager) and wait for a yes or no.</param>
public record ClubMembersDto(
    int ClubId, string ClubName, IReadOnlyList<ClubMemberDto> Members, IReadOnlyList<TrainerRequestDto> Pending);

/// <param name="Role">Manager, Trainer or Member.</param>
public record ChangeMemberRoleRequest([Required] string Role);

/// <param name="Role">The person's role now.</param>
/// <param name="AwaitingAdmin">True when the change to Manager needs an admin to approve it, so nothing changed yet.</param>
public record ChangeMemberRoleResponse(string Role, bool AwaitingAdmin);
