using System.Text.RegularExpressions;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// Reads and checks how a result ended. Every result that did not finish has <c>Eliminated</c> set, so the
/// places, points and standings code that tests it keeps working. <c>Status</c> only says why, and is 0 on rows
/// saved before the choice existed: those were all eliminations.
/// </summary>
public static class ResultStatuses
{
    public const int NoteMaxLength = 500;
    private static readonly Regex CardRegex = new(@"\[card:(yellow|red)\]", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex FlagRegex = new(@"\[flag:([a-z0-9-]+)\]", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>The status to show for a result: Finished unless it did not finish, and Eliminated for old rows.</summary>
    public static ResultStatus Of(bool eliminated, ResultStatus stored)
        => !eliminated ? ResultStatus.Finished : stored == ResultStatus.Finished ? ResultStatus.Eliminated : stored;

    public static ResultStatus Of(Result result) => Of(result.Eliminated, result.Status);

    /// <summary>Extracts a public referee card ("yellow" or "red") from a result's referee note, or null if none.</summary>
    public static string? RefereeCardOf(string? note)
    {
        if (string.IsNullOrWhiteSpace(note)) return null;
        var match = CardRegex.Match(note);
        return match.Success ? match.Groups[1].Value.ToLowerInvariant() : null;
    }

    /// <summary>Returns the highest-severity referee card ("red" &gt; "yellow") across a team's results, or null if none.</summary>
    public static string? LatestCardOf(IEnumerable<Result>? results)
    {
        if (results is null) return null;
        string? card = null;
        foreach (var r in results)
        {
            var c = RefereeCardOf(r.RefereeNote);
            if (c == "red") return "red";
            if (c == "yellow") card = "yellow";
        }
        return card;
    }

    /// <summary>Returns the highest-severity referee card ("red" &gt; "yellow") on a team or its results.</summary>
    public static string? TeamCardOf(Team? team)
    {
        if (team is null) return null;
        var fromTeam = RefereeCardOf(team.BibDescription);
        var fromResults = LatestCardOf(team.Results);
        if (fromTeam == "red" || fromResults == "red") return "red";
        if (fromTeam == "yellow" || fromResults == "yellow") return "yellow";
        return null;
    }

    /// <summary>Extracts a team's flag code (e.g. "gb-wls", "gb-eng") from its bib description, or null if none.</summary>
    public static string? TeamFlagOf(string? bibDescription)
    {
        if (string.IsNullOrWhiteSpace(bibDescription)) return null;
        var match = FlagRegex.Match(bibDescription);
        return match.Success ? match.Groups[1].Value.ToLowerInvariant() : null;
    }

    /// <summary>Strips internal <c>[card:...]</c> tags from a team's bib description while keeping <c>[flag:...]</c> and text.</summary>
    public static string? PublicBibDescription(string? bibDescription)
    {
        if (string.IsNullOrWhiteSpace(bibDescription)) return null;
        var cleaned = Regex.Replace(CardRegex.Replace(bibDescription, string.Empty), @"\s{2,}", " ").Trim();
        return string.IsNullOrWhiteSpace(cleaned) ? null : cleaned;
    }

    /// <summary>Applies or clears a <c>[card:yellow]</c> or <c>[card:red]</c> tag on a referee note or bib description.</summary>
    public static string? ApplyCardTag(string? note, string? card)
    {
        var cleaned = string.IsNullOrWhiteSpace(note)
            ? string.Empty
            : Regex.Replace(CardRegex.Replace(note, string.Empty), @"\s{2,}", " ").Trim();
        var norm = card?.Trim().ToLowerInvariant();
        if (norm is not ("yellow" or "red"))
            return string.IsNullOrWhiteSpace(cleaned) ? null : cleaned;
        var tag = $"[card:{norm}]";
        return string.IsNullOrWhiteSpace(cleaned) ? tag : $"{tag} {cleaned}";
    }

    /// <summary>Updates a team's bib description while preserving existing <c>[flag:...]</c> and <c>[card:...]</c> tags unless overridden.</summary>
    public static string? MergeBibTags(
        string? existingBibDescription,
        string? newBibDescription,
        string? flagOverride = null,
        string? cardOverride = null)
    {
        var source = newBibDescription ?? existingBibDescription ?? string.Empty;
        var plainText = Regex.Replace(
            FlagRegex.Replace(CardRegex.Replace(source, string.Empty), string.Empty),
            @"\s{2,}", " ").Trim();

        var flag = flagOverride is not null
            ? (string.IsNullOrWhiteSpace(flagOverride) ? null : flagOverride.Trim().ToLowerInvariant())
            : (TeamFlagOf(newBibDescription) ?? TeamFlagOf(existingBibDescription));

        var card = cardOverride is not null
            ? (cardOverride.Trim().ToLowerInvariant() is "yellow" or "red" ? cardOverride.Trim().ToLowerInvariant() : null)
            : (RefereeCardOf(newBibDescription) ?? RefereeCardOf(existingBibDescription));

        var parts = new List<string>(3);
        if (flag is not null) parts.Add($"[flag:{flag}]");
        if (card is not null) parts.Add($"[card:{card}]");
        if (!string.IsNullOrWhiteSpace(plainText)) parts.Add(plainText);
        return parts.Count == 0 ? null : string.Join(" ", parts);
    }

    /// <summary>The letters printed on a sheet or score grid; null for a finisher.</summary>
    public static string? Letter(ResultStatus status) => status switch
    {
        ResultStatus.Eliminated => "E",
        ResultStatus.DidNotStart => "DNS",
        ResultStatus.DidNotFinish => "DNF",
        ResultStatus.Retired => "R",
        _ => null,
    };

    /// <summary>The letters for a stored result, or null for a finisher.</summary>
    public static string? Letter(bool eliminated, ResultStatus stored) => Letter(Of(eliminated, stored));

    /// <summary>A note trimmed, empty as null. Throws when it is longer than <see cref="NoteMaxLength"/>.</summary>
    public static string? CleanNote(string? note)
    {
        var text = note?.Trim();
        if (string.IsNullOrEmpty(text)) return null;
        if (text.Length > NoteMaxLength)
            throw new ScoreValidationException($"A note must be {NoteMaxLength} characters or fewer.");
        return text;
    }
}
