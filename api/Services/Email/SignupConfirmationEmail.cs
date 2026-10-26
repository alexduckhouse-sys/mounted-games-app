using System.Globalization;
using System.Text;
using Microsoft.Extensions.Options;
using MountedGames.Api.Entities;

namespace MountedGames.Api.Services.Email;

/// <summary>What the opt-in tick did, as far as the confirmation email needs to say.</summary>
public enum OptInOutcome { NotAsked, Joined, AlreadyOnList }

public static class SignupConfirmationEmail
{
    // Invariant culture: English day and month names, and no dependence on ICU data in the container.
    private static readonly CultureInfo Uk = CultureInfo.InvariantCulture;

    /// <summary>
    /// Plain, short and honest about money: the entry is recorded, the fee is paid to the organiser directly,
    /// and nothing here suggests a card payment took place.
    /// </summary>
    public static EmailMessage Build(
        SectionSignup signup, Competition competition, CompetitionSection section, string toAddress,
        string? competitionUrl, OptInOutcome optIn, string? unsubscribeUrl)
    {
        var sb = new StringBuilder();
        // No name: it is typed by whoever made the entry, so it could carry links or a message in someone else's inbox.
        sb.AppendLine("Hello,");
        sb.AppendLine();
        sb.AppendLine($"Thanks for entering {section.DisplayName} at {competition.Name}. Your entry is in.");
        sb.AppendLine();
        sb.AppendLine($"Event: {competition.Name}");
        sb.AppendLine($"Date: {FormatDates(competition.StartDate, competition.EndDate)}");
        if (!string.IsNullOrWhiteSpace(competition.Location)) sb.AppendLine($"Where: {competition.Location.Trim()}");
        sb.AppendLine($"Class: {section.DisplayName}");
        sb.AppendLine($"Entry fee: {Money(signup.AmountMinor)}");
        sb.AppendLine();

        if (signup.AmountMinor <= 0)
        {
            sb.AppendLine("There's nothing to pay for this entry.");
        }
        else
        {
            sb.AppendLine($"You haven't paid yet, and no payment has been taken through this app. Please pay the {Money(signup.AmountMinor)} entry fee to the organiser. Your place is confirmed once they have received it.");
            sb.AppendLine();
            if (string.IsNullOrWhiteSpace(competition.PaymentDestination))
                sb.AppendLine("The organiser will let you know how they'd like to be paid.");
            else
            {
                sb.AppendLine("How the organiser asked to be paid:");
                sb.AppendLine(competition.PaymentDestination.Trim());
            }
        }

        if (!string.IsNullOrEmpty(competitionUrl))
        {
            sb.AppendLine();
            sb.AppendLine("The timetable and any updates will be on the competition page:");
            sb.AppendLine(competitionUrl);
        }

        sb.AppendLine();
        sb.AppendLine("If you didn't make this entry, please let the organiser know.");

        if (optIn == OptInOutcome.Joined)
        {
            sb.AppendLine();
            sb.AppendLine("You also asked us to email you when new competitions open.");
            if (!string.IsNullOrEmpty(unsubscribeUrl))
            {
                sb.AppendLine("If you change your mind, you can stop those emails here:");
                sb.AppendLine(unsubscribeUrl);
            }
        }
        else if (optIn == OptInOutcome.AlreadyOnList)
        {
            sb.AppendLine();
            sb.AppendLine("You're already on our list for new competition emails.");
        }

        sb.AppendLine();
        sb.AppendLine("Mounted Games");

        var subject = signup.AmountMinor <= 0
            ? $"You're entered in {competition.Name}"
            : $"Your entry for {competition.Name}";

        var html = new StringBuilder();
        html.Append("<p style=\"margin:0 0 12px;\">Hello,</p>");
        html.Append($"<p style=\"margin:0 0 16px;\">Thanks for entering <strong>{EmailHtml.Encode(section.DisplayName)}</strong> at <strong>{EmailHtml.Encode(competition.Name)}</strong>. Your entry is in.</p>");
        html.Append("<table role=\"presentation\" style=\"width:100%;border-collapse:collapse;margin:0 0 16px;\">");
        html.Append(EmailHtml.Row("Event", competition.Name));
        html.Append(EmailHtml.Row("Date", FormatDates(competition.StartDate, competition.EndDate)));
        if (!string.IsNullOrWhiteSpace(competition.Location))
            html.Append(EmailHtml.Row("Where", competition.Location.Trim()));
        html.Append(EmailHtml.Row("Class", section.DisplayName));
        html.Append(EmailHtml.Row("Entry fee", Money(signup.AmountMinor)));
        if (signup.AmountMinor > 0 && !string.IsNullOrWhiteSpace(competition.PaymentDestination))
            html.Append(EmailHtml.Row("Payment instructions", competition.PaymentDestination.Trim()));
        html.Append("</table>");

        if (signup.AmountMinor <= 0)
        {
            html.Append("<p style=\"margin:0 0 12px;\">There's nothing to pay for this entry.</p>");
        }
        else
        {
            html.Append($"<p style=\"margin:0 0 12px;\">You haven't paid yet, and no payment has been taken through this app. Please pay the <strong>{EmailHtml.Encode(Money(signup.AmountMinor))}</strong> entry fee to the organiser. Your place is confirmed once they have received it.</p>");
            if (string.IsNullOrWhiteSpace(competition.PaymentDestination))
                html.Append("<p style=\"margin:0 0 12px;\">The organiser will let you know how they'd like to be paid.</p>");
            else
                html.Append($"<p style=\"margin:0 0 12px;\"><strong>How the organiser asked to be paid:</strong><br>{EmailHtml.Encode(competition.PaymentDestination.Trim())}</p>");
        }

        if (!string.IsNullOrEmpty(competitionUrl))
        {
            html.Append("<p style=\"margin:0 0 8px;\">The timetable and any updates will be on the competition page:</p>");
            html.Append(EmailHtml.Button(competitionUrl, "Open competition page"));
        }

        html.Append("<p style=\"margin:16px 0 12px;color:#475569;font-size:13px;\">If you didn't make this entry, please let the organiser know.</p>");

        if (optIn == OptInOutcome.Joined)
        {
            html.Append("<p style=\"margin:0 0 8px;color:#475569;font-size:13px;\">You also asked us to email you when new competitions open.");
            if (!string.IsNullOrEmpty(unsubscribeUrl))
                html.Append($" If you change your mind, you can <a href=\"{EmailHtml.Encode(unsubscribeUrl)}\" style=\"color:#17385F;\">stop those emails here</a>.");
            html.Append("</p>");
        }
        else if (optIn == OptInOutcome.AlreadyOnList)
        {
            html.Append("<p style=\"margin:0 0 8px;color:#475569;font-size:13px;\">You're already on our list for new competition emails.</p>");
        }

        return new EmailMessage(toAddress, subject, sb.ToString(), EmailHtml.Wrap(html.ToString()), $"signup-confirmation-{signup.Id}");
    }

