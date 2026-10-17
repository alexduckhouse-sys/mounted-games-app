using MountedGames.Api.Entities.Commerce;

namespace MountedGames.Api.Services.Commerce;

public interface IPaymentProvider
{
    PaymentProviderResult Checkout(FakePaymentOutcome requestedOutcome);
}

public sealed record PaymentProviderResult(TestPaymentStatus Status, string ReceiptReference);

/// <summary>
/// Deterministic local simulation. It never accepts payment details, makes a
/// network call, or produces a receipt that can be mistaken for real money.
/// </summary>
public sealed class FakePaymentProvider : IPaymentProvider
{
    public PaymentProviderResult Checkout(FakePaymentOutcome requestedOutcome)
    {
        var status = requestedOutcome switch
        {
            FakePaymentOutcome.Success => TestPaymentStatus.Succeeded,
            FakePaymentOutcome.Decline => TestPaymentStatus.Declined,
            FakePaymentOutcome.Cancel => TestPaymentStatus.Cancelled,
            _ => throw new ArgumentOutOfRangeException(nameof(requestedOutcome)),
        };
        return new PaymentProviderResult(
            status,
            $"TEST-{Guid.NewGuid():N}".ToUpperInvariant());
    }
}
