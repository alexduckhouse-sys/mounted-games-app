using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Broadcast;

public sealed class BroadcastService(AppDbContext db, TimeProvider time)
{
    public const int MaxDelaySeconds = 120;
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);
    public static string ArenaName(string? name) => string.IsNullOrWhiteSpace(name) ? "Arena 1" : name.Trim();

    public async Task<bool> ValidArenaAsync(int competitionId, string arena, int? sectionId, CancellationToken ct)
    {
        if (arena.Length is 0 or > 80 || sectionId is <= 0) return false;
        var sessions = await db.Sessions.AsNoTracking().Where(s => s.CompetitionId == competitionId)
            .Select(s => new { s.ArenaName, s.CompetitionSectionId }).ToListAsync(ct);
        return sessions.Any(s => ArenaName(s.ArenaName) == arena && (sectionId is null || s.CompetitionSectionId == sectionId));
    }

    /// <summary>
    /// Observations use one database snapshot, including uncached standings. Their timestamp is taken after the read,
    /// never before it: delayed playback cannot reveal a later correction. With no earlier baseline we send nothing.
    /// </summary>
    public Task<BroadcastSnapshotDto> ReadAsync(int competitionId, string arena, int? sectionId, int delay, CancellationToken ct, bool force = false)
    {
        var attempts = 0;
        return db.Database.CreateExecutionStrategy().ExecuteAsync(() => ReadOnceAsync(competitionId, arena, sectionId, delay, ct, force, attempts++ > 0));
    }

    private async Task<BroadcastSnapshotDto> ReadOnceAsync(int competitionId, string arena, int? sectionId, int delay, CancellationToken ct, bool force, bool retry)
    {
        if (retry) db.ChangeTracker.Clear();
        var now = time.GetUtcNow().UtcDateTime;
        var key = sectionId ?? 0;
        var history = db.Set<BroadcastSnapshot>();
        var latest = await history.AsNoTracking().Where(x => x.CompetitionId == competitionId && x.Arena == arena && x.SectionKey == key)
            .OrderByDescending(x => x.ObservedAt).ThenByDescending(x => x.Id).FirstOrDefaultAsync(ct);
        if (force || latest is null || now - latest.ObservedAt >= TimeSpan.FromSeconds(2))
        {
            await using var tx = await db.Database.BeginTransactionAsync(
                db.Database.IsNpgsql() ? IsolationLevel.RepeatableRead : IsolationLevel.Serializable, ct);
            var graphics = await BuildAsync(competitionId, arena, sectionId, ct);
            now = time.GetUtcNow().UtcDateTime;
            latest = new BroadcastSnapshot { CompetitionId = competitionId, Arena = arena, SectionKey = key,
                ObservedAt = now, PayloadJson = JsonSerializer.Serialize(graphics, Json) };
            history.Add(latest);
            await db.SaveChangesAsync(ct);
            var cutoff = now.AddSeconds(-MaxDelaySeconds - 45);
            await history.Where(x => x.ObservedAt < cutoff).ExecuteDeleteAsync(ct);
            await db.Set<BroadcastCue>().Where(x => x.ExpiresAt < cutoff).ExecuteDeleteAsync(ct);
            await tx.CommitAsync(ct);
        }
        var playback = now.AddSeconds(-delay);
        var chosen = delay == 0 ? latest : await history.AsNoTracking()
            .Where(x => x.CompetitionId == competitionId && x.Arena == arena && x.SectionKey == key && x.ObservedAt <= playback)
            .OrderByDescending(x => x.ObservedAt).ThenByDescending(x => x.Id).FirstOrDefaultAsync(ct);
        var output = await db.Set<BroadcastOutput>().AsNoTracking()
            .SingleOrDefaultAsync(x => x.CompetitionId == competitionId && x.Arena == arena, ct);
        var hidden = output?.Hidden == true;
        var usable = chosen is not null && playback - chosen.ObservedAt <= TimeSpan.FromSeconds(15)
            && (output is null || chosen.ObservedAt >= output.DiscardBefore);
        var payload = usable && !hidden ? JsonSerializer.Deserialize<BroadcastGraphics>(chosen!.PayloadJson, Json) : null;
        if (payload is not null)
            payload = payload with { Cues = payload.Cues.Where(c => c.StartsAt <= playback && c.ExpiresAt > playback).ToList() };
        return new(chosen?.Id ?? 0, now, chosen is null ? null : Utc(chosen.ObservedAt), playback, now.AddSeconds(15), hidden, !usable, payload);
    }

    private async Task<BroadcastGraphics> BuildAsync(int competitionId, string arena, int? sectionId, CancellationToken ct)
    {
        var comp = await db.Competitions.AsNoTracking().Where(c => c.Id == competitionId).Select(c => c.Name).SingleAsync(ct);
        var sessions = await db.Sessions.AsNoTracking().Where(s => s.CompetitionId == competitionId)
            .Include(s => s.Section).Include(s => s.Heats).ThenInclude(h => h.Entries).ThenInclude(e => e.Team)
            .Include(s => s.Heats).ThenInclude(h => h.Races).ThenInclude(r => r.Results).AsSplitQuery().ToListAsync(ct);
        var scoped = sessions.Where(s => ArenaName(s.ArenaName) == arena && (sectionId is null || s.CompetitionSectionId == sectionId))
            .OrderBy(s => s.OrderIndex).ThenBy(s => s.Id).ToList();
        var heats = scoped.Where(s => !s.IsBreak && s.Kind == SessionKind.Race)
            .SelectMany(s => s.Heats.OrderBy(h => h.OrderIndex).ThenBy(h => h.Id)).ToList();
        var pending = heats.Where(h => h.FinishedAt is null && h.Session?.Status != SessionStatus.Finished).ToList();
        var current = pending.FirstOrDefault(h => h.StartedAt is not null) ?? pending.FirstOrDefault();
        var next = current is null ? null : pending.Skip(pending.IndexOf(current) + 1).FirstOrDefault();
        var overlay = await db.StreamOverlays.AsNoTracking().SingleOrDefaultAsync(o => o.CompetitionId == competitionId, ct);
        using var lookDocument = JsonDocument.Parse(overlay?.LookJson ?? "{}");
        var look = lookDocument.RootElement;
        var card = TextOption(look, "liveCard") ?? "auto";
        if (!new[] { "auto", "none", "toplist", "heat", "lanes", "podium", "result", "next", "title", "sponsor", "favourites" }.Contains(card)) card = "none";
        var options = look.ValueKind == JsonValueKind.Object && look.TryGetProperty("liveOptions", out var liveOptions) && liveOptions.ValueKind == JsonValueKind.Object ? liveOptions : default;
        var pickedSection = card == "podium" ? NumberOption(options, "podiumSectionId") : NumberOption(look, "liveSectionId");
        var selectedSection = sectionId ?? (scoped.Any(s => s.CompetitionSectionId == pickedSection) ? pickedSection : null) ?? current?.Session?.CompetitionSectionId ?? scoped.LastOrDefault(s => s.CompetitionSectionId != null)?.CompetitionSectionId;
        var standings = selectedSection is null ? [] : await new StandingsService(db).RowsAsync(competitionId, selectedSection, ct);
        var rowCount = NumberOption(options, "toplistRows") ?? 8;
        if (rowCount is not (3 or 5 or 8)) rowCount = 8;
        PrizeGivingDto? podium = null;
        if (card == "podium" && selectedSection is not null)
        {
            var count = TextOption(options, "podiumReveal") == "one" ? Math.Clamp(NumberOption(options, "podiumShown") ?? 0, 0, 3) : 3;
            var podiumPlaces = standings.Where(s => !s.Withdrawn && s.Place is <= 3).OrderByDescending(s => s.Place).ToList();
            var placesToShow = podiumPlaces.GroupBy(s => s.Place).Take(count).SelectMany(g => g).ToList();
            podium = new("show", selectedSection, scoped.FirstOrDefault(s => s.CompetitionSectionId == selectedSection)?.Section?.DisplayName,
                placesToShow.Select(s => new PrizeGivingPlaceDto(s.TeamId, s.Place!.Value, s.TeamName, s.ClubName, s.TotalPoints)).ToList(), placesToShow.Any(s => s.Place == 1));
        }
        var now = time.GetUtcNow().UtcDateTime;
        var output = await db.Set<BroadcastOutput>().AsNoTracking().SingleOrDefaultAsync(x => x.CompetitionId == competitionId && x.Arena == arena, ct);
        var discardBefore = output?.DiscardBefore ?? DateTime.MinValue;
        var cues = await db.Set<BroadcastCue>().AsNoTracking().Where(c => c.CompetitionId == competitionId && c.Arena == arena
            && c.StartsAt >= discardBefore && c.StartsAt <= now && (sectionId == null || c.SectionId == null || c.SectionId == sectionId))
            .OrderBy(c => c.Id).ToListAsync(ct);
        var showScore = overlay?.ScoreCardMode != OverlayMode.Off && ElementShown(look, "scoreCard");
        var latestCues = cues.Where(c => c.Kind != "score" || showScore).GroupBy(c => c.Kind).Select(g => g.Last()).Where(c => c.ExpiresAt > now)
            .Select(c => new BroadcastCueDto(c.Id, c.CommandId, c.Kind, c.Action, Utc(c.StartsAt), Utc(c.ExpiresAt),
                JsonSerializer.Deserialize<JsonElement>(c.PayloadJson, Json))).ToList();
        var scoreRace = heats.SelectMany(h => h.Races).Where(r => r.IsComplete && r.FinishedAt is not null
                && r.FinishedAt <= now.AddSeconds(-(overlay?.ScoreCardDelaySeconds ?? 4))
                && r.FinishedAt > now.AddSeconds(-(overlay?.ScoreCardDelaySeconds ?? 4) - (overlay?.ScoreCardSeconds ?? 10)))
            .OrderByDescending(r => r.FinishedAt).FirstOrDefault();
        if (card == "result") {
            var resultId = NumberOption(options, "resultRaceId");
            scoreRace = heats.SelectMany(h => h.Races).Where(r => r.Results.Count > 0 && (resultId == null || r.Id == resultId))
                .OrderByDescending(r => r.FinishedAt).ThenByDescending(r => r.Id).FirstOrDefault();
        }
        var activeSession = scoped.FirstOrDefault(s => s.Status == SessionStatus.InArena) ?? scoped.FirstOrDefault(s => s.Status == SessionStatus.Upcoming);
        var cardsOn = overlay?.SponsorMode == OverlayMode.On || activeSession?.IsBreak == true || activeSession?.Kind == SessionKind.Briefing;
        var placement = cardsOn ? SponsorPlacement.BreakStream : SponsorPlacement.Stream;
        var eligibleSponsors = await db.Sponsors.AsNoTracking().Where(s => s.CompetitionId == competitionId && s.IsEnabled
                && (s.ShowOn & (SponsorPlacement.Stream | SponsorPlacement.BreakStream)) != 0 && (s.StartsAt == null || s.StartsAt <= now) && (s.EndsAt == null || s.EndsAt > now))
            .OrderBy(s => s.Tier).ThenBy(s => s.SortOrder).ThenBy(s => s.Id).Select(s => new { s.Name, s.ShowOn }).ToListAsync(ct);
        if (cardsOn && !eligibleSponsors.Any(s => (s.ShowOn & SponsorPlacement.BreakStream) != 0)) { cardsOn = false; placement = SponsorPlacement.Stream; }
        var sponsors = eligibleSponsors.Where(s => (s.ShowOn & placement) != 0).Select(s => new BroadcastSponsor(s.Name, null)).ToList();
        if (sponsors.Count > 0) {
            var index = (new DateTimeOffset(Utc(now)).ToUnixTimeSeconds() / (cardsOn ? 8 : 10) + (output?.SponsorOffset ?? 0)) % sponsors.Count;
            sponsors = [sponsors[(int)index]];
        }
        var bannerArenas = JsonSerializer.Deserialize<List<string>>(overlay?.BannerArenas ?? "[]") ?? [];
        return new(comp, arena, !ElementShown(look, "strip") || overlay?.StripMode == OverlayMode.Off ? null : HeatCard(current),
            !ElementShown(look, "strip") || overlay?.StripMode == OverlayMode.Off ? null : HeatCard(next),
            !showScore || scoreRace is null ? null : ScoreCard(scoreRace) with {
                ExpiresAt = card == "result" ? null : Utc(scoreRace.FinishedAt!.Value).AddSeconds((overlay?.ScoreCardDelaySeconds ?? 4) + (overlay?.ScoreCardSeconds ?? 10)) }, standings,
            ElementShown(look, "banner") && (bannerArenas.Count == 0 || bannerArenas.Contains(arena)) ? overlay?.BannerText : null,
            overlay?.SponsorMode == OverlayMode.Off || !ElementShown(look, "sponsor") ? [] : sponsors, latestCues, card, rowCount, podium,
            ColourOption(look, "background", "#0F1E3D"), ColourOption(look, "accent", "#F5B82E"));
    }

    private static bool ElementShown(JsonElement look, string key) => !(look.ValueKind == JsonValueKind.Object
        && look.TryGetProperty("elements", out var elements) && elements.ValueKind == JsonValueKind.Object
        && elements.TryGetProperty(key, out var element) && element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty("show", out var show) && show.ValueKind == JsonValueKind.False);

    public async Task SkipSponsorAsync(int competitionId, CancellationToken ct)
    {
        var arenas = (await db.Sessions.Where(s => s.CompetitionId == competitionId).Select(s => s.ArenaName).Distinct().ToListAsync(ct)).Select(ArenaName).Distinct();
        foreach (var arena in arenas) {
            var rows = db.Set<BroadcastOutput>().Where(o => o.CompetitionId == competitionId && o.Arena == arena);
            if (await rows.ExecuteUpdateAsync(s => s.SetProperty(o => o.SponsorOffset, o => o.SponsorOffset + 1), ct) != 0) continue;
            var output = new BroadcastOutput { CompetitionId = competitionId, Arena = arena, SponsorOffset = 1 };
            db.Add(output);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException) {
                db.Entry(output).State = EntityState.Detached;
                if (await rows.ExecuteUpdateAsync(s => s.SetProperty(o => o.SponsorOffset, o => o.SponsorOffset + 1), ct) == 0) throw;
            }
        }
    }

    private static string? TextOption(JsonElement element, string key) => element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static int? NumberOption(JsonElement element, string key) => element.ValueKind == JsonValueKind.Object
        && element.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number) ? number : null;
    private static string ColourOption(JsonElement element, string key, string fallback)
    {
        var value = TextOption(element, key);
        return value is not null && System.Text.RegularExpressions.Regex.IsMatch(value, "^#[0-9a-fA-F]{6}$") ? value : fallback;
    }

    private static BroadcastHeat? HeatCard(Heat? heat)
    {
        if (heat is null) return null;
        var session = heat.Session!;
        var races = heat.Races.OrderBy(r => r.OrderIndex).ThenBy(r => r.Id).ToList();
        var race = races.FirstOrDefault(r => !r.IsComplete);
        var index = race is null ? 0 : races.IndexOf(race);
        var rows = heat.Entries.Where(e => e.Team is not null).Select(e => {
            var lane = LaneRotation.PositionFor(e.LaneIndex, index, heat.Entries.Count, session.LaneRotationMode);
            var sit = LaneRotation.SitsOut(e.LaneIndex, index, heat.Entries.Count, session.LanesPerHeat, session.LaneRotationMode);
            return new BroadcastRow(e.TeamId, e.Team!.DisplayName, e.BibColourOverride ?? e.Team.BibColour,
                sit ? null : lane, sit, e.Team.IsHorsConcours, null, false, null, false);
        }).OrderBy(e => e.SitOut).ThenBy(e => e.Lane).ToList();
        return new(heat.Id, heat.Label ?? $"Heat {heat.OrderIndex + 1}", session.Name, session.CompetitionSectionId,
            session.Section?.DisplayName ?? session.Section?.AgeGroup ?? "", race?.Id, race?.Name, heat.StartedAt is not null, rows);
    }

    public static BroadcastScore ScoreCard(Race race, ScoreCardControlDto? control = null)
    {
        var teams = race.Heat!.Entries.Where(e => e.Team is not null).ToDictionary(e => e.TeamId, e => e.Team!);
        var rows = race.Results.Where(r => teams.ContainsKey(r.TeamId) && control?.HiddenTeamIds.Contains(r.TeamId) != true)
            .OrderBy(r => r.IsSitOut).ThenBy(r => r.Eliminated).ThenBy(r => r.Placing ?? int.MaxValue).ThenBy(r => r.TeamId)
            .Select(r => new BroadcastRow(r.TeamId, control?.Names.GetValueOrDefault(r.TeamId) ?? teams[r.TeamId].DisplayName,
                teams[r.TeamId].BibColour, null, r.IsSitOut, teams[r.TeamId].IsHorsConcours, r.Placing,
                r.Placing is not null && race.Results.Count(x => x.Placing == r.Placing && !x.Eliminated && !x.IsSitOut) > 1,
                r.Points, r.Eliminated)).ToList();
        return new(race.Id, race.Name, race.Heat.Label ?? $"Heat {race.Heat.OrderIndex + 1}", rows);
    }

    public async Task RecordScoreAsync(int competitionId, ScoreCardControlDto control, CancellationToken ct)
    {
        var race = await db.Races.AsNoTracking().Include(r => r.Results).Include(r => r.Heat!).ThenInclude(h => h.Entries)
            .ThenInclude(e => e.Team).Include(r => r.Heat!).ThenInclude(h => h.Session)
            .SingleAsync(r => r.Id == control.RaceId && r.Heat!.Session!.CompetitionId == competitionId, ct);
        await RecordCueAsync(competitionId, ArenaName(race.Heat!.Session!.ArenaName), race.Heat.Session.CompetitionSectionId,
            "score", control.Action, ScoreCard(race, control), control.Action == "skip" ? MaxDelaySeconds + 30 : control.Seconds ?? 10, ct);
    }

    public async Task RecordPrizeAsync(int competitionId, PrizeGivingDto prize, CancellationToken ct)
    {
        var arenaNames = await db.Sessions.AsNoTracking().Where(s => s.CompetitionId == competitionId
            && (prize.SectionId == null || s.CompetitionSectionId == prize.SectionId)).Select(s => s.ArenaName).Distinct().ToListAsync(ct);
        foreach (var arena in arenaNames.Select(ArenaName).Distinct())
            await RecordCueAsync(competitionId, arena, prize.SectionId, "podium", prize.Action, prize, MaxDelaySeconds + 30, ct);
    }

    private async Task RecordCueAsync<T>(int competitionId, string arena, int? sectionId, string kind, string action, T payload, int seconds, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        db.Set<BroadcastCue>().Add(new() { CompetitionId = competitionId, Arena = arena, SectionId = sectionId,
            Kind = kind, Action = action, StartsAt = now, ExpiresAt = now.AddSeconds(seconds), PayloadJson = JsonSerializer.Serialize(payload, Json) });
        // Force the next public read to take a fresh coherent snapshot without erasing delayed history.
        await db.SaveChangesAsync(ct);
    }
}
