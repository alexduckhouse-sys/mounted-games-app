START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261025210613_AddFinalScoringOptions') THEN
    ALTER TABLE "CompetitionSections" ADD "CarryPointsIntoFinal" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261025210613_AddFinalScoringOptions') THEN
    ALTER TABLE "CompetitionSections" ADD "DoublePointsInFinal" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261025210613_AddFinalScoringOptions') THEN
    ALTER TABLE "CompetitionSections" ADD "HasFinal" boolean NOT NULL DEFAULT TRUE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261025210613_AddFinalScoringOptions') THEN
    UPDATE "CompetitionSections" SET "CarryPointsIntoFinal" = TRUE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261025210613_AddFinalScoringOptions') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261025210613_AddFinalScoringOptions', '10.0.8');
    END IF;
END $EF$;
COMMIT;

