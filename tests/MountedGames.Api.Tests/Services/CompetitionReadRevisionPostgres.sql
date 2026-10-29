-- Run only against a disposable database after the previous and new migration scripts.
-- psql -v ON_ERROR_STOP=1 -f CompetitionReadRevisionPostgres.sql
-- All fixtures roll back. No production data or credentials are needed.
BEGIN;
INSERT INTO "Competitions" ("Id","Name","StartDate","IsActive","IsArchived","SignupsLocked","CreatedAt")
VALUES (900001,'Synthetic A',now(),true,false,false,now()),(900002,'Synthetic B',now(),true,false,false,now());
INSERT INTO "Clubs" ("Id","Name","CreatedAt") VALUES (900001,'Synthetic club',now());
INSERT INTO "CompetitionSections" ("Id","CompetitionId","Format","AgeGroup","DisplayName","UsesRaceFinals","PriceMinor","CreatedAt")
VALUES (900001,900001,0,'Synthetic','Synthetic A',false,0,now()),(900002,900002,0,'Synthetic','Synthetic B',false,0,now());
INSERT INTO "Teams" ("Id","CompetitionId","CompetitionSectionId","ClubId","Suffix","DisplayName","IsHorsConcours","CreatedAt")
VALUES (900001,900001,900001,900001,'A','Synthetic A',false,now()),(900002,900002,900002,900001,'B','Synthetic B',false,now());
INSERT INTO "Sessions" ("Id","CompetitionId","Name","Status","OrderIndex","IsBreak","Kind","RaceOrderAlternating")
VALUES (900001,900001,'Synthetic',0,0,false,0,false);
INSERT INTO "Heats" ("Id","SessionId","OrderIndex","RaceRoundStage") VALUES (900001,900001,0,0);
INSERT INTO "Races" ("Id","HeatId","Name","OrderIndex","IsComplete") VALUES (900001,900001,'Synthetic',0,false);
INSERT INTO "Results" ("Id","RaceId","TeamId","Eliminated","Points","RecordedAt") VALUES (900001,900001,900001,false,1,now());
INSERT INTO "AspNetUsers" ("Id","FullName","CreatedAt","EmailConfirmed","PhoneNumberConfirmed","TwoFactorEnabled","LockoutEnabled","AccessFailedCount")
VALUES ('synthetic-revision-user','Synthetic user',now(),false,false,false,false,0);

DO $test$
DECLARE a bigint; b bigint; shared bigint;
BEGIN
    SELECT "Standings" INTO a FROM "CompetitionReadRevisions" WHERE "CompetitionId"=900001;
    UPDATE "Competitions" SET "Name"='Synthetic edited' WHERE "Id"=900001;
    IF (SELECT "Name" FROM "Competitions" WHERE "Id"=900001) <> 'Synthetic edited'
        THEN RAISE EXCEPTION 'BEFORE UPDATE must return NEW, preserving the edit'; END IF;
    IF (SELECT "Standings" FROM "CompetitionReadRevisions" WHERE "CompetitionId"=900001) <= a
        THEN RAISE EXCEPTION 'Competition edit did not advance revision'; END IF;
    SELECT "Standings" INTO a FROM "CompetitionReadRevisions" WHERE "CompetitionId"=900001;
    SELECT "Standings" INTO b FROM "CompetitionReadRevisions" WHERE "CompetitionId"=900002;
    UPDATE "Results" SET "TeamId"=900002,"Points"=5 WHERE "Id"=900001;
    IF (SELECT "TeamId" FROM "Results" WHERE "Id"=900001) <> 900002
        THEN RAISE EXCEPTION 'Result move was discarded'; END IF;
    IF (SELECT "Standings" FROM "CompetitionReadRevisions" WHERE "CompetitionId"=900001) <= a
        OR (SELECT "Standings" FROM "CompetitionReadRevisions" WHERE "CompetitionId"=900002) <= b
        THEN RAISE EXCEPTION 'Old/new dependencies were not both invalidated'; END IF;
    SELECT "Detail" INTO shared FROM "CompetitionReadRevisions" WHERE "CompetitionId"=0;
    UPDATE "AspNetUsers" SET "SessionVersion"=1 WHERE "Id"='synthetic-revision-user';
    IF (SELECT "SessionVersion" FROM "AspNetUsers" WHERE "Id"='synthetic-revision-user') <> 1
        OR (SELECT "Detail" FROM "CompetitionReadRevisions" WHERE "CompetitionId"=0) <> shared
        THEN RAISE EXCEPTION 'Session revocation must persist without flushing public detail'; END IF;
    UPDATE "AspNetUsers" SET "FullName"='Synthetic edited user' WHERE "Id"='synthetic-revision-user';
    IF (SELECT "FullName" FROM "AspNetUsers" WHERE "Id"='synthetic-revision-user') <> 'Synthetic edited user'
        OR (SELECT "Detail" FROM "CompetitionReadRevisions" WHERE "CompetitionId"=0) <= shared
        THEN RAISE EXCEPTION 'Public user edit must persist and invalidate details'; END IF;
    DELETE FROM "Results" WHERE "Id"=900001;
    IF EXISTS(SELECT 1 FROM "Results" WHERE "Id"=900001) THEN RAISE EXCEPTION 'Delete was discarded'; END IF;
END $test$;
CREATE TEMP TABLE revision_before AS SELECT * FROM "CompetitionReadRevisions";
SAVEPOINT synthetic_rollback;
UPDATE "Competitions" SET "Name"='Synthetic rolled back' WHERE "Id"=900001;
ROLLBACK TO SAVEPOINT synthetic_rollback;
DO $test$
BEGIN
    IF EXISTS((SELECT * FROM "CompetitionReadRevisions" EXCEPT SELECT * FROM revision_before)
              UNION ALL (SELECT * FROM revision_before EXCEPT SELECT * FROM "CompetitionReadRevisions"))
        THEN RAISE EXCEPTION 'Rollback changed committed revisions'; END IF;
END $test$;
ROLLBACK;
