using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MountedGames.Api.Auth;
using MountedGames.Api.Dtos;
using MountedGames.Api.Services.Email;

namespace MountedGames.Api.Controllers;

/// <summary>
/// Site admins only: the status card for the daily "entries are open" email, and its Send now button. The evening run
/// itself needs no one (see <see cref="EntriesDigestService"/>). Nothing here returns an address.
/// </summary>
[ApiController]
public sealed class EntriesDigestController(EntriesDigestService digest) : ControllerBase
{
    [HttpGet("api/admin/entries-digest")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<EntriesDigestStatusDto> Status(CancellationToken ct) => await digest.StatusAsync(ct);

    /// <summary>
    /// Starts today's email now, or carries on the one already started, and works one stretch of it. Call it again until the
    /// status shows no one left. A 409 says why nothing was sent (email off, nothing new, already gone, list changed).
    /// </summary>
    [HttpPost("api/admin/entries-digest/send")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<EntriesDigestStatusDto>> Send(SendEntriesDigestRequest request, CancellationToken ct)
    {
        if (!request.Confirm) return Problem(statusCode: 400, title: "Not sent", detail: "Confirm that you want to send this email.");
        try
        {
            await digest.SendNowAsync(request.ExpectedRecipients, ct);
        }
        catch (EntriesDigestException ex)
        {
            return Problem(statusCode: ex.StatusCode, title: "Not sent", detail: ex.Message);
        }
        return await digest.StatusAsync(ct);
    }
}
