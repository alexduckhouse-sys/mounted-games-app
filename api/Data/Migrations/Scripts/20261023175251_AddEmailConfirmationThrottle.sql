START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023175251_AddEmailConfirmationThrottle') THEN
    ALTER TABLE "AspNetUsers" ADD "ConfirmationsSentToday" integer NOT NULL DEFAULT 0;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023175251_AddEmailConfirmationThrottle') THEN
    ALTER TABLE "AspNetUsers" ADD "LastConfirmationSentAt" timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261023175251_AddEmailConfirmationThrottle') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261023175251_AddEmailConfirmationThrottle', '10.0.8');
    END IF;
END $EF$;
COMMIT;

