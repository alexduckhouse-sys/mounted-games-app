using System.Net;
using System.Text;

namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>Replaces the network for named HttpClients (weather, geocoding, push): tests queue canned responses by URL fragment.</summary>
public class StubHttp : HttpMessageHandler
{
    private readonly List<(string Fragment, Func<HttpRequestMessage, HttpResponseMessage> Respond)> _routes = new();

    public List<string> Requests { get; } = new();

    public void Reset()
    {
        _routes.Clear();
        Requests.Clear();
    }

    public void RespondJson(string urlFragment, string json, HttpStatusCode status = HttpStatusCode.OK)
        => _routes.Add((urlFragment, _ => new HttpResponseMessage(status)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        }));

    public void Throw(string urlFragment)
        => _routes.Add((urlFragment, _ => throw new HttpRequestException("stubbed network failure")));

    public void Respond(string urlFragment, Func<HttpRequestMessage, HttpResponseMessage> respond)
    {
        lock (_routes) _routes.Add((urlFragment, respond));
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var url = request.RequestUri!.ToString();
        (string Fragment, Func<HttpRequestMessage, HttpResponseMessage> Respond)[] routes;
        lock (_routes)
        {
            Requests.Add(url);
            routes = _routes.ToArray();
        }
        foreach (var (fragment, respond) in routes)
            if (url.Contains(fragment, StringComparison.OrdinalIgnoreCase))
                return Task.FromResult(respond(request));
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }
}
