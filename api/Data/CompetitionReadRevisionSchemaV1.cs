using Microsoft.EntityFrameworkCore;

namespace MountedGames.Api.Data;

/// <summary>
/// Versioned migration SQL: triggers make revisions atomic with tracked, bulk and SQL writes,
/// including rollback, cascades and moves between competitions. Keep V1 unchanged after release.
/// No FK on revisions: a deleted competition keeps its tombstone until its cached copies expire.
/// </summary>
public static class CompetitionReadRevisionSchemaV1
{
    internal sealed record Rule(string Table, string Ids, bool Standings = true, bool Detail = true, string? UpdateColumns = null);
    private const string Session = "SELECT s.\"CompetitionId\" AS id FROM \"Sessions\" s WHERE s.\"Id\" = {r}.\"SessionId\"";
    private const string Heat = "SELECT s.\"CompetitionId\" AS id FROM \"Heats\" h JOIN \"Sessions\" s ON s.\"Id\" = h.\"SessionId\" WHERE h.\"Id\" = {r}.\"HeatId\"";
    private const string Team = "SELECT t.\"CompetitionId\" AS id FROM \"Teams\" t WHERE t.\"Id\" = {r}.\"TeamId\"";
    private const string Signup = "SELECT s.\"CompetitionId\" AS id FROM \"SectionSignups\" x JOIN \"CompetitionSections\" s ON s.\"Id\" = x.\"CompetitionSectionId\" WHERE x.\"Id\" = {r}.\"SignupId\"";
    internal static readonly Rule[] Rules =
    [
        new("Competitions", "SELECT {r}.\"Id\" AS id"),
        new("CompetitionSections", "SELECT {r}.\"CompetitionId\" AS id"),
        new("Teams", "SELECT {r}.\"CompetitionId\" AS id"),
        new("Sessions", "SELECT {r}.\"CompetitionId\" AS id"),
        new("Heats", Session),
        new("HeatEntries", Heat + " UNION " + Team),
        new("Races", Heat),
        new("Results", Team + " UNION SELECT s.\"CompetitionId\" AS id FROM \"Races\" r JOIN \"Heats\" h ON h.\"Id\" = r.\"HeatId\" JOIN \"Sessions\" s ON s.\"Id\" = h.\"SessionId\" WHERE r.\"Id\" = {r}.\"RaceId\""),
        new("FinalsTieOrders", "SELECT {r}.\"CompetitionId\" AS id", Detail: false),
        new("TackCheckSections", "SELECT {r}.\"CompetitionId\" AS id", Detail: false),
        new("TackCheckSectors", "SELECT s.\"CompetitionId\" AS id FROM \"TackCheckSections\" s WHERE s.\"Id\" = {r}.\"TackCheckSectionId\"", Detail: false),
        new("TackCheckMarks", Team, Detail: false),
        new("SectionSignups", "SELECT s.\"CompetitionId\" AS id FROM \"CompetitionSections\" s WHERE s.\"Id\" = {r}.\"CompetitionSectionId\"", Standings: false),
        new("SignupExtras", Signup, Standings: false),
        new("SignupMatchmaking", Signup, Standings: false),
        new("CompetitionEntrySettings", "SELECT {r}.\"CompetitionId\" AS id", Standings: false),
        new("EventCommerceSettings", "SELECT {r}.\"CompetitionId\" AS id", Standings: false),
        new("EventOrder", "SELECT {r}.\"CompetitionId\" AS id", Standings: false),
        new("EventOrderLine", "SELECT o.\"CompetitionId\" AS id FROM \"EventOrder\" o WHERE o.\"Id\" = {r}.\"EventOrderId\"", Standings: false),
        new("Clubs", "SELECT t.\"CompetitionId\" AS id FROM \"Teams\" t WHERE t.\"ClubId\" = {r}.\"Id\""),
        // Payout clubs may be pinned in JSON, so their infrequent edits invalidate the shared detail version.
        new("ClubPayoutAccounts", "SELECT 0 AS id", Standings: false),
        new("Clubs", "SELECT 0 AS id", Standings: false, UpdateColumns: "Name"),
        new("AspNetUsers", "SELECT 0 AS id", Standings: false, UpdateColumns: "FullName,ClubId"),
    ];

    public static IEnumerable<string> Create(bool sqlite)
    {
        foreach (var (rule, index) in Rules.Select((r, i) => (r, i)))
        foreach (var (row, timing, events) in new[] { ("OLD", "BEFORE", "UPDATE OR DELETE"), ("NEW", "AFTER", "INSERT OR UPDATE") })
        {
            var name = $"mg_read_revision_{index}_{row.ToLowerInvariant()}";
            var select = rule.Ids.Replace("{r}", row);
            var bump = $"INSERT INTO \"CompetitionReadRevisions\" (\"CompetitionId\", \"Standings\", \"Detail\") SELECT DISTINCT id, {(rule.Standings ? 1 : 0)}, {(rule.Detail ? 1 : 0)} FROM ({select}) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT (\"CompetitionId\") DO UPDATE SET \"Standings\" = \"CompetitionReadRevisions\".\"Standings\" + {(rule.Standings ? 1 : 0)}, \"Detail\" = \"CompetitionReadRevisions\".\"Detail\" + {(rule.Detail ? 1 : 0)};";
            var changed = rule.UpdateColumns is null ? null : string.Join(" OR ", rule.UpdateColumns.Split(',').Select(c => sqlite
                ? $"OLD.\"{c}\" IS NOT NEW.\"{c}\"" : $"OLD.\"{c}\" IS DISTINCT FROM NEW.\"{c}\""));
            if (sqlite)
            {
                foreach (var operation in events.Split(" OR "))
                {
                    var when = operation == "UPDATE" && changed is not null ? $" WHEN {changed}" : "";
                    yield return $"CREATE TRIGGER IF NOT EXISTS \"{name}_{operation}\" {timing} {operation} ON \"{rule.Table}\" FOR EACH ROW{when} BEGIN {bump} END;";
                }
            }
            else
            {
                var body = changed is null ? bump : $"IF TG_OP <> 'UPDATE' OR ({changed}) THEN {bump} END IF;";
                // A BEFORE UPDATE trigger must return NEW; returning OLD silently discards the edit.
                var result = row == "OLD" ? "IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;" : "RETURN NEW;";
                yield return $"CREATE FUNCTION \"{name}\"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN {body} {result} END; $revision$; CREATE TRIGGER \"{name}\" {timing} {events} ON \"{rule.Table}\" FOR EACH ROW EXECUTE FUNCTION \"{name}\"();";
            }
        }
    }

    public static IEnumerable<string> DropPostgres()
        => Rules.SelectMany((rule, i) => new[] { "old", "new" }.Select(row =>
            $"DROP TRIGGER IF EXISTS \"mg_read_revision_{i}_{row}\" ON \"{rule.Table}\"; DROP FUNCTION IF EXISTS \"mg_read_revision_{i}_{row}\"();"));

    public static async Task EnsureSqliteAsync(AppDbContext db)
    {
        await db.Database.ExecuteSqlRawAsync("CREATE TABLE IF NOT EXISTS \"CompetitionReadRevisions\" (\"CompetitionId\" INTEGER NOT NULL PRIMARY KEY, \"Standings\" INTEGER NOT NULL, \"Detail\" INTEGER NOT NULL);");
        foreach (var sql in Create(sqlite: true)) await db.Database.ExecuteSqlRawAsync(sql);
    }
}
