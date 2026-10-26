START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026173438_AddDetailsAndShopFields') THEN
    ALTER TABLE "EventOrderLine" ADD "Detail" character varying(80);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026173438_AddDetailsAndShopFields') THEN
    ALTER TABLE "Competitions" ADD "CompetitionNumber" character varying(40);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026173438_AddDetailsAndShopFields') THEN
    ALTER TABLE "Competitions" ADD "ContactEmail" character varying(254);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026173438_AddDetailsAndShopFields') THEN
    ALTER TABLE "Competitions" ADD "Postcode" character varying(12);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026173438_AddDetailsAndShopFields') THEN
    ALTER TABLE "CatalogueItem" ADD "DetailHint" character varying(80);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026173438_AddDetailsAndShopFields') THEN
    ALTER TABLE "CatalogueItem" ADD "DetailPrompt" character varying(60);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261026173438_AddDetailsAndShopFields') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261026173438_AddDetailsAndShopFields', '10.0.8');
    END IF;
END $EF$;
COMMIT;

