START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029140739_AddCompetitionIsIndoor') THEN
    ALTER TABLE "Competitions" ADD "IsIndoor" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029140739_AddCompetitionIsIndoor') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261029140739_AddCompetitionIsIndoor', '10.0.8');
    END IF;
END $EF$;
COMMIT;

