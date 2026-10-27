START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027100805_AddStewardDutiesAndProvisionalWindow') THEN
    ALTER TABLE "VolunteerShift" ADD "AssignedClubName" character varying(150);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027100805_AddStewardDutiesAndProvisionalWindow') THEN
    ALTER TABLE "VolunteerShift" ADD "AssignedTeamId" integer;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027100805_AddStewardDutiesAndProvisionalWindow') THEN
    ALTER TABLE "VolunteerShift" ADD "AttendanceStatus" character varying(20) NOT NULL DEFAULT 'Assigned';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027100805_AddStewardDutiesAndProvisionalWindow') THEN
    ALTER TABLE "VolunteerShift" ADD "CheckedInAt" timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027100805_AddStewardDutiesAndProvisionalWindow') THEN
    ALTER TABLE "VolunteerShift" ADD "CheckedInByName" character varying(160);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027100805_AddStewardDutiesAndProvisionalWindow') THEN
    ALTER TABLE "VolunteerShift" ADD "CheckedInByStaffOverride" boolean NOT NULL DEFAULT FALSE;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027100805_AddStewardDutiesAndProvisionalWindow') THEN
    ALTER TABLE "VolunteerShift" ADD "CheckedInByUserId" character varying(120);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027100805_AddStewardDutiesAndProvisionalWindow') THEN
    ALTER TABLE "VolunteerShift" ADD "DutyCategory" character varying(40) NOT NULL DEFAULT 'Custom';
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027100805_AddStewardDutiesAndProvisionalWindow') THEN
    ALTER TABLE "VolunteerShift" ADD "LaneNumber" integer;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027100805_AddStewardDutiesAndProvisionalWindow') THEN
    ALTER TABLE "Sessions" ADD "OfficialConfirmedAt" timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027100805_AddStewardDutiesAndProvisionalWindow') THEN
    ALTER TABLE "Sessions" ADD "ProvisionalUntil" timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027100805_AddStewardDutiesAndProvisionalWindow') THEN
    CREATE INDEX "IX_VolunteerShift_AssignedTeamId" ON "VolunteerShift" ("AssignedTeamId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027100805_AddStewardDutiesAndProvisionalWindow') THEN
    ALTER TABLE "VolunteerShift" ADD CONSTRAINT "FK_VolunteerShift_Teams_AssignedTeamId" FOREIGN KEY ("AssignedTeamId") REFERENCES "Teams" ("Id") ON DELETE SET NULL;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261027100805_AddStewardDutiesAndProvisionalWindow') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261027100805_AddStewardDutiesAndProvisionalWindow', '10.0.8');
    END IF;
END $EF$;
COMMIT;

