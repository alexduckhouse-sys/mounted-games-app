using System.Net;
using Microsoft.Extensions.Configuration;
using MountedGames.Api.Services;

namespace MountedGames.Api.Tests.Services;

public class RedisBackplaneTests
{
    private static IConfiguration Config(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values.ToDictionary(v => v.Key, v => (string?)v.Value)).Build();

    [Fact]
    public void IsOff_WithoutAConnection()
    {
        Assert.Null(RedisBackplane.Options(Config()));
        Assert.Null(RedisBackplane.Options(Config(("REDIS_URL", "  "))));
    }

    [Fact]
    public void ReadsAnUpstashTlsUrl()
    {
        var o = RedisBackplane.Options(Config(("REDIS_URL", "rediss://default:s3cr%40t@eu1-example.upstash.io:6379")))!;

        var endpoint = Assert.IsType<DnsEndPoint>(Assert.Single(o.EndPoints));
        Assert.Equal(("eu1-example.upstash.io", 6379, true, "eu1-example.upstash.io", "default", "s3cr@t", false),
            (endpoint.Host, endpoint.Port, o.Ssl, o.SslHost, o.User, o.Password, o.AbortOnConnectFail));
    }

    [Fact]
    public void ReadsAPlainUrl_WithAPasswordOnly_AndTheDefaultPort()
    {
        var o = RedisBackplane.Options(Config(("KV_URL", "redis://hunter2@localhost")))!;

        var endpoint = Assert.IsType<DnsEndPoint>(Assert.Single(o.EndPoints));
        Assert.Equal(("localhost", 6379, false, null, "hunter2"), (endpoint.Host, endpoint.Port, o.Ssl, o.User, o.Password));
    }

    [Fact]
    public void ReadsAUrlWithNoCredentials_AndAnEmptyUser()
    {
        var bare = RedisBackplane.Options(Config(("REDIS_URL", "redis://cache:6380")))!;
        Assert.Equal((null, null), (bare.User, bare.Password));

        var noUser = RedisBackplane.Options(Config(("REDIS_URL", "redis://:pw@cache:6380")))!;
        Assert.Equal((null, "pw"), (noUser.User, noUser.Password));
    }

    [Fact]
    public void PrefersTheAppSetting_AndAcceptsAConnectionString()
    {
        var o = RedisBackplane.Options(Config(("Redis:ConnectionString", "cache:6381,password=x"), ("REDIS_URL", "redis://other:1")))!;

        var endpoint = Assert.IsType<DnsEndPoint>(Assert.Single(o.EndPoints));
        Assert.Equal(("cache", 6381, "x", false), (endpoint.Host, endpoint.Port, o.Password, o.AbortOnConnectFail));
    }
}
