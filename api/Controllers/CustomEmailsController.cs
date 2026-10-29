using MountedGames.Api.Security;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Services.Email;
using MountedGames.Api.Services.Sponsors;

namespace MountedGames.Api.Controllers;

/// <summary>
/// Custom emails from site admins to an audience (news list, trainers, organisers and admins), written as blocks: text,
/// picture, button and competition card. Preview and test never touch the list. Sending is two steps, because the API has
/// no queue: <c>POST</c> freezes the email and the recipient list, then the page calls <c>send-batch</c> until
/// <c>remaining</c> is 0 (see <see cref="CustomEmailService"/>). Nothing here logs an address or a body.
/// </summary>
[ApiController]
public sealed class CustomEmailsController(AppDbContext db, CustomEmailService emails) : ControllerBase
{
    private string? UserId => User.FindFirstValue(ClaimTypes.NameIdentifier);

    [HttpGet("api/admin/custom-emails/audiences")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<IReadOnlyList<CustomEmailAudienceDto>>> Audiences(CancellationToken ct)
        => await emails.AudiencesAsync(ct);

    [HttpPost("api/admin/custom-emails/preview")]
    [Authorize(Roles = Roles.Admin)]
    public Task<ActionResult<CustomEmailPreviewDto>> Preview(CustomEmailContentRequest request, CancellationToken ct)
        => RunAsync(() => emails.PreviewAsync(request, ct));

    /// <summary>Sends the email to the signed-in admin's own address only, marked [Test].</summary>
    [EnableRateLimiting(RequestLimits.EmailResendPolicy)]
    [HttpPost("api/admin/custom-emails/test")]
    [Authorize(Roles = Roles.Admin)]
    public Task<ActionResult<CustomEmailTestDto>> Test(CustomEmailContentRequest request, CancellationToken ct)
        => RunAsync(async () => new CustomEmailTestDto(await emails.SendTestAsync(request, User.FindFirstValue(ClaimTypes.Email) ?? User.FindFirstValue("email"), ct)));

    [HttpGet("api/admin/custom-emails")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<IReadOnlyList<CustomEmailDto>>> List(CancellationToken ct) => await emails.ListAsync(ct);

    [HttpGet("api/admin/custom-emails/{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public Task<ActionResult<CustomEmailDetailDto>> Get(int id, CancellationToken ct)
        => RunAsync(async () => { var (email, blocks) = await emails.GetAsync(id, ct); return new CustomEmailDetailDto(email, blocks); });

    /// <summary>Freezes the email and its recipients and returns it, ready for <c>send-batch</c>. Nothing is mailed yet.</summary>
    [HttpPost("api/admin/custom-emails")]
    [Authorize(Roles = Roles.Admin)]
    public Task<ActionResult<CustomEmailDto>> Create(SendCustomEmailRequest request, CancellationToken ct)
        => RunAsync(async () => (await emails.ToDtosAsync([await emails.CreateAsync(request, UserId, ct)], ct))[0]);

    /// <summary>Mails the next few people and says how many are left. Call it again until <c>remaining</c> is 0.</summary>
    [HttpPost("api/admin/custom-emails/{id:int}/send-batch")]
    [Authorize(Roles = Roles.Admin)]
    public Task<ActionResult<CustomEmailDto>> SendBatch(int id, CancellationToken ct)
        => RunAsync(async () => (await emails.ToDtosAsync([await emails.SendBatchAsync(id, ct)], ct))[0]);

    [HttpPost("api/admin/custom-emails/{id:int}/cancel")]
    [Authorize(Roles = Roles.Admin)]
    public Task<ActionResult<CustomEmailDto>> Cancel(int id, CancellationToken ct)
        => RunAsync(async () => (await emails.ToDtosAsync([await emails.CancelAsync(id, ct)], ct))[0]);

    [HttpPost("api/admin/custom-emails/{id:int}/retry-failed")]
    [Authorize(Roles = Roles.Admin)]
    public Task<ActionResult<CustomEmailDto>> RetryFailed(int id, CancellationToken ct)
        => RunAsync(async () => (await emails.ToDtosAsync([await emails.RetryFailedAsync(id, ct)], ct))[0]);

    // ---- pictures ----

    /// <summary>
    /// Uploads a picture. The body is the image itself; its Content-Type must be png, jpeg or webp and its first bytes must
    /// agree (never SVG). 500 KB at most. The returned <c>id</c> goes in a picture block.
    /// </summary>
    [HttpPost("api/admin/custom-email-images")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<CustomEmailImageDto>> UploadImage(CancellationToken ct)
    {
        var declared = Request.ContentType?.Split(';')[0].Trim().ToLowerInvariant();
        if (declared is null || !SponsorLogos.ContentTypes.Contains(declared))
            return StatusCode(StatusCodes.Status415UnsupportedMediaType, new { message = "The picture must be a PNG, JPEG or WebP image." });
        if (Request.ContentLength > CustomEmailImage.MaxBytes)
            return StatusCode(StatusCodes.Status413PayloadTooLarge, new { message = "The picture must be 500 KB or smaller." });

        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int read;
        while ((read = await Request.Body.ReadAsync(chunk.AsMemory(), ct)) > 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > CustomEmailImage.MaxBytes)
                return StatusCode(StatusCodes.Status413PayloadTooLarge, new { message = "The picture must be 500 KB or smaller." });
        }
        try
        {
            var image = await emails.AddImageAsync(buffer.ToArray(), declared, UserId, ct);
            return new CustomEmailImageDto(image.Id, $"/api/email-images/{image.Id:D}", image.Bytes.Length);
        }
        catch (CustomEmailException ex) { return Problem(statusCode: ex.StatusCode, title: "Picture not saved", detail: ex.Message); }
    }

    /// <summary>
    /// A picture in an email. Anyone with the link can fetch it, which is what a mail app needs. The id is a random GUID,
    /// so it can't be guessed, and it is served with the type judged from its bytes.
    /// </summary>
    [HttpGet("api/email-images/{id:guid}")]
    [AllowAnonymous]
    [EnableRateLimiting("public-read")]
    [PublicRead]
    public async Task<IActionResult> Image(Guid id, CancellationToken ct)
    {
        var image = await db.CustomEmailImages.AsNoTracking().Where(i => i.Id == id).Select(i => new { i.Bytes, i.ContentType }).FirstOrDefaultAsync(ct);
        if (image is null) return NotFound();
        Response.Headers.CacheControl = "public, max-age=86400";
        Response.Headers.XContentTypeOptions = "nosniff";
        return File(image.Bytes, image.ContentType);
    }

    private async Task<ActionResult<T>> RunAsync<T>(Func<Task<T>> action)
    {
        try { return await action(); }
        catch (CustomEmailException ex)
        {
            if (ex.Problems.Count == 0) return Problem(statusCode: ex.StatusCode, title: "Email not sent", detail: ex.Message);
            return StatusCode(ex.StatusCode, new { message = ex.Message, problems = ex.Problems });
        }
    }
}