    public static EmailMessage BuildPaymentReminder(
        SectionSignup signup, Competition competition, CompetitionSection section, string toAddress,
        string? customNote = null, string? competitionUrl = null)
    {
        var paymentRef = $"MG-{competition.Id}-{signup.Id}";
        var amountText = Money(signup.AmountMinor);
        var trimmedNote = string.IsNullOrWhiteSpace(customNote) ? null : customNote.Trim();

        var sb = new StringBuilder();
        sb.AppendLine("Hello,");
        sb.AppendLine();
        sb.AppendLine($"This is a polite reminder that your entry fee for {section.DisplayName} at {competition.Name} is still awaiting payment.");
        sb.AppendLine();
        sb.AppendLine($"Event: {competition.Name}");
        sb.AppendLine($"Date: {FormatDates(competition.StartDate, competition.EndDate)}");
        sb.AppendLine($"Class: {section.DisplayName}");
        sb.AppendLine($"Amount due: {amountText}");
        sb.AppendLine($"Payment reference: {paymentRef}");
        if (!string.IsNullOrWhiteSpace(competition.PaymentDestination))
        {
            sb.AppendLine();
            sb.AppendLine("BACS payment details:");
            sb.AppendLine(competition.PaymentDestination.Trim());
        }
        if (trimmedNote is not null)
        {
            sb.AppendLine();
            sb.AppendLine("Note from the organiser:");
            sb.AppendLine(trimmedNote);
        }
        if (!string.IsNullOrEmpty(competitionUrl))
        {
            sb.AppendLine();
            sb.AppendLine("View competition details:");
            sb.AppendLine(competitionUrl);
        }
        sb.AppendLine();
        sb.AppendLine("If you have already sent your transfer, thank you — the organiser will mark your entry paid once it clears.");
        sb.AppendLine();
        sb.AppendLine("Mounted Games");

        var html = new StringBuilder();
        html.Append("<p style=\"margin:0 0 12px;\">Hello,</p>");
        html.Append($"<p style=\"margin:0 0 16px;\">This is a polite reminder that your entry fee for <strong>{EmailHtml.Encode(section.DisplayName)}</strong> at <strong>{EmailHtml.Encode(competition.Name)}</strong> is still awaiting payment.</p>");
        html.Append("<table role=\"presentation\" style=\"width:100%;border-collapse:collapse;margin:0 0 16px;\">");
        html.Append(EmailHtml.Row("Event", competition.Name));
        html.Append(EmailHtml.Row("Date", FormatDates(competition.StartDate, competition.EndDate)));
        html.Append(EmailHtml.Row("Class", section.DisplayName));
        html.Append(EmailHtml.Row("Amount due", amountText));
        html.Append(EmailHtml.Row("Payment reference", paymentRef));
        if (!string.IsNullOrWhiteSpace(competition.PaymentDestination))
            html.Append(EmailHtml.Row("BACS details", competition.PaymentDestination.Trim()));
        html.Append("</table>");
        if (trimmedNote is not null)
            html.Append($"<p style=\"margin:0 0 12px;\"><strong>Note from the organiser:</strong><br>{EmailHtml.Encode(trimmedNote)}</p>");
        if (!string.IsNullOrEmpty(competitionUrl))
            html.Append(EmailHtml.Button(competitionUrl, "Open competition page"));
        html.Append("<p style=\"margin:16px 0 12px;color:#475569;font-size:13px;\">If you have already sent your transfer, thank you — the organiser will mark your entry paid once it clears.</p>");

        var subject = $"Payment reminder: {competition.Name} ({section.DisplayName})";
        return new EmailMessage(toAddress, subject, sb.ToString(), EmailHtml.Wrap(html.ToString()));
    }

