using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Payouts;

public record StripeAccountStatus(
    string AccountId,
    bool ChargesEnabled,
    bool PayoutsEnabled,
    bool DetailsSubmitted,
    string? BankName = null,
    string? SortCode = null,
    string? Last4 = null,
    string? Country = null,
    string? AccountHolderName = null);

/// <summary>
/// Stripe Connect Standard/Express onboarding and account status synchronisation over <see cref="IHttpClientFactory"/>,
/// plus <c>Stripe-Signature</c> HMAC-SHA256 verification. Never logs or stores full bank numbers or secret keys.
/// </summary>
public class StripeConnectService(IHttpClientFactory httpClientFactory, IConfiguration configuration, TimeProvider time)
{
    public const string HttpClientName = "stripe";
    public const int WebhookToleranceSeconds = 300;

    private static readonly HashSet<string> AllowedEuCountries = new(StringComparer.OrdinalIgnoreCase)
    {
        "IE", "FR", "DE", "ES", "IT", "NL", "BE", "PT", "AT", "LU", "FI", "SE", "DK", "PL", "CZ", "SK",
        "HU", "RO", "BG", "HR", "SI", "EE", "LV", "LT", "CY", "MT", "GR", "NO", "LI"
    };

    private string? SecretKey => configuration["Stripe:SecretKey"] ?? configuration["STRIPE_SECRET_KEY"];

    private string? ConnectWebhookSecret =>
        configuration["Stripe:ConnectWebhookSecret"]
        ?? configuration["STRIPE_CONNECT_WEBHOOK_SECRET"];

    public bool IsConfigured => !string.IsNullOrWhiteSpace(SecretKey);

    public bool IsWebhookConfigured => !string.IsNullOrWhiteSpace(ConnectWebhookSecret);

    public bool IsLivemodeMismatch(bool eventLivemode)
    {
        var secret = SecretKey?.Trim();
        if (string.IsNullOrWhiteSpace(secret)) return false;
        if ((secret.StartsWith("sk_live_", StringComparison.OrdinalIgnoreCase)
            || secret.StartsWith("rk_live_", StringComparison.OrdinalIgnoreCase))
            && !eventLivemode)
        {
            return true;
        }
        if ((secret.StartsWith("sk_test_", StringComparison.OrdinalIgnoreCase)
            || secret.StartsWith("rk_test_", StringComparison.OrdinalIgnoreCase))
            && eventLivemode)
        {
            return true;
        }
        return false;
    }

    public string PublicBaseUrl
    {
        get
        {
            var raw = configuration["Sharing:PublicBaseUrl"]
                ?? configuration["Email:SiteUrl"]
                ?? "https://mounted-games-app.vercel.app";
            return raw.TrimEnd('/');
        }
    }

