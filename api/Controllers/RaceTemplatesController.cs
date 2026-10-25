using System.Diagnostics.CodeAnalysis;
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
[Route("api/race-templates")]
public class RaceTemplatesController : ControllerBase
{
    private readonly AppDbContext _db;
    public RaceTemplatesController(AppDbContext db) => _db = db;

    [HttpGet]
    [AllowAnonymous]
    public async Task<IEnumerable<RaceTemplateDto>> List()
    {
        var rows = await _db.RaceTemplates.OrderBy(r => r.Name).ToListAsync();
        return rows.Select(ToDto);
    }

    [HttpGet("names")]
    [AllowAnonymous]
    [ExcludeFromCodeCoverage]
    public async Task<IReadOnlyList<string>> ListNames()
    {
        return await _db.RaceTemplates
            .AsNoTracking()
            .OrderBy(r => r.Name)
            .Select(r => r.Name)
            .ToListAsync();
    }

    [HttpGet("by-name/{name}")]
    [AllowAnonymous]
    [ExcludeFromCodeCoverage]
    public async Task<ActionResult<BuiltInRaceMetadata.RaceTemplateDetailDto>> GetByName(string name)
    {
        var trimmed = (name ?? string.Empty).Trim();
        if (trimmed.Length == 0) return NotFound();
        var lowered = trimmed.ToLower();
        var candidates = await _db.RaceTemplates
            .AsNoTracking()
            .Where(r => r.Name.ToLower() == lowered)
            .OrderBy(r => r.Id)
            .ToListAsync();
        var row = candidates.FirstOrDefault(r => r.Name == trimmed) ?? candidates.FirstOrDefault();
        if (row is not null)
            return BuiltInRaceMetadata.ToDetailDto(row);

        var builtIn = BuiltInRaceMetadata.FromBuiltInSeed(trimmed);
        return builtIn is not null ? builtIn : NotFound();
    }

    [HttpGet("{id:int}")]
    [AllowAnonymous]
    public async Task<ActionResult<RaceTemplateDto>> Get(int id)
    {
        var r = await _db.RaceTemplates.FindAsync(id);
        if (r is null) return NotFound();
        return ToDto(r);
    }

    [HttpPost]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<RaceTemplateDto>> Create(UpsertRaceTemplateRequest req)
    {
        var name = (req.Name ?? string.Empty).Trim();
        if (name.Length == 0) return BadRequest(new { message = "Name is required." });
        if (await _db.RaceTemplates.AnyAsync(r => r.Name == name))
            return Conflict(new { message = "A race with that name already exists." });
        var r = new RaceTemplate
        {
            Name = name,
            Summary = req.Summary?.Trim(),
            Rules = req.Rules?.Trim(),
            Category = req.Category?.Trim(),
            DiagramJson = string.IsNullOrWhiteSpace(req.DiagramJson) ? null : req.DiagramJson.Trim(),
            IsBuiltIn = false
        };
        _db.RaceTemplates.Add(r);
        await _db.SaveChangesAsync();
        return ToDto(r);
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<ActionResult<RaceTemplateDto>> Update(int id, UpsertRaceTemplateRequest req)
    {
        var r = await _db.RaceTemplates.FindAsync(id);
        if (r is null) return NotFound();
        var name = (req.Name ?? string.Empty).Trim();
        if (name.Length == 0) return BadRequest(new { message = "Name is required." });
        if (await _db.RaceTemplates.AnyAsync(x => x.Name == name && x.Id != id))
            return Conflict(new { message = "Another race already has that name." });
        r.Name = name;
        r.Summary = req.Summary?.Trim();
        r.Rules = req.Rules?.Trim();
        r.Category = req.Category?.Trim();
        r.DiagramJson = string.IsNullOrWhiteSpace(req.DiagramJson) ? null : req.DiagramJson.Trim();
        await _db.SaveChangesAsync();
        return ToDto(r);
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roles.Admin)]
    public async Task<IActionResult> Delete(int id)
    {
        var r = await _db.RaceTemplates.FindAsync(id);
        if (r is null) return NotFound();
        if (r.IsBuiltIn) return BadRequest(new { message = "Built-in races can't be deleted." });
        _db.RaceTemplates.Remove(r);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    private static RaceTemplateDto ToDto(RaceTemplate r) =>
        new(r.Id, r.Name, r.Summary, r.Rules, r.Category, r.DiagramJson, r.IsBuiltIn);
}