    public static EmailMessage BuildWaitlistOffer(
        SectionSignup signup, Competition competition, CompetitionSection section, string toAddress,
        DateTime expiresAtUtc, int amountMinor, string? myEntriesUrl = null)
    {
        var deadlineText = FormatDateTime(expiresAtUtc);
        var amountText = Money(amountMinor);

        var sb = new StringBuilder();
        sb.AppendLine("Hello,");
        sb.AppendLine();
        sb.AppendLine($"Good news — a spot has opened up in {section.DisplayName} at {competition.Name}.");
        sb.AppendLine();
        sb.AppendLine($"Event: {competition.Name}");
        sb.AppendLine($"Class: {section.DisplayName}");
        sb.AppendLine($"Entry fee: {amountText}");
        sb.AppendLine($"Accept before: {deadlineText}");
        if (!string.IsNullOrEmpty(myEntriesUrl))
        {
            sb.AppendLine();
            sb.AppendLine("Accept your spot and proceed to payment on My Entries:");
            sb.AppendLine(myEntriesUrl);
        }
        sb.AppendLine();
        sb.AppendLine("Mounted Games");

        var html = new StringBuilder();
        html.Append("<p style=\"margin:0 0 12px;\">Hello,</p>");
        html.Append($"<p style=\"margin:0 0 16px;\">Good news — a spot has opened up in <strong>{EmailHtml.Encode(section.DisplayName)}</strong> at <strong>{EmailHtml.Encode(competition.Name)}</strong>.</p>");
        html.Append("<table role=\"presentation\" style=\"width:100%;border-collapse:collapse;margin:0 0 16px;\">");
        html.Append(EmailHtml.Row("Event", competition.Name));
        html.Append(EmailHtml.Row("Class", section.DisplayName));
        html.Append(EmailHtml.Row("Entry fee", amountText));
        html.Append(EmailHtml.Row("Accept before", deadlineText));
        html.Append("</table>");
        if (!string.IsNullOrEmpty(myEntriesUrl))
            html.Append(EmailHtml.Button(myEntriesUrl, "Accept spot & proceed to payment"));

        var subject = $"Spot available: {section.DisplayName} at {competition.Name}";
        return new EmailMessage(toAddress, subject, sb.ToString(), EmailHtml.Wrap(html.ToString()));
    }

    public static string FormatDateTime(DateTime utc)
    {
        var uk = ToUk(utc);
        return uk.ToString("dddd d MMMM yyyy 'at' HH:mm", Uk);
    }

    public static string Money(int pence)
        => "£" + (pence / 100m).ToString("0.00", Uk);

