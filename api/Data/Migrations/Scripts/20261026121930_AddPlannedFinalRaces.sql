START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026121930_AddPlannedFinalRaces') THEN
    ALTER TABLE "Sessions" ADD "PlannedFinalRaces" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026121930_AddPlannedFinalRaces') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261026121930_AddPlannedFinalRaces', '10.0.8');
    END IF;
END $EF$;
COMMIT;

