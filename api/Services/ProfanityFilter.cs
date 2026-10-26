using System.Text.RegularExpressions;

namespace MountedGames.Api.Services;

/// <summary>
/// Masks swear words in chat and direct messages before they are saved or broadcast. A swear word keeps its first letter
/// (in the case it was typed) and the rest becomes asterisks, so "Bloody" becomes "B*****". Whole words only, any case.
/// </summary>
public static class ProfanityFilter
{
    private static readonly string[] Words =
    [
        "fuck", "fucks", "fucked", "fucker", "fuckers", "fucking", "fuckin", "motherfucker", "motherfuckers", "mofo",
        "shit", "shits", "shite", "shitty", "shitting", "bullshit", "horseshit", "shithead",
        "cunt", "cunts",
        "bollocks", "bollock", "bollocking",
        "bastard", "bastards",
        "wanker", "wankers", "wank", "wanking",
        "twat", "twats",
        "prick", "pricks",
        "bitch", "bitches", "bitchy",
        "arse", "arses", "arsehole", "arseholes",
        "dick", "dicks", "dickhead", "dickheads",
        "piss", "pissed", "pisses", "pissing",
        "bloody",
        "crap", "crappy",
    ];

    private static readonly Regex Pattern = new(
        $@"\b(?:{string.Join("|", Words.OrderByDescending(w => w.Length).Select(Regex.Escape))})\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled,
        TimeSpan.FromSeconds(1));

    public static string Clean(string text)
        => string.IsNullOrEmpty(text) ? text : Pattern.Replace(text, m => m.Value[0] + new string('*', m.Value.Length - 1));
}