    public static string FormatDates(DateTime start, DateTime? end)
    {
        var s = ToUk(start);
        var first = s.ToString("dddd d MMMM yyyy", Uk);
        if (end is null) return first;
        var e = ToUk(end.Value);
        return e.Date <= s.Date ? first : $"{first} to {e.ToString("dddd d MMMM yyyy", Uk)}";
    }

    private static DateTime ToUk(DateTime utc)
    {
        var value = utc.Kind == DateTimeKind.Local ? utc.ToUniversalTime() : DateTime.SpecifyKind(utc, DateTimeKind.Utc);
        try
        {
            return TimeZoneInfo.ConvertTimeFromUtc(value, TimeZoneInfo.FindSystemTimeZoneById("Europe/London"));
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return value;
        }
    }
}

/// <summary>Builds and sends the one entry confirmation, inline, and says how it went. Never throws.</summary>
public class SignupConfirmationService(
    IEmailSender sender, IOptions<EmailOptions> options, IConfiguration configuration, ILogger<SignupConfirmationService> log)
{
    public async Task<EmailDeliveryStatus> SendAsync(
        SectionSignup signup, Competition competition, CompetitionSection section,
        OptInOutcome optIn, string? unsubscribeToken)
    {
        if (string.IsNullOrEmpty(signup.ContactEmail)) return EmailDeliveryStatus.NotRequested;
        try
        {
            var site = SiteOrigin();
            var message = SignupConfirmationEmail.Build(
                signup, competition, section, signup.ContactEmail,
                site is null ? null : $"{site}/competitions/{competition.Id}",
                optIn,
                site is null || unsubscribeToken is null ? null : $"{site}/unsubscribe?token={Uri.EscapeDataString(unsubscribeToken)}");
            return await sender.SendAsync(message);
        }
        catch (Exception ex)
        {
            // The sender doesn't throw; this guards the message building. Type only, as the text could hold the address.
            log.LogWarning("Could not build the entry confirmation: {Reason}", ex.GetType().Name);
            return EmailDeliveryStatus.Failed;
        }
    }

    public async Task<EmailDeliveryStatus> SendPaymentReminderAsync(
        SectionSignup signup, Competition competition, CompetitionSection section, string? customNote = null)
    {
        if (string.IsNullOrWhiteSpace(signup.ContactEmail)) return EmailDeliveryStatus.NotRequested;
        try
        {
            var site = SiteOrigin();
            var message = SignupConfirmationEmail.BuildPaymentReminder(
                signup, competition, section, signup.ContactEmail, customNote,
                site is null ? null : $"{site}/competitions/{competition.Id}");
            return await sender.SendAsync(message);
        }
        catch (Exception ex)
        {
            log.LogWarning("Could not build the payment reminder: {Reason}", ex.GetType().Name);
            return EmailDeliveryStatus.Failed;
        }
    }

    public async Task<EmailDeliveryStatus> SendWaitlistOfferAsync(
        SectionSignup signup, Competition competition, CompetitionSection section, DateTime expiresAtUtc, int amountMinor)
    {
        if (string.IsNullOrWhiteSpace(signup.ContactEmail)) return EmailDeliveryStatus.NotRequested;
        try
        {
            var site = SiteOrigin();
            var message = SignupConfirmationEmail.BuildWaitlistOffer(
                signup, competition, section, signup.ContactEmail, expiresAtUtc, amountMinor,
                site is null ? null : $"{site}/me/signups");
            return await sender.SendAsync(message);
        }
        catch (Exception ex)
        {
            log.LogWarning("Could not build the waitlist offer email: {Reason}", ex.GetType().Name);
            return EmailDeliveryStatus.Failed;
        }
    }

    private string? SiteOrigin() => EmailSite.Origin(options.Value, configuration);
}

/// <summary>The website's address (scheme and host) for links in emails, or null when it isn't set or isn't a plain http(s) address.</summary>
public static class EmailSite
{
    public static string? Origin(EmailOptions options, IConfiguration configuration)
    {
        var raw = options.SiteUrl;
        if (string.IsNullOrWhiteSpace(raw)) raw = configuration["Sharing:PublicBaseUrl"];
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > 300) return null;
        if (!Uri.TryCreate(raw.Trim(), UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme is not ("http" or "https") || string.IsNullOrEmpty(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo)) return null;
        return uri.GetLeftPart(UriPartial.Authority);
    }
}
