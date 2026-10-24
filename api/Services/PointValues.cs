using System.Globalization;

namespace MountedGames.Api.Services;

/// <summary>
/// Race points are whole or half points and nothing finer. They are held as <c>double</c>, which stores halves exactly,
/// so sums and comparisons stay exact; <c>decimal</c> is avoided because the SQLite provider cannot sum or sort it.
/// </summary>
public static class PointValues
{
    /// <summary>The most one team can be given for a single race.</summary>
    public const double Max = 1000;

    public static bool IsValid(double value)
        => double.IsFinite(value) && value >= 0 && value <= Max && value * 2 == Math.Floor(value * 2);

    /// <summary>Throws <see cref="ScoreValidationException"/> unless <paramref name="value"/> is a whole or half number from 0 to <see cref="Max"/>.</summary>
    public static void Validate(double value)
    {
        if (!IsValid(value))
            throw new ScoreValidationException("Points must be a whole or half number between 0 and 1000.");
    }

    /// <summary>"3" for a whole value and "2.5" for a half, whatever the culture.</summary>
    public static string Format(double value)
        => value.ToString("0.#", CultureInfo.InvariantCulture);
}
