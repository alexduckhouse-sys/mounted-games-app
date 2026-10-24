using Microsoft.EntityFrameworkCore;
using MountedGames.Api.Data;

namespace MountedGames.Api.Services;

public static class EntryExtensionsSqliteSchema
{
    // Definitions also allow databases created by the original request-time SQL to be adopted.
    private static readonly (string Table, string Columns, string Definition, int ForeignKeys)[] Tables =
    [
        ("SignupMatchmaking", "\"DeclarationAccessGranted\", \"SignupId\", \"LookingForPair\", \"LookingForGuestRiders\", \"WaitingForGuestSpot\", \"PairRequestFromSignupId\", \"PairRequestToSignupId\", \"PairRequestStatus\"", """
            "SignupId" INTEGER NOT NULL PRIMARY KEY,
            "DeclarationAccessGranted" INTEGER NOT NULL DEFAULT 0,
            "LookingForPair" INTEGER NOT NULL DEFAULT 0,
            "LookingForGuestRiders" INTEGER NOT NULL DEFAULT 0,
            "WaitingForGuestSpot" INTEGER NOT NULL DEFAULT 0,
            "PairRequestFromSignupId" INTEGER NULL,
            "PairRequestToSignupId" INTEGER NULL,
            "PairRequestStatus" TEXT NULL,
            FOREIGN KEY ("SignupId") REFERENCES "SectionSignups" ("Id") ON DELETE CASCADE,
            FOREIGN KEY ("PairRequestFromSignupId") REFERENCES "SectionSignups" ("Id") ON DELETE SET NULL,
            FOREIGN KEY ("PairRequestToSignupId") REFERENCES "SectionSignups" ("Id") ON DELETE SET NULL
            """, 3),
        ("SignupExtras", "\"SignupId\", \"StablesCount\", \"StablingClubOrTeam\", \"PaymentMethod\", \"IsWaitlist\", \"IsWithdrawn\", \"RefundPending\", \"TeamsCount\"", """
            "SignupId" INTEGER NOT NULL PRIMARY KEY,
            "StablesCount" INTEGER NOT NULL DEFAULT 0,
            "StablingClubOrTeam" TEXT NULL,
            "PaymentMethod" TEXT NULL,
            "IsWaitlist" INTEGER NOT NULL DEFAULT 0,
            "IsWithdrawn" INTEGER NOT NULL DEFAULT 0,
            "RefundPending" INTEGER NOT NULL DEFAULT 0,
            "TeamsCount" INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY ("SignupId") REFERENCES "SectionSignups" ("Id") ON DELETE CASCADE
            """, 1),
        ("CompetitionEntrySettings", "\"CompetitionId\", \"EntriesCloseAt\"", """
            "CompetitionId" INTEGER NOT NULL PRIMARY KEY,
            "EntriesCloseAt" TEXT NULL,
            FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE
            """, 1),
        ("CompetitionDeclarationLocks", "\"CompetitionId\", \"DeclarationsCloseAt\"", """
            "CompetitionId" INTEGER NOT NULL PRIMARY KEY,
            "DeclarationsCloseAt" TEXT NULL,
            FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE
            """, 1),
    ];

    public static Task EnsureAsync(AppDbContext db) =>
        db.Database.CreateExecutionStrategy().ExecuteAsync(() => EnsureOnceAsync(db));

    private static async Task EnsureOnceAsync(AppDbContext db)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        foreach (var (table, columns, definition, foreignKeys) in Tables)
        {
            var createSql = $"CREATE TABLE IF NOT EXISTS \"{table}\" ({definition});";
            await db.Database.ExecuteSqlRawAsync(createSql);
            if (table == "SignupMatchmaking"
                && await db.Database.SqlQueryRaw<int>("SELECT COUNT(*) AS Value FROM pragma_table_info('SignupMatchmaking') WHERE name = 'DeclarationAccessGranted'").SingleAsync() == 0)
                await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"SignupMatchmaking\" ADD COLUMN \"DeclarationAccessGranted\" INTEGER NOT NULL DEFAULT 0;");
            var count = await db.Database.SqlQuery<int>($"SELECT COUNT(*) AS \"Value\" FROM pragma_foreign_key_list({table})").SingleAsync();
            if (count == foreignKeys) continue;

            // SQLite cannot add a foreign key. Copy inside the transaction; invalid legacy rows fail
            // without deleting the original table or silently dropping data.
            var rebuildSql = $"""
                CREATE TABLE "{table}_ef_upgrade" ({definition});
                INSERT INTO "{table}_ef_upgrade" ({columns}) SELECT {columns} FROM "{table}";
                DROP TABLE "{table}";
                ALTER TABLE "{table}_ef_upgrade" RENAME TO "{table}";
                """;
            await db.Database.ExecuteSqlRawAsync(rebuildSql);
        }
        await db.Database.ExecuteSqlRawAsync("""
            CREATE INDEX IF NOT EXISTS "IX_SignupMatchmaking_PairRequestFromSignupId" ON "SignupMatchmaking" ("PairRequestFromSignupId");
            CREATE INDEX IF NOT EXISTS "IX_SignupMatchmaking_PairRequestToSignupId" ON "SignupMatchmaking" ("PairRequestToSignupId");
            """);
        await transaction.CommitAsync();
    }
}
