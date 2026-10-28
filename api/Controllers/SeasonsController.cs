using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Entities.Seasons;
using MountedGames.Api.Services.Seasons;

namespace MountedGames.Api.Controllers;

[ApiController]
[Route("api/seasons")]
public sealed class SeasonsController(AppDbContext db) : ControllerBase
{
    private const string SeasonOrganiserRoles = Roles.Organiser + "," + Roles.Manager;

    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<IReadOnlyList<SeasonDto>>> List(CancellationToken ct)
    {
        var seasons = await db.Set<Season>()
            .AsNoTracking()
            .Include(x => x.PlacePoints)
            .Include(x => x.Rounds).ThenInclude(x => x.Competition)
            .Include(x => x.Rounds).ThenInclude(x => x.CompetitionSection)
            .Include(x => x.Rounds).ThenInclude(x => x.Publications)
            .OrderByDescending(x => x.Year).ThenBy(x => x.Title)
            .ToListAsync(ct);
        var result = new List<SeasonDto>(seasons.Count);
        foreach (var season in seasons) result.Add(await ToDtoAsync(season, ct, checkCurrent: false));
        return result;
    }

    /// <summary>The seasons a competition counts towards, for the menu: no standings, so it stays small.</summary>
    [HttpGet("for-competition/{competitionId:int}")]
    [AllowAnonymous]
    public async Task<ActionResult<IReadOnlyList<SeasonLinkDto>>> ForCompetition(int competitionId, CancellationToken ct) =>
        await db.Set<Season>().AsNoTracking()
            .Where(x => x.Rounds.Any(r => r.CompetitionId == competitionId && r.IsIncluded))
            .OrderByDescending(x => x.Year).ThenBy(x => x.Title)
            .Select(x => new SeasonLinkDto(x.Id, x.Title, x.Year))
            .ToListAsync(ct);

    [HttpGet("{id:guid}")]
    [AllowAnonymous]
    public async Task<ActionResult<SeasonDto>> Get(Guid id, CancellationToken ct)
    {
        var season = await LoadSeasonAsync(id, ct);
        return season is null ? NotFound() : await ToDtoAsync(season, ct);
    }

    [HttpGet("{id:guid}/standings")]
    [AllowAnonymous]
    public async Task<ActionResult<SeasonStandingsDto>> Standings(Guid id, [FromQuery] string? ageGroup = null, [FromQuery] SectionFormat? format = null, CancellationToken ct = default)
    {
        if (format.HasValue && !Enum.IsDefined(format.Value)) return BadRequest();
        var standings = await SeasonStandingsCalculator.CalculateAsync(db, id, ct, ageGroup, format);
        return standings is null ? NotFound() : standings;
    }

