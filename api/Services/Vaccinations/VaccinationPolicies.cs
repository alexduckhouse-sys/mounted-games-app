using System.Text.Json;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
namespace MountedGames.Api.Services.Vaccinations;
public static class VaccinationPolicies
{
    public const string PonyClub2026 = "pc-2026-01-v1";
    public const string PonyClubSource = "https://resources.pcuk.org/wp-content/uploads/2024/08/The-Pony-Club-Equine-Influenza-VACCINATION-RULE.pdf";
    public static IReadOnlyList<VaccinationPolicyDto> Catalogue { get; } =
    [
        new(PonyClub2026, "Pony Club", "January 2026", PonyClubSource, new(2026, 1, 1), new(2026, 12, 31), new(2026, 10, 29), true,
            ["V2: 21–60 days after V1. V3: 120–180 days after V2.",
             "Courses before 2024: V2 at 21–92 days; V3 no later than seven calendar months after V2. Ambiguous cohort dates need official review.",
             "Later boosters: no more than 12 calendar months apart. A broken course needs a restart.",
             "Do not attend on the injection date or the six following days. Day 7 is allowed.",
             "Bring the passport with the vet's signed and stamped record. Documented October–December 2022 vaccine-shortage exceptions (up to 15 months, then a booster within nine months) need official review."],
            ["A booster within six calendar months plus 21 days before arrival is recommended."]),
        Manual("manual-v1", "Local / other", "Source required"),
        Manual("fei-2026-unverified-v1", "FEI", "2026 — source required"),
        Manual("mgagb-unverified-v1", "MGAGB", "Source required"),
        Manual("eguk-unverified-v1", "EGUK", "Source required"),
        Manual("struk-unverified-v1", "STRUK", "Source required"),
    ];
    private static VaccinationPolicyDto Manual(string id, string name, string edition) =>
        new(id, name, edition, null, null, null, null, false, ["Official review is needed until the current policy has been verified."], []);
    public static VaccinationPolicyDto? Find(string id) => Catalogue.FirstOrDefault(x => x.Id == id);
    public static IEnumerable<VaccinationPolicyVersion> Rows() => Catalogue.Select(x => new VaccinationPolicyVersion
    {
        Id = x.Id, Organisation = x.Organisation, Edition = x.Edition, SourceUrl = x.SourceUrl,
        EffectiveFrom = x.EffectiveFrom, EffectiveUntil = x.EffectiveUntil, VerifiedOn = x.VerifiedOn,
        Automatic = x.Automatic, RulesJson = JsonSerializer.Serialize(new { x.Mandatory, x.Recommended }),
    });
}
