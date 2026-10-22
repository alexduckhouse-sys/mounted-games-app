using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Services.Email;

namespace MountedGames.Api.Controllers;

public record UnsubscribeRequest(string? Token);

[ApiController]
public class EmailOptInsController(AppDbContext db, EmailOptInService optIns) : ControllerBase
{
    /// <summary>
    /// Opened from the link in an email. No sign-in. Always answers the same way, whether the token matched
    /// something, matched something already unsubscribed, or was made up, so it can't be used to find out who is
    /// on the list. Unsubscribing twice is harmless.
    /// </summary>
    [HttpPost("api/email/unsubscribe")]
    [AllowAnonymous]
    public async Task<IActionResult> Unsubscribe(UnsubscribeRequest req, CancellationToken ct)
    {
        await optIns.UnsubscribeAsync(req.Token, ct);
        return Ok(new { ok = true });
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
