START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026212038_AddStableAndHookupCapacity') THEN
    ALTER TABLE "SignupExtras" ADD "HookupsCount" integer NOT NULL DEFAULT 0;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026212038_AddStableAndHookupCapacity') THEN
    ALTER TABLE "CompetitionEntrySettings" ADD "MaxHookups" integer;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026212038_AddStableAndHookupCapacity') THEN
    ALTER TABLE "CompetitionEntrySettings" ADD "MaxStables" integer;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026212038_AddStableAndHookupCapacity') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261026212038_AddStableAndHookupCapacity', '10.0.8');
    END IF;
END $EF$;
COMMIT;

