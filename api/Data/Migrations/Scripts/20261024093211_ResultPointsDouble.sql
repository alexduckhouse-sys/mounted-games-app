START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261024093211_ResultPointsDouble') THEN
    ALTER TABLE "SeasonRoundResult" ALTER COLUMN "EventPoints" TYPE double precision;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261024093211_ResultPointsDouble') THEN
    ALTER TABLE "Results" ALTER COLUMN "Points" TYPE double precision;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261024093211_ResultPointsDouble') THEN
    ALTER TABLE "FinalsTieOrders" ALTER COLUMN "Points" TYPE double precision;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261024093211_ResultPointsDouble') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261024093211_ResultPointsDouble', '10.0.8');
    END IF;
END $EF$;
COMMIT;

