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
/// A club's payout set-up: Stripe Connect hosted onboarding and/or manual BACS details. That club's Team
/// Manager, an approved Trainer of that club, or a site Admin may use it; anyone else (another club's staff, or
/// a collaborator on a competition that pays the club) gets 403, a club that doesn't exist 404.
/// Responses carry masked bank details only. Full account numbers and IBANs are checked, masked and dropped:
/// they are never stored, logged, returned or put in an error message. This controller injects no logger on purpose.
/// </summary>
[ApiController]
[Route("api/clubs/{clubId:int}/payouts")]
[Authorize]
public class ClubPayoutsController(
    AppDbContext db,
    UserManager<AppUser> users,
    TimeProvider time,
    StripeConnectService stripe) : ControllerBase
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
        return ToDto(club.Id, club.Name, account ?? new ClubPayoutAccount { ClubId = clubId }, time, stripe.IsConfigured);
    }

    /// <summary>Saves the details apart from the bank account. Only the fields sent change.</summary>
    [HttpPut]
    public async Task<ActionResult<ClubPayoutsDto>> Save(int clubId, SavePayoutDetailsRequest req, CancellationToken ct)
    {
        var (club, denied) = await ScopeAsync(clubId, ct);
        if (club is null) return denied!;
        var account = await db.ClubPayoutAccounts.FirstOrDefaultAsync(a => a.ClubId == clubId, ct);
        var draft = account ?? NewAccount(clubId);
        var (errors, changed) = ApplyDetails(draft, req, time.GetUtcNow());
        if (errors.Count > 0) return Invalid(errors);
        if (account is null || changed)
        {
            if (account is null)
            {
                draft.CreatedAt = time.GetUtcNow().UtcDateTime;
                db.ClubPayoutAccounts.Add(draft);
            }
            await TouchAsync(draft, changed, ClubAccess.UserIdOf(User), db, time, ct);
        }
        return ToDto(club.Id, club.Name, draft, time, stripe.IsConfigured);
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
        var errors = ApplyBank(draft, req);
        if (errors.Count > 0) return Invalid(errors);
        if (account is null)
        {
            draft.CreatedAt = time.GetUtcNow().UtcDateTime;
            db.ClubPayoutAccounts.Add(draft);
        }
        await TouchAsync(draft, true, ClubAccess.UserIdOf(User), db, time, ct);
        return ToDto(club.Id, club.Name, draft, time, stripe.IsConfigured);
    }

    /// <summary>
    /// Completes the manual BACS &amp; organisation details check: once every required detail is present and valid,
    /// <see cref="IPayoutAccount.ManualBacsReady"/> is true and the account is Ready. Never sets Stripe flags.
    /// </summary>
    [HttpPost("finish")]
    public async Task<ActionResult<ClubPayoutsDto>> Finish(int clubId, CancellationToken ct)
    {
        var (club, denied) = await ScopeAsync(clubId, ct);
        if (club is null) return denied!;
        var account = await db.ClubPayoutAccounts.FirstOrDefaultAsync(a => a.ClubId == clubId, ct);
        var problems = Check(account ?? NewAccount(clubId), time.GetUtcNow());
        if (account is null || problems.Count > 0) return Invalid(problems.Count > 0 ? problems : new() { ["businessType"] = "Start with who is being paid." });
        if (!account.ManualBacsReady || account.Status != PayoutStatus.Ready)
        {
            account.ManualBacsReady = true;
            account.Status = PayoutStatus.Ready;
            account.UpdatedAt = time.GetUtcNow().UtcDateTime;
            account.UpdatedByUserId = ClubAccess.UserIdOf(User);
            await db.SaveChangesAsync(ct);
        }
        return ToDto(club.Id, club.Name, account, time, stripe.IsConfigured);
    }

    /// <summary>
    /// Creates or retrieves the club's Stripe Connect account and returns a hosted onboarding link.
    /// </summary>
    [HttpPost("stripe/onboard")]
    public async Task<ActionResult<StripeOnboardResponseDto>> OnboardStripe(
        int clubId,
        [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] StripeOnboardRequestDto? req = null,
        CancellationToken ct = default)
    {
        var (club, denied) = await ScopeAsync(clubId, ct);
        if (club is null) return denied!;
        if (!stripe.IsConfigured)
            return BadRequest(new { message = "Online card payments via Stripe aren’t configured on this server yet. You can still add your bank details below for BACS transfers." });

        var account = await db.ClubPayoutAccounts.FirstOrDefaultAsync(a => a.ClubId == clubId, ct);
        var now = time.GetUtcNow().UtcDateTime;
        if (account is null)
        {
            account = new ClubPayoutAccount { ClubId = clubId, CreatedAt = now, UpdatedAt = now };
            db.ClubPayoutAccounts.Add(account);
        }

        string stripeAccountId;
        string url;
        try
        {
            var idemCountry = (req?.Country ?? account.IbanCountry ?? "default").Trim().ToUpperInvariant();
            stripeAccountId = await stripe.CreateOrGetAccountAsync(
                account.StripeAccountId,
                account.Region,
                account.ContactEmail,
                account.LegalName ?? club.Name,
                ct,
                req?.Country,
                account.IbanCountry,
                $"connect-create-club-{clubId}-{account.Region}-{idemCountry}");
            account.StripeAccountId = stripeAccountId;
            account.Status = StripeConnectService.ComputeStatus(account);
            account.UpdatedAt = now;
            account.UpdatedByUserId = ClubAccess.UserIdOf(User);
            await db.SaveChangesAsync(ct);

            var baseUrl = stripe.PublicBaseUrl;
            url = await stripe.CreateAccountLinkAsync(
                stripeAccountId,
                $"{baseUrl}/me/payouts?stripe=refresh&clubId={clubId}",
                $"{baseUrl}/me/payouts?stripe=return&clubId={clubId}",
                ct);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }

        return Ok(new StripeOnboardResponseDto(url, stripeAccountId));
    }

    /// <summary>
    /// Synchronises the club's Stripe Connect account status after returning from Stripe hosted onboarding.
    /// </summary>
    [HttpPost("stripe/sync")]
    public async Task<ActionResult<ClubPayoutsDto>> SyncStripe(int clubId, CancellationToken ct)
    {
        var (club, denied) = await ScopeAsync(clubId, ct);
        if (club is null) return denied!;
        var account = await db.ClubPayoutAccounts.FirstOrDefaultAsync(a => a.ClubId == clubId, ct);
        if (account is null || string.IsNullOrWhiteSpace(account.StripeAccountId))
            return ToDto(club.Id, club.Name, account ?? NewAccount(clubId), time, stripe.IsConfigured);

        if (stripe.IsConfigured)
        {
            try
            {
                var status = await stripe.SyncAccountStatusAsync(account.StripeAccountId, ct);
                StripeConnectService.ApplyStatus(account, status, time.GetUtcNow().UtcDateTime);
                account.UpdatedByUserId = ClubAccess.UserIdOf(User);
                await db.SaveChangesAsync(ct);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        return ToDto(club.Id, club.Name, account, time, stripe.IsConfigured);
    }

    // ---- helpers ----

    /// <summary>
    /// The club, if the caller may run its payouts: an Admin for any club, or a Team Manager or approved Trainer who
    /// belongs to that club now. Running a competition that pays the club gives no access: a collaborator, or an
    /// organiser who has since moved club, could otherwise change where the club's money goes.
    /// </summary>
    private async Task<(Club? Club, ActionResult? Denied)> ScopeAsync(int clubId, CancellationToken ct)
    {
        var club = await db.Clubs.AsNoTracking().FirstOrDefaultAsync(c => c.Id == clubId, ct);
        if (club is null) return (null, NotFound());
        if (User.IsInRole(Roles.Admin)) return (club, null);
        var uid = ClubAccess.UserIdOf(User);
        if (string.IsNullOrEmpty(uid)) return (null, Forbid());
        // The token carries the roles it was issued with, so check the live role in the database.
        var me = await users.FindByIdAsync(uid);
        if (me is null || me.ClubId != clubId) return (null, Forbid());
        var isManagerOrTrainer = await users.IsInRoleAsync(me, Roles.Manager) || await users.IsInRoleAsync(me, Roles.Trainer);
        return isManagerOrTrainer ? (club, null) : (null, Forbid());
    }

    private static ClubPayoutAccount NewAccount(int clubId) => new() { ClubId = clubId };

    internal static (Dictionary<string, string> Errors, bool Changed) ApplyDetails(
        IPayoutAccount draft,
        SavePayoutDetailsRequest req,
        DateTimeOffset now)
    {
        var errors = new Dictionary<string, string>();
        var changed = false;

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
            var problem = PayoutRules.ValidateDateOfBirth(dob, DateOnly.FromDateTime(now.UtcDateTime));
            if (problem is not null) errors["personDateOfBirth"] = problem;
            else Assign(ref changed, draft.PersonDateOfBirth, (DateOnly?)dob, v => draft.PersonDateOfBirth = v);
        }
        else if (req.ClearPersonDateOfBirth == true)
        {
            Assign(ref changed, draft.PersonDateOfBirth, (DateOnly?)null, v => draft.PersonDateOfBirth = v);
        }

        return (errors, changed);

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

    internal static Dictionary<string, string> ApplyBank(IPayoutAccount draft, SavePayoutBankRequest req)
    {
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
        if (errors.Count > 0) return errors;

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
        return errors;
    }

    /// <summary>
    /// Saves a new or changed account. Any manual edit resets <see cref="IPayoutAccount.ManualBacsReady"/>,
    /// but if Stripe Connect is already active (<c>StripeChargesEnabled &amp;&amp; StripePayoutsEnabled</c>),
    /// <see cref="IPayoutAccount.Status"/> remains <see cref="PayoutStatus.Ready"/>.
    /// </summary>
    internal static async Task TouchAsync(
        IPayoutAccount draft,
        bool changed,
        string? userId,
        AppDbContext db,
        TimeProvider time,
        CancellationToken ct)
    {
        var now = time.GetUtcNow().UtcDateTime;
        if (changed)
            draft.ManualBacsReady = false;
        if (draft.StripeChargesEnabled && draft.StripePayoutsEnabled)
            draft.Status = PayoutStatus.Ready;
        else if (changed || draft.Status == PayoutStatus.NotStarted)
            draft.Status = PayoutStatus.InProgress;
        draft.UpdatedAt = now;
        draft.UpdatedByUserId = userId;
        await db.SaveChangesAsync(ct);
    }

    private static void ClearBank(IPayoutAccount a)
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

    private static string? StoredValue(string field, IPayoutAccount a) => field switch
    {
        "legalName" => a.LegalName, "tradingName" => a.TradingName, "addressLine1" => a.AddressLine1,
        "addressLine2" => a.AddressLine2, "city" => a.City, "postcode" => a.Postcode,
        "contactEmail" => a.ContactEmail, "contactPhone" => a.ContactPhone,
        "registrationNumber" => a.RegistrationNumber, "vatNumber" => a.VatNumber,
        "personFullName" => a.PersonFullName, _ => a.StatementDescriptor,
    };

    private ActionResult Invalid(Dictionary<string, string> errors) =>
        BadRequest(new { message = errors.Values.First(), errors });

    /// <summary>Everything still missing or wrong before manual BACS details can be finished, by field.</summary>
    internal static Dictionary<string, string> Check(IPayoutAccount a, DateTimeOffset now)
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

    internal static ClubPayoutsDto ToDto(int clubId, string clubName, IPayoutAccount a, TimeProvider time, bool stripeConfigured)
    {
        var bank = PayoutRules.MaskedAccount(a) is { } masked && !string.IsNullOrEmpty(a.BankAccountHolder)
            ? new PayoutBankDto(a.BankAccountHolder, a.BankName, a.SortCode, masked, a.IbanCountry)
            : null;
        return new ClubPayoutsDto(
            clubId, clubName, a.Status, a.BusinessType, a.Region, a.Currency,
            a.LegalName, a.TradingName, a.AddressLine1, a.AddressLine2, a.City, a.Postcode,
            a.ContactEmail, a.ContactPhone, a.RegistrationNumber, a.VatNumber,
            a.PersonFullName, a.PersonDateOfBirth, a.StatementDescriptor, a.Schedule,
            bank, Check(a, time.GetUtcNow()).Keys.ToList(),
            a.Id == 0 ? null : DateTime.SpecifyKind(a.UpdatedAt, DateTimeKind.Utc),
            StripeConnected: !string.IsNullOrEmpty(a.StripeAccountId),
            StripeChargesEnabled: a.StripeChargesEnabled,
            StripePayoutsEnabled: a.StripePayoutsEnabled,
            StripeDetailsSubmitted: a.StripeDetailsSubmitted,
            StripeConfigured: stripeConfigured,
            ManualBacsReady: a.ManualBacsReady,
            StripeAccountId: a.StripeAccountId);
    }
}

/// <summary>
/// Personal payout set-up (<c>/api/me/payouts</c>) for competition organisers without a club and Event Shop / Tack Shop sellers.
/// Uses the exact same validation, masking and Stripe Connect onboarding rules as <see cref="ClubPayoutsController"/>.
/// </summary>
[ApiController]
[Route("api/me/payouts")]
[Authorize]
public class MePayoutsController(
    AppDbContext db,
    UserManager<AppUser> users,
    TimeProvider time,
    StripeConnectService stripe) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ClubPayoutsDto>> Get(CancellationToken ct)
    {
        var me = await CurrentUserAsync();
        if (me is null) return Unauthorized();
        var account = await db.UserPayoutAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.UserId == me.Id, ct);
        return ClubPayoutsController.ToDto(0, DisplayName(me, account), account ?? new UserPayoutAccount { UserId = me.Id }, time, stripe.IsConfigured);
    }

    [HttpPut]
    public async Task<ActionResult<ClubPayoutsDto>> Save(SavePayoutDetailsRequest req, CancellationToken ct)
    {
        var me = await CurrentUserAsync();
        if (me is null) return Unauthorized();
        var account = await db.UserPayoutAccounts.FirstOrDefaultAsync(a => a.UserId == me.Id, ct);
        var draft = account ?? new UserPayoutAccount { UserId = me.Id };
        var (errors, changed) = ClubPayoutsController.ApplyDetails(draft, req, time.GetUtcNow());
        if (errors.Count > 0) return BadRequest(new { message = errors.Values.First(), errors });
        if (account is null || changed)
        {
            if (account is null)
            {
                draft.CreatedAt = time.GetUtcNow().UtcDateTime;
                db.UserPayoutAccounts.Add(draft);
            }
            await ClubPayoutsController.TouchAsync(draft, changed, me.Id, db, time, ct);
        }
        return ClubPayoutsController.ToDto(0, DisplayName(me, draft), draft, time, stripe.IsConfigured);
    }

    [HttpPut("bank")]
    public async Task<ActionResult<ClubPayoutsDto>> SaveBank(SavePayoutBankRequest req, CancellationToken ct)
    {
        var me = await CurrentUserAsync();
        if (me is null) return Unauthorized();
        var account = await db.UserPayoutAccounts.FirstOrDefaultAsync(a => a.UserId == me.Id, ct);
        var draft = account ?? new UserPayoutAccount { UserId = me.Id };
        var errors = ClubPayoutsController.ApplyBank(draft, req);
        if (errors.Count > 0) return BadRequest(new { message = errors.Values.First(), errors });
        if (account is null)
        {
            draft.CreatedAt = time.GetUtcNow().UtcDateTime;
            db.UserPayoutAccounts.Add(draft);
        }
        await ClubPayoutsController.TouchAsync(draft, true, me.Id, db, time, ct);
        return ClubPayoutsController.ToDto(0, DisplayName(me, draft), draft, time, stripe.IsConfigured);
    }

    [HttpPost("finish")]
    public async Task<ActionResult<ClubPayoutsDto>> Finish(CancellationToken ct)
    {
        var me = await CurrentUserAsync();
        if (me is null) return Unauthorized();
        var account = await db.UserPayoutAccounts.FirstOrDefaultAsync(a => a.UserId == me.Id, ct);
        var problems = ClubPayoutsController.Check(account ?? new UserPayoutAccount { UserId = me.Id }, time.GetUtcNow());
        if (account is null || problems.Count > 0)
        {
            var err = problems.Count > 0 ? problems : new Dictionary<string, string> { ["businessType"] = "Start with who is being paid." };
            return BadRequest(new { message = err.Values.First(), errors = err });
        }
        if (!account.ManualBacsReady || account.Status != PayoutStatus.Ready)
        {
            account.ManualBacsReady = true;
            account.Status = PayoutStatus.Ready;
            account.UpdatedAt = time.GetUtcNow().UtcDateTime;
            account.UpdatedByUserId = me.Id;
            await db.SaveChangesAsync(ct);
        }
        return ClubPayoutsController.ToDto(0, DisplayName(me, account), account, time, stripe.IsConfigured);
    }

    [HttpPost("stripe/onboard")]
    public async Task<ActionResult<StripeOnboardResponseDto>> OnboardStripe(
        [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] StripeOnboardRequestDto? req = null,
        CancellationToken ct = default)
    {
        var me = await CurrentUserAsync();
        if (me is null) return Unauthorized();
        if (!stripe.IsConfigured)
            return BadRequest(new { message = "Online card payments via Stripe aren’t configured on this server yet. You can still add your bank details below for BACS transfers." });

        var account = await db.UserPayoutAccounts.FirstOrDefaultAsync(a => a.UserId == me.Id, ct);
        var now = time.GetUtcNow().UtcDateTime;
        if (account is null)
        {
            account = new UserPayoutAccount { UserId = me.Id, CreatedAt = now, UpdatedAt = now };
            db.UserPayoutAccounts.Add(account);
        }

        string stripeAccountId;
        string url;
        try
        {
            var idemCountry = (req?.Country ?? account.IbanCountry ?? "default").Trim().ToUpperInvariant();
            stripeAccountId = await stripe.CreateOrGetAccountAsync(
                account.StripeAccountId,
                account.Region,
                account.ContactEmail ?? me.Email,
                account.LegalName ?? me.FullName,
                ct,
                req?.Country,
                account.IbanCountry,
                $"connect-create-user-{me.Id}-{account.Region}-{idemCountry}");
            account.StripeAccountId = stripeAccountId;
            account.Status = StripeConnectService.ComputeStatus(account);
            account.UpdatedAt = now;
            account.UpdatedByUserId = me.Id;
            await db.SaveChangesAsync(ct);

            var baseUrl = stripe.PublicBaseUrl;
            url = await stripe.CreateAccountLinkAsync(
                stripeAccountId,
                $"{baseUrl}/me/payouts?scope=personal&stripe=refresh",
                $"{baseUrl}/me/payouts?scope=personal&stripe=return",
                ct);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }

        return Ok(new StripeOnboardResponseDto(url, stripeAccountId));
    }

    [HttpPost("stripe/sync")]
    public async Task<ActionResult<ClubPayoutsDto>> SyncStripe(CancellationToken ct)
    {
        var me = await CurrentUserAsync();
        if (me is null) return Unauthorized();
        var account = await db.UserPayoutAccounts.FirstOrDefaultAsync(a => a.UserId == me.Id, ct);
        if (account is null || string.IsNullOrWhiteSpace(account.StripeAccountId))
            return ClubPayoutsController.ToDto(0, DisplayName(me, account), account ?? new UserPayoutAccount { UserId = me.Id }, time, stripe.IsConfigured);

        if (stripe.IsConfigured)
        {
            try
            {
                var status = await stripe.SyncAccountStatusAsync(account.StripeAccountId, ct);
                StripeConnectService.ApplyStatus(account, status, time.GetUtcNow().UtcDateTime);
                account.UpdatedByUserId = me.Id;
                await db.SaveChangesAsync(ct);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        return ClubPayoutsController.ToDto(0, DisplayName(me, account), account, time, stripe.IsConfigured);
    }

    private async Task<AppUser?> CurrentUserAsync()
    {
        var uid = ClubAccess.UserIdOf(User);
        return string.IsNullOrEmpty(uid) ? null : await users.FindByIdAsync(uid);
    }

    private static string DisplayName(AppUser user, UserPayoutAccount? account) =>
        !string.IsNullOrWhiteSpace(account?.TradingName) ? account.TradingName!
        : !string.IsNullOrWhiteSpace(account?.LegalName) ? account.LegalName!
        : user.FullName;
}