    public static bool IsSafeStripeUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)) return false;
        var host = uri.Host;
        return host.Equals("connect.stripe.com", StringComparison.OrdinalIgnoreCase)
            || host.Equals("stripe.com", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".stripe.com", StringComparison.OrdinalIgnoreCase);
    }

    public static string ResolveCountryCode(PayoutRegion region, string? requestedCountry = null, string? ibanCountry = null)
    {
        if (region == PayoutRegion.Uk)
        {
            if (!string.IsNullOrWhiteSpace(requestedCountry))
            {
                var c = requestedCountry.Trim().ToUpperInvariant();
                if (c != "GB")
                    throw new InvalidOperationException("UK payout accounts must use GB as their Stripe country.");
            }
            return "GB";
        }

        var candidate = !string.IsNullOrWhiteSpace(requestedCountry)
            ? requestedCountry.Trim().ToUpperInvariant()
            : !string.IsNullOrWhiteSpace(ibanCountry)
                ? ibanCountry.Trim().ToUpperInvariant()
                : null;

        if (string.IsNullOrWhiteSpace(candidate) || candidate.Length != 2 || !AllowedEuCountries.Contains(candidate))
        {
            throw new InvalidOperationException("For Ireland or EU accounts, please select your 2-letter EU country code or save your IBAN first before connecting Stripe.");
        }

        return candidate;
    }

    public async Task<string> CreateOrGetAccountAsync(
        string? existingAccountId,
        PayoutRegion region,
        string? email,
        string? legalName,
        CancellationToken ct = default,
        string? countryCode = null,
        string? ibanCountry = null,
        string? idempotencyKey = null)
    {
        if (!string.IsNullOrWhiteSpace(existingAccountId))
            return existingAccountId;

        var secret = RequireSecretKey();
        var accountType = configuration["Stripe:ConnectAccountType"];
        if (string.IsNullOrWhiteSpace(accountType)) accountType = "standard";
        var resolvedCountry = ResolveCountryCode(region, countryCode, ibanCountry);

        var fields = new List<KeyValuePair<string, string>>
        {
            new("type", accountType.Trim().ToLowerInvariant()),
            new("country", resolvedCountry),
        };
        if (!string.IsNullOrWhiteSpace(email))
            fields.Add(new("email", email.Trim()));
        if (!string.IsNullOrWhiteSpace(legalName))
            fields.Add(new("business_profile[name]", legalName.Trim()));

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.stripe.com/v1/accounts")
        {
            Content = new FormUrlEncodedContent(fields),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", secret);
        if (!string.IsNullOrWhiteSpace(idempotencyKey))
            req.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey.Trim());

        var client = httpClientFactory.CreateClient(HttpClientName);
        using var res = await client.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException("Could not create the Stripe account. Please try again.");

        using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        if (!doc.RootElement.TryGetProperty("id", out var idProp)
            || idProp.GetString() is not { Length: > 0 } id
            || !id.StartsWith("acct_", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Stripe returned an unexpected account response.");
        }

        return id;
    }

    public async Task<string> CreateAccountLinkAsync(
        string stripeAccountId,
        string refreshUrl,
        string returnUrl,
        CancellationToken ct = default)
    {
        var secret = RequireSecretKey();
        var fields = new List<KeyValuePair<string, string>>
        {
            new("account", stripeAccountId),
            new("type", "account_onboarding"),
            new("refresh_url", refreshUrl),
            new("return_url", returnUrl),
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.stripe.com/v1/account_links")
        {
            Content = new FormUrlEncodedContent(fields),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", secret);

        var client = httpClientFactory.CreateClient(HttpClientName);
        using var res = await client.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException("Could not start Stripe onboarding. Please try again.");

        using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        if (!doc.RootElement.TryGetProperty("url", out var urlProp)
            || urlProp.GetString() is not { Length: > 0 } url
            || !IsSafeStripeUrl(url))
        {
            throw new InvalidOperationException("Stripe returned an invalid onboarding link.");
        }

        return url;
    }

    public async Task<StripeAccountStatus> SyncAccountStatusAsync(string stripeAccountId, CancellationToken ct = default)
    {
        var secret = RequireSecretKey();
        using var req = new HttpRequestMessage(
            HttpMethod.Get,
            $"https://api.stripe.com/v1/accounts/{Uri.EscapeDataString(stripeAccountId)}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", secret);

        var client = httpClientFactory.CreateClient(HttpClientName);
        using var res = await client.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException("Could not check the Stripe account status.");

        using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        return ParseAccountObject(doc.RootElement, stripeAccountId);
    }

    public static StripeAccountStatus ParseAccountObject(JsonElement obj, string? fallbackAccountId = null)
    {
        var accountId = obj.TryGetProperty("id", out var idProp) && idProp.ValueKind == JsonValueKind.String
            ? idProp.GetString() ?? fallbackAccountId ?? string.Empty
            : fallbackAccountId ?? string.Empty;
        var chargesEnabled = obj.TryGetProperty("charges_enabled", out var ce) && ce.ValueKind == JsonValueKind.True;
        var payoutsEnabled = obj.TryGetProperty("payouts_enabled", out var pe) && pe.ValueKind == JsonValueKind.True;
        var detailsSubmitted = obj.TryGetProperty("details_submitted", out var ds) && ds.ValueKind == JsonValueKind.True;

        string? bankName = null, sortCode = null, last4 = null, country = null, holder = null;
        if (obj.TryGetProperty("external_accounts", out var ext)
            && ext.ValueKind == JsonValueKind.Object
            && ext.TryGetProperty("data", out var data)
            && data.ValueKind == JsonValueKind.Array
            && data.GetArrayLength() > 0)
        {
            var first = data[0];
            if (first.ValueKind == JsonValueKind.Object)
            {
                if (first.TryGetProperty("bank_name", out var bn) && bn.ValueKind == JsonValueKind.String)
                    bankName = bn.GetString();
                if (first.TryGetProperty("routing_number", out var rn) && rn.ValueKind == JsonValueKind.String)
                    sortCode = rn.GetString();
                if (first.TryGetProperty("last4", out var l4) && l4.ValueKind == JsonValueKind.String)
                    last4 = l4.GetString();
                if (first.TryGetProperty("country", out var co) && co.ValueKind == JsonValueKind.String)
                    country = co.GetString();
                if (first.TryGetProperty("account_holder_name", out var ah) && ah.ValueKind == JsonValueKind.String)
                    holder = ah.GetString();
            }
        }

        return new StripeAccountStatus(accountId, chargesEnabled, payoutsEnabled, detailsSubmitted, bankName, sortCode, last4, country, holder);
    }

    public static void ApplyStatus(IPayoutAccount account, StripeAccountStatus status, DateTime utcNow)
    {
        if (!string.IsNullOrWhiteSpace(status.AccountId))
            account.StripeAccountId = status.AccountId;
        account.StripeChargesEnabled = status.ChargesEnabled;
        account.StripePayoutsEnabled = status.PayoutsEnabled;
        account.StripeDetailsSubmitted = status.DetailsSubmitted;
        if (status.ChargesEnabled && status.PayoutsEnabled && account.StripeConnectedAt is null)
            account.StripeConnectedAt = utcNow;

        if (!string.IsNullOrWhiteSpace(status.Last4) && status.Last4.Length == 4)
        {
            if (account.Region == PayoutRegion.Uk)
            {
                account.AccountLast4 = status.Last4;
                if (PayoutRules.NormaliseSortCode(status.SortCode) is { } sc)
                {
                    account.SortCode = PayoutRules.FormatSortCode(sc);
                    account.BankName = !string.IsNullOrWhiteSpace(status.BankName) ? status.BankName : PayoutRules.BankNameFor(sc);
                }
                else if (!string.IsNullOrWhiteSpace(status.BankName))
                {
                    account.BankName = status.BankName;
                }
            }
            else
            {
                account.IbanLast4 = status.Last4;
                if (!string.IsNullOrWhiteSpace(status.Country) && status.Country.Length == 2)
                    account.IbanCountry = status.Country.ToUpperInvariant();
                if (!string.IsNullOrWhiteSpace(status.BankName))
                    account.BankName = status.BankName;
            }
            if (string.IsNullOrWhiteSpace(account.BankAccountHolder))
                account.BankAccountHolder = !string.IsNullOrWhiteSpace(status.AccountHolderName)
                    ? status.AccountHolderName
                    : account.LegalName ?? "Connected Stripe account";
        }

        account.Status = ComputeStatus(account);
        account.UpdatedAt = utcNow;
    }

    public static void ApplyDeauthorized(IPayoutAccount account, DateTime utcNow)
    {
        account.StripeChargesEnabled = false;
        account.StripePayoutsEnabled = false;
        account.StripeDetailsSubmitted = false;
        account.Status = ComputeStatus(account);
        account.UpdatedAt = utcNow;
    }

    public static PayoutStatus ComputeStatus(IPayoutAccount a)
    {
        if ((a.StripeChargesEnabled && a.StripePayoutsEnabled) || a.ManualBacsReady)
            return PayoutStatus.Ready;
        if (!string.IsNullOrEmpty(a.StripeAccountId) || a.StripeDetailsSubmitted || a.Status == PayoutStatus.InProgress)
            return PayoutStatus.InProgress;
        return a.Status;
    }

    /// <summary>
    /// Verifies a <c>Stripe-Signature</c> header (<c>t=...,v1=...</c>) over the exact raw request body using
    /// HMAC-SHA256, <see cref="CryptographicOperations.FixedTimeEquals"/>, and a 300-second replay window.
    /// </summary>
    public bool VerifyWebhookSignature(string rawBody, string? signatureHeader)
    {
        var secret = ConnectWebhookSecret;
        if (string.IsNullOrWhiteSpace(secret) || string.IsNullOrWhiteSpace(signatureHeader))
            return false;

        long? timestamp = null;
        var signatures = new List<string>();
        foreach (var part in signatureHeader.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var eq = part.IndexOf('=');
            if (eq <= 0 || eq == part.Length - 1) continue;
            var key = part[..eq].Trim();
            var val = part[(eq + 1)..].Trim();
            if (key == "t" && long.TryParse(val, System.Globalization.CultureInfo.InvariantCulture, out var parsedTs))
                timestamp = parsedTs;
            else if (key == "v1" && val.Length == 64)
                signatures.Add(val);
        }

        if (timestamp is not { } ts || signatures.Count == 0)
            return false;

        var nowSeconds = time.GetUtcNow().ToUnixTimeSeconds();
        if (ts <= 0 || nowSeconds < ts - WebhookToleranceSeconds || nowSeconds - ts > WebhookToleranceSeconds)
            return false;

        var signedPayload = Encoding.UTF8.GetBytes($"{ts}.{rawBody}");
        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), signedPayload);

        foreach (var hex in signatures)
        {
            byte[] candidate;
            try
            {
                candidate = Convert.FromHexString(hex);
            }
            catch (FormatException)
            {
                continue;
            }
            if (candidate.Length == expected.Length && CryptographicOperations.FixedTimeEquals(expected, candidate))
                return true;
        }

        return false;
    }

    private string RequireSecretKey()
    {
        var secret = SecretKey;
        if (string.IsNullOrWhiteSpace(secret))
            throw new InvalidOperationException("Stripe online payments are not configured on this server yet.");
        return secret;
    }
}
