using System.Globalization;
using System.Text.Json;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.DecForms;

/// <summary>
/// Applies a competition's <see cref="DecFormConfig"/> to a rider on a submitted form: a missing required answer is
/// refused, an answer to a part that is switched off is dropped (it is never stored), and a number over or under the
/// organiser's limit is accepted but recorded as a flag.
/// </summary>
public static class DecFormRules
{
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Why the rider can't be accepted, or null. On success the rider's entry has been filled in.
    /// <paramref name="lenient"/> is the standard form of a competition that never set one up: nothing is newly refused there.
    /// </summary>
    public static string? Apply(DecFormConfig config, bool lenient, RiderEntryInput input, bool isReserve, RiderEntry entry, int currentYear)
    {
        var who = string.IsNullOrWhiteSpace(input.FullName) ? "A rider" : input.FullName.Trim();
        string Missing(string what) => $"{who}: {what} is needed.";

        // Date of birth, in whichever form the organiser chose.
        entry.DateOfBirth = null; entry.BirthYear = null; entry.AgeGroup = null;
        if (config.Dob != FieldRequirement.Off)
        {
            switch (config.DobFormat)
            {
                case DobFormat.Full:
                    entry.DateOfBirth = input.DateOfBirth;
                    if (input.DateOfBirth is null && config.Dob == FieldRequirement.Required && !lenient) return Missing("date of birth");
                    break;
                case DobFormat.YearOnly:
                    if (input.BirthYear is { } y && (y < 1900 || y > currentYear)) return $"{who}: the birth year isn't right.";
                    entry.BirthYear = input.BirthYear;
                    if (input.BirthYear is null && config.Dob == FieldRequirement.Required) return Missing("year of birth");
                    break;
                default:
                    entry.AgeGroup = Clean(input.AgeGroup);
                    if (entry.AgeGroup is null && config.Dob == FieldRequirement.Required) return Missing("age group");
                    break;
            }
        }

        // Weight arrives in kilograms whatever the form showed.
        entry.WeightKg = config.Weight == FieldRequirement.Off ? null : input.WeightKg;
        if (entry.WeightKg is { } w && (w < 5 || w > 250)) return $"{who}: the weight isn't right.";
        if (entry.WeightKg is null && config.Weight == FieldRequirement.Required) return Missing("weight");

        // Pony parts: a non-riding reserve has no pony.
        if (isReserve)
        {
            entry.PonyPassportNumber = null; entry.PonyAge = null;
        }
        else
        {
            if (config.PonyHeight == FieldRequirement.Off) entry.PonyHeightHands = null;
            else if (entry.PonyHeightHands is null && config.PonyHeight == FieldRequirement.Required && !lenient) return Missing("the pony's height");
            entry.PonyPassportNumber = config.PonyPassport == FieldRequirement.Off ? null : Clean(input.PonyPassportNumber);
            if (entry.PonyPassportNumber is null && config.PonyPassport == FieldRequirement.Required) return Missing("the pony's passport or ID number");
            entry.PonyAge = config.PonyAge == FieldRequirement.Off ? null : input.PonyAge;
            if (entry.PonyAge is null && config.PonyAge == FieldRequirement.Required) return Missing("the pony's age");
        }

        entry.MembershipNumber = config.MembershipNumber == FieldRequirement.Off ? null : Clean(input.MembershipNumber);
        if (entry.MembershipNumber is null && config.MembershipNumber == FieldRequirement.Required) return Missing("membership number");

        if (config.EmergencyContact == FieldRequirement.Off) { entry.EmergencyContactName = null; entry.EmergencyContactPhone = null; }
        else
        {
            entry.EmergencyContactName = Clean(input.EmergencyContactName);
            entry.EmergencyContactPhone = Clean(input.EmergencyContactPhone);
            if (config.EmergencyContact == FieldRequirement.Required && (entry.EmergencyContactName is null || entry.EmergencyContactPhone is null))
                return Missing("an emergency contact name and phone number");
            if ((entry.EmergencyContactName is null) != (entry.EmergencyContactPhone is null))
                return $"{who}: give both the emergency contact's name and phone number, or neither.";
        }

        entry.MedicalNotes = config.MedicalNotes == FieldRequirement.Off ? null : Clean(input.MedicalNotes);
        if (entry.MedicalNotes is null && config.MedicalNotes == FieldRequirement.Required) return Missing("medical notes (write “none” if there aren't any)");

        // The organiser's own fields.
        var values = new Dictionary<string, object?>();
        var flags = new List<string>();
        foreach (var field in config.CustomFields)
        {
            string? raw = null;
            input.CustomValues?.TryGetValue(field.Id, out raw);
            raw = Clean(raw);
            if (raw is null)
            {
                if (field.Required) return Missing(field.Label);
                continue;
            }
            if (field.Type == CustomFieldType.Text)
            {
                if (raw.Length > 300) return $"{who}: “{field.Label}” is too long.";
                values[field.Id] = raw;
                continue;
            }
            if (!decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var number) || Math.Abs(number) > 1_000_000m)
                return $"{who}: “{field.Label}” should be a number.";
            values[field.Id] = number;
            var unit = string.IsNullOrEmpty(field.Unit) ? "" : " " + field.Unit;
            if (field.Max is { } max && number > max)
                flags.Add($"{who}: {field.Label} is {Show(number)}{unit}, over the limit of {Show(max)}{unit}.");
            if (field.Min is { } min && number < min)
                flags.Add($"{who}: {field.Label} is {Show(number)}{unit}, under the minimum of {Show(min)}{unit}.");
        }
        entry.CustomValuesJson = values.Count == 0 ? null : JsonSerializer.Serialize(values, Json);
        entry.FlagsJson = flags.Count == 0 ? null : JsonSerializer.Serialize(flags, Json);
        return null;
    }

    static string Show(decimal n) => n.ToString("0.##", CultureInfo.InvariantCulture);

    static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>Custom values as the plain strings the form edits.</summary>
    public static IReadOnlyDictionary<string, string?>? ReadCustomValues(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
            return doc.RootElement.EnumerateObject().ToDictionary(p => p.Name,
                p => p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.GetRawText());
        }
        catch (JsonException) { return null; }
    }

    public static IReadOnlyList<string>? ReadFlags(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try { return JsonSerializer.Deserialize<List<string>>(json, Json) is { Count: > 0 } list ? list : null; }
        catch (JsonException) { return null; }
    }
}
