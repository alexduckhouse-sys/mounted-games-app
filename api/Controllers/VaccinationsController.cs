using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Services.EventTools;
using MountedGames.Api.Services.Vaccinations;
namespace MountedGames.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/event-tools/competitions/{competitionId:int}/passport-check/vaccinations")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class VaccinationsController(VaccinationService service) : ControllerBase
{
    [HttpGet]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<VaccinationBoardDto>> Board(int competitionId, CancellationToken ct) => Run(() => service.BoardAsync(competitionId, null, ct));
    [HttpPut("settings")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<VaccinationSettingsDto>> Settings(int competitionId, SaveVaccinationSettingsRequest request, CancellationToken ct) =>
        Run(() => service.SaveSettingsAsync(competitionId, request, User, ct));
    [HttpGet("riders/{riderId:int}/mine")]
    public Task<ActionResult<VaccinationBoardDto>> Mine(int competitionId, int riderId, CancellationToken ct) => Run(async () =>
    {
        await service.RequireEntrantAsync(competitionId, riderId, User, ct);
        return await service.BoardAsync(competitionId, riderId, ct);
    });
    [HttpPut("riders/{riderId:int}/mine")]
    public Task<ActionResult<VaccinationPonyDto>> Supplied(int competitionId, int riderId, SaveVaccinationEvidenceRequest request, CancellationToken ct) => Run(async () =>
    {
        await service.RequireEntrantAsync(competitionId, riderId, User, ct);
        return await service.SaveEvidenceAsync(competitionId, riderId, request, false, User, ct);
    });
    [HttpPut("riders/{riderId:int}/evidence")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<VaccinationPonyDto>> Evidence(int competitionId, int riderId, SaveVaccinationEvidenceRequest request, CancellationToken ct) =>
        Run(() => service.SaveEvidenceAsync(competitionId, riderId, request, true, User, ct));
    [HttpPut("riders/{riderId:int}/horse")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<VaccinationPonyDto>> Link(int competitionId, int riderId, LinkVaccinationHorseRequest request, CancellationToken ct) =>
        Run(() => service.LinkAsync(competitionId, riderId, request, ct));
    [HttpPost("riders/{riderId:int}/inspection")]
    [Authorize(Policy = CompetitionStaff.Policy)]
    [CompetitionAccess("competitionId")]
    public Task<ActionResult<VaccinationPonyDto>> Inspect(int competitionId, int riderId, InspectVaccinationRequest request, CancellationToken ct) =>
        Run(() => service.InspectAsync(competitionId, riderId, request, User, ct));
    private async Task<ActionResult<T>> Run<T>(Func<Task<T>> action)
    {
        Response.Headers.CacheControl = "private, no-store";
        try { return await action(); }
        catch (EventToolsException ex) { return Problem(statusCode: ex.StatusCode, title: "Passport check", detail: ex.Message); }
    }
}
