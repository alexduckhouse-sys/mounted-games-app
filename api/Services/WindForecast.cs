using System.Text.Json;
using System.Text.Json.Nodes;

namespace MountedGames.Api.Services;

/// <summary>Preserves existing km/h columns and adds explicit, UTC gust intervals.</summary>
public static class WindForecast
{
    public static object Enrich(JsonElement root, DateTimeOffset fetchedAt)
    {
        var body = JsonNode.Parse(root.GetRawText())!.AsObject();
        body["fetchedAt"] = fetchedAt.ToString("O");
        var intervals = new JsonArray();
        if (root.TryGetProperty("hourly", out var hours)
            && hours.TryGetProperty("time", out var times) && times.ValueKind == JsonValueKind.Array
            && hours.TryGetProperty("wind_gusts_10m", out var gusts) && gusts.ValueKind == JsonValueKind.Array)
        {
            var values = gusts.EnumerateArray().ToArray();
            var i = 0;
            foreach (var time in times.EnumerateArray())
            {
                if (time.ValueKind == JsonValueKind.Number && time.TryGetInt64(out var epoch) && i < values.Length
                    && values[i].ValueKind == JsonValueKind.Number && values[i].TryGetDouble(out var speed)
                    && double.IsFinite(speed) && speed >= 0)
                    intervals.Add(new JsonObject { ["startsAt"] = epoch - 3600, ["endsAt"] = epoch, ["gustMph"] = speed / 1.609344 });
                i++;
            }
        }
        body["gustIntervals"] = intervals;
        return body;
    }
}
