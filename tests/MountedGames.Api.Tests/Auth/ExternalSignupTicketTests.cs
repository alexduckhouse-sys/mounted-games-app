using Microsoft.Extensions.Configuration;
using MountedGames.Api.Auth;
using MountedGames.Api.Tests.Infrastructure;

namespace MountedGames.Api.Tests.Auth;

/// <summary>The ten-minute sign-up ticket a provider sign-in gets when it finds no account.</summary>
public class ExternalSignupTicketTests
{
    private readonly ManualTimeProvider _clock = new();

    private ExternalSignupTickets Tickets(string jwtKey = "test-jwt-key-0123456789-0123456789-0123456789")
        => new(new ConfigurationBuilder().AddInMemoryCollection([new("Jwt:Key", jwtKey)]).Build(), _clock);

    private static readonly ExternalSignupTicket Sample = new("apple", "001234.abc.5678", "sam@privaterelay.appleid.com", false, "Sam Taylor");

    [Fact]
    public void AFreshTicketReadsBackExactly()
    {
        var tickets = Tickets();
        Assert.Equal(Sample, tickets.Read(tickets.Create(Sample)));
        var withEmail = Sample with { Provider = "google", Email = "sam@gmail.com", EmailVouched = true };
        Assert.Equal(withEmail, tickets.Read(tickets.Create(withEmail)));
    }

    [Fact]
    public void ATicketLastsTenMinutes()
    {
        var tickets = Tickets();
        var ticket = tickets.Create(Sample);
        _clock.Advance(ExternalSignupTickets.Lifetime);
        Assert.NotNull(tickets.Read(ticket));
        _clock.Advance(TimeSpan.FromSeconds(1));
        Assert.Null(tickets.Read(ticket));
    }

    [Fact]
    public void AnAlteredOrForeignTicketIsRefused()
    {
        var tickets = Tickets();
        var ticket = tickets.Create(Sample);
        var dot = ticket.IndexOf('.');

        // Someone else's subject in the body, with the old signature.
        var forged = Tickets().Create(Sample with { Subject = "someone-else" });
        Assert.Null(tickets.Read(forged[..forged.IndexOf('.')] + ticket[dot..]));
        Assert.Null(tickets.Read(ticket[..^2] + (ticket[^2..] == "AA" ? "BB" : "AA")));
        // Signed with a different server key.
        Assert.Null(tickets.Read(Tickets("another-key-0123456789-0123456789-0123456789").Create(Sample)));

        foreach (var junk in new[] { null, "", "no-dot", ".starts-with-dot", new string('a', 5000) })
            Assert.Null(tickets.Read(junk));

        // A correctly signed ticket from before every ticket carried an address makes no account.
        Assert.Null(tickets.Read(tickets.Create(Sample with { Email = null! })));
    }
}
