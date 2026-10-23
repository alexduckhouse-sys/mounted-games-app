START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023182915_AddAdaptiveDecForms') THEN
    ALTER TABLE "RiderEntries" ADD "AgeGroup" character varying(30);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023182915_AddAdaptiveDecForms') THEN
    ALTER TABLE "RiderEntries" ADD "BirthYear" integer;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023182915_AddAdaptiveDecForms') THEN
    ALTER TABLE "RiderEntries" ADD "CustomValuesJson" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023182915_AddAdaptiveDecForms') THEN
    ALTER TABLE "RiderEntries" ADD "EmergencyContactName" character varying(120);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023182915_AddAdaptiveDecForms') THEN
    ALTER TABLE "RiderEntries" ADD "EmergencyContactPhone" character varying(40);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023182915_AddAdaptiveDecForms') THEN
    ALTER TABLE "RiderEntries" ADD "FlagsJson" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023182915_AddAdaptiveDecForms') THEN
    ALTER TABLE "RiderEntries" ADD "MedicalNotes" character varying(1000);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023182915_AddAdaptiveDecForms') THEN
    ALTER TABLE "RiderEntries" ADD "MembershipNumber" character varying(60);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023182915_AddAdaptiveDecForms') THEN
    ALTER TABLE "RiderEntries" ADD "PonyAge" integer;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023182915_AddAdaptiveDecForms') THEN
    ALTER TABLE "RiderEntries" ADD "PonyPassportNumber" character varying(60);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023182915_AddAdaptiveDecForms') THEN
    ALTER TABLE "RiderEntries" ADD "WeightKg" numeric(5,1);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023182915_AddAdaptiveDecForms') THEN
    ALTER TABLE "DeclarationForms" ADD "TrainerPhone" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023182915_AddAdaptiveDecForms') THEN
    ALTER TABLE "Competitions" ADD "DecFormConfigJson" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023182915_AddAdaptiveDecForms') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261023182915_AddAdaptiveDecForms', '10.0.8');
    END IF;
END $EF$;
COMMIT;

