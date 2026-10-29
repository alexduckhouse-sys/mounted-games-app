START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE TABLE "CompetitionReadRevisions" (
        "CompetitionId" integer NOT NULL,
        "Standings" bigint NOT NULL,
        "Detail" bigint NOT NULL,
        CONSTRAINT "PK_CompetitionReadRevisions" PRIMARY KEY ("CompetitionId")
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_0_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT OLD."Id" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_0_old" BEFORE UPDATE OR DELETE ON "Competitions" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_0_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_0_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT NEW."Id" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_0_new" AFTER INSERT OR UPDATE ON "Competitions" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_0_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_1_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT OLD."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_1_old" BEFORE UPDATE OR DELETE ON "CompetitionSections" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_1_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_1_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT NEW."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_1_new" AFTER INSERT OR UPDATE ON "CompetitionSections" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_1_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_2_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT OLD."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_2_old" BEFORE UPDATE OR DELETE ON "Teams" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_2_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_2_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT NEW."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_2_new" AFTER INSERT OR UPDATE ON "Teams" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_2_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_3_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT OLD."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_3_old" BEFORE UPDATE OR DELETE ON "Sessions" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_3_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_3_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT NEW."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_3_new" AFTER INSERT OR UPDATE ON "Sessions" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_3_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_4_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT s."CompetitionId" AS id FROM "Sessions" s WHERE s."Id" = OLD."SessionId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_4_old" BEFORE UPDATE OR DELETE ON "Heats" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_4_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_4_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT s."CompetitionId" AS id FROM "Sessions" s WHERE s."Id" = NEW."SessionId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_4_new" AFTER INSERT OR UPDATE ON "Heats" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_4_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_5_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT s."CompetitionId" AS id FROM "Heats" h JOIN "Sessions" s ON s."Id" = h."SessionId" WHERE h."Id" = OLD."HeatId" UNION SELECT t."CompetitionId" AS id FROM "Teams" t WHERE t."Id" = OLD."TeamId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_5_old" BEFORE UPDATE OR DELETE ON "HeatEntries" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_5_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_5_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT s."CompetitionId" AS id FROM "Heats" h JOIN "Sessions" s ON s."Id" = h."SessionId" WHERE h."Id" = NEW."HeatId" UNION SELECT t."CompetitionId" AS id FROM "Teams" t WHERE t."Id" = NEW."TeamId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_5_new" AFTER INSERT OR UPDATE ON "HeatEntries" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_5_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_6_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT s."CompetitionId" AS id FROM "Heats" h JOIN "Sessions" s ON s."Id" = h."SessionId" WHERE h."Id" = OLD."HeatId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_6_old" BEFORE UPDATE OR DELETE ON "Races" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_6_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_6_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT s."CompetitionId" AS id FROM "Heats" h JOIN "Sessions" s ON s."Id" = h."SessionId" WHERE h."Id" = NEW."HeatId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_6_new" AFTER INSERT OR UPDATE ON "Races" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_6_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_7_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT t."CompetitionId" AS id FROM "Teams" t WHERE t."Id" = OLD."TeamId" UNION SELECT s."CompetitionId" AS id FROM "Races" r JOIN "Heats" h ON h."Id" = r."HeatId" JOIN "Sessions" s ON s."Id" = h."SessionId" WHERE r."Id" = OLD."RaceId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_7_old" BEFORE UPDATE OR DELETE ON "Results" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_7_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_7_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT t."CompetitionId" AS id FROM "Teams" t WHERE t."Id" = NEW."TeamId" UNION SELECT s."CompetitionId" AS id FROM "Races" r JOIN "Heats" h ON h."Id" = r."HeatId" JOIN "Sessions" s ON s."Id" = h."SessionId" WHERE r."Id" = NEW."RaceId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_7_new" AFTER INSERT OR UPDATE ON "Results" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_7_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_8_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 0 FROM (SELECT OLD."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 0; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_8_old" BEFORE UPDATE OR DELETE ON "FinalsTieOrders" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_8_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_8_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 0 FROM (SELECT NEW."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 0; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_8_new" AFTER INSERT OR UPDATE ON "FinalsTieOrders" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_8_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_9_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 0 FROM (SELECT OLD."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 0; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_9_old" BEFORE UPDATE OR DELETE ON "TackCheckSections" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_9_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_9_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 0 FROM (SELECT NEW."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 0; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_9_new" AFTER INSERT OR UPDATE ON "TackCheckSections" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_9_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_10_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 0 FROM (SELECT s."CompetitionId" AS id FROM "TackCheckSections" s WHERE s."Id" = OLD."TackCheckSectionId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 0; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_10_old" BEFORE UPDATE OR DELETE ON "TackCheckSectors" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_10_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_10_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 0 FROM (SELECT s."CompetitionId" AS id FROM "TackCheckSections" s WHERE s."Id" = NEW."TackCheckSectionId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 0; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_10_new" AFTER INSERT OR UPDATE ON "TackCheckSectors" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_10_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_11_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 0 FROM (SELECT t."CompetitionId" AS id FROM "Teams" t WHERE t."Id" = OLD."TeamId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 0; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_11_old" BEFORE UPDATE OR DELETE ON "TackCheckMarks" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_11_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_11_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 0 FROM (SELECT t."CompetitionId" AS id FROM "Teams" t WHERE t."Id" = NEW."TeamId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 0; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_11_new" AFTER INSERT OR UPDATE ON "TackCheckMarks" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_11_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_12_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT s."CompetitionId" AS id FROM "CompetitionSections" s WHERE s."Id" = OLD."CompetitionSectionId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_12_old" BEFORE UPDATE OR DELETE ON "SectionSignups" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_12_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_12_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT s."CompetitionId" AS id FROM "CompetitionSections" s WHERE s."Id" = NEW."CompetitionSectionId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_12_new" AFTER INSERT OR UPDATE ON "SectionSignups" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_12_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_13_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT s."CompetitionId" AS id FROM "SectionSignups" x JOIN "CompetitionSections" s ON s."Id" = x."CompetitionSectionId" WHERE x."Id" = OLD."SignupId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_13_old" BEFORE UPDATE OR DELETE ON "SignupExtras" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_13_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_13_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT s."CompetitionId" AS id FROM "SectionSignups" x JOIN "CompetitionSections" s ON s."Id" = x."CompetitionSectionId" WHERE x."Id" = NEW."SignupId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_13_new" AFTER INSERT OR UPDATE ON "SignupExtras" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_13_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_14_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT s."CompetitionId" AS id FROM "SectionSignups" x JOIN "CompetitionSections" s ON s."Id" = x."CompetitionSectionId" WHERE x."Id" = OLD."SignupId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_14_old" BEFORE UPDATE OR DELETE ON "SignupMatchmaking" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_14_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_14_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT s."CompetitionId" AS id FROM "SectionSignups" x JOIN "CompetitionSections" s ON s."Id" = x."CompetitionSectionId" WHERE x."Id" = NEW."SignupId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_14_new" AFTER INSERT OR UPDATE ON "SignupMatchmaking" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_14_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_15_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT OLD."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_15_old" BEFORE UPDATE OR DELETE ON "CompetitionEntrySettings" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_15_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_15_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT NEW."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_15_new" AFTER INSERT OR UPDATE ON "CompetitionEntrySettings" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_15_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_16_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT OLD."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_16_old" BEFORE UPDATE OR DELETE ON "EventCommerceSettings" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_16_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_16_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT NEW."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_16_new" AFTER INSERT OR UPDATE ON "EventCommerceSettings" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_16_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_17_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT OLD."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_17_old" BEFORE UPDATE OR DELETE ON "EventOrder" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_17_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_17_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT NEW."CompetitionId" AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_17_new" AFTER INSERT OR UPDATE ON "EventOrder" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_17_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_18_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT o."CompetitionId" AS id FROM "EventOrder" o WHERE o."Id" = OLD."EventOrderId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_18_old" BEFORE UPDATE OR DELETE ON "EventOrderLine" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_18_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_18_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT o."CompetitionId" AS id FROM "EventOrder" o WHERE o."Id" = NEW."EventOrderId") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_18_new" AFTER INSERT OR UPDATE ON "EventOrderLine" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_18_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_19_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT t."CompetitionId" AS id FROM "Teams" t WHERE t."ClubId" = OLD."Id") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_19_old" BEFORE UPDATE OR DELETE ON "Clubs" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_19_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_19_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 1, 1 FROM (SELECT t."CompetitionId" AS id FROM "Teams" t WHERE t."ClubId" = NEW."Id") AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 1, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_19_new" AFTER INSERT OR UPDATE ON "Clubs" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_19_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_20_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT 0 AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_20_old" BEFORE UPDATE OR DELETE ON "ClubPayoutAccounts" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_20_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_20_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT 0 AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_20_new" AFTER INSERT OR UPDATE ON "ClubPayoutAccounts" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_20_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_21_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN IF TG_OP <> 'UPDATE' OR (OLD."Name" IS DISTINCT FROM NEW."Name") THEN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT 0 AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_21_old" BEFORE UPDATE OR DELETE ON "Clubs" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_21_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_21_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN IF TG_OP <> 'UPDATE' OR (OLD."Name" IS DISTINCT FROM NEW."Name") THEN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT 0 AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_21_new" AFTER INSERT OR UPDATE ON "Clubs" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_21_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_22_old"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN IF TG_OP <> 'UPDATE' OR (OLD."FullName" IS DISTINCT FROM NEW."FullName" OR OLD."ClubId" IS DISTINCT FROM NEW."ClubId") THEN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT 0 AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_22_old" BEFORE UPDATE OR DELETE ON "AspNetUsers" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_22_old"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    CREATE FUNCTION "mg_read_revision_22_new"() RETURNS trigger LANGUAGE plpgsql AS $revision$ BEGIN IF TG_OP <> 'UPDATE' OR (OLD."FullName" IS DISTINCT FROM NEW."FullName" OR OLD."ClubId" IS DISTINCT FROM NEW."ClubId") THEN INSERT INTO "CompetitionReadRevisions" ("CompetitionId", "Standings", "Detail") SELECT DISTINCT id, 0, 1 FROM (SELECT 0 AS id) AS affected WHERE id IS NOT NULL AND id >= 0 ON CONFLICT ("CompetitionId") DO UPDATE SET "Standings" = "CompetitionReadRevisions"."Standings" + 0, "Detail" = "CompetitionReadRevisions"."Detail" + 1; END IF; RETURN NEW; END; $revision$; CREATE TRIGGER "mg_read_revision_22_new" AFTER INSERT OR UPDATE ON "AspNetUsers" FOR EACH ROW EXECUTE FUNCTION "mg_read_revision_22_new"();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029112234_CompetitionReadRevisions') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261029112234_CompetitionReadRevisions', '10.0.8');
    END IF;
END $EF$;
COMMIT;

