using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Auth;
using MountedGames.Api.Data;
using MountedGames.Api.Dtos;
using MountedGames.Api.Entities;
using MountedGames.Api.Security;
using MountedGames.Api.Services;
using MountedGames.Api.Services.Payouts;

namespace MountedGames.Api.Controllers;

/// <summary>
/// A club's payout set-up, a mock of provider-hosted onboarding (no money moves yet). Only that club's Team
/// Manager or an admin may use it; another club's manager gets 403, a club that doesn't exist 404.
/// Responses carry masked bank details only. Full account numbers and IBANs are checked, masked and dropped:
/// they are never stored, logged, returned or put in an error message. This controller injects no logger on purpose.
/// </summary>
[ApiController]
[Route("api/clubs/{clubId:int}/payouts")]
[Authorize(Roles = Roles.Admin + "," + Roles.Manager)]
public class ClubPayoutsController(AppDbContext db, UserManager<AppUser> users, TimeProvider time) : ControllerBase
{
    /// <summary>The public, safe summary: club name, masked account once Ready, and whether it is. No personal data.</summary>
    [HttpGet("summary")]
    [AllowAnonymous]
    [PublicRead]
    [EnableRateLimiting("public-read")]
    public async Task<ActionResult<PayoutsToDto>> Summary(int clubId) =>
        await db.PayoutsToForClubAsync(clubId) is { } summary ? summary : NotFound();

