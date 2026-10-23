using System.Security.Cryptography;
using System.Text;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services;

/// <summary>
/// The wording behind the single sign-up tick (parental consent plus the event terms). The text itself is in the web app (<c>web/src/lib/termsTick.ts</c>);
/// this is its version. Change both together, so a stored version always points at one exact piece of text.
/// </summary>
public static class SignupTerms
{
    public const string WordingVersion = "2026-10-v1";

    /// <summary>
    /// What gets stored on the signup: the tick wording plus which terms were beside it. Organisers can edit their
    /// terms, so a short digest of the text shown (or "default" for the placeholder) is added.
    /// </summary>
    public static string VersionFor(Competition competition)
    {
        var terms = competition.TermsText?.Trim();
        if (string.IsNullOrEmpty(terms)) return $"{WordingVersion}+terms:default";
        var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(terms)))[..8].ToLowerInvariant();
        return $"{WordingVersion}+terms:{digest}";
    }
}
