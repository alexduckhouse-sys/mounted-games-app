START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023174601_AddCreatorWizardColumns') THEN
    ALTER TABLE "Sessions" ADD "PlannedRaces" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023174601_AddCreatorWizardColumns') THEN
    ALTER TABLE "Competitions" ADD "LaneHatbands" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023174601_AddCreatorWizardColumns') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261023174601_AddCreatorWizardColumns', '10.0.8');
    END IF;
END $EF$;
COMMIT;

