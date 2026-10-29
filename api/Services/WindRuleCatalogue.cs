using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

public record WindRuleProfile(string Id, string Name, string Source, string Clause, string Authority,
    string Guidance, bool SubstitutionsVerified, string VerifiedOn = "2026-10-29", string EffectiveFrom = "2026-01-01", string EffectiveThrough = "2026-12-31");

/// <summary>Versioned reviewed clauses. A source link alone never grants a change.</summary>
public static class WindRuleCatalogue
{
    public const string Pc = "https://resources.pcuk.org/wp-content/uploads/2025/12/RULEBOOK-Mounted-Games-2026-Web.pdf";
    public const string Imga = "https://mounted-games.org/wp-content/uploads/2026/02/IMGA-Rule-Book-2026.pdf";
    public const string Struk = "https://www.strukevents.co.uk/_files/ugd/7ce1db_f7566f4e7397456db2a0497c226a5598.pdf";
    public static readonly WindRuleProfile[] All = [
        new("unverified", "Rules not confirmed", "", "", "Official review", "Inspect the arena and equipment. Confirm the event rules with its officials.", false),
        new("pc-2026-v1", "Pony Club 2026", Pc, "22(q), p39", "Official Steward", "The Official Steward may choose the published spare or void an event that cannot run. Five Flag team and pairs provisions allow rubber bands to keep flags furled (pp45,54,67). Check the published age group and race list.", true),
        new("imga-2026-v1", "IMGA 2026", Imga, "CR17.1–5, pp31–32; AO3.7, p39", "Referee with organiser", "The referee decides weighting of cones, bins and buckets. Added weights become equipment; subsequent heats use the same arrangements. Exact tyre placement is not verified. Substitution requires the referee to consult the organiser.", true),
        new("mgagb-2026-v1", "MGAGB 2026 — adoption needs checking", "https://www.mgagb.co.uk/rulebook", "IMGA adoption; domestic supplement unverified", "Referee with organiser", "Confirm the event's published adoption and amendments before using IMGA provisions. Unverified domestic amendments remain for manual official review.", false),
        new("struk-2026-v1", "STRUK 2026", Struk, "1.2.2–1.2.3, pp6–7; 1.3.1; Slam Dunk p67", "Starter", "Starter review for wind stops and replays. Slam Dunk teams may use the fifth rider to hold the stand without leaning it to help the rider. No extension to pairs or individuals. Programme substitution authority is unverified.", false),
        new("eguk-unverified-v1", "EGUK — rule not verified", "", "Current authoritative source required", "Official review", "General equipment inspection and manual official review only.", false),
        new("local-v1", "Local / friendly / training", "", "Event's published local rules required", "Organiser", "Record the local rules and official approval. Local adaptations are not governing-body permissions.", false),
    ];
    public static WindRuleProfile Find(string? id) => All.FirstOrDefault(p => p.Id == id) ?? All[0];

    public static string? ReplacementName(WindRulesSelection selection, SectionFormat format, string name)
    {
        if (!selection.AdoptionConfirmed || string.IsNullOrWhiteSpace(selection.EventLevel)) return null;
        if (selection.ProfileId == "pc-2026-v1" && format != SectionFormat.Individual
            && !string.IsNullOrWhiteSpace(selection.PublishedSpare)
            && name.Equals(selection.PublishedSpare, StringComparison.OrdinalIgnoreCase))
            return RaceVariants.Resolve(name, format);
        // Do not reuse the library's unofficial individual adaptations as IMGA races.
        if (selection.ProfileId == "imga-2026-v1" && name == HooplaName(format)) return name;
        return null;
    }
    public static string HooplaName(SectionFormat format) => $"Hoopla — IMGA 2026 ({format})";
}
