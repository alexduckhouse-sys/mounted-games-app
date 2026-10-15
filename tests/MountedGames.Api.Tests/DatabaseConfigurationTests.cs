using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Microsoft.Extensions.Configuration;
using MountedGames.Api.Data;
using MountedGames.Api.Entities;
using Npgsql;

namespace MountedGames.Api.Tests;

public class DatabaseConfigurationTests
{
    private const string FakeUrl = "postgresql://fake%40user:fake%3Bpassword%3Avalue@fake-pooler.example.invalid/neondb?sslmode=require&channel_binding=require";

    [Fact]
    public void ConnectionUsesTlsAndDecodesCredentialsWithoutSplittingPassword()
    {
        var connection = new NpgsqlConnectionStringBuilder(DatabaseConfiguration.ParsePostgresUrl(FakeUrl));
        Assert.Equal("fake@user", connection.Username);
        Assert.Equal("fake;password:value", connection.Password);
        Assert.Equal(5432, connection.Port);
        Assert.Equal(SslMode.VerifyFull, connection.SslMode);
        Assert.Equal(ChannelBinding.Require, connection.ChannelBinding);
        Assert.False(connection.IncludeErrorDetail);
    }

    [Theory]
    [InlineData("https://fake:secret@example.invalid/db")]
    [InlineData("postgresql://fake:secret@example.invalid/")]
    [InlineData("postgresql://fake:secret@example.invalid/db?sslmode=disable")]
    [InlineData("postgresql://fake:secret@example.invalid/db?channel_binding=invalid")]
    [InlineData("postgresql://fake:secret@example.invalid/db?unknown=1")]
    public void InvalidUrlsFailWithoutIncludingCredentials(string value)
    {
        var error = Assert.Throws<InvalidOperationException>(() => DatabaseConfiguration.ParsePostgresUrl(value));
        Assert.DoesNotContain("secret", error.ToString());
        Assert.Null(error.InnerException);
    }

    [Fact]
    public void NeonVariableTakesPrecedenceOverLegacySqliteConfiguration()
    {
        var configuration = Config(("DATABASE_URL", FakeUrl), ("ConnectionStrings:Default", "Data Source=old.db"));
        var options = new DbContextOptionsBuilder<AppDbContext>();
        DatabaseConfiguration.Configure(options, configuration);
        using var db = new AppDbContext(options.Options);
        Assert.True(db.Database.IsNpgsql());
    }

    [Fact]
    public void ExplicitPostgresConfigurationDoesNotFallBackToSqliteWithoutCredentials()
    {
        Assert.Throws<InvalidOperationException>(() => DatabaseConfiguration.Configure(
            new DbContextOptionsBuilder<AppDbContext>(), Config(("Database:Provider", "postgres"))));
    }

    [Fact]
    public void ExistingLocalSqliteConfigurationStillWorks()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>();
        DatabaseConfiguration.Configure(options, Config(("ConnectionStrings:Default", "Data Source=:memory:")));
        using var db = new AppDbContext(options.Options);
        Assert.True(db.Database.IsSqlite());
        db.Database.OpenConnection();
        db.Database.EnsureCreated();
        Assert.Empty(db.Competitions.ToList());
    }

    [Theory]
    [InlineData(null)]
    [InlineData(FakeUrl)]
    public void MigrationsRejectMissingOrPooledDirectUrl(string? directUrl)
    {
        Assert.Throws<InvalidOperationException>(() => DatabaseConfiguration.Configure(
            new DbContextOptionsBuilder<AppDbContext>(),
            Config(("DATABASE_URL", FakeUrl), ("DATABASE_URL_UNPOOLED", directUrl)), migrate: true));
    }

    [Fact]
    public void MigrationUsesDirectEndpointAndOnlyCreatesSchema()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>();
        DatabaseConfiguration.Configure(options, Config(("DATABASE_URL", FakeUrl),
            ("DATABASE_URL_UNPOOLED", FakeUrl.Replace("fake-pooler.", "fake."))), migrate: true);
        using var db = new AppDbContext(options.Options);
        Assert.Equal("fake.example.invalid", new NpgsqlConnectionStringBuilder(db.Database.GetConnectionString()).Host);
        var assembly = db.GetService<IMigrationsAssembly>();
        var migration = assembly.CreateMigration(assembly.Migrations.First().Value, db.Database.ProviderName!);
        Assert.NotEmpty(migration.UpOperations);
        Assert.All(migration.UpOperations, operation =>
            Assert.True(operation is CreateTableOperation or CreateIndexOperation));
    }

    [Fact]
    public void TimestampMappingPreservesInstantsAndCalendarDates()
    {
        using var db = new AppDbContextFactory().CreateDbContext([]);
        var start = db.Model.FindEntityType(typeof(Competition))!.FindProperty(nameof(Competition.StartDate))!;
        var birthday = db.Model.FindEntityType(typeof(SavedRider))!.FindProperty(nameof(SavedRider.DateOfBirth))!;
        var fakeDate = new DateTime(2000, 1, 2, 12, 0, 0, DateTimeKind.Unspecified);
        var instant = Assert.IsType<DateTime>(start.GetValueConverter()!.ConvertToProvider(fakeDate));
        Assert.Equal(DateTimeKind.Utc, instant.Kind);
        Assert.Equal(fakeDate.Ticks, instant.Ticks);
        Assert.Equal("timestamp with time zone", start.GetColumnType());
        var calendar = Assert.IsType<DateTime>(birthday.GetValueConverter()!.ConvertToProvider(instant));
        Assert.Equal(DateTimeKind.Unspecified, calendar.Kind);
        Assert.Equal(fakeDate.Ticks, calendar.Ticks);
        Assert.Equal("timestamp without time zone", birthday.GetColumnType());
    }

    private static IConfiguration Config(params (string Key, string? Value)[] settings) =>
        new ConfigurationBuilder().AddInMemoryCollection(settings.ToDictionary(x => x.Key, x => x.Value)).Build();
}
