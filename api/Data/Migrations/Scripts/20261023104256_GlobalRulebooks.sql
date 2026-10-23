START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023104256_GlobalRulebooks') THEN
    DELETE FROM "Rulebook" r WHERE EXISTS (
        SELECT 1 FROM "Rulebook" o
        WHERE o."Title" = r."Title" AND o."Edition" = r."Edition"
          AND (o."UpdatedAt" > r."UpdatedAt" OR (o."UpdatedAt" = r."UpdatedAt" AND o."Id" > r."Id")));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023104256_GlobalRulebooks') THEN
    ALTER TABLE "Rulebook" DROP CONSTRAINT "FK_Rulebook_Competitions_CompetitionId";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023104256_GlobalRulebooks') THEN
    DROP INDEX "IX_Rulebook_CompetitionId_Title_Edition";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023104256_GlobalRulebooks') THEN
    ALTER TABLE "Rulebook" DROP COLUMN "CompetitionId";
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023104256_GlobalRulebooks') THEN
    CREATE UNIQUE INDEX "IX_Rulebook_Title_Edition" ON "Rulebook" ("Title", "Edition");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023104256_GlobalRulebooks') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261023104256_GlobalRulebooks', '10.0.8');
    END IF;
END $EF$;
COMMIT;

