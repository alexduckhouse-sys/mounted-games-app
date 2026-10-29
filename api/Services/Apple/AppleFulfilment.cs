using MountedGames.Api.Dtos;
using MountedGames.Api.Entities.Commerce;
namespace MountedGames.Api.Services.Apple;

public static class AppleFulfilment
{
    public static bool HasNights(FulfilmentRequest x) => x.Kind is ArrivalFulfilmentKind.Stable or ArrivalFulfilmentKind.Hookup;
    public static bool Valid(FulfilmentRequest x) => Enum.IsDefined(x.Kind) && (!HasNights(x)
        || (DateOnly.TryParseExact(x.FromDate, "yyyy-MM-dd", out var from) && DateOnly.TryParseExact(x.UntilDate, "yyyy-MM-dd", out var until)
            && until > from && until.DayNumber - from.DayNumber <= 31));
}
