using MountedGames.Api.Security;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MountedGames.Api.Services;

namespace MountedGames.Api.Controllers;

[ApiController]
public class EquipmentController : ControllerBase
{
    private readonly EquipmentCalculator _calc;
    public EquipmentController(EquipmentCalculator calc) => _calc = calc;

    public record EquipmentResponse(
        IReadOnlyList<EquipmentCalculator.EquipmentLine> Lines,
        int Sessions,
        int RacesCounted);

    /// <summary>Aggregated equipment list for a competition.</summary>
    [HttpGet("api/competitions/{competitionId:int}/equipment")]
    [AllowAnonymous]
    [PublicRead]
    [EnableRateLimiting("public-read")]
    public async Task<ActionResult<EquipmentResponse>> Compute(int competitionId)
    {
        var r = await _calc.ComputeAsync(competitionId);
        return new EquipmentResponse(r.Lines, r.Sessions, r.RacesCounted);
    }
}
