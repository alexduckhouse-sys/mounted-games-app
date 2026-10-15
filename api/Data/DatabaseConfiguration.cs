using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace MountedGames.Api.Data;

public static class DatabaseConfiguration
{
    public static bool UsesPostgres(IConfiguration configuration) =>
        !string.IsNullOrWhiteSpace(configuration["DATABASE_URL"]) ||
        string.Equals(configuration["Database:Provider"], "postgres", StringComparison.OrdinalIgnoreCase);

    public static void Configure(DbContextOptionsBuilder options, IConfiguration configuration, bool migrate = false)
    {
        if (!UsesPostgres(configuration))
        {
            options.UseSqlite(configuration.GetConnectionString("Default") ?? "Data Source=mg.db");
            return;
        }

        var name = migrate ? "DATABASE_URL_UNPOOLED" : "DATABASE_URL";
        var value = configuration[name];
        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException($"Set {name} for PostgreSQL before starting the API.");

        var connection = ParsePostgresUrl(value);
        if (migrate)
        {
            var settings = new NpgsqlConnectionStringBuilder(connection);
            if (settings.Host?.Contains("-pooler.", StringComparison.OrdinalIgnoreCase) == true)
                throw new InvalidOperationException("Migrations require a direct PostgreSQL endpoint.");
        }

        options.UseNpgsql(connection, postgres => postgres.EnableRetryOnFailure(3));
    }

    public static string ParsePostgresUrl(string value)
    {
        // Do not include the URL or parser exception in an error: either can contain credentials.
        try
        {
            var uri = new Uri(value);
            if (uri.Scheme is not ("postgres" or "postgresql") || string.IsNullOrEmpty(uri.Host))
                throw new FormatException();
            var credentials = uri.UserInfo.Split(':', 2);
            if (credentials.Length != 2 || string.IsNullOrEmpty(uri.AbsolutePath.Trim('/')))
                throw new FormatException();

            var settings = new NpgsqlConnectionStringBuilder
            {
                Host = uri.Host,
                Port = uri.IsDefaultPort ? 5432 : uri.Port,
                Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
                Username = Uri.UnescapeDataString(credentials[0]),
                Password = Uri.UnescapeDataString(credentials[1]),
                SslMode = SslMode.VerifyFull,
                Pooling = true,
                MaxPoolSize = 20,
                Timeout = 30,
                ApplicationName = "mounted-games-api",
                IncludeErrorDetail = false,
            };
            foreach (var parameter in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var pair = parameter.Split('=', 2);
                var key = Uri.UnescapeDataString(pair[0]);
                var option = pair.Length == 2 ? Uri.UnescapeDataString(pair[1]) : "";
                switch (key)
                {
                    // Neon supplies require; VerifyFull also checks the server certificate.
                    case "sslmode" when option is "require" or "verify-full" or "verify-ca":
                        break;
                    case "channel_binding":
                        settings.ChannelBinding = Enum.Parse<ChannelBinding>(option, true);
                        break;
                    case "application_name":
                        settings.ApplicationName = option;
                        break;
                    case "connect_timeout":
                        settings.Timeout = int.Parse(option, System.Globalization.CultureInfo.InvariantCulture);
                        break;
                    default:
                        throw new FormatException();
                }
            }
            return settings.ConnectionString;
        }
        catch (Exception error) when (error is ArgumentException or FormatException or OverflowException)
        {
            throw new InvalidOperationException("Invalid PostgreSQL URL. Use the Neon connection variables with TLS enabled.");
        }
    }
}
