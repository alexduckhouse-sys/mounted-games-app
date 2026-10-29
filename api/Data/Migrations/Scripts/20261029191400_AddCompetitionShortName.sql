START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029191400_AddCompetitionShortName') THEN
    ALTER TABLE "Competitions" ADD "ShortName" character varying(40);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029191400_AddCompetitionShortName') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261029191400_AddCompetitionShortName', '10.0.8');
    END IF;
END $EF$;
COMMIT;

