using System.Text.RegularExpressions;

namespace MountedGames.Api.Tests.Infrastructure;

/// <summary>
/// Production runs Postgres with a retrying execution strategy (<c>EnableRetryOnFailure</c>), which throws on a
/// transaction started outside <c>CreateExecutionStrategy().ExecuteAsync</c>. SQLite in tests has no such strategy, so
/// the mistake only shows on the live site (approving a team manager failed this way). This reads the API source and
/// fails when a <c>BeginTransactionAsync</c> isn't inside the strategy.
/// </summary>
public class ExecutionStrategyTransactionTests
{
    private static readonly Regex Member = new(@"^\s{4}(public|private|internal|protected)\b[^=;]*\(", RegexOptions.Compiled);

    [Fact]
    public void EveryTransactionRunsInsideTheExecutionStrategy()
    {
        var api = Path.Combine(RepoRoot(), "api");
        var offenders = new List<string>();
        foreach (var file in Directory.EnumerateFiles(api, "*.cs", SearchOption.AllDirectories)
                     .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}Migrations{Path.DirectorySeparatorChar}")
                                 && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                                 && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}")))
        {
            var lines = File.ReadAllLines(file);
            var source = string.Join('\n', lines);
            for (var i = 0; i < lines.Length; i++)
            {
                if (!lines[i].Contains("BeginTransactionAsync(")) continue;
                var start = i;
                while (start > 0 && !Member.IsMatch(lines[start])) start--;
                var span = string.Join('\n', lines[start..(i + 1)]);
                if (span.Contains("CreateExecutionStrategy()") || span.Contains("strategy.ExecuteAsync(")) continue;
                // A "…OnceAsync" member is fine when it is only ever run through the strategy.
                var name = Regex.Match(lines[start], @"(\w+OnceAsync)\(").Groups[1].Value;
                if (name.Length > 0 && Regex.IsMatch(source, $@"CreateExecutionStrategy\(\)\.ExecuteAsync\(\(\) => {name}\(")) continue;
                offenders.Add($"{Path.GetRelativePath(api, file)}:{i + 1}");
            }
        }
        Assert.True(offenders.Count == 0,
            "Start transactions inside db.Database.CreateExecutionStrategy().ExecuteAsync(...): " + string.Join(", ", offenders));
    }

    private static string RepoRoot()
    {
        var path = new DirectoryInfo(AppContext.BaseDirectory);
        while (path != null && !File.Exists(Path.Combine(path.FullName, "web/vercel.json"))) path = path.Parent;
        return path?.FullName ?? throw new InvalidOperationException("Could not find the repository root.");
    }
}
