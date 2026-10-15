using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace MountedGames.Api.Data;

public sealed class UtcDateTimeConverter() : ValueConverter<DateTime, DateTime>(
    value => value.Kind == DateTimeKind.Local
        ? value.ToUniversalTime()
        : DateTime.SpecifyKind(value, DateTimeKind.Utc),
    value => DateTime.SpecifyKind(value, DateTimeKind.Utc));

// Birth dates are calendar values, so changing their time zone would change their meaning.
public sealed class CalendarDateTimeConverter() : ValueConverter<DateTime, DateTime>(
    value => DateTime.SpecifyKind(value, DateTimeKind.Unspecified),
    value => DateTime.SpecifyKind(value, DateTimeKind.Unspecified));
