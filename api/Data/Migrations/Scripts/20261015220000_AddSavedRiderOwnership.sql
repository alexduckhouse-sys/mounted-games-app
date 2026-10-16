START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261015220000_AddSavedRiderOwnership') THEN
    ALTER TABLE "SavedRiders" ADD "CreatedByUserId" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261015220000_AddSavedRiderOwnership') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261015220000_AddSavedRiderOwnership', '10.0.8');
    END IF;
END $EF$;
COMMIT;
