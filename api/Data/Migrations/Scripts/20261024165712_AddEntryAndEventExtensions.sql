START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261024165712_AddEntryAndEventExtensions') THEN
    ALTER TABLE "TackCheckMarks" ADD COLUMN IF NOT EXISTS "RiderScoresJson" text NULL;
    ALTER TABLE "SeasonRound" ADD COLUMN IF NOT EXISTS "PointsMultiplier" double precision NOT NULL DEFAULT 1.0;
    CREATE TABLE IF NOT EXISTS "CompetitionDeclarationLocks" (
        "CompetitionId" integer NOT NULL CONSTRAINT "PK_CompetitionDeclarationLocks" PRIMARY KEY, "DeclarationsCloseAt" text NULL
    );
    CREATE TABLE IF NOT EXISTS "CompetitionEntrySettings" (
        "CompetitionId" integer NOT NULL CONSTRAINT "PK_CompetitionEntrySettings" PRIMARY KEY, "EntriesCloseAt" text NULL
    );
    CREATE TABLE IF NOT EXISTS "SignupExtras" (
        "SignupId" integer NOT NULL CONSTRAINT "PK_SignupExtras" PRIMARY KEY,
        "StablesCount" integer NOT NULL DEFAULT 0, "StablingClubOrTeam" text NULL,
        "PaymentMethod" text NULL, "IsWaitlist" integer NOT NULL DEFAULT 0,
        "IsWithdrawn" integer NOT NULL DEFAULT 0, "RefundPending" integer NOT NULL DEFAULT 0,
        "TeamsCount" integer NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS "SignupMatchmaking" (
        "SignupId" integer NOT NULL CONSTRAINT "PK_SignupMatchmaking" PRIMARY KEY,
        "LookingForPair" integer NOT NULL DEFAULT 0, "LookingForGuestRiders" integer NOT NULL DEFAULT 0,
        "WaitingForGuestSpot" integer NOT NULL DEFAULT 0, "PairRequestFromSignupId" integer NULL,
        "PairRequestToSignupId" integer NULL, "PairRequestStatus" text NULL
    );
    DO $adopt$
    DECLARE existing_key text;
    BEGIN
        SELECT conname INTO existing_key FROM pg_constraint WHERE contype = 'p' AND conrelid = '"CompetitionDeclarationLocks"'::regclass;
        IF existing_key IS NOT NULL AND existing_key <> 'PK_CompetitionDeclarationLocks' THEN
            EXECUTE format('ALTER TABLE "CompetitionDeclarationLocks" RENAME CONSTRAINT %I TO "PK_CompetitionDeclarationLocks"', existing_key);
        END IF;
    END $adopt$;
    DO $adopt$
    DECLARE existing_key text;
    BEGIN
        SELECT conname INTO existing_key FROM pg_constraint WHERE contype = 'p' AND conrelid = '"CompetitionEntrySettings"'::regclass;
        IF existing_key IS NOT NULL AND existing_key <> 'PK_CompetitionEntrySettings' THEN
            EXECUTE format('ALTER TABLE "CompetitionEntrySettings" RENAME CONSTRAINT %I TO "PK_CompetitionEntrySettings"', existing_key);
        END IF;
    END $adopt$;
    DO $adopt$
    DECLARE existing_key text;
    BEGIN
        SELECT conname INTO existing_key FROM pg_constraint WHERE contype = 'p' AND conrelid = '"SignupExtras"'::regclass;
        IF existing_key IS NOT NULL AND existing_key <> 'PK_SignupExtras' THEN
            EXECUTE format('ALTER TABLE "SignupExtras" RENAME CONSTRAINT %I TO "PK_SignupExtras"', existing_key);
        END IF;
    END $adopt$;
    DO $adopt$
    DECLARE existing_key text;
    BEGIN
        SELECT conname INTO existing_key FROM pg_constraint WHERE contype = 'p' AND conrelid = '"SignupMatchmaking"'::regclass;
        IF existing_key IS NOT NULL AND existing_key <> 'PK_SignupMatchmaking' THEN
            EXECUTE format('ALTER TABLE "SignupMatchmaking" RENAME CONSTRAINT %I TO "PK_SignupMatchmaking"', existing_key);
        END IF;
    END $adopt$;
    DO $adopt$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_CompetitionDeclarationLocks_Competition' AND conrelid = '"CompetitionDeclarationLocks"'::regclass) THEN
            ALTER TABLE "CompetitionDeclarationLocks" ADD CONSTRAINT "FK_CompetitionDeclarationLocks_Competition" FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE;
        END IF;
    END $adopt$;
    DO $adopt$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_CompetitionEntrySettings_Competition' AND conrelid = '"CompetitionEntrySettings"'::regclass) THEN
            ALTER TABLE "CompetitionEntrySettings" ADD CONSTRAINT "FK_CompetitionEntrySettings_Competition" FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE;
        END IF;
    END $adopt$;
    DO $adopt$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_SignupExtras_Signup' AND conrelid = '"SignupExtras"'::regclass) THEN
            ALTER TABLE "SignupExtras" ADD CONSTRAINT "FK_SignupExtras_Signup" FOREIGN KEY ("SignupId") REFERENCES "SectionSignups" ("Id") ON DELETE CASCADE;
        END IF;
    END $adopt$;
    DO $adopt$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_SignupMatchmaking_Signup' AND conrelid = '"SignupMatchmaking"'::regclass) THEN
            ALTER TABLE "SignupMatchmaking" ADD CONSTRAINT "FK_SignupMatchmaking_Signup" FOREIGN KEY ("SignupId") REFERENCES "SectionSignups" ("Id") ON DELETE CASCADE;
        END IF;
    END $adopt$;
    DO $adopt$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_SignupMatchmaking_PairFrom' AND conrelid = '"SignupMatchmaking"'::regclass) THEN
            ALTER TABLE "SignupMatchmaking" ADD CONSTRAINT "FK_SignupMatchmaking_PairFrom" FOREIGN KEY ("PairRequestFromSignupId") REFERENCES "SectionSignups" ("Id") ON DELETE SET NULL;
        END IF;
    END $adopt$;
    DO $adopt$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_SignupMatchmaking_PairTo' AND conrelid = '"SignupMatchmaking"'::regclass) THEN
            ALTER TABLE "SignupMatchmaking" ADD CONSTRAINT "FK_SignupMatchmaking_PairTo" FOREIGN KEY ("PairRequestToSignupId") REFERENCES "SectionSignups" ("Id") ON DELETE SET NULL;
        END IF;
    END $adopt$;
    CREATE INDEX IF NOT EXISTS "IX_SignupMatchmaking_PairRequestFromSignupId" ON "SignupMatchmaking" ("PairRequestFromSignupId");
    CREATE INDEX IF NOT EXISTS "IX_SignupMatchmaking_PairRequestToSignupId" ON "SignupMatchmaking" ("PairRequestToSignupId");
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261024165712_AddEntryAndEventExtensions') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261024165712_AddEntryAndEventExtensions', '10.0.8');
    END IF;
END $EF$;
COMMIT;

