START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023113448_AddDecFormFields') THEN
    ALTER TABLE "SavedRiders" ADD "PonyHeightHands" numeric(4,1);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023113448_AddDecFormFields') THEN
    ALTER TABLE "RiderEntries" ADD "PonyHeightHands" numeric(4,1);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023113448_AddDecFormFields') THEN
    ALTER TABLE "DeclarationForms" ADD "TermsAcceptedAt" timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023113448_AddDecFormFields') THEN
    ALTER TABLE "DeclarationForms" ADD "TermsAcceptedByUserId" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023113448_AddDecFormFields') THEN
    ALTER TABLE "DeclarationForms" ADD "TrainerName" character varying(200);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023113448_AddDecFormFields') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261023113448_AddDecFormFields', '10.0.8');
    END IF;
END $EF$;
COMMIT;

