using System.Text.Json;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.DecForms;

/// <summary>Whether a dec form part is asked for. Travels as a number.</summary>
public enum FieldRequirement { Off = 0, Optional = 1, Required = 2 }

/// <summary>How a rider's age is asked for. Travels as a number.</summary>
public enum DobFormat { Full = 0, YearOnly = 1, AgeGroup = 2 }

public enum WeightUnit { Kg = 0, StonePounds = 1 }

public enum CustomFieldType { Text = 0, Number = 1 }

/// <summary>One of the organiser's own questions. A number can have a limit; going over is flagged, never refused.</summary>
public record DecFormCustomField(
    string Id, string Label, CustomFieldType Type, bool Required,
    decimal? Min = null, decimal? Max = null, string? Unit = null);

/// <summary>
/// What a competition's dec form asks. The base form is always the pony's name, the rider's name, the bib or number and the
/// trainer's name; everything here is added to it. A competition with no saved setup uses <see cref="Standard"/>.
/// </summary>
public record DecFormConfig(
    FieldRequirement Dob, DobFormat DobFormat,
    FieldRequirement Weight, WeightUnit WeightUnit,
    FieldRequirement PonyHeight, FieldRequirement PonyPassport, FieldRequirement PonyAge,
    FieldRequirement MembershipNumber, FieldRequirement EmergencyContact, FieldRequirement MedicalNotes,
    IReadOnlyList<DecFormCustomField> CustomFields,
    FieldRequirement TrainerPhone = FieldRequirement.Off, FieldRequirement Bib = FieldRequirement.Off)
{
    /// <summary>Today's form: date of birth, pony height and nothing else added. Kept exactly for competitions that never set one up.</summary>
    public static readonly DecFormConfig Standard = new(
        FieldRequirement.Required, DobFormat.Full, FieldRequirement.Off, WeightUnit.Kg,
        FieldRequirement.Required, FieldRequirement.Off, FieldRequirement.Off,
        FieldRequirement.Off, FieldRequirement.Off, FieldRequirement.Off, [],
        FieldRequirement.Optional, FieldRequirement.Optional);

    /// <summary>The bare base form, the starting point when an organiser chooses their own.</summary>
    public static readonly DecFormConfig Basic = Standard with
    {
        Dob = FieldRequirement.Off, PonyHeight = FieldRequirement.Off,
        TrainerPhone = FieldRequirement.Required, Bib = FieldRequirement.Off,
    };

    public const int MaxCustomFields = 12;

    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static DecFormConfig? Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<DecFormConfig>(json, Json); }
        catch (JsonException) { return null; }
    }

    public string ToJson() => JsonSerializer.Serialize(this, Json);

    /// <summary>The setup in force for a competition: its own, or the standard form.</summary>
    public static DecFormConfig For(Competition competition) => Parse(competition.DecFormConfigJson) ?? Standard;

    /// <summary>Why the setup can't be saved, or null when it can.</summary>
    public string? Validate()
    {
        if (!Enum.IsDefined(Dob) || !Enum.IsDefined(DobFormat) || !Enum.IsDefined(Weight) || !Enum.IsDefined(WeightUnit)
            || !Enum.IsDefined(PonyHeight) || !Enum.IsDefined(PonyPassport) || !Enum.IsDefined(PonyAge)
            || !Enum.IsDefined(TrainerPhone) || !Enum.IsDefined(Bib) || !Enum.IsDefined(MembershipNumber) || !Enum.IsDefined(EmergencyContact) || !Enum.IsDefined(MedicalNotes))
            return "One of the dec form settings isn't recognised.";
        var fields = CustomFields ?? [];
        if (fields.Count > MaxCustomFields) return $"A dec form can have up to {MaxCustomFields} extra fields.";
        var seen = new HashSet<string>();
        foreach (var f in fields)
        {
            if (string.IsNullOrWhiteSpace(f.Id) || f.Id.Length > 40 || !f.Id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))
                return "An extra field has a bad id.";
            if (!seen.Add(f.Id)) return "Two extra fields share an id.";
            if (string.IsNullOrWhiteSpace(f.Label) || f.Label.Trim().Length > 80) return "Give each extra field a name of up to 80 characters.";
            if (!Enum.IsDefined(f.Type)) return $"“{f.Label}” has an unknown type.";
            if (f.Unit is { Length: > 20 }) return $"The unit for “{f.Label}” is too long.";
            if (f.Type == CustomFieldType.Text && (f.Min is not null || f.Max is not null)) return $"“{f.Label}” is text, so it can't have a limit.";
            if (f.Min is { } lo && f.Max is { } hi && lo > hi) return $"The smallest allowed for “{f.Label}” is bigger than the largest.";
        }
        return null;
    }

    /// <summary>The same setup with labels trimmed and text fields stripped of limits, ready to store.</summary>
    public DecFormConfig Normalised() => this with
    {
        CustomFields = (CustomFields ?? []).Select(f => f with
        {
            Label = f.Label.Trim(), Unit = string.IsNullOrWhiteSpace(f.Unit) ? null : f.Unit.Trim(),
        }).ToList(),
    };
}
