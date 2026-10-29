using System.Numerics;
using System.Text.RegularExpressions;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Payouts;

/// <summary>
/// The checks and tidy-ups for a club's payout details. <c>web/src/lib/payouts.ts</c> mirrors the format rules,
/// so change both together. Full bank numbers pass through here only to be checked and masked; nothing here logs.
/// </summary>
public static partial class PayoutRules
{
    public const string Bullets = "••••";

    /// <summary>Digits-only form of a sort code, or null when it isn't six digits.</summary>
    public static string? NormaliseSortCode(string? raw)
    {
        var digits = new string((raw ?? string.Empty).Where(c => c != ' ' && c != '-').ToArray());
        return digits.Length == 6 && digits.All(char.IsAsciiDigit) ? digits : null;
    }

    /// <summary>Sort code shown as 12-34-56.</summary>
    public static string FormatSortCode(string digits) => $"{digits[..2]}-{digits[2..4]}-{digits[4..]}";

    /// <summary>Digits-only form of a UK account number, or null when it isn't eight digits.</summary>
    public static string? NormaliseAccountNumber(string? raw)
    {
        var digits = new string((raw ?? string.Empty).Where(c => c != ' ' && c != '-').ToArray());
        return digits.Length == 8 && digits.All(char.IsAsciiDigit) ? digits : null;
    }

    private static readonly Dictionary<string, int> IbanLengths = new()
    {
        ["IE"] = 22, ["GB"] = 22, ["FR"] = 27, ["DE"] = 22, ["ES"] = 24, ["IT"] = 27, ["NL"] = 18,
        ["BE"] = 16, ["PT"] = 25, ["AT"] = 20, ["LU"] = 20, ["FI"] = 18,
    };

    /// <summary>The IBAN without spaces, in capitals, when its format and mod-97 check pass; otherwise null.</summary>
    public static string? NormaliseIban(string? raw)
    {
        var iban = new string((raw ?? string.Empty).Where(c => c != ' ').ToArray()).ToUpperInvariant();
        if (iban.Length is < 15 or > 34 || !IbanShape().IsMatch(iban)) return null;
        if (IbanLengths.TryGetValue(iban[..2], out var expected) && iban.Length != expected) return null;
        // Move the first four characters to the end, turn letters into numbers (A=10 ... Z=35), and the remainder mod 97 must be 1.
        var rearranged = iban[4..] + iban[..4];
        var digits = new System.Text.StringBuilder();
        foreach (var c in rearranged) digits.Append(char.IsAsciiLetter(c) ? (c - 'A' + 10).ToString() : c.ToString());
        return BigInteger.Parse(digits.ToString()) % 97 == 1 ? iban : null;
    }

    public static bool IsValidBic(string? raw)
    {
        var bic = new string((raw ?? string.Empty).Where(c => c != ' ').ToArray()).ToUpperInvariant();
        return BicShape().IsMatch(bic);
    }

    /// <summary>The bank behind a UK sort code, where the first two digits make it obvious; otherwise blank.</summary>
    public static string? BankNameFor(string sortCodeDigits) => sortCodeDigits[..2] switch
    {
        "07" => "Nationwide",
        "09" => "Santander",
        "11" => "Halifax",
        "20" => "Barclays",
        "30" => "Lloyds",
        "40" => "HSBC",
        "60" => "NatWest",
        "77" => "TSB",
        "83" => "Royal Bank of Scotland",
        _ => null,
    };

    public static string Last4(string digits) => digits[^4..];

    public static string Masked(string? last4) => string.IsNullOrEmpty(last4) ? string.Empty : Bullets + last4;

    /// <summary>"Barclays ••••1234" style line for a saved account (bank name omitted when unknown).</summary>
    public static string? MaskedAccount(IPayoutAccount a)
    {
        var last4 = a.AccountLast4 ?? a.IbanLast4;
        return string.IsNullOrEmpty(last4) ? null : Masked(last4);
    }

    public static string CurrencyFor(PayoutRegion region) => region == PayoutRegion.Eu ? "EUR" : "GBP";

    public static string? ValidateEmail(string value) =>
        value.Length <= 200 && EmailShape().IsMatch(value) ? null : "Enter a valid email address.";

    public static string? ValidatePhone(string value)
    {
        var digits = value.Count(char.IsAsciiDigit);
        return value.Length <= 30 && PhoneShape().IsMatch(value) && digits is >= 7 and <= 15 ? null : "Enter a valid phone number.";
    }

    public static string? ValidatePostcode(string value, PayoutRegion region) => region == PayoutRegion.Uk
        ? UkPostcodeShape().IsMatch(value.ToUpperInvariant()) ? null : "Enter a UK postcode, like SW1A 1AA."
        : PostcodeLoose().IsMatch(value) ? null : "Enter a valid postcode.";

    public static string? ValidateRegistrationNumber(string value) =>
        RegistrationShape().IsMatch(value.Replace(" ", "")) ? null : "Use 5 to 12 letters or numbers.";

    /// <summary>The VAT number in capitals without spaces, or null when it is not valid.</summary>
    public static string? NormaliseVat(string value, PayoutRegion region)
    {
        var v = value.Replace(" ", "").ToUpperInvariant();
        if (region == PayoutRegion.Uk)
        {
            if (UkVatDigits().IsMatch(v)) return "GB" + v;
            return UkVat().IsMatch(v) ? v : null;
        }
        return EuVat().IsMatch(v) ? v : null;
    }

    public static string? ValidateDescriptor(string value) =>
        DescriptorShape().IsMatch(value) && value.Any(char.IsAsciiLetter)
            ? null
            : "Use 5 to 22 letters, numbers or spaces, with at least one letter.";

    public static string? ValidateDateOfBirth(DateOnly dob, DateOnly today)
    {
        if (dob > today.AddYears(-18)) return "They must be at least 18.";
        return dob < today.AddYears(-120) ? "Check the date of birth." : null;
    }

    public static bool NeedsRegistrationNumber(PayoutBusinessType type) => type is PayoutBusinessType.Charity or PayoutBusinessType.Company;

    [GeneratedRegex("^[A-Z]{2}[0-9]{2}[A-Z0-9]+$")] private static partial Regex IbanShape();
    [GeneratedRegex("^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$")] private static partial Regex BicShape();
    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")] private static partial Regex EmailShape();
    [GeneratedRegex(@"^\+?[0-9 ()\-]+$")] private static partial Regex PhoneShape();
    [GeneratedRegex(@"^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$")] private static partial Regex UkPostcodeShape();
    [GeneratedRegex(@"^[A-Za-z0-9 \-]{3,10}$")] private static partial Regex PostcodeLoose();
    [GeneratedRegex("^[A-Za-z0-9]{5,12}$")] private static partial Regex RegistrationShape();
    [GeneratedRegex(@"^[0-9]{9}([0-9]{3})?$")] private static partial Regex UkVatDigits();
    [GeneratedRegex(@"^GB[0-9]{9}([0-9]{3})?$")] private static partial Regex UkVat();
    [GeneratedRegex("^[A-Z]{2}[A-Z0-9]{7,12}$")] private static partial Regex EuVat();
    [GeneratedRegex("^[A-Za-z0-9 ]{5,22}$")] private static partial Regex DescriptorShape();
}