    [HttpGet("available-competitions")]
    [Authorize(Roles = SeasonOrganiserRoles)]
    public async Task<ActionResult<IReadOnlyList<SeasonCompetitionOptionDto>>> AvailableCompetitions(CancellationToken ct)
    {
        var ownerId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(ownerId)) return Unauthorized();
        var isAdmin = User.IsInRole(Roles.Admin);
        return await db.Competitions.AsNoTracking()
            .Where(x => isAdmin || x.CreatedByUserId == ownerId)
            .OrderByDescending(x => x.StartDate).ThenBy(x => x.Id)
            .Select(x => new SeasonCompetitionOptionDto(x.Id, x.Name, x.StartDate)).ToListAsync(ct);
    }

    [HttpPost]
    [Authorize(Roles = SeasonOrganiserRoles)]
    public async Task<ActionResult<SeasonDto>> Create(CreateSeasonRequest request, CancellationToken ct)
    {
        var validation = Validate(request.Title, request.Year, request.Format, request.AgeGroup, request.BestResultsToCount, request.PlacePoints);
        if (validation is not null) return validation;
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return Unauthorized();

        var ageGroup = string.IsNullOrWhiteSpace(request.AgeGroup) ? "All age groups" : request.AgeGroup.Trim();
        var season = new Season
        {
            OwnerUserId = userId,
            Title = request.Title.Trim(),
            Year = request.Year,
            Format = request.Format,
            AgeGroup = ageGroup,
            BestResultsToCount = request.BestResultsToCount,
            PlacePoints = request.PlacePoints.OrderBy(x => x.Place)
                .Select(x => new SeasonPlacePoints { Place = x.Place, Points = x.Points }).ToList(),
        };
        var compIds = request.CompetitionIds?.Distinct().ToArray() ?? [];
        var secIds = request.CompetitionSectionIds?.Distinct().ToArray() ?? [];
        if (request.CompetitionIds?.Count > 1000 || request.CompetitionSectionIds?.Count > 1000 || compIds.Any(x => x <= 0) || secIds.Any(x => x <= 0))
            return BadRequest(new ProblemDetails { Status = 400, Title = "Choose up to 1000 competitions or sections with valid IDs" });
        if (compIds.Length > 0 || secIds.Length > 0)
        {
            var competitions = await db.Competitions.AsNoTracking().Where(x => compIds.Contains(x.Id)).ToListAsync(ct);
            if (competitions.Count != compIds.Length || competitions.Any(x => !CanManageCompetition(x.CreatedByUserId)))
                return NotFound();
            var candidateSections = await db.CompetitionSections.AsNoTracking()
                .Include(x => x.Competition)
                .Where(x => compIds.Contains(x.CompetitionId) || secIds.Contains(x.Id))
                .ToListAsync(ct);
            if (secIds.Any(id => candidateSections.All(x => x.Id != id))
                || candidateSections.Any(x => x.Competition is null || !CanManageCompetition(x.Competition.CreatedByUserId)))
                return NotFound();
            if (candidateSections.Count > 1000)
                return BadRequest(new ProblemDetails { Status = 400, Title = "Choose up to 1000 rounds" });
            season.Rounds = candidateSections.OrderBy(x => x.Competition!.StartDate).ThenBy(x => x.CompetitionId).ThenBy(x => x.Id)
                .Select((section, index) => new SeasonRound
                {
                    SeasonId = season.Id, CompetitionId = section.CompetitionId,
                    CompetitionSectionId = section.Id, OrderIndex = index + 1,
                }).ToList();
        }
        // Season and selected rounds are one atomic save, after every requested link has been authorised.
        db.Set<Season>().Add(season);
        await db.SaveChangesAsync(ct);

        var loaded = await LoadSeasonAsync(season.Id, ct) ?? season;
        return CreatedAtAction(nameof(Get), new { id = season.Id }, await ToDtoAsync(loaded, ct));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = SeasonOrganiserRoles)]
    public async Task<ActionResult<SeasonDto>> Update(Guid id, UpdateSeasonRequest request, CancellationToken ct)
    {
        var validation = Validate(request.Title, request.Year, request.Format, request.AgeGroup, request.BestResultsToCount, request.PlacePoints);
        if (validation is not null) return validation;
        var season = await db.Set<Season>()
            .Include(x => x.PlacePoints)
            .Include(x => x.Rounds).ThenInclude(x => x.CompetitionSection)
            .SingleOrDefaultAsync(x => x.Id == id, ct);
        if (season is null || !CanManage(season.OwnerUserId)) return NotFound();

        season.Title = request.Title.Trim();
        season.Year = request.Year;
        season.Format = request.Format;
        season.AgeGroup = string.IsNullOrWhiteSpace(request.AgeGroup) ? "All age groups" : request.AgeGroup.Trim();
        season.BestResultsToCount = request.BestResultsToCount;
        season.UpdatedAt = DateTime.UtcNow;
        db.Set<SeasonPlacePoints>().RemoveRange(season.PlacePoints);
        season.PlacePoints = request.PlacePoints.OrderBy(x => x.Place)
            .Select(x => new SeasonPlacePoints { SeasonId = season.Id, Place = x.Place, Points = x.Points }).ToList();
        await db.SaveChangesAsync(ct);
        return await ToDtoAsync((await LoadSeasonAsync(id, ct))!, ct);
    }

    [HttpPost("{id:guid}/rounds")]
    [Authorize(Roles = SeasonOrganiserRoles)]
    public async Task<ActionResult<SeasonRoundDto>> AddRound(Guid id, AddSeasonRoundRequest request, CancellationToken ct)
    {
        var season = await db.Set<Season>().Include(x => x.Rounds).SingleOrDefaultAsync(x => x.Id == id, ct);
        if (season is null || !CanManage(season.OwnerUserId)) return NotFound();
        var section = await db.CompetitionSections.Include(x => x.Competition)
            .SingleOrDefaultAsync(x => x.Id == request.CompetitionSectionId, ct);
        if (section?.Competition is null || !CanManageCompetition(section.Competition.CreatedByUserId)) return NotFound();
        if (season.Rounds.Any(x => x.CompetitionSectionId == section.Id))
            return Conflict(new ProblemDetails { Status = 409, Title = "Round already linked" });

        var multiplier = request.PointsMultiplier ?? 1.0;
        if (double.IsNaN(multiplier) || double.IsInfinity(multiplier) || multiplier is < 0.1 or > 10)
            return BadRequest(new ProblemDetails { Status = 400, Title = "Points multiplier must be between 0.1 and 10" });

        var orderIndex = request.OrderIndex ?? season.Rounds.Select(x => x.OrderIndex).DefaultIfEmpty(0).Max() + 1;
        if (orderIndex < 1) return BadRequest(new ProblemDetails { Status = 400, Title = "Order must be at least 1" });
        if (season.Rounds.Any(x => x.OrderIndex == orderIndex))
            return Conflict(new ProblemDetails { Status = 409, Title = "Round order is already in use" });
        var round = new SeasonRound
        {
            SeasonId = id,
            CompetitionId = section.CompetitionId,
            CompetitionSectionId = section.Id,
            OrderIndex = orderIndex,
            PointsMultiplier = multiplier,
        };
        db.Set<SeasonRound>().Add(round);
        await db.SaveChangesAsync(ct);
        round.Competition = section.Competition;
        round.CompetitionSection = section;
        return CreatedAtAction(nameof(Get), new { id }, await ToRoundDtoAsync(round, ct));
    }

    [HttpPut("{id:guid}/rounds/{roundId:guid}/included")]
    [Authorize(Roles = SeasonOrganiserRoles)]
    public async Task<ActionResult<SeasonRoundDto>> SetRoundIncluded(
        Guid id, Guid roundId, SetSeasonRoundIncludedRequest request, CancellationToken ct)
    {
        var round = await db.Set<SeasonRound>()
            .Include(x => x.Season)
            .Include(x => x.Competition)
            .Include(x => x.CompetitionSection)
            .Include(x => x.Publications)
            .SingleOrDefaultAsync(x => x.Id == roundId && x.SeasonId == id, ct);
        if (round?.Season is null || !CanManage(round.Season.OwnerUserId)) return NotFound();

        if (request.PointsMultiplier is { } multiplier)
        {
            if (double.IsNaN(multiplier) || double.IsInfinity(multiplier) || multiplier is < 0.1 or > 10)
                return BadRequest(new ProblemDetails { Status = 400, Title = "Points multiplier must be between 0.1 and 10" });
            round.PointsMultiplier = multiplier;
        }
        round.IsIncluded = request.IsIncluded;
        round.Season.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return await ToRoundDtoAsync(round, ct);
    }

    /// <summary>
    /// Unlinks a round from a season. Its published versions and results go with it; standings are worked out
    /// from the remaining published rounds on every request, so nothing needs recalculating.
    /// </summary>
    [HttpDelete("{id:guid}/rounds/{roundId:guid}")]
    [Authorize(Roles = SeasonOrganiserRoles)]
    public async Task<IActionResult> RemoveRound(Guid id, Guid roundId, CancellationToken ct)
    {
        var round = await db.Set<SeasonRound>().Include(x => x.Season)
            .SingleOrDefaultAsync(x => x.Id == roundId && x.SeasonId == id, ct);
        if (round?.Season is null || !CanManage(round.Season.OwnerUserId)) return NotFound();
        round.Season.UpdatedAt = DateTime.UtcNow;
        db.Set<SeasonRound>().Remove(round);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPut("{id:guid}/rounds/{roundId:guid}/multiplier")]
    [Authorize(Roles = SeasonOrganiserRoles)]
    public async Task<ActionResult<SeasonRoundDto>> SetRoundMultiplier(
        Guid id, Guid roundId, SetSeasonRoundMultiplierRequest request, CancellationToken ct)
    {
        var multiplier = request.PointsMultiplier;
        if (double.IsNaN(multiplier) || double.IsInfinity(multiplier) || multiplier is < 0.1 or > 10)
            return BadRequest(new ProblemDetails { Status = 400, Title = "Points multiplier must be between 0.1 and 10" });
        var round = await db.Set<SeasonRound>()
            .Include(x => x.Season)
            .Include(x => x.Competition)
            .Include(x => x.CompetitionSection)
            .Include(x => x.Publications)
            .SingleOrDefaultAsync(x => x.Id == roundId && x.SeasonId == id, ct);
        if (round?.Season is null || !CanManage(round.Season.OwnerUserId)) return NotFound();
        round.PointsMultiplier = multiplier;
        round.Season.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return await ToRoundDtoAsync(round, ct);
    }

    [HttpGet("{id:guid}/rounds/{roundId:guid}/publication-preview")]
    [Authorize(Roles = SeasonOrganiserRoles)]
    public async Task<ActionResult<SeasonPublicationPreviewDto>> PreviewPublication(Guid id, Guid roundId, CancellationToken ct)
    {
        var round = await AuthorisedRoundAsync(id, roundId, ct);
        if (round is null) return NotFound();
        try { return await new SeasonPublicationService(db).PreviewAsync(id, roundId, ct); }
        catch (SeasonPublicationException ex) { return Problem(statusCode: ex.StatusCode, title: "Publication unavailable", detail: ex.Message); }
    }

    [HttpPost("{id:guid}/rounds/{roundId:guid}/publications")]
    [Authorize(Roles = SeasonOrganiserRoles)]
    public async Task<ActionResult<SeasonRoundPublicationDto>> Publish(
        Guid id, Guid roundId, PublishSeasonRoundRequest request, CancellationToken ct)
    {
        var round = await AuthorisedRoundAsync(id, roundId, ct);
        if (round is null) return NotFound();
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return Unauthorized();
        try
        {
            var result = await new SeasonPublicationService(db).PublishAsync(id, roundId, request.SourceFingerprint, request.ExpectedVersion, userId, ct);
            return CreatedAtAction(nameof(GetPublication), new { id, roundId, version = result.Version }, result);
        }
        catch (SeasonPublicationException ex)
        {
            return Problem(statusCode: ex.StatusCode, title: "Publication unavailable", detail: ex.Message);
        }
    }

    [HttpGet("{id:guid}/rounds/{roundId:guid}/publications/{version:int}")]
    [AllowAnonymous]
    public async Task<ActionResult<SeasonRoundPublicationDto>> GetPublication(Guid id, Guid roundId, int version, CancellationToken ct)
    {
        var publication = await db.Set<SeasonRoundPublication>()
            .AsNoTracking().Include(x => x.Results)
            .SingleOrDefaultAsync(x => x.SeasonRoundId == roundId && x.SeasonRound!.SeasonId == id && x.Version == version, ct);
        if (publication is null) return NotFound();
        var initialOnly = await SeasonRiderPrivacy.InitialOnlyProfilesAsync(db, publication.Results.Select(x => x.TeamProfileId), ct);
        var dto = SeasonPublicationService.ToDto(publication);
        return dto with { Results = dto.Results.Select(row => row with { TeamName = SeasonRiderPrivacy.Display(row.TeamProfileId, row.TeamName, initialOnly) }).ToArray() };
    }

    private async Task<SeasonRound?> AuthorisedRoundAsync(Guid seasonId, Guid roundId, CancellationToken ct)
    {
        var round = await db.Set<SeasonRound>().Include(x => x.Season).Include(x => x.Competition)
            .SingleOrDefaultAsync(x => x.Id == roundId && x.SeasonId == seasonId, ct);
        return round?.Season is not null && round.Competition is not null
            && CanManage(round.Season.OwnerUserId) && CanManageCompetition(round.Competition.CreatedByUserId)
            ? round : null;
    }

    private Task<Season?> LoadSeasonAsync(Guid id, CancellationToken ct) => db.Set<Season>()
        .AsNoTracking()
        .Include(x => x.PlacePoints)
        .Include(x => x.Rounds).ThenInclude(x => x.Competition)
        .Include(x => x.Rounds).ThenInclude(x => x.CompetitionSection)
        .Include(x => x.Rounds).ThenInclude(x => x.Publications)
        .SingleOrDefaultAsync(x => x.Id == id, ct);

    private async Task<SeasonDto> ToDtoAsync(Season season, CancellationToken ct, bool checkCurrent = true)
    {

        var rounds = new List<SeasonRoundDto>();
        foreach (var round in season.Rounds.OrderBy(x => x.OrderIndex)) rounds.Add(await ToRoundDtoAsync(round, ct, checkCurrent));
        return new SeasonDto(
            season.Id, season.Title, season.Year, season.Format, season.AgeGroup,
            season.BestResultsToCount,
            season.PlacePoints.OrderBy(x => x.Place).Select(x => new SeasonPointsRule(x.Place, x.Points)).ToArray(),
            rounds, season.CreatedAt, season.UpdatedAt, CanManage(season.OwnerUserId));
    }

    private async Task<SeasonRoundDto> ToRoundDtoAsync(SeasonRound round, CancellationToken ct, bool checkCurrent = true)
    {
        var latest = round.Publications.MaxBy(x => x.Version);
        var current = latest is not null;
        if (latest is not null && checkCurrent)
        {
            try
            {
                var preview = await new SeasonPublicationService(db).PreviewAsync(round.SeasonId, round.Id, ct);
                current = string.Equals(preview.SourceFingerprint, latest.SourceFingerprint, StringComparison.Ordinal);
            }
            catch (SeasonPublicationException) { current = false; }
        }
        return new SeasonRoundDto(
            round.Id, round.CompetitionId, round.Competition?.Name ?? string.Empty,
            round.Competition?.StartDate ?? default,
            round.CompetitionSectionId, round.CompetitionSection?.DisplayName ?? string.Empty,
            round.OrderIndex, round.IsIncluded, latest?.Version, latest?.PublishedAt, current,
            round.CompetitionSection?.AgeGroup ?? string.Empty,
            round.CompetitionSection?.Format ?? SectionFormat.Teams,
            round.PointsMultiplier > 0 ? round.PointsMultiplier : 1.0);
    }

    private ActionResult? Validate(string title, int year, MountedGames.Api.Entities.SectionFormat format, string? ageGroup, int? bestResults, IReadOnlyList<SeasonPointsRule>? rules)
    {
        if (string.IsNullOrWhiteSpace(title) || title.Trim().Length > 200)
            return BadRequest(new ProblemDetails { Status = 400, Title = "Title is required and must be at most 200 characters" });
        if (year is < 2000 or > 2200)
            return BadRequest(new ProblemDetails { Status = 400, Title = "Year must be between 2000 and 2200" });
        if (!Enum.IsDefined(format))
            return BadRequest(new ProblemDetails { Status = 400, Title = "Choose a valid competition format" });
        if (ageGroup is not null && ageGroup.Trim().Length > 50)
            return BadRequest(new ProblemDetails { Status = 400, Title = "Age group must be at most 50 characters" });
        if (bestResults is <= 0 or > 1000)
            return BadRequest(new ProblemDetails { Status = 400, Title = "Best results to count must be between 1 and 1000" });
        if (rules is null || rules.Count is < 1 or > 100)
            return BadRequest(new ProblemDetails { Status = 400, Title = "Supply between 1 and 100 place points" });
        var ordered = rules.OrderBy(x => x.Place).ToArray();
        if (ordered.Select(x => x.Place).Distinct().Count() != ordered.Length
            || ordered.Where((x, i) => x.Place != i + 1).Any())
            return BadRequest(new ProblemDetails { Status = 400, Title = "Place points must contain each place once, starting at 1" });
        if (ordered.Any(x => x.Points is < 0 or > 1_000_000) || ordered.Zip(ordered.Skip(1)).Any(x => x.First.Points < x.Second.Points))
            return BadRequest(new ProblemDetails { Status = 400, Title = "Place points must be between 0 and 1,000,000 and cannot increase for lower places" });
        return null;
    }

    private bool CanManage(string ownerUserId)
        => User.IsInRole(Roles.Admin)
            || ((User.IsInRole(Roles.Trainer) || User.IsInRole(Roles.Manager))
                && User.FindFirstValue(ClaimTypes.NameIdentifier) == ownerUserId);

    private bool CanManageCompetition(string? ownerUserId)
        => User.IsInRole(Roles.Admin)
            || ((User.IsInRole(Roles.Trainer) || User.IsInRole(Roles.Manager))
                && ownerUserId is not null
                && User.FindFirstValue(ClaimTypes.NameIdentifier) == ownerUserId);
}

