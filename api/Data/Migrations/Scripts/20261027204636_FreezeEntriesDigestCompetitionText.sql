START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027204636_FreezeEntriesDigestCompetitionText') THEN
    ALTER TABLE "EntriesDigestCompetitions" ADD "EndDate" timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027204636_FreezeEntriesDigestCompetitionText') THEN
    ALTER TABLE "EntriesDigestCompetitions" ADD "EntriesCloseAt" timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027204636_FreezeEntriesDigestCompetitionText') THEN
    ALTER TABLE "EntriesDigestCompetitions" ADD "Latitude" double precision;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027204636_FreezeEntriesDigestCompetitionText') THEN
    ALTER TABLE "EntriesDigestCompetitions" ADD "Location" character varying(500);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027204636_FreezeEntriesDigestCompetitionText') THEN
    ALTER TABLE "EntriesDigestCompetitions" ADD "Longitude" double precision;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027204636_FreezeEntriesDigestCompetitionText') THEN
    ALTER TABLE "EntriesDigestCompetitions" ADD "Name" character varying(200) NOT NULL DEFAULT '';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027204636_FreezeEntriesDigestCompetitionText') THEN
    ALTER TABLE "EntriesDigestCompetitions" ADD "StartDate" timestamp with time zone NOT NULL DEFAULT TIMESTAMPTZ '-infinity';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027204636_FreezeEntriesDigestCompetitionText') THEN
    UPDATE "EntriesDigestCompetitions" AS d
    SET "Name" = LEFT(c."Name", 200), "Location" = LEFT(c."Location", 500), "StartDate" = c."StartDate",
        "EndDate" = c."EndDate", "Latitude" = c."Latitude", "Longitude" = c."Longitude"
    FROM "Competitions" AS c
    WHERE c."Id" = d."CompetitionId" AND d."Name" = '';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027204636_FreezeEntriesDigestCompetitionText') THEN
    CREATE INDEX "IX_SectionSignups_ContactEmail" ON "SectionSignups" ("ContactEmail");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027204636_FreezeEntriesDigestCompetitionText') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261027204636_FreezeEntriesDigestCompetitionText', '10.0.8');
    END IF;
END $EF$;
COMMIT;

