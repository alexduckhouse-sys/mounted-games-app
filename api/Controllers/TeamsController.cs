using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Security;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

public record CreateTeamInput(
    int CompetitionSectionId,
    int ClubId = 0,
    string? Suffix = null,
    string? BibColour = null,
    string? TrainerUserId = null,
    bool IsHorsConcours = false,
    string? BibDescription = null,
    [StringLength(150)] string? ClubName = null,
    [StringLength(150)] string? Club = null,
    string? Name = null,
    string? DisplayName = null,
    [StringLength(20)] string? Flag = null
);

public record UpdateTeamInput(
    string? Suffix = null,
    string? TrainerUserId = null,
    bool? IsHorsConcours = null,
    string? BibDescription = null,
    string? Name = null,
    string? DisplayName = null,
    string? BibColour = null,
    [StringLength(20)] string? Flag = null
);

[ApiController]
[Route("api/competitions/{competitionId:int}/teams")]
public class TeamsController : ControllerBase
{
    private readonly AppDbContext _db;
    public TeamsController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IEnumerable<TeamDto>> List(int competitionId) =>
        (await _db.Teams
            .Include(t => t.Club).Include(t => t.Section).Include(t => t.Trainer).Include(t => t.Results)
            .Where(t => t.CompetitionId == competitionId)
            .OrderBy(t => t.DisplayName)
            .ToListAsync())
        .Select(t => t.ToDto());

    [HttpPost]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<TeamDto>> Create(int competitionId, CreateTeamInput req)
    {
        var section = await _db.CompetitionSections.FindAsync(req.CompetitionSectionId);
        if (section is null || section.CompetitionId != competitionId)
            return BadRequest(new { message = "Section is not part of this competition." });

        Club? club = null;
        if (req.ClubId > 0)
        {
            club = await _db.Clubs.FindAsync(req.ClubId);
        }
        var typedClub = (req.ClubName ?? req.Club)?.Trim();
        if (club is null && !string.IsNullOrEmpty(typedClub))
        {
            club = await _db.Clubs.FirstOrDefaultAsync(c => c.Name.ToLower() == typedClub.ToLower());
            if (club is null)
            {
                club = new Club { Name = typedClub };
                _db.Clubs.Add(club);
                await _db.SaveChangesAsync();
            }
        }
        var customName = (req.Name ?? req.DisplayName)?.Trim();
        if (club is null && req.ClubId <= 0 && !string.IsNullOrEmpty(customName))
        {
            club = await _db.Clubs.FirstOrDefaultAsync(c => c.Name.ToLower() == "unaffiliated");
            if (club is null)
            {
                club = new Club { Name = "Unaffiliated" };
                _db.Clubs.Add(club);
                await _db.SaveChangesAsync();
            }
        }
        if (club is null) return BadRequest(new { message = "Club not found." });

        var suffix = (req.Suffix ?? string.Empty).Trim().ToUpperInvariant();
        var display = !string.IsNullOrEmpty(customName)
            ? customName
            : (string.IsNullOrWhiteSpace(suffix) ? club.Name : $"{club.Name} {suffix}");

        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var trainerUserId = req.TrainerUserId;
        if (string.IsNullOrEmpty(trainerUserId) && User.IsInRole(Roles.Trainer))
            trainerUserId = userId;

        var team = new Team
        {
            CompetitionId = competitionId,
            CompetitionSectionId = req.CompetitionSectionId,
            ClubId = club.Id,
            Suffix = suffix,
            DisplayName = display,
            BibColour = string.IsNullOrWhiteSpace(req.BibColour) ? club.BibColour : req.BibColour.Trim(),
            TrainerUserId = trainerUserId,
            IsHorsConcours = req.IsHorsConcours,
            BibDescription = ResultStatuses.MergeBibTags(null, req.BibDescription, req.Flag),
        };
        _db.Teams.Add(team);
        await _db.SaveChangesAsync();

        await _db.Entry(team).Reference(t => t.Club).LoadAsync();
        await _db.Entry(team).Reference(t => t.Section).LoadAsync();
        await _db.Entry(team).Reference(t => t.Trainer).LoadAsync();
        return team.ToDto();
    }

