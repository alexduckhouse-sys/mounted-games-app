START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022161142_AddRiderPrivacy') THEN
    ALTER TABLE "SectionSignups" ADD "NoFilming" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022161142_AddRiderPrivacy') THEN
    ALTER TABLE "SectionSignups" ADD "UseInitialOnly" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022161142_AddRiderPrivacy') THEN
    ALTER TABLE "SavedRiders" ADD "NoFilming" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022161142_AddRiderPrivacy') THEN
    ALTER TABLE "SavedRiders" ADD "UseInitialOnly" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022161142_AddRiderPrivacy') THEN
    ALTER TABLE "RiderEntries" ADD "NoFilming" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022161142_AddRiderPrivacy') THEN
    ALTER TABLE "RiderEntries" ADD "UseInitialOnly" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022161142_AddRiderPrivacy') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261022161142_AddRiderPrivacy', '10.0.8');
    END IF;
END $EF$;
COMMIT;

