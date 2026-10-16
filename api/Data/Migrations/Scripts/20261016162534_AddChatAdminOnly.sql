START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261016162534_AddChatAdminOnly') THEN
    ALTER TABLE "ChatMessages" ADD "AdminOnly" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261016162534_AddChatAdminOnly') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261016162534_AddChatAdminOnly', '10.0.8');
    END IF;
END $EF$;
COMMIT;

