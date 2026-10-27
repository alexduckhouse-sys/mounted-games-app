START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026212737_AddEntriesWaitlistClubInvoiceFields') THEN
    ALTER TABLE "SignupExtras" ADD "ArrivalWindow" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026212737_AddEntriesWaitlistClubInvoiceFields') THEN
    ALTER TABLE "SignupExtras" ADD "DispositionNote" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026212737_AddEntriesWaitlistClubInvoiceFields') THEN
    ALTER TABLE "SignupExtras" ADD "DispositionUpdatedAt" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026212737_AddEntriesWaitlistClubInvoiceFields') THEN
    ALTER TABLE "SignupExtras" ADD "FeeDisposition" text NOT NULL DEFAULT 'None';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026212737_AddEntriesWaitlistClubInvoiceFields') THEN
    ALTER TABLE "SignupExtras" ADD "LastReminderSentAt" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026212737_AddEntriesWaitlistClubInvoiceFields') THEN
    ALTER TABLE "SignupExtras" ADD "RefundedAmountMinor" integer;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026212737_AddEntriesWaitlistClubInvoiceFields') THEN
    ALTER TABLE "SignupExtras" ADD "WaitlistOfferExpiresAt" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026212737_AddEntriesWaitlistClubInvoiceFields') THEN
    ALTER TABLE "SignupExtras" ADD "WaitlistOfferedAt" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026212737_AddEntriesWaitlistClubInvoiceFields') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261026212737_AddEntriesWaitlistClubInvoiceFields', '10.0.8');
    END IF;
END $EF$;
COMMIT;
