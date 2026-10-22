START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022183341_AddTermsTick') THEN
    ALTER TABLE "SectionSignups" ADD "TermsAccepted" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022183341_AddTermsTick') THEN
    ALTER TABLE "SectionSignups" ADD "TermsAcceptedAt" timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022183341_AddTermsTick') THEN
    ALTER TABLE "SectionSignups" ADD "TermsAcceptedByName" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022183341_AddTermsTick') THEN
    ALTER TABLE "SectionSignups" ADD "TermsAcceptedByUserId" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022183341_AddTermsTick') THEN
    ALTER TABLE "SectionSignups" ADD "TermsWordingVersion" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022183341_AddTermsTick') THEN
    ALTER TABLE "Competitions" ADD "TermsText" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022183341_AddTermsTick') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261022183341_AddTermsTick', '10.0.8');
    END IF;
END $EF$;
COMMIT;

