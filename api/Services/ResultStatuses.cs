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

    /// <summary>The status to show for a result: Finished unless it did not finish, and Eliminated for old rows.</summary>
    public static ResultStatus Of(bool eliminated, ResultStatus stored)
        => !eliminated ? ResultStatus.Finished : stored == ResultStatus.Finished ? ResultStatus.Eliminated : stored;

    public static ResultStatus Of(Result result) => Of(result.Eliminated, result.Status);

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
