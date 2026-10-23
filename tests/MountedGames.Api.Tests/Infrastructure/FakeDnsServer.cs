using System.Net;
using System.Net.Sockets;

namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>
/// A tiny UDP DNS server on the loopback address, so the real mail-domain check runs end to end without the
/// internet. <see cref="Answer"/> decides each reply; returning null drops the query, which looks like a timeout.
/// </summary>
public sealed class FakeDnsServer : IDisposable
{
    public sealed record Reply(int ResponseCode, params byte[][] Records);

    public const int A = 1, MX = 15, AAAA = 28;

    private readonly UdpClient _udp = new(new IPEndPoint(IPAddress.Loopback, 0));
    private readonly CancellationTokenSource _stop = new();

    public Func<string, int, Reply?> Answer { get; set; } = (_, _) => new Reply(3);

    public IPEndPoint Endpoint => (IPEndPoint)_udp.Client.LocalEndPoint!;

    public FakeDnsServer() => _ = Task.Run(LoopAsync);

    public static byte[] MxRecord(ushort preference, string exchange)
        => [(byte)(preference >> 8), (byte)preference, .. Name(exchange)];

    public static byte[] ARecord(string ip) => IPAddress.Parse(ip).GetAddressBytes();

    private static byte[] Name(string name)
    {
        var bytes = new List<byte>();
        foreach (var label in name.Split('.', StringSplitOptions.RemoveEmptyEntries))
        {
            bytes.Add((byte)label.Length);
            bytes.AddRange(System.Text.Encoding.ASCII.GetBytes(label));
        }
        bytes.Add(0);
        return bytes.ToArray();
    }

    private async Task LoopAsync()
    {
        while (!_stop.IsCancellationRequested)
        {
            UdpReceiveResult request;
            try { request = await _udp.ReceiveAsync(_stop.Token); }
            catch { return; }
            var q = request.Buffer;
            var labels = new List<string>();
            var i = 12;
            while (q[i] != 0) { labels.Add(System.Text.Encoding.ASCII.GetString(q, i + 1, q[i])); i += q[i] + 1; }
            var qtype = (q[i + 1] << 8) | q[i + 2];
            var reply = Answer(string.Join('.', labels), qtype);
            if (reply is null) continue;

            var response = new List<byte> { q[0], q[1], 0x81, (byte)(0x80 | reply.ResponseCode), 0, 1, (byte)(reply.Records.Length >> 8), (byte)reply.Records.Length, 0, 0, 0, 0 };
            response.AddRange(q.Skip(12).Take(i + 5 - 12));
            foreach (var record in reply.Records)
            {
                response.AddRange([0xC0, 0x0C, (byte)(qtype >> 8), (byte)qtype, 0, 1, 0, 0, 0, 60, (byte)(record.Length >> 8), (byte)record.Length]);
                response.AddRange(record);
            }
            await _udp.SendAsync(response.ToArray(), request.RemoteEndPoint);
        }
    }

    public void Dispose()
    {
        _stop.Cancel();
        _udp.Dispose();
        _stop.Dispose();
    }
}
