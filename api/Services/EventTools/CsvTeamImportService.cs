using System.Security.Cryptography;
using System.Text;
using System.Data;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.EventTools;

public sealed class CsvTeamImportService(AppDbContext db)
{
    public const int CurrentPreviewVersion = 1;
    public const int MaxBytes = 256 * 1024;
    public const int MaxRows = 500;

    public async Task<CsvTeamImportPreviewDto> PreviewAsync(int competitionId, string? csv, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(csv)) throw new EventToolsException("CSV text is required.", 400);
        if (Encoding.UTF8.GetByteCount(csv) > MaxBytes) throw new EventToolsException($"CSV text cannot exceed {MaxBytes} bytes.", 413);
        var parsed = Parse(csv);
        if (parsed.Count == 0) throw new EventToolsException("CSV must include a header row.", 400);
        var headerCells = parsed[0].Cells.Select((x, i) => new { Name = x.Trim().TrimStart('\uFEFF'), Index = i }).ToArray();
        if (headerCells.GroupBy(x => x.Name, StringComparer.OrdinalIgnoreCase).Any(x => x.Count() > 1))
            throw new EventToolsException("CSV header contains a duplicate column.", 400);
        var header = headerCells.ToDictionary(x => x.Name, x => x.Index, StringComparer.OrdinalIgnoreCase);
        // Club and section are needed; the suffix is optional (a club with one team has none), and an
        // optional team/name column gives the team a custom name such as "Welsh Dragons".
        if (!header.TryGetValue("club", out var clubColumn)
            || !header.TryGetValue("section", out var sectionColumn))
            throw new EventToolsException("CSV header must contain club and section columns (suffix is optional).", 400);
        var suffixColumn = header.TryGetValue("suffix", out var s) ? s : -1;
        var nameColumn = header.TryGetValue("team", out var t) ? t : header.TryGetValue("name", out var n) ? n : -1;
        var maxColumn = new[] { clubColumn, sectionColumn, suffixColumn, nameColumn }.Max();
        var dataRows = parsed.Skip(1).Where(x => x.Cells.Any(y => !string.IsNullOrWhiteSpace(y))).ToList();
        if (dataRows.Count > MaxRows) throw new EventToolsException($"CSV cannot contain more than {MaxRows} team rows.", 413);

        var sections = await db.CompetitionSections.AsNoTracking().Where(x => x.CompetitionId == competitionId).ToListAsync(ct);
        var clubs = await db.Clubs.AsNoTracking().ToListAsync(ct);
        var existing = await db.Teams.AsNoTracking().Where(x => x.CompetitionId == competitionId)
            .Select(x => new { x.ClubId, x.CompetitionSectionId, x.Suffix, x.DisplayName, ClubName = x.Club!.Name }).ToListAsync(ct);
        // An existing team clashes on club + suffix, or, for a custom-named team, on its name.
        var existingKeys = existing.Select(x => Key(x.ClubId, x.CompetitionSectionId, x.Suffix, null))
            .Concat(existing.Select(x => Key(x.ClubId, x.CompetitionSectionId, x.Suffix,
                string.Equals(x.DisplayName, string.IsNullOrWhiteSpace(x.Suffix) ? x.ClubName : $"{x.ClubName} {x.Suffix}", StringComparison.OrdinalIgnoreCase) ? null : x.DisplayName)))
            .ToHashSet();
        var inputKeys = new HashSet<string>();
        var rows = new List<CsvTeamImportRowDto>();

