using Microsoft.AspNetCore.Hosting;

namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>
/// A host that looks like production's container: a content root containing wwwroot (the built SPA),
/// the Development environment (OpenAPI document), and a SQLite file inside a folder that doesn't exist yet.
/// </summary>
public class SpaApiFactory : ApiFactory
{
    public string Root { get; } = Directory.CreateTempSubdirectory("mg-spa-").FullName;
    public string DbFolder => Path.Combine(Root, "data", "nested");

    public SpaApiFactory()
    {
        var wwwroot = Directory.CreateDirectory(Path.Combine(Root, "wwwroot"));
        File.WriteAllText(Path.Combine(wwwroot.FullName, "index.html"), "<html>spa-shell</html>");
        Directory.CreateDirectory(Path.Combine(wwwroot.FullName, "assets"));
        File.WriteAllText(Path.Combine(wwwroot.FullName, "assets", "app.js"), "console.log(1)");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseEnvironment("Development");
        builder.UseContentRoot(Root);
        builder.UseSetting("ConnectionStrings:Default", $"Data Source={Path.Combine(DbFolder, "mg.db")}");
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing)
            try { Directory.Delete(Root, true); } catch (IOException) { }
    }
}