[ApiController]
[Route("api/team-profiles")]
public sealed class TeamProfilesController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<IReadOnlyList<TeamProfileDto>>> List(CancellationToken ct)
    {
        var profiles = await db.Set<TeamProfile>().AsNoTracking().Include(x => x.Club)
            .OrderBy(x => x.DisplayName).ThenBy(x => x.Id)
            .ToListAsync(ct);
        var initialOnly = await SeasonRiderPrivacy.InitialOnlyProfilesAsync(db, profiles.Select(x => x.Id), ct);
        return profiles.Select(x => ToDto(x) with { DisplayName = SeasonRiderPrivacy.Display(x.Id, x.DisplayName, initialOnly) }).ToArray();
    }

    [HttpGet("{id:guid}/history")]
    [AllowAnonymous]
    public async Task<ActionResult<TeamProfileHistoryDto>> History(Guid id, CancellationToken ct)
    {
        var profile = await db.Set<TeamProfile>().AsNoTracking().Include(x => x.Club)
            .Include(x => x.EventTeams).ThenInclude(x => x.Team)
            .Include(x => x.EventTeams).ThenInclude(x => x.Competition)
            .SingleOrDefaultAsync(x => x.Id == id, ct);
        if (profile is null) return NotFound();

        var allPublished = await db.Set<SeasonRoundResult>().AsNoTracking()
            .Where(x => x.TeamProfileId == id)
            .Where(x => x.SeasonRoundPublication != null
                && !db.Set<SeasonRoundPublication>().Any(publication =>
                    publication.SeasonRoundId == x.SeasonRoundPublication.SeasonRoundId
                    && publication.Version > x.SeasonRoundPublication.Version))
            .Include(x => x.SeasonRoundPublication)!.ThenInclude(x => x!.SeasonRound)!.ThenInclude(x => x!.Season)
            .Include(x => x.SeasonRoundPublication)!.ThenInclude(x => x!.SeasonRound)!.ThenInclude(x => x!.Competition)
            .ToListAsync(ct);
        var current = allPublished
            .Where(x => x.SeasonRoundPublication?.SeasonRound is not null)
            .OrderByDescending(x => x.SeasonRoundPublication!.SeasonRound!.Competition!.StartDate)
            .Select(x => new TeamProfileHistoryResultDto(
                x.SeasonRoundPublication!.SeasonRound!.SeasonId,
                x.SeasonRoundPublication.SeasonRound.Season!.Title,
                x.SeasonRoundPublication.SeasonRound.Season.Year,
                x.SeasonRoundPublication.SeasonRoundId,
                x.SeasonRoundPublication.SeasonRound.OrderIndex,
                x.SeasonRoundPublication.SeasonRound.Competition!.Name,
                x.SeasonRoundPublication.SeasonRound.Competition.StartDate,
                x.SeasonRoundPublication.Version,
                x.SeasonRoundPublication.PublishedAt,
                x.EventRank, x.EventPoints, x.SeasonPoints))
            .ToArray();
        var initialOnly = await SeasonRiderPrivacy.InitialOnlyProfilesAsync(db, [id], ct);
        return new TeamProfileHistoryDto(
            ToDto(profile) with { DisplayName = SeasonRiderPrivacy.Display(id, profile.DisplayName, initialOnly) },
            profile.EventTeams.OrderByDescending(x => x.Competition!.StartDate)
                .Select(x => new EventTeamProfileLinkDto(x.Id, x.TeamProfileId, x.CompetitionId,
                    x.Competition!.Name, x.TeamId, x.Team!.DisplayName, x.LinkedAt)).ToArray(),
            current);
    }

    private const string SeasonOrganiserRoles = Roles.Organiser + "," + Roles.Manager;

    [HttpPost]
    [Authorize(Roles = SeasonOrganiserRoles)]
    public async Task<ActionResult<TeamProfileDto>> Create(CreateTeamProfileRequest request, CancellationToken ct)
    {
        var error = Validate(request.ClubId, request.ClubName, request.Suffix, request.DisplayName);
        if (error is not null) return error;
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return Unauthorized();
        var club = await ResolveClubAsync(request.ClubId, request.ClubName, ct);
        if (club is null) return BadRequest(new ProblemDetails { Status = 400, Title = "Club not found" });
        var profile = new TeamProfile
        {
            OwnerUserId = userId,
            ClubId = club.Id,
            Club = club,
            Suffix = (request.Suffix ?? string.Empty).Trim(),
            DisplayName = request.DisplayName.Trim(),
        };
        db.Set<TeamProfile>().Add(profile);
        await db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(History), new { id = profile.Id }, ToDto(profile));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = SeasonOrganiserRoles)]
    public async Task<ActionResult<TeamProfileDto>> Update(Guid id, UpdateTeamProfileRequest request, CancellationToken ct)
    {
        var error = Validate(request.ClubId, request.ClubName, request.Suffix, request.DisplayName);
        if (error is not null) return error;
        var profile = await db.Set<TeamProfile>().Include(x => x.Club).SingleOrDefaultAsync(x => x.Id == id, ct);
        if (profile is null || !CanManage(profile.OwnerUserId)) return NotFound();
        var club = await ResolveClubAsync(request.ClubId, request.ClubName, ct);
        if (club is null) return BadRequest(new ProblemDetails { Status = 400, Title = "Club not found" });
        var identityChanged = profile.ClubId != club.Id
            || !string.Equals(profile.Suffix.Trim(), (request.Suffix ?? string.Empty).Trim(), StringComparison.OrdinalIgnoreCase);
        if (identityChanged && (await db.Set<EventTeamProfileLink>().AnyAsync(x => x.TeamProfileId == id, ct)
            || await db.Set<SeasonRoundResult>().AnyAsync(x => x.TeamProfileId == id, ct)))
            return Conflict(new ProblemDetails
            {
                Status = 409,
                Title = "Linked team identity cannot be changed",
                Detail = "Club and suffix stay fixed after a profile is linked or published. You can still correct its display name.",
            });
        profile.ClubId = club.Id;
        profile.Club = club;
        profile.Suffix = (request.Suffix ?? string.Empty).Trim();
        profile.DisplayName = request.DisplayName.Trim();
        profile.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return ToDto(profile);
    }

    [HttpPost("/api/competitions/{competitionId:int}/team-profile-links")]
    [Authorize(Roles = SeasonOrganiserRoles)]
    public async Task<ActionResult<EventTeamProfileLinkDto>> Link(int competitionId, LinkEventTeamRequest request, CancellationToken ct)
    {
        var competition = await db.Competitions.SingleOrDefaultAsync(x => x.Id == competitionId, ct);
        if (competition is null || !CanManageCompetition(competition.CreatedByUserId)) return NotFound();
        var team = await db.Teams.Include(x => x.Club).SingleOrDefaultAsync(x => x.Id == request.TeamId && x.CompetitionId == competitionId, ct);
        var profile = await db.Set<TeamProfile>().SingleOrDefaultAsync(x => x.Id == request.TeamProfileId, ct);
        if (team is null || profile is null || !CanManage(profile.OwnerUserId)) return NotFound();
        // Any team of the profile's club can be linked: a club's teams can be named freely, so the suffix
        // (which may be empty) is not part of the match.
        if (team.ClubId != profile.ClubId)
            return Conflict(new ProblemDetails { Status = 409, Title = "Team profile does not match this event team", Detail = "Choose a profile for the same club." });
        if (await db.Set<EventTeamProfileLink>().AnyAsync(x => x.TeamId == team.Id || (x.CompetitionId == competitionId && x.TeamProfileId == profile.Id), ct))
            return Conflict(new ProblemDetails { Status = 409, Title = "Team identity already linked", Detail = "An event team and a stable profile can each be linked only once per competition." });
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return Unauthorized();
        var link = new EventTeamProfileLink
        {
            TeamProfileId = profile.Id,
            CompetitionId = competitionId,
            TeamId = team.Id,
            LinkedByUserId = userId,
        };
        db.Set<EventTeamProfileLink>().Add(link);
        await db.SaveChangesAsync(ct);
        return Created(string.Empty, new EventTeamProfileLinkDto(
            link.Id, profile.Id, competition.Id, competition.Name, team.Id, team.DisplayName, link.LinkedAt));
    }

    /// <summary>The club by id, or by name (matched ignoring case); a new name creates the club.</summary>
    private async Task<Club?> ResolveClubAsync(int clubId, string? clubName, CancellationToken ct)
    {
        var name = clubName?.Trim();
        if (string.IsNullOrEmpty(name)) return await db.Clubs.SingleOrDefaultAsync(x => x.Id == clubId, ct);
        var existing = await db.Clubs.FirstOrDefaultAsync(x => x.Name.ToLower() == name.ToLower(), ct);
        if (existing is not null) return existing;
        var club = new Club { Name = name, Region = "Custom" };
        db.Clubs.Add(club);
        await db.SaveChangesAsync(ct);
        return club;
    }

    private ActionResult? Validate(int clubId, string? clubName, string? suffix, string displayName)
    {
        if (clubId < 1 && string.IsNullOrWhiteSpace(clubName)) return BadRequest(new ProblemDetails { Status = 400, Title = "Club is required" });
        if (clubName?.Trim().Length > 150) return BadRequest(new ProblemDetails { Status = 400, Title = "Club name must be at most 150 characters" });
        if ((suffix ?? string.Empty).Trim().Length > 10)
            return BadRequest(new ProblemDetails { Status = 400, Title = "Suffix must be at most 10 characters" });
        if (string.IsNullOrWhiteSpace(displayName) || displayName.Trim().Length > 200)
            return BadRequest(new ProblemDetails { Status = 400, Title = "Display name is required and must be at most 200 characters" });
        return null;
    }

    private bool CanManage(string ownerUserId)
        => User.IsInRole(Roles.Admin)
            || ((User.IsInRole(Roles.Trainer) || User.IsInRole(Roles.Manager))
                && User.FindFirstValue(ClaimTypes.NameIdentifier) == ownerUserId);

    private bool CanManageCompetition(string? ownerUserId)
        => User.IsInRole(Roles.Admin)
            || ((User.IsInRole(Roles.Trainer) || User.IsInRole(Roles.Manager))
                && ownerUserId is not null
                && User.FindFirstValue(ClaimTypes.NameIdentifier) == ownerUserId);

    private TeamProfileDto ToDto(TeamProfile x)
        => new(x.Id, x.ClubId, x.Club?.Name ?? string.Empty, x.Suffix, x.DisplayName, x.CreatedAt, x.UpdatedAt,
            CanManage(x.OwnerUserId));
}
