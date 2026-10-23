using System.Text.RegularExpressions;

namespace MountedGames.Api.Services.DecForms;

/// <summary>Friendly checking of UK and Irish phone numbers: spaces, dashes, brackets and +44 / 0044 forms are all fine.</summary>
public static partial class PhoneNumbers
{
    [GeneratedRegex(@"[\s\-\.\(\)]")]
    private static partial Regex Separators();

    /// <summary>
    /// A cleaned number: national numbers keep their leading 0 ("07123456789"); international ones are "+44" or "+353" followed
    /// by the number without its national zero. False when it doesn't look like a UK or Irish number. Deliberately not strict:
    /// it checks the shape, not that the number exists.
    /// </summary>
    public static bool TryNormalise(string? input, out string normalised)
    {
        normalised = string.Empty;
        if (string.IsNullOrWhiteSpace(input)) return false;
        var text = Separators().Replace(input.Trim().Replace("(0)", ""), "");
        if (text.StartsWith("00")) text = "+" + text[2..];
        if (text.Length == 0 || !text.Skip(text[0] == '+' ? 1 : 0).All(char.IsAsciiDigit)) return false;

        if (text[0] != '+')
        {
            if (text[0] != '0' || text.Length is < 9 or > 11) return false;
            normalised = text;
            return true;
        }

        var prefix = text.StartsWith("+44") ? "+44" : text.StartsWith("+353") ? "+353" : null;
        if (prefix is null) return false;
        var digits = text[prefix.Length..];
        if (digits.StartsWith('0')) digits = digits[1..]; // "+44 07123..." typed with the national zero as well
        if (digits.Length is < 7 or > 10) return false;
        normalised = prefix + digits;
        return true;
    }
}
