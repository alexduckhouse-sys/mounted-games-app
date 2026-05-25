using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
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

    private const int MaxImageBase64Bytes = 700_000; // ≈500 KB image when base64-encoded

    [HttpGet("posts")]
    [AllowAnonymous]
    public async Task<IEnumerable<ShopPostDto>> List([FromQuery] int take = 50, [FromQuery] bool includeDeleted = false)
    {
        take = Math.Clamp(take, 1, 200);
        var isAdmin = User.IsInRole(Roles.Admin);
        var q = _db.ShopPosts.Include(p => p.Comments).Include(p => p.Reports).AsQueryable();
        if (!includeDeleted || !isAdmin) q = q.Where(p => !p.IsDeleted);
        var rows = await q.OrderByDescending(p => p.CreatedAt).Take(take).ToListAsync();
        return rows.Select(r => r.ToDto());
    }

    [HttpGet("posts/{id:int}")]
    [AllowAnonymous]
    public async Task<ActionResult<ShopPostDto>> Get(int id)
    {
        var p = await _db.ShopPosts
            .Include(x => x.Comments).Include(x => x.Reports)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (p is null) return NotFound();
        if (p.IsDeleted && !User.IsInRole(Roles.Admin)) return NotFound();
        return p.ToDto();
    }

    [HttpPost("posts")]
    [Authorize]
    public async Task<ActionResult<ShopPostDto>> Create(CreateShopPostRequest req)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        if (!string.IsNullOrEmpty(ip) && await _db.IpBlocks.AnyAsync(b => b.IpAddress == ip))
            return StatusCode(403, new { message = "Posting from this network is blocked." });
        var title = req.Title?.Trim();
        var body = req.Body?.Trim();
        var name = req.AuthorName?.Trim();
        if (string.IsNullOrEmpty(title) || string.IsNullOrEmpty(body) || string.IsNullOrEmpty(name))
            return BadRequest(new { message = "Title, body and your name are all required." });
        var image = req.ImageBase64;
        if (!string.IsNullOrEmpty(image))
        {
            if (image.Length > MaxImageBase64Bytes)
                return BadRequest(new { message = "Image is too large — please resize to under 500 KB." });
        }
        var post = new ShopPost
        {
            AuthorUserId = userId,
            AuthorName = name.Length > 150 ? name[..150] : name,
            PonyClubName = req.PonyClubName?.Trim(),
            Title = title.Length > 200 ? title[..200] : title,
            Body = body.Length > 4000 ? body[..4000] : body,
            PriceMinor = req.PriceMinor.HasValue && req.PriceMinor.Value >= 0 ? req.PriceMinor : null,
            ContactInfo = req.ContactInfo?.Trim(),
            ImageBase64 = string.IsNullOrEmpty(image) ? null : image,
            IpAddress = ip,
        };
        _db.ShopPosts.Add(post);
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
    public async Task<IEnumerable<ShopCommentDto>> Comments(int id)
    {
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var isAdmin = User.IsInRole(Roles.Admin);
        var post = await _db.ShopPosts.FindAsync(id);
        if (post is null) return Array.Empty<ShopCommentDto>();
        var rows = await _db.ShopComments
            .Where(c => c.PostId == id && !c.IsDeleted)
            .OrderBy(c => c.CreatedAt)
            .ToListAsync();
        // Private comments are visible only to: their author, the named ToUserId,
        // the post author, and admins.
        return rows.Where(c => !c.IsPrivate
                || isAdmin
                || c.AuthorUserId == userId
                || c.ToUserId == userId
                || post.AuthorUserId == userId)
            .Select(c => c.ToDto());
    }

    [HttpPost("posts/{id:int}/comments")]
    [Authorize]
    public async Task<ActionResult<ShopCommentDto>> Comment(int id, CreateShopCommentRequest req)
    {
        var post = await _db.ShopPosts.FindAsync(id);
        if (post is null || post.IsDeleted) return NotFound();
        var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var body = req.Body?.Trim();
        var name = req.AuthorName?.Trim();
        if (string.IsNullOrEmpty(body) || string.IsNullOrEmpty(name))
            return BadRequest(new { message = "Comment body and your name required." });
        var c = new ShopComment
        {
            PostId = id,
            AuthorUserId = userId,
            AuthorName = name.Length > 150 ? name[..150] : name,
            Body = body.Length > 2000 ? body[..2000] : body,
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

    [HttpPost("posts/{id:int}/report")]
    [AllowAnonymous]
    public async Task<IActionResult> Report(int id, CreateShopReportRequest req)
    {
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