    [HttpPut("{id:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<TeamDto>> Update(int competitionId, int id, UpdateTeamInput req)
    {
        var t = await _db.Teams
            .Include(x => x.Club).Include(x => x.Section).Include(x => x.Trainer).Include(x => x.Results)
            .FirstOrDefaultAsync(x => x.Id == id && x.CompetitionId == competitionId);
        if (t is null) return NotFound();
        var customName = (req.Name ?? req.DisplayName)?.Trim();
        if (!string.IsNullOrEmpty(customName))
        {
            t.DisplayName = customName;
            if (req.Suffix is not null) t.Suffix = req.Suffix.Trim().ToUpperInvariant();
        }
        else if (!string.IsNullOrWhiteSpace(req.Suffix))
        {
            t.Suffix = req.Suffix.Trim().ToUpperInvariant();
            t.DisplayName = $"{t.Club?.Name ?? string.Empty} {t.Suffix}".Trim();
        }
        if (req.IsHorsConcours.HasValue) t.IsHorsConcours = req.IsHorsConcours.Value;
        if (req.BibColour is not null)
            t.BibColour = string.IsNullOrWhiteSpace(req.BibColour) ? t.Club?.BibColour : req.BibColour.Trim();
        var problem = await ApplyTrainerAndBibAsync(t, req.TrainerUserId, req.BibDescription, flagOverride: req.Flag);
        if (problem is not null) return problem;
        await _db.SaveChangesAsync();
        return t.ToDto();
    }

    /// <summary>
    /// A club's Team Manager (as well as an organiser or admin) puts a trainer in charge of one of the
    /// club's teams, and describes its bibs. An empty value clears the field.
    /// </summary>
    [HttpPut("/api/teams/{id:int}/trainer")]
    [Authorize]
    public async Task<ActionResult<TeamDto>> SetTrainer(int id, UpdateTeamRequest req)
    {
        var t = await _db.Teams
            .Include(x => x.Club).Include(x => x.Section).Include(x => x.Trainer).Include(x => x.Results)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (t is null) return NotFound();
        // 404, not 403, for people who can't see the team's management.
        if (!await CanManageTeamAsync(t)) return NotFound();
        // A club's manager can only pick trainers of that club; an organiser or admin can pick a visiting trainer.
        var clubOnly = !User.IsInRole(Roles.Admin) && !await _db.CanManageAsync(User, t.CompetitionId);
        var problem = await ApplyTrainerAndBibAsync(t, req.TrainerUserId, req.BibDescription, clubOnly, req.Flag);
        if (problem is not null) return problem;
        await _db.SaveChangesAsync();
        return t.ToDto();
    }

    /// <summary>Applies the trainer and bib description of an update. Returns an error result, or null when fine.</summary>
    private async Task<ActionResult?> ApplyTrainerAndBibAsync(
        Team t, string? trainerUserId, string? bibDescription, bool clubOnly = false, string? flagOverride = null)
    {
        if (bibDescription is not null || flagOverride is not null)
            t.BibDescription = ResultStatuses.MergeBibTags(t.BibDescription, bibDescription, flagOverride);
        if (trainerUserId is null) return null;
        if (string.IsNullOrWhiteSpace(trainerUserId))
        {
            t.TrainerUserId = null;
            t.Trainer = null;
            return null;
        }
        var trainerId = trainerUserId.Trim();
        var isTrainer = await (from userRole in _db.UserRoles
                               join role in _db.Roles on userRole.RoleId equals role.Id
                               where userRole.UserId == trainerId && role.Name == Roles.Trainer
                               select userRole.UserId).AnyAsync();
        if (!isTrainer) return BadRequest(new { message = "That person isn't an approved trainer." });
        if (clubOnly && !await _db.Users.AnyAsync(u => u.Id == trainerId && u.ClubId == t.ClubId))
            return BadRequest(new { message = "Choose a trainer from this club." });
        t.TrainerUserId = trainerId;
        t.Trainer = await _db.Users.FindAsync(trainerId);
        return null;
    }

    /// <summary>Admins, whoever organises the competition, and the Team Manager of the team's club.</summary>
    private async Task<bool> CanManageTeamAsync(Team t)
        => User.IsInRole(Roles.Admin)
            || await _db.CanManageAsync(User, t.CompetitionId)
            || await _db.IsClubManagerAsync(User, t.ClubId);

    /// <summary>The trainers of a club, for choosing who looks after a team.</summary>
    [HttpGet("/api/clubs/{clubId:int}/trainers")]
    [Authorize(Roles = Roles.Admin + "," + Roles.Trainer + "," + Roles.Manager)]
    public async Task<IEnumerable<ClubTrainerDto>> ClubTrainers(int clubId)
        => await (from u in _db.Users.AsNoTracking()
                  join userRole in _db.UserRoles on u.Id equals userRole.UserId
                  join role in _db.Roles on userRole.RoleId equals role.Id
                  where u.ClubId == clubId && role.Name == Roles.Trainer
                  orderby u.FullName
                  select new ClubTrainerDto(u.Id, u.FullName)).ToListAsync();

    [HttpDelete("{id:int}")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<IActionResult> Delete(int competitionId, int id)
    {
        var t = await _db.Teams.FirstOrDefaultAsync(t => t.Id == id && t.CompetitionId == competitionId);
        if (t is null) return NotFound();
        _db.Teams.Remove(t);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("/api/trainer/my-teams")]
    [Authorize]
    public async Task<IEnumerable<TeamDto>> MyTeams()
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Array.Empty<TeamDto>();
        // Includes the user's coached teams, any team they're an accepted supporter of, and, for a club's
        // Team Manager, every team of their club. Caller (My Teams page) splits on `relationship`.
        var managedClubId = User.IsInRole(Roles.Manager) ? await _db.ClubIdOfAsync(User) : null;
        var teams = await _db.Teams
            .Include(t => t.Club).Include(t => t.Section).Include(t => t.Trainer).Include(t => t.Competition)
            .Include(t => t.Supporters)
            .Where(t => t.TrainerUserId == userId
                || (managedClubId != null && t.ClubId == managedClubId)
                || t.Supporters.Any(s => s.UserId == userId && s.Status == TeamSupporterStatus.Accepted))
            .OrderByDescending(t => t.Competition!.StartDate)
            .ToListAsync();
        var teamIds = teams.Select(t => t.Id).ToList();
        var declared = (await _db.DeclarationForms.AsNoTracking().Where(f => teamIds.Contains(f.TeamId)).Select(f => f.TeamId).Distinct().ToListAsync()).ToHashSet();
        var today = DateTime.UtcNow.Date;
        return teams.Select(t =>
        {
            var manages = managedClubId != null && t.ClubId == managedClubId;
            var dto = t.ToDtoFor(userId, manages);
            // Only the people who fill in a team's dec form are asked for it, and only until the event is over.
            var fills = t.TrainerUserId == userId || manages;
            var over = (t.Competition?.EndDate ?? t.Competition?.StartDate ?? today).Date < today;
            return dto with { NeedsDeclaration = fills && !over && t.EntryStatus == TeamEntryStatus.Active && !declared.Contains(t.Id) };
        });
    }

    [HttpPost("{teamId:int}/supporter-key")]
    [Authorize]
    public async Task<ActionResult<GenerateJoinKeyResponse>> RotateJoinKey(int teamId)
    {
        var (team, err) = await LoadTeamForTrainerAsync(teamId);
        if (err != null) return err;
        team!.SupporterJoinKey = GenerateKey();
        await _db.SaveChangesAsync();
        return new GenerateJoinKeyResponse(team.SupporterJoinKey!);
    }

    /// <summary>
    /// Trainer sets a custom team code (replaces the random one). Must be
    /// unique within the team's competition so entrants can join unambiguously.
    /// </summary>
    [HttpPut("{teamId:int}/team-code")]
    [Authorize]
    public async Task<ActionResult<GenerateJoinKeyResponse>> SetTeamCode(int teamId, SetTeamCodeRequest req)
    {
        var (team, err) = await LoadTeamForTrainerAsync(teamId);
        if (err != null) return err;
        var code = (req.Code ?? string.Empty).Trim().ToUpperInvariant();
        if (code.Length < 3 || code.Length > 32)
            return BadRequest(new { message = "Team code must be 3-32 characters." });
        if (!System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_-]+$"))
            return BadRequest(new { message = "Letters, digits, dash and underscore only." });
        var clash = await _db.Teams
            .AnyAsync(t => t.Id != team!.Id
                && t.CompetitionId == team.CompetitionId
                && t.SupporterJoinKey != null
                && t.SupporterJoinKey.ToUpper() == code);
        if (clash) return Conflict(new { message = "Another team in this competition already uses that code." });
        team!.SupporterJoinKey = code;
        await _db.SaveChangesAsync();
        return new GenerateJoinKeyResponse(code);
    }

    [HttpDelete("{teamId:int}/supporter-key")]
    [Authorize]
    public async Task<IActionResult> RevokeJoinKey(int teamId)
    {
        var (team, err) = await LoadTeamForTrainerAsync(teamId);
        if (err != null) return err;
        team!.SupporterJoinKey = null;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("{teamId:int}/supporters")]
    [Authorize]
    public async Task<ActionResult<IEnumerable<TeamSupporterDto>>> ListSupporters(int teamId)
    {
        var (team, err) = await LoadTeamForTrainerAsync(teamId);
        if (err != null) return err;
        var rows = await _db.TeamSupporters
            .Include(s => s.User).Include(s => s.Team)
            .Where(s => s.TeamId == team!.Id)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();
        return Ok(rows.Select(s => s.ToDto()));
    }

    [EnableRateLimiting(RequestLimits.TeamJoinPolicy)]
    [HttpPost("/api/teams/join")]
    [Authorize]
    public async Task<ActionResult<TeamSupporterDto>> Join(JoinTeamRequest req)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return Unauthorized();
        var key = req.Key?.Trim();
        if (string.IsNullOrEmpty(key)) return BadRequest(new { message = "Join key required." });

        var keyUpper = key.ToUpperInvariant();
        var team = await _db.Teams
            .Include(t => t.Competition).Include(t => t.Trainer)
            .FirstOrDefaultAsync(t => t.SupporterJoinKey != null && t.SupporterJoinKey.ToUpper() == keyUpper);
        if (team is null) return NotFound(new { message = "No team matches that key. Double-check with the trainer." });

        // Don't let the team's own trainer request to "support" their own team.
        if (team.TrainerUserId == userId)
            return BadRequest(new { message = "You're already the trainer of this team." });

        var existing = await _db.TeamSupporters
            .Include(s => s.Team).Include(s => s.User)
            .FirstOrDefaultAsync(s => s.TeamId == team.Id && s.UserId == userId);
        if (existing is not null) return Ok(existing.ToDto());

        var row = new TeamSupporter
        {
            TeamId = team.Id,
            UserId = userId,
            Status = TeamSupporterStatus.Pending,
        };
        _db.TeamSupporters.Add(row);
        await _db.SaveChangesAsync();
        var loaded = await _db.TeamSupporters
            .Include(s => s.User).Include(s => s.Team)
            .FirstAsync(s => s.Id == row.Id);
        return Ok(loaded.ToDto());
    }

    [HttpPut("/api/team-supporters/{id:int}/accept")]
    [Authorize]
    public async Task<ActionResult<TeamSupporterDto>> Accept(int id)
    {
        var row = await _db.TeamSupporters
            .Include(s => s.Team).Include(s => s.User)
            .FirstOrDefaultAsync(s => s.Id == id);
        if (row is null) return NotFound();
        if (!await ViewerOwnsTeamAsync(row.TeamId)) return Forbid();
        row.Status = TeamSupporterStatus.Accepted;
        await _db.SaveChangesAsync();
        return row.ToDto();
    }

    [HttpDelete("/api/team-supporters/{id:int}")]
    [Authorize]
    public async Task<IActionResult> RemoveSupporter(int id)
    {
        var row = await _db.TeamSupporters
            .Include(s => s.Team)
            .FirstOrDefaultAsync(s => s.Id == id);
        if (row is null) return NotFound();
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        // The supporter themselves can leave; the trainer (or admin) can kick.
        var canRemove = row.UserId == userId || await ViewerOwnsTeamAsync(row.TeamId);
        if (!canRemove) return Forbid();
        _db.TeamSupporters.Remove(row);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Loads a team if the current viewer trains it (or is Admin).</summary>
    private async Task<(Team? team, ActionResult? error)> LoadTeamForTrainerAsync(int teamId)
    {
        var team = await _db.Teams.FirstOrDefaultAsync(t => t.Id == teamId);
        if (team is null) return (null, NotFound());
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return (null, Unauthorized());
        if (team.TrainerUserId != userId && !User.IsInRole(Roles.Admin)
            && !await _db.IsClubManagerAsync(User, team.ClubId)) return (null, Forbid());
        return (team, null);
    }

    private async Task<bool> ViewerOwnsTeamAsync(int teamId)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userId)) return false;
        if (User.IsInRole(Roles.Admin)) return true;
        var team = await _db.Teams.AsNoTracking().FirstOrDefaultAsync(t => t.Id == teamId);
        return team is not null && (team.TrainerUserId == userId || await _db.IsClubManagerAsync(User, team.ClubId));
    }

    private static string GenerateKey()
    {
        // Short, unambiguous join key — no I/0/1/O.
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var rng = System.Security.Cryptography.RandomNumberGenerator.Create();
        var bytes = new byte[8];
        rng.GetBytes(bytes);
        var sb = new System.Text.StringBuilder(8);
        foreach (var b in bytes) sb.Append(chars[b % chars.Length]);
        return sb.ToString();
    }
}
