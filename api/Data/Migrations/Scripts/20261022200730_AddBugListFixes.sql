START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022200730_AddBugListFixes') THEN
    ALTER TABLE "Teams" ADD "BibDescription" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022200730_AddBugListFixes') THEN
    ALTER TABLE "Sessions" ADD "LaneRotationMode" integer NOT NULL DEFAULT 0;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022200730_AddBugListFixes') THEN
    ALTER TABLE "SectionSignups" ADD "IsWholeTeam" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022200730_AddBugListFixes') THEN
    ALTER TABLE "SectionSignups" ADD "TeamName" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022200730_AddBugListFixes') THEN
    ALTER TABLE "RiderEntries" ADD "IsGuestRider" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022200730_AddBugListFixes') THEN
    ALTER TABLE "Results" ADD "IsSitOut" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022200730_AddBugListFixes') THEN
    ALTER TABLE "ChatMessages" ADD "RecipientUserId" text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261022200730_AddBugListFixes') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261022200730_AddBugListFixes', '10.0.8');
    END IF;
END $EF$;
COMMIT;

