using MountedGames.Api.Entities;

namespace MountedGames.Api.Dtos;

public enum EmailBlockType
{
    /// <summary>Plain text. Blank lines make paragraphs. No markup is read, so nothing typed can become HTML.</summary>
    Text = 0,
    /// <summary>A picture uploaded with <c>POST /api/admin/custom-email-images</c>.</summary>
    Picture = 1,
    /// <summary>A button: a label and an https link.</summary>
    Button = 2,
    /// <summary>A competition's name, dates, venue and an Enter link, read from the competition when the email is made.</summary>
    Competition = 3,
}

/// <summary>One block of an email. Only the fields for its <c>Type</c> are read.</summary>
public record EmailBlockDto(
    EmailBlockType Type, string? Text = null, Guid? ImageId = null, string? Alt = null,
    string? Label = null, string? Url = null, int? CompetitionId = null);

public record CustomEmailContentRequest(string Subject, CustomEmailAudience Audience, IReadOnlyList<EmailBlockDto> Blocks);

/// <param name="Confirm">Must be true: sending is a deliberate act.</param>
/// <param name="ExpectedRecipients">The number the admin saw for this audience. If the list has changed since, nothing is sent and the new number comes back.</param>
public record SendCustomEmailRequest(
    string Subject, CustomEmailAudience Audience, IReadOnlyList<EmailBlockDto> Blocks, bool Confirm, int ExpectedRecipients);

public record CustomEmailPreviewDto(string Subject, string Html, string Text);
public record CustomEmailTestDto(EmailDeliveryStatus Status);
public record CustomEmailImageDto(Guid Id, string Url, int Bytes);
public record CustomEmailAudienceDto(CustomEmailAudience Audience, string Label, int Recipients);

/// <summary>A custom email and how it went. <c>Remaining</c> is the people still to try; the send is finished when it is 0.</summary>
public record CustomEmailDto(
    int Id, string Subject, CustomEmailAudience Audience, CustomEmailStatus Status, int Total, int Sent, int Failed, int Skipped,
    int Remaining, DateTime CreatedAt, DateTime? CompletedAt, string? CreatedByName);

public record CustomEmailDetailDto(CustomEmailDto Email, IReadOnlyList<EmailBlockDto> Blocks);
