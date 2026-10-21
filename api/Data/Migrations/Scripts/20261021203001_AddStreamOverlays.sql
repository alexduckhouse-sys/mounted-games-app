START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261021203001_AddStreamOverlays') THEN
    CREATE TABLE "StreamOverlays" (
        "CompetitionId" integer NOT NULL,
        "BannerText" character varying(140),
        "BannerStyle" integer NOT NULL,
        "BannerArenas" character varying(1000) NOT NULL,
        "StripMode" integer NOT NULL,
        "ScoreCardMode" integer NOT NULL,
        "ScoreCardDelaySeconds" integer NOT NULL,
        "ScoreCardSeconds" integer NOT NULL,
        "LookJson" character varying(4000) NOT NULL,
        "Revision" integer NOT NULL,
        "UpdatedAt" timestamp with time zone NOT NULL,
        "UpdatedByUserId" text,
        CONSTRAINT "PK_StreamOverlays" PRIMARY KEY ("CompetitionId"),
        CONSTRAINT "FK_StreamOverlays_Competitions_CompetitionId" FOREIGN KEY ("CompetitionId") REFERENCES "Competitions" ("Id") ON DELETE CASCADE
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261021203001_AddStreamOverlays') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261021203001_AddStreamOverlays', '10.0.8');
    END IF;
END $EF$;
COMMIT;