    [HttpGet]
    public async Task<ActionResult<ClubPayoutsDto>> Get(int clubId, CancellationToken ct)
    {
        var (club, denied) = await ScopeAsync(clubId, ct);
        if (club is null) return denied!;
        var account = await db.ClubPayoutAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.ClubId == clubId, ct);
        return ToDto(club, account ?? new ClubPayoutAccount { ClubId = clubId });
    }

    /// <summary>Saves the details apart from the bank account. Only the fields sent change.</summary>
    [HttpPut]
    public async Task<ActionResult<ClubPayoutsDto>> Save(int clubId, SavePayoutDetailsRequest req, CancellationToken ct)
    {
        var (club, denied) = await ScopeAsync(clubId, ct);
        if (club is null) return denied!;
        var account = await db.ClubPayoutAccounts.FirstOrDefaultAsync(a => a.ClubId == clubId, ct);
        var errors = new Dictionary<string, string>();
        var changed = false;
        var draft = account ?? NewAccount(clubId);

        if (req.BusinessType is { } type)
        {
            if (!Enum.IsDefined(type)) errors["businessType"] = "Pick one of the options.";
            else Assign(ref changed, draft.BusinessType, type, v => draft.BusinessType = v);
        }
        if (req.Region is { } region)
        {
            if (!Enum.IsDefined(region)) errors["region"] = "Pick one of the options.";
            else if (region != draft.Region)
            {
                // The kind of bank details depends on the region, so the old ones no longer fit.
                draft.Region = region;
                draft.Currency = PayoutRules.CurrencyFor(region);
                ClearBank(draft);
                changed = true;
            }
        }
        if (req.Schedule is { } schedule)
        {
            if (!Enum.IsDefined(schedule)) errors["schedule"] = "Pick one of the options.";
            else Assign(ref changed, draft.Schedule, schedule, v => draft.Schedule = v);
        }

        Text(req.LegalName, "legalName", 150, null, draft.LegalName, v => draft.LegalName = v);
        Text(req.TradingName, "tradingName", 150, null, draft.TradingName, v => draft.TradingName = v);
        Text(req.AddressLine1, "addressLine1", 150, null, draft.AddressLine1, v => draft.AddressLine1 = v);
        Text(req.AddressLine2, "addressLine2", 150, null, draft.AddressLine2, v => draft.AddressLine2 = v);
        Text(req.City, "city", 100, null, draft.City, v => draft.City = v);
        Text(req.Postcode, "postcode", 12, v => PayoutRules.ValidatePostcode(Squash(v), draft.Region), draft.Postcode,
            v => draft.Postcode = v is null ? null : draft.Region == PayoutRegion.Uk ? Squash(v) : v.ToUpperInvariant());
        Text(req.ContactEmail, "contactEmail", 200, PayoutRules.ValidateEmail, draft.ContactEmail, v => draft.ContactEmail = v);
        Text(req.ContactPhone, "contactPhone", 30, PayoutRules.ValidatePhone, draft.ContactPhone, v => draft.ContactPhone = v);
        Text(req.RegistrationNumber, "registrationNumber", 20, PayoutRules.ValidateRegistrationNumber, draft.RegistrationNumber,
            v => draft.RegistrationNumber = v?.Replace(" ", "").ToUpperInvariant());
        Text(req.VatNumber, "vatNumber", 20,
            v => PayoutRules.NormaliseVat(v, draft.Region) is null ? "Enter a valid VAT number, like GB123456789." : null,
            draft.VatNumber, v => draft.VatNumber = v is null ? null : PayoutRules.NormaliseVat(v, draft.Region));
        Text(req.PersonFullName, "personFullName", 150, null, draft.PersonFullName, v => draft.PersonFullName = v);
        Text(req.StatementDescriptor, "statementDescriptor", 22, PayoutRules.ValidateDescriptor, draft.StatementDescriptor,
            v => draft.StatementDescriptor = v?.ToUpperInvariant());

        if (req.PersonDateOfBirth is { } dob)
        {
            var problem = PayoutRules.ValidateDateOfBirth(dob, DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime));
            if (problem is not null) errors["personDateOfBirth"] = problem;
            else Assign(ref changed, draft.PersonDateOfBirth, (DateOnly?)dob, v => draft.PersonDateOfBirth = v);
        }
        else if (req.ClearPersonDateOfBirth == true || req.PersonFullName is not null)
        {
            Assign(ref changed, draft.PersonDateOfBirth, (DateOnly?)null, v => draft.PersonDateOfBirth = v);
        }

        if (errors.Count > 0) return Invalid(errors);
        if (account is null || changed) await TouchAsync(account, draft, changed, ct);
        return ToDto(club, draft);

        // Applies one text field: null means leave it, blank clears it, anything else is checked, trimmed and stored.
        void Text(string? incoming, string field, int max, Func<string, string?>? validate, string? current, Action<string?> assign)
        {
            if (incoming is null) return;
            var value = incoming.Trim();
            if (value.Length == 0)
            {
                if (current is not null) { assign(null); changed = true; }
                return;
            }
            if (value.Length > max) { errors[field] = $"Use {max} characters or fewer."; return; }
            if (validate?.Invoke(value) is { } message) { errors[field] = message; return; }
            var before = current;
            assign(value);
            // Compare what ended up stored, so tidying (capitals, spaces) alone doesn't count as an edit.
            if (!string.Equals(before, StoredValue(field, draft), StringComparison.Ordinal)) changed = true;
        }
    }

    /// <summary>
    /// Saves the bank account. The full account number or IBAN is checked here and then dropped: only the sort
    /// code and last four digits are kept, and nothing about them is logged or echoed back.
    /// </summary>
    [HttpPut("bank")]
    public async Task<ActionResult<ClubPayoutsDto>> SaveBank(int clubId, SavePayoutBankRequest req, CancellationToken ct)
    {
        var (club, denied) = await ScopeAsync(clubId, ct);
        if (club is null) return denied!;
        var account = await db.ClubPayoutAccounts.FirstOrDefaultAsync(a => a.ClubId == clubId, ct);
        var draft = account ?? NewAccount(clubId);
        var errors = new Dictionary<string, string>();

        var holder = (req.AccountHolder ?? string.Empty).Trim();
        if (holder.Length == 0) errors["accountHolder"] = "Enter the name on the account.";
        else if (holder.Length > 150) errors["accountHolder"] = "Use 150 characters or fewer.";

        string? sortCode = null, accountNumber = null, iban = null;
        if (draft.Region == PayoutRegion.Uk)
        {
            sortCode = PayoutRules.NormaliseSortCode(req.SortCode);
            accountNumber = PayoutRules.NormaliseAccountNumber(req.AccountNumber);
            if (sortCode is null) errors["sortCode"] = "A sort code has 6 digits.";
            if (accountNumber is null) errors["accountNumber"] = "An account number has 8 digits.";
        }
        else
        {
            iban = PayoutRules.NormaliseIban(req.Iban);
            if (iban is null) errors["iban"] = "That IBAN doesn't look right. Check it and try again.";
            if (!string.IsNullOrWhiteSpace(req.Bic) && !PayoutRules.IsValidBic(req.Bic)) errors["bic"] = "A BIC has 8 or 11 letters and numbers.";
        }
        if (errors.Count > 0) return Invalid(errors);

        draft.BankAccountHolder = holder;
        if (sortCode is not null)
        {
            draft.SortCode = PayoutRules.FormatSortCode(sortCode);
            draft.AccountLast4 = PayoutRules.Last4(accountNumber!);
            draft.BankName = PayoutRules.BankNameFor(sortCode);
            draft.IbanCountry = null;
            draft.IbanLast4 = null;
        }
        else
        {
            draft.IbanCountry = iban![..2];
            draft.IbanLast4 = PayoutRules.Last4(iban);
            draft.BankName = null;
            draft.SortCode = null;
            draft.AccountLast4 = null;
        }
        await TouchAsync(account, draft, true, ct);
        return ToDto(club, draft);
    }

    /// <summary>
    /// The mock of the provider's verification: once every required detail is present and valid, the account is Ready.
    /// Otherwise answers 400 with what's still missing.
    /// </summary>
    [HttpPost("finish")]
    public async Task<ActionResult<ClubPayoutsDto>> Finish(int clubId, CancellationToken ct)
    {
        var (club, denied) = await ScopeAsync(clubId, ct);
        if (club is null) return denied!;
        var account = await db.ClubPayoutAccounts.FirstOrDefaultAsync(a => a.ClubId == clubId, ct);
        var problems = Check(account ?? NewAccount(clubId), time.GetUtcNow());
        if (account is null || problems.Count > 0) return Invalid(problems.Count > 0 ? problems : new() { ["businessType"] = "Start with who is being paid." });
        if (account.Status != PayoutStatus.Ready)
        {
            account.Status = PayoutStatus.Ready;
            account.UpdatedAt = time.GetUtcNow().UtcDateTime;
            account.UpdatedByUserId = ClubAccess.UserIdOf(User);
            await db.SaveChangesAsync(ct);
        }
        return ToDto(club, account);
    }

    // ---- helpers ----

    /// <summary>The club, if the caller may run its payouts: an admin for any club, a Team Manager for their own.</summary>
    private async Task<(Club? Club, ActionResult? Denied)> ScopeAsync(int clubId, CancellationToken ct)
    {
        var club = await db.Clubs.AsNoTracking().FirstOrDefaultAsync(c => c.Id == clubId, ct);
        if (club is null) return (null, NotFound());
        if (User.IsInRole(Roles.Admin)) return (club, null);
        // The token carries the roles it was issued with, so check the manager role as it is now.
        var me = await users.FindByIdAsync(ClubAccess.UserIdOf(User) ?? string.Empty);
        var allowed = me is not null && me.ClubId == clubId && await users.IsInRoleAsync(me, Roles.Manager);
        return allowed ? (club, null) : (null, Forbid());
    }

    private static ClubPayoutAccount NewAccount(int clubId) => new() { ClubId = clubId };

    /// <summary>Saves a new or changed account. Any edit puts a Ready account back to InProgress until it's finished again.</summary>
    private async Task TouchAsync(ClubPayoutAccount? existing, ClubPayoutAccount draft, bool changed, CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        if (existing is null) { draft.CreatedAt = now; db.ClubPayoutAccounts.Add(draft); }
        if (changed || draft.Status == PayoutStatus.NotStarted) draft.Status = PayoutStatus.InProgress;
        draft.UpdatedAt = now;
        draft.UpdatedByUserId = ClubAccess.UserIdOf(User);
        await db.SaveChangesAsync(ct);
    }

    private static void ClearBank(ClubPayoutAccount a)
    {
        a.BankAccountHolder = a.BankName = a.SortCode = a.AccountLast4 = a.IbanCountry = a.IbanLast4 = null;
    }

    private static void Assign<T>(ref bool changed, T current, T next, Action<T> set)
    {
        if (EqualityComparer<T>.Default.Equals(current, next)) return;
        set(next);
        changed = true;
    }

    private static string Squash(string v) => string.Join(' ', v.ToUpperInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries));

    private static string? StoredValue(string field, ClubPayoutAccount a) => field switch
    {
        "legalName" => a.LegalName, "tradingName" => a.TradingName, "addressLine1" => a.AddressLine1,
        "addressLine2" => a.AddressLine2, "city" => a.City, "postcode" => a.Postcode,
        "contactEmail" => a.ContactEmail, "contactPhone" => a.ContactPhone,
        "registrationNumber" => a.RegistrationNumber, "vatNumber" => a.VatNumber,
        "personFullName" => a.PersonFullName, _ => a.StatementDescriptor,
    };

    private ActionResult Invalid(Dictionary<string, string> errors) =>
        BadRequest(new { message = errors.Values.First(), errors });

    /// <summary>Everything still missing or wrong before the account can be Ready, by field.</summary>
    internal static Dictionary<string, string> Check(ClubPayoutAccount a, DateTimeOffset now)
    {
        var p = new Dictionary<string, string>();
        void Need(string field, string? value, string message, Func<string, string?>? validate = null)
        {
            if (string.IsNullOrWhiteSpace(value)) p[field] = message;
            else if (validate?.Invoke(value) is { } bad) p[field] = bad;
        }
        if (a.BusinessType is null) p["businessType"] = "Pick who is being paid.";
        Need("legalName", a.LegalName, "Enter the legal name.");
        Need("addressLine1", a.AddressLine1, "Enter the first line of the address.");
        Need("city", a.City, "Enter the town or city.");
        Need("postcode", a.Postcode, "Enter the postcode.", v => PayoutRules.ValidatePostcode(v, a.Region));
        Need("contactEmail", a.ContactEmail, "Enter a contact email.", PayoutRules.ValidateEmail);
        Need("contactPhone", a.ContactPhone, "Enter a contact phone number.", PayoutRules.ValidatePhone);
        if (a.BusinessType is { } type && PayoutRules.NeedsRegistrationNumber(type))
            Need("registrationNumber", a.RegistrationNumber,
                type == PayoutBusinessType.Charity ? "Enter the charity number." : "Enter the company number.",
                PayoutRules.ValidateRegistrationNumber);
        Need("personFullName", a.PersonFullName, "Enter the responsible person's full name.");
        if (a.PersonDateOfBirth is not { } dob) p["personDateOfBirth"] = "Enter their date of birth.";
        else if (PayoutRules.ValidateDateOfBirth(dob, DateOnly.FromDateTime(now.UtcDateTime)) is { } dobProblem) p["personDateOfBirth"] = dobProblem;
        if (string.IsNullOrEmpty(a.BankAccountHolder) || PayoutRules.MaskedAccount(a) is null) p["bank"] = "Add the bank account.";
        Need("statementDescriptor", a.StatementDescriptor, "Enter a statement descriptor.", PayoutRules.ValidateDescriptor);
        return p;
    }

    private ClubPayoutsDto ToDto(Club club, ClubPayoutAccount a)
    {
        var bank = PayoutRules.MaskedAccount(a) is { } masked && !string.IsNullOrEmpty(a.BankAccountHolder)
            ? new PayoutBankDto(a.BankAccountHolder, a.BankName, a.SortCode, masked, a.IbanCountry)
            : null;
        return new ClubPayoutsDto(
            club.Id, club.Name, a.Status, a.BusinessType, a.Region, a.Currency,
            a.LegalName, a.TradingName, a.AddressLine1, a.AddressLine2, a.City, a.Postcode,
            a.ContactEmail, a.ContactPhone, a.RegistrationNumber, a.VatNumber,
            a.PersonFullName, a.PersonDateOfBirth, a.StatementDescriptor, a.Schedule,
            bank, Check(a, time.GetUtcNow()).Keys.ToList(),
            a.Id == 0 ? null : DateTime.SpecifyKind(a.UpdatedAt, DateTimeKind.Utc));
    }
}
