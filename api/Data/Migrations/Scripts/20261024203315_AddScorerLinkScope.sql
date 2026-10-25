START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261024203315_AddScorerLinkScope') THEN
    ALTER TABLE "ScorerLinks" ADD "Scope" integer NOT NULL DEFAULT 0;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261024203315_AddScorerLinkScope') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261024203315_AddScorerLinkScope', '10.0.8');
    END IF;
END $EF$;
COMMIT;
