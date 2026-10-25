using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Services.DecForms;

namespace MountedGames.Api.Controllers;

/// <param name="Config">What the dec form asks.</param>
/// <param name="IsStandard">True when the organiser never set one up, so the standard form is in use.</param>
/// <param name="FormsSubmitted">Dec forms already in. A change applies to new submissions only; these are not rewritten.</param>
public record DecFormConfigDto(DecFormConfig Config, bool IsStandard, int FormsSubmitted);

public record TeamFlagsDto(int TeamId, string TeamName, int DecFormId, IReadOnlyList<string> Flags);

/// <summary>
/// The per-competition dec form setup. Reading it needs only a sign-in (a trainer needs it to fill the form in, and it
/// holds labels and limits, nothing about any rider); changing it is for the people who run the competition.
/// </summary>
[ApiController]
public class DecFormConfigController(AppDbContext db) : ControllerBase
{
    [HttpGet("api/competitions/{competitionId:int}/dec-form-config")]
    [Authorize]
    public async Task<ActionResult<DecFormConfigDto>> Get(int competitionId)
    {
        var competition = await db.Competitions.AsNoTracking().FirstOrDefaultAsync(c => c.Id == competitionId);
        if (competition is null) return NotFound();
        return await DtoAsync(competition.Id, competition.DecFormConfigJson);
    }

    [HttpPut("api/competitions/{competitionId:int}/dec-form-config")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<DecFormConfigDto>> Put(int competitionId, DecFormConfig config)
    {
        if (config.Validate() is { } problem) return BadRequest(new { message = problem });
        var competition = await db.Competitions.FirstOrDefaultAsync(c => c.Id == competitionId);
        if (competition is null) return NotFound();
        var pinnedClubId = await PayoutClubAsync(competition.DecFormConfigJson, competition.CreatedByUserId);
        competition.DecFormConfigJson = (config.Normalised() with { PayoutClubId = pinnedClubId }).ToJson();
        await db.SaveChangesAsync();
        return await DtoAsync(competitionId, competition.DecFormConfigJson);
    }

    /// <summary>Goes back to the standard form.</summary>
    [HttpDelete("api/competitions/{competitionId:int}/dec-form-config")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<ActionResult<DecFormConfigDto>> Reset(int competitionId)
    {
        var competition = await db.Competitions.FirstOrDefaultAsync(c => c.Id == competitionId);
        if (competition is null) return NotFound();
        var pinnedClubId = await PayoutClubAsync(competition.DecFormConfigJson, competition.CreatedByUserId);
        competition.DecFormConfigJson = pinnedClubId is null ? null
            : (DecFormConfig.Standard with { PayoutClubId = pinnedClubId }).ToJson();
        await db.SaveChangesAsync();
        return await DtoAsync(competitionId, competition.DecFormConfigJson);
    }

    /// <summary>Teams whose dec form broke a rule, for the people who run the competition. Rider names appear in the sentences, so staff only.</summary>
    [HttpGet("api/competitions/{competitionId:int}/dec-form-flags")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public async Task<IEnumerable<TeamFlagsDto>> Flags(int competitionId)
    {
        var rows = await db.RiderEntries.AsNoTracking()
            .Where(r => r.DeclarationForm!.Team!.CompetitionId == competitionId && r.FlagsJson != null && r.FlagsJson != "[]")
            .Select(r => new { r.DeclarationFormId, r.DeclarationForm!.TeamId, TeamName = r.DeclarationForm.Team!.DisplayName, r.FlagsJson })
            .ToListAsync();
        return rows.GroupBy(r => (r.TeamId, r.TeamName, r.DeclarationFormId))
            .Select(g => new TeamFlagsDto(g.Key.TeamId, g.Key.TeamName, g.Key.DeclarationFormId,
                g.SelectMany(r => DecFormRules.ReadFlags(r.FlagsJson) ?? []).ToList()))
            .OrderBy(t => t.TeamName).ToList();
    }

    private async Task<int?> PayoutClubAsync(string? json, string? ownerId)
    {
        var pinned = DecFormConfig.Parse(json)?.PayoutClubId;
        return pinned ?? await db.Users.Where(u => u.Id == ownerId).Select(u => u.ClubId).FirstOrDefaultAsync();
    }

    private async Task<DecFormConfigDto> DtoAsync(int competitionId, string? json)
    {
        var parsed = DecFormConfig.Parse(json);
        var count = await db.DeclarationForms.CountAsync(f => f.Team!.CompetitionId == competitionId);
        var isStandard = parsed is null || (parsed with { PayoutClubId = null }).ToJson() == DecFormConfig.Standard.ToJson();
        return new DecFormConfigDto(parsed ?? DecFormConfig.Standard, isStandard, count);
    }
}
