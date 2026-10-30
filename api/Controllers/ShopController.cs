using MountedGames.Api.Services.Accounts;
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

[ApiController]
[Route("api/shop")]
public class ShopController : ControllerBase
{
    private readonly AppDbContext _db;
    public ShopController(AppDbContext db) => _db = db;

    // Only a plain inline picture: never an external URL (a tracking pixel) or an SVG, which can carry script.
    private static readonly System.Text.RegularExpressions.Regex ImageDataUrl =
        new(@"^data:image/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]*$", System.Text.RegularExpressions.RegexOptions.Compiled | System.Text.RegularExpressions.RegexOptions.CultureInvariant);
    private const string BadImageMessage = "That image isn't a supported picture. Use a JPEG, PNG, WebP or GIF.";
    private const int MaxImageBase64Bytes = 700_000; // ≈500 KB image when base64-encoded

    private static bool IsSupportedImage(string value)
    {
        if (!ImageDataUrl.IsMatch(value)) return false;
        var comma = value.IndexOf(',');
        byte[] bytes;
        try { bytes = Convert.FromBase64String(value[(comma + 1)..]); }
        catch (FormatException) { return false; }
        var actual = Services.Sponsors.SponsorLogos.Detect(bytes);
        if (bytes.Length >= 6 && (bytes.AsSpan(0, 6).SequenceEqual("GIF87a"u8) || bytes.AsSpan(0, 6).SequenceEqual("GIF89a"u8)))
            actual = "image/gif";
        return actual is not null && value[..comma] == $"data:{actual};base64";
    }

    [HttpGet("posts")]
    [AllowAnonymous]
    [PublicRead]
    [EnableRateLimiting("public-read")]
    public async Task<IEnumerable<ShopPostDto>> List([FromQuery] int take = 50, [FromQuery] bool includeDeleted = false, [FromQuery] string? imageMode = null)
    {
        take = Math.Clamp(take, 1, 200);
        var isAdmin = User.IsInRole(Roles.Admin);
        var q = _db.ShopPosts.AsNoTracking();
        if (!includeDeleted || !isAdmin) q = q.Where(p => !p.IsDeleted);
        return await Summaries(q.OrderByDescending(p => p.CreatedAt).Take(take), imageMode == "urls", User.Identity?.IsAuthenticated == true).ToListAsync(HttpContext.RequestAborted);
    }

    [HttpGet("posts/{id:int}")]
    [AllowAnonymous]
    [PublicRead]
    [EnableRateLimiting("public-read")]
    public async Task<ActionResult<ShopPostDto>> Get(int id, [FromQuery] string? imageMode = null)
    {
        var p = await Summaries(_db.ShopPosts.AsNoTracking().Where(x => x.Id == id), imageMode == "urls", User.Identity?.IsAuthenticated == true)
            .FirstOrDefaultAsync(HttpContext.RequestAborted);
        if (p is null) return NotFound();
        if (p.IsDeleted && !User.IsInRole(Roles.Admin)) return NotFound();
        return p;
    }

    private static IQueryable<ShopPostDto> Summaries(IQueryable<ShopPost> posts, bool imageUrls, bool includeAuthorId)
        => posts.Select(p => new ShopPostDto(p.Id, p.AuthorName, p.PonyClubName, includeAuthorId ? p.AuthorUserId : null,
            p.Title, p.Body, p.PriceMinor, p.ContactInfo,
            imageUrls ? (p.ImageBase64 != null ? "/api/shop/posts/" + p.Id + "/images/0" : null) : p.ImageBase64,
            p.CreatedAt, p.IsDeleted, p.Comments.Count(c => !c.IsDeleted && !c.IsPrivate), p.Reports.Count));

    // Revalidate on every use so moderation/deletion and replacement also apply to saved URLs.
    [HttpGet("posts/{id:int}/images/0")]
    [AllowAnonymous]
    [PublicRead]
    [EnableRateLimiting("public-read")]
    public async Task<IActionResult> Image(int id)
    {
        Response.Headers.CacheControl = "private, no-cache";
        var isAdmin = User.IsInRole(Roles.Admin);
        var data = await _db.ShopPosts.AsNoTracking().Where(p => p.Id == id && (!p.IsDeleted || isAdmin))
            .Select(p => p.ImageBase64).FirstOrDefaultAsync(HttpContext.RequestAborted);
        if (string.IsNullOrEmpty(data) || data.Length > MaxImageBase64Bytes || !IsSupportedImage(data)) return NotFound();
        var comma = data.IndexOf(',');
        byte[] bytes;
        try { bytes = Convert.FromBase64String(data[(comma + 1)..]); }
        catch (FormatException) { return NotFound(); }
        var contentType = data[5..data.IndexOf(';')];
        var etag = new Microsoft.Net.Http.Headers.EntityTagHeaderValue(
            $"\"{Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes))}\"");
        return File(bytes, contentType, lastModified: null, entityTag: etag);
    }