        foreach (var parsedRow in dataRows)
        {
            var errors = new List<string>();
            if (parsedRow.Cells.Count <= maxColumn)
            {
                rows.Add(new CsvTeamImportRowDto(parsedRow.RowNumber, null, string.Empty, string.Empty, null, string.Empty, string.Empty,
                    ["Row does not contain all required columns."]));
                continue;
            }
            var clubName = parsedRow.Cells[clubColumn].Trim();
            var suffix = suffixColumn < 0 ? string.Empty : parsedRow.Cells[suffixColumn].Trim();
            var customName = nameColumn < 0 ? string.Empty : parsedRow.Cells[nameColumn].Trim();
            var sectionName = parsedRow.Cells[sectionColumn].Trim();
            if (clubName.Length is < 1 or > 150) errors.Add("Club is required and must be at most 150 characters.");
            if (suffix.Length > 10) errors.Add("Suffix must be at most 10 characters.");
            if (customName.Length > 200) errors.Add("Team name must be at most 200 characters.");
            if (sectionName.Length is < 1 or > 150) errors.Add("Section is required and must be at most 150 characters.");
            if (IsFormula(clubName) || IsFormula(suffix) || IsFormula(sectionName) || IsFormula(customName)) errors.Add("Spreadsheet formulas are not allowed.");

            // A club that isn't on the list yet is created when the teams are imported.
            var matchingClubs = clubs.Where(x => string.Equals(x.Name.Trim(), clubName, StringComparison.OrdinalIgnoreCase)).ToArray();
            var matchingSections = sections.Where(x => string.Equals(x.DisplayName.Trim(), sectionName, StringComparison.OrdinalIgnoreCase)).ToArray();
            if (matchingClubs.Length > 1) errors.Add("Club name is ambiguous.");
            if (matchingSections.Length != 1) errors.Add(matchingSections.Length == 0 ? "Unknown section." : "Section name is ambiguous.");

            var clubId = matchingClubs.Length == 1 ? matchingClubs[0].Id : (int?)null;
            var sectionId = matchingSections.Length == 1 ? matchingSections[0].Id : (int?)null;
            var teamName = customName.Length > 0 ? customName
                : clubName.Length == 0 ? suffix : string.IsNullOrWhiteSpace(suffix) ? clubName : $"{clubName} {suffix}";
            if (sectionId.HasValue && clubName.Length > 0 && matchingClubs.Length <= 1)
            {
                // The same club and suffix may repeat when teams have their own names; the name must be unique.
                var key = clubId.HasValue
                    ? Key(clubId.Value, sectionId.Value, suffix, customName)
                    : $"new:{clubName.ToUpperInvariant()}:{sectionId.Value}:{suffix.ToUpperInvariant()}:{customName.ToUpperInvariant()}";
                if (!inputKeys.Add(key)) errors.Add("Duplicate team in this CSV.");
                if (clubId.HasValue && existingKeys.Contains(key)) errors.Add("Team already exists in this competition section.");
            }
            rows.Add(new CsvTeamImportRowDto(parsedRow.RowNumber, clubId, clubName, suffix, sectionId, sectionName, teamName, errors));
        }

