using System.Collections.Concurrent;
using MountedGames.Api.Services.Email;

namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>A stand-in for the DNS mail check. Domains not listed are treated as able to receive mail.</summary>
public sealed class FakeDomainChecker : IEmailDomainChecker
{
    private readonly ConcurrentDictionary<string, DomainMail> _answers = new(StringComparer.OrdinalIgnoreCase);

    public ConcurrentQueue<string> Asked { get; } = new();

    public void Set(string domain, DomainMail answer) => _answers[domain] = answer;

    public Task<DomainMail> CheckAsync(string domain, CancellationToken ct = default)
    {
        Asked.Enqueue(domain);
        return Task.FromResult(_answers.TryGetValue(domain, out var a) ? a : DomainMail.HasMail);
    }
}