    [HttpPost("posts")]
    [Authorize]
    public async Task<ActionResult<ShopPostDto>> Create(CreateShopPostRequest req)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        if (await _db.IsIpBlockedAsync(HttpContext))
            return StatusCode(403, new { message = "Posting from this network is blocked." });
        var title = req.Title?.Trim();
        var body = (req.Body ?? req.Description)?.Trim();
        var name = req.AuthorName?.Trim();
        if (string.IsNullOrEmpty(title) || string.IsNullOrEmpty(body) || string.IsNullOrEmpty(name))
            return BadRequest(new { message = "Title, body and your name are all required." });
        if (title.Length > 200 || body.Length > 4000 || req.Description?.Length > 4000)
            return BadRequest(new { message = "Title must be 200 characters or fewer and description 4000 or fewer." });
        if (req.PriceMinor is < 0 or > 100_000_000)
            return BadRequest(new { message = "Price must be zero or positive." });
        var image = req.ImageBase64;
        if (image is { Length: > MaxImageBase64Bytes })
            return BadRequest(new { message = "Image is too large (max ~500 KB after compression)." });
        if (!string.IsNullOrEmpty(image) && !IsSupportedImage(image))
            return BadRequest(new { message = BadImageMessage });
        var post = new ShopPost
        {
            AuthorUserId = userId,
            AuthorName = name.Length > 150 ? name[..150] : name,
            PonyClubName = req.PonyClubName?.Trim(),
            Title = ProfanityFilter.Clean(title),
            Body = ProfanityFilter.Clean(body),
            PriceMinor = req.PriceMinor,
            ContactInfo = req.ContactInfo?.Trim(),
            ImageBase64 = string.IsNullOrEmpty(image) ? null : image,
            IpAddress = ip,
        };
        _db.ShopPosts.Add(post);
        await _db.SaveChangesAsync();
        return post.ToDto();
    }

    [HttpPut("posts/{id:int}")]
    [Authorize]
    public async Task<ActionResult<ShopPostDto>> Update(int id, UpdateShopPostRequest req)
    {
        if (await _db.IsIpBlockedAsync(HttpContext))
            return StatusCode(403, new { message = "Posting from this network is blocked." });
        if (req.ImageBase64 is { Length: > MaxImageBase64Bytes })
            return BadRequest(new { message = "Image is too large (max ~500 KB after compression)." });
        if (!string.IsNullOrEmpty(req.ImageBase64) && !IsSupportedImage(req.ImageBase64))
            return BadRequest(new { message = BadImageMessage });
        if (req.PriceMinor is < 0 or > 100_000_000)
            return BadRequest(new { message = "Price must be zero or positive." });

        var title = req.Title?.Trim();
        var body = (req.Body ?? req.Description)?.Trim();
        if (title is { Length: > 200 } || body is { Length: > 4000 } || req.Description?.Length > 4000)
            return BadRequest(new { message = "Title must be 200 characters or fewer and description 4000 or fewer." });

        var post = await _db.ShopPosts
            .Include(p => p.Comments).Include(p => p.Reports)
            .FirstOrDefaultAsync(p => p.Id == id);
        if (post is null || post.IsDeleted) return NotFound();
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var canEdit = User.IsInRole(Roles.Admin) || (!string.IsNullOrEmpty(userId) && post.AuthorUserId == userId);
        if (!canEdit) return Forbid();

        if (!string.IsNullOrEmpty(title)) post.Title = ProfanityFilter.Clean(title);
        if (!string.IsNullOrEmpty(body)) post.Body = ProfanityFilter.Clean(body);
        if (req.PriceMinor.HasValue) post.PriceMinor = req.PriceMinor;
        if (req.ContactInfo is not null) post.ContactInfo = req.ContactInfo.Trim();
        if (req.PonyClubName is not null) post.PonyClubName = req.PonyClubName.Trim();
        if (req.ImageBase64 is not null) post.ImageBase64 = string.IsNullOrEmpty(req.ImageBase64) ? null : req.ImageBase64;
        await _db.SaveChangesAsync();
        return post.ToDto();
    }

    [HttpDelete("posts/{id:int}")]
    [Authorize]
    public async Task<IActionResult> Delete(int id)
    {
        var post = await _db.ShopPosts.FindAsync(id);
        if (post is null) return NotFound();
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var canRemove = User.IsInRole(Roles.Admin) || post.AuthorUserId == userId;
        if (!canRemove) return Forbid();
        post.IsDeleted = true;
        post.DeletedAt = DateTime.UtcNow;
        post.DeletedByUserId = userId;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("posts/{id:int}/comments")]
    [AllowAnonymous]
    [PublicRead]
    [EnableRateLimiting("public-read")]
    public async Task<IEnumerable<ShopCommentDto>> Comments(int id)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var isAdmin = User.IsInRole(Roles.Admin);
        var post = await _db.ShopPosts.FindAsync(id);
        if (post is null || (post.IsDeleted && !isAdmin)) return Array.Empty<ShopCommentDto>();
        var rows = await _db.ShopComments
            .Where(c => c.PostId == id && !c.IsDeleted)
            .OrderBy(c => c.CreatedAt)
            .ToListAsync();
        // Private comments are visible only to: their author, the named ToUserId,
        // the post author, and admins.
        return rows.Where(c => !c.IsPrivate
                || isAdmin
                || (!string.IsNullOrEmpty(userId) && (c.AuthorUserId == userId
                || c.ToUserId == userId
                || post.AuthorUserId == userId)))
            .Select(c => string.IsNullOrEmpty(userId) ? c.ToDto() with { AuthorUserId = null, ToUserId = null } : c.ToDto());
    }

    [HttpPost("posts/{id:int}/comments")]
    [Authorize]
    public async Task<ActionResult<ShopCommentDto>> Comment(int id, CreateShopCommentRequest req)
    {
        if (await _db.IsIpBlockedAsync(HttpContext, HttpContext.RequestAborted))
            return StatusCode(403, new { message = "Posting from this network is blocked." });

        var post = await _db.ShopPosts.FindAsync(id);
        if (post is null || post.IsDeleted) return NotFound();
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var body = req.Body?.Trim();
        var name = req.AuthorName?.Trim();
        if (string.IsNullOrEmpty(body) || string.IsNullOrEmpty(name))
            return BadRequest(new { message = "Comment body and your name required." });
        if (body.Length > 1000)
            return BadRequest(new { message = "Comment must be 1000 characters or fewer." });
        var c = new ShopComment
        {
            PostId = id,
            AuthorUserId = userId,
            AuthorName = name.Length > 150 ? name[..150] : name,
            Body = ProfanityFilter.Clean(body),
            IsPrivate = req.IsPrivate,
            ToUserId = req.IsPrivate ? (req.ToUserId ?? post.AuthorUserId) : null,
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
        };
        _db.ShopComments.Add(c);
        await _db.SaveChangesAsync();
        return c.ToDto();
    }

    [HttpDelete("comments/{commentId:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteComment(int commentId)
    {
        var c = await _db.ShopComments.FindAsync(commentId);
        if (c is null) return NotFound();
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (!(User.IsInRole(Roles.Admin) || c.AuthorUserId == userId)) return Forbid();
        c.IsDeleted = true;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [EnableRateLimiting(RequestLimits.ShopReportPolicy)]
    [HttpPost("posts/{id:int}/report")]
    [AllowAnonymous]
    public async Task<IActionResult> Report(int id, CreateShopReportRequest req)
    {
        if (await _db.IsIpBlockedAsync(HttpContext, HttpContext.RequestAborted))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Reporting from this network is blocked." });
        if (req.Reason is not null && req.Reason.Trim().Length > 1000)
            return BadRequest(new { message = "Report reason must be 1000 characters or fewer." });
        var post = await _db.ShopPosts.FindAsync(id);
        if (post is null) return NotFound();
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        _db.ShopReports.Add(new ShopReport
        {
            PostId = id,
            ReporterUserId = userId,
            Reason = req.Reason?.Trim(),
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
        });
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