        var fingerprint = await FingerprintAsync(competitionId, csv, ct);
        return new CsvTeamImportPreviewDto(CurrentPreviewVersion, fingerprint, rows.Count, rows.Count(x => x.Errors.Count == 0), rows);
    }

    public async Task<CsvTeamImportResultDto> ApplyAsync(
        int competitionId, string csv, string fingerprint, int previewVersion, CancellationToken ct)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                db.ChangeTracker.Clear();
                await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
                if (previewVersion != CurrentPreviewVersion)
                    throw new EventToolsException("The import preview version is no longer supported. Preview the file again.", 409);
                var preview = await PreviewAsync(competitionId, csv, ct);
                if (!string.Equals(preview.Fingerprint, fingerprint?.Trim(), StringComparison.OrdinalIgnoreCase))
                    throw new EventToolsException("The competition setup or CSV changed after preview. Preview the file again.", 409);
                if (preview.Rows.Any(x => x.Errors.Count > 0))
                    throw new EventToolsException("The import has validation errors. Correct them and preview again.", 400);

                // Clubs named in the file that aren't on the list yet are created once each.
                var newClubs = preview.Rows.Where(x => x.ClubId is null)
                    .Select(x => x.Club).Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(name => name, name => new Club { Name = name, Region = "Custom" }, StringComparer.OrdinalIgnoreCase);
                db.Clubs.AddRange(newClubs.Values);
                // A team starts with its club's bib colour, as on the other ways of adding a team.
                var existingIds = preview.Rows.Where(x => x.ClubId is not null).Select(x => x.ClubId!.Value).Distinct().ToList();
                var bibByClub = await db.Clubs.AsNoTracking().Where(c => existingIds.Contains(c.Id))
                    .ToDictionaryAsync(c => c.Id, c => c.BibColour, ct);
                var teams = preview.Rows.Select(x => new Team
                {
                    CompetitionId = competitionId,
                    CompetitionSectionId = x.CompetitionSectionId!.Value,
                    ClubId = x.ClubId ?? 0,
                    Club = x.ClubId is null ? newClubs[x.Club] : null,
                    Suffix = x.Suffix,
                    DisplayName = x.TeamName,
                    BibColour = x.ClubId is { } clubId ? bibByClub.GetValueOrDefault(clubId) : null,
                }).ToList();
                db.Teams.AddRange(teams);
                await db.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return new CsvTeamImportResultDto(teams.Count, teams.Select(x => x.Id).ToArray());
            });
        }
        catch (DbUpdateException)
        {
            throw new EventToolsException("The competition changed while teams were being imported. Preview the file again.", 409);
        }
    }

    private async Task<string> FingerprintAsync(int competitionId, string csv, CancellationToken ct)
    {
        var state = new StringBuilder().Append(CurrentPreviewVersion).Append('|').Append(competitionId).Append('|').Append(csv);
        var sections = await db.CompetitionSections.AsNoTracking().Where(x => x.CompetitionId == competitionId)
            .OrderBy(x => x.Id).Select(x => new { x.Id, x.DisplayName }).ToListAsync(ct);
        var clubs = await db.Clubs.AsNoTracking().OrderBy(x => x.Id)
            .Select(x => new { x.Id, x.Name }).ToListAsync(ct);
        var teams = await db.Teams.AsNoTracking().Where(x => x.CompetitionId == competitionId)
            .OrderBy(x => x.Id).Select(x => new { x.Id, x.ClubId, x.CompetitionSectionId, x.Suffix }).ToListAsync(ct);
        foreach (var section in sections) state.Append("|S:").Append(section.Id).Append(':').Append(section.DisplayName);
        foreach (var club in clubs) state.Append("|C:").Append(club.Id).Append(':').Append(club.Name);
        foreach (var team in teams) state.Append("|T:").Append(team.Id).Append(':').Append(team.ClubId).Append(':').Append(team.CompetitionSectionId).Append(':').Append(team.Suffix);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(state.ToString())));
    }

    private static List<ParsedRow> Parse(string csv)
    {
        var rows = new List<ParsedRow>();
        var cells = new List<string>();
        var cell = new StringBuilder();
        var quoted = false;
        var afterQuote = false;
        var rowNumber = 1;

        for (var i = 0; i < csv.Length; i++)
        {
            var ch = csv[i];
            if (quoted)
            {
                if (ch == '"')
                {
                    if (i + 1 < csv.Length && csv[i + 1] == '"') { cell.Append('"'); i++; }
                    else { quoted = false; afterQuote = true; }
                }
                else cell.Append(ch);
                continue;
            }
            if (afterQuote)
            {
                if (ch == ',') { cells.Add(cell.ToString()); cell.Clear(); afterQuote = false; continue; }
                if (ch is '\r' or '\n')
                {
                    cells.Add(cell.ToString()); cell.Clear(); afterQuote = false;
                    rows.Add(new ParsedRow(rowNumber++, cells.ToArray())); cells.Clear();
                    if (ch == '\r' && i + 1 < csv.Length && csv[i + 1] == '\n') i++;
                    continue;
                }
                if (!char.IsWhiteSpace(ch)) throw new EventToolsException($"Malformed CSV near row {rowNumber}: unexpected text after a quoted field.", 400);
                continue;
            }
            if (ch == '"')
            {
                if (cell.Length > 0) throw new EventToolsException($"Malformed CSV near row {rowNumber}: quote inside an unquoted field.", 400);
                quoted = true;
            }
            else if (ch == ',') { cells.Add(cell.ToString()); cell.Clear(); }
            else if (ch is '\r' or '\n')
            {
                cells.Add(cell.ToString()); cell.Clear();
                rows.Add(new ParsedRow(rowNumber++, cells.ToArray())); cells.Clear();
                if (ch == '\r' && i + 1 < csv.Length && csv[i + 1] == '\n') i++;
            }
            else cell.Append(ch);
        }
        if (quoted) throw new EventToolsException($"Malformed CSV near row {rowNumber}: quoted field is not closed.", 400);
        if (cell.Length > 0 || cells.Count > 0 || afterQuote)
        {
            cells.Add(cell.ToString());
            rows.Add(new ParsedRow(rowNumber, cells.ToArray()));
        }
        return rows;
    }

    private static bool IsFormula(string value)
    {
        if (string.IsNullOrEmpty(value)) return false;
        var first = value[0];
        return first is '=' or '+' or '@' or '\t' or '\r'
            || (first == '-' && value.Length > 1 && char.IsDigit(value[1]));
    }

    private static string Key(int clubId, int sectionId, string suffix, string? customName)
        => $"{clubId}:{sectionId}:{suffix.Trim().ToUpperInvariant()}:{(customName ?? string.Empty).Trim().ToUpperInvariant()}";

    private sealed record ParsedRow(int RowNumber, IReadOnlyList<string> Cells);
}

public sealed class EventToolsException(string message, int statusCode) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}
