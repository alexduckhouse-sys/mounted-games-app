using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MountedGames.Api.Auth;
using MountedGames.Api.Security;
using MountedGames.Api.Data;
using MountedGames.Api.Services.Email;

namespace MountedGames.Api.Controllers;

public record UnsubscribeRequest(string? Token);
public record EmailTestRequest(string? To = null);

[ApiController]
public class EmailOptInsController(
    AppDbContext db,
    EmailOptInService optIns,
    IOptions<EmailOptions> emailOptions,
    IEmailSender sender) : ControllerBase
{
    /// <summary>
    /// Opened from the link in an email. No sign-in. Always answers the same way, whether the token matched
    /// something, matched something already unsubscribed, or was made up, so it can't be used to find out who is
    /// on the list. Unsubscribing twice is harmless.
    /// </summary>
    [EnableRateLimiting(RequestLimits.UnsubscribePolicy)]
    [HttpPost("api/email/unsubscribe")]
    [AllowAnonymous]
    public async Task<IActionResult> Unsubscribe(UnsubscribeRequest req, CancellationToken ct)
    {
        await optIns.UnsubscribeAsync(req.Token, ct);
        return Ok(new { ok = true });
    }

    /// <summary>Site admins only: whether Resend email delivery is enabled and configured, with a masked sender address (never the API key).</summary>
    [HttpGet("api/admin/email-status")]
    [Authorize(Roles = Roles.Admin)]
    public IActionResult Status()
    {
        var o = emailOptions.Value;
        return Ok(new
        {
            enabled = o.Enabled,
            configured = o.IsConfigured,
            fromMasked = string.IsNullOrWhiteSpace(o.From) ? null : MaskFrom(o.From),
        });
    }

    /// <summary>Site admins only: sends a short test email to the signed-in admin (or an explicit address) and reports the delivery status.</summary>
    [HttpPost("api/admin/email-test")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> SendTest(
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] EmailTestRequest? req = null,
        CancellationToken ct = default)
    {
        var rawTo = !string.IsNullOrWhiteSpace(req?.To) ? req.To : User.FindFirstValue(ClaimTypes.Email);
        if (!EmailAddresses.TryNormalise(rawTo, out var to))
            return BadRequest(new { message = "Enter a valid email address." });

        const string text = """
            Hello,

            This is a test email from Mounted Games Site Admin. Resend email delivery is working.

            Mounted Games
            """;
        var html = EmailHtml.Wrap("""
            <p style="margin:0 0 12px;">Hello,</p>
            <p style="margin:0;">This is a test email from Mounted Games Site Admin. Resend email delivery is working.</p>
            """);
        var status = await sender.SendAsync(new EmailMessage(to, "Mounted Games test email", text, html), ct);
        return Ok(new { status = status.ToString(), recipientMasked = EmailAddresses.Mask(to) });
    }

    private static string MaskFrom(string from)
    {
        var trimmed = from.Trim();
        var open = trimmed.IndexOf('<');
        var close = trimmed.IndexOf('>', open + 1);
        var addr = open >= 0 && close > open + 1 ? trimmed[(open + 1)..close].Trim() : trimmed;
        return EmailAddresses.Mask(addr);
    }

    /// <summary>
    /// Everyone currently opted in, one row per address (their earliest active consent), for loading into a
    /// mailing tool. Site admins only; the addresses are not shown anywhere else.
    /// </summary>
    [HttpGet("api/admin/email-opt-ins.csv")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Export(CancellationToken ct)
    {
        var rows = await db.EmailOptIns.AsNoTracking()
            .Where(o => o.UnsubscribedAt == null)
            .OrderBy(o => o.ConsentedAt).ThenBy(o => o.Id)
            .Select(o => new { o.Email, o.ConsentedAt, o.WordingVersion, o.Source })
            .ToListAsync(ct);
        var sb = new StringBuilder("Email,Consented at (UTC),Wording version,Source\r\n");
        foreach (var r in rows.DistinctBy(r => r.Email))
        {
            sb.Append(Cell(r.Email)).Append(',')
              .Append(r.ConsentedAt.ToString("yyyy-MM-ddTHH:mm:ssZ")).Append(',')
              .Append(Cell(r.WordingVersion)).Append(',')
              .Append(Cell(r.Source)).Append("\r\n");
        }
        Response.Headers.CacheControl = "no-store";
        return File(Encoding.UTF8.GetBytes(sb.ToString()), "text/csv; charset=utf-8", "email-opt-ins.csv");
    }

    /// <summary>Quotes a value, and stops a spreadsheet reading a leading = + - @ as a formula.</summary>
    private static string Cell(string value)
    {
        if (value.Length > 0 && value[0] is '=' or '+' or '-' or '@' or '\t' or '\r') value = "'" + value;
        return value.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? "\"" + value.Replace("\"", "\"\"") + "\"" : value;
    }
}
