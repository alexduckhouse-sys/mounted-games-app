START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026211708_AddStablingPassAndPaymentLink') THEN
    ALTER TABLE "SignupExtras" ADD "ArrivalNotes" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026211708_AddStablingPassAndPaymentLink') THEN
    ALTER TABLE "SignupExtras" ADD "HookupAssignment" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026211708_AddStablingPassAndPaymentLink') THEN
    ALTER TABLE "SignupExtras" ADD "StableAssignment" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026211708_AddStablingPassAndPaymentLink') THEN
    ALTER TABLE "SignupExtras" ADD "VehicleRegistration" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026211708_AddStablingPassAndPaymentLink') THEN
    ALTER TABLE "Competitions" ADD "PaymentLinkUrl" character varying(500);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026211708_AddStablingPassAndPaymentLink') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261026211708_AddStablingPassAndPaymentLink', '10.0.8');
    END IF;
END $EF$;
COMMIT;

