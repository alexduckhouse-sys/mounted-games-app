START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261028172958_AddHeatIdToVolunteerShift') THEN
    ALTER TABLE "VolunteerShift" ADD "HeatId" integer;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261028172958_AddHeatIdToVolunteerShift') THEN
    CREATE INDEX "IX_VolunteerShift_HeatId" ON "VolunteerShift" ("HeatId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261028172958_AddHeatIdToVolunteerShift') THEN
    ALTER TABLE "VolunteerShift" ADD CONSTRAINT "FK_VolunteerShift_Heats_HeatId" FOREIGN KEY ("HeatId") REFERENCES "Heats" ("Id") ON DELETE CASCADE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261028172958_AddHeatIdToVolunteerShift') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261028172958_AddHeatIdToVolunteerShift', '10.0.8');
    END IF;
END $EF$;
COMMIT;

