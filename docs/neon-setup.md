# Neon database setup

The React frontend stays on Vercel. The .NET API connects to Neon using Entity Framework Core and Npgsql. Database credentials belong on the API server, never in browser code or `VITE_*` variables.

## Current setup

- Since 30 October 2026 production runs on the Vercel-billed Neon database `mounted-games-db` (Neon project `dawn-rain-89550103`, AWS us-east-2 / Vercel `cle1`, Postgres 18, Launch plan billed through the Vercel Pro team). It is connected to the `mounted-games-api` project for **Production only**, with no preview branching and prefix `DATABASE`, so Vercel manages `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct) and the `DATABASE_PG*` / `DATABASE_POSTGRES_*` extras as sensitive variables. Rotating the password in the store updates them; redeploy the API afterwards.
- Read-only SQL for the new database: Vercel → Storage → `mounted-games-db` → Query (keep **Read-only** on). Opening it in the Neon console asks to link your Vercel login to your Neon account by email first.
- The old project `wild-leaf-19597390` (organisation `org-hidden-silence-42555372`, free plan) still holds the copy taken at the switch and is no longer used. Keep it untouched until 6 November 2026 as the way back, then delete it. Neon can't move a project into a Vercel-managed organisation, which is why this was a copy, not a transfer.
- The production database has the PostgreSQL schema, including competition icons, and the real West Mids Pairs event (competition 44). The eight fictional demo events were cleared from production on 28 October; `npm run db:seed-review` recreates them on a non-production branch.
- The Neon CLI is authenticated. Codex's global Neon MCP configuration uses OAuth and is restricted to this project. Start a new Codex session if its tools are not available in an existing session.
- `neon.ts` requests PostgreSQL only. The app keeps ASP.NET Identity for sign-in.
- The CLI writes connection variables into ignored local environment files. Do not commit or print their contents.

The first deployment used eight Neon demo competitions. The owner confirmed that the old site's SQLite data does not need to be preserved; it has not been imported.

`web/vercel.json` forwards `/api` requests to the API on Vercel (`mounted-games-api`) and serves the app for direct page links. Live updates connect directly to the API project using `VITE_LIVE_HUB_URL`. Local development keeps the Vite proxy. The API scales to zero, so the first request after a quiet spell can be slow; Neon persistence does not remove that.

The demo events have separate sections, teams, timetables and results. Six were seeded for today or later and two are past events. The picker requests only IDs, names, dates and icons. Past events are requested when their page opens from the sidebar; competition details load after selection. Organisers can choose a flag or symbol under **Competition icon** when editing an event.

The explicit `npm run db:seed-review` command creates missing demo events without changing existing ones, except that it gives any of the eight events that has no event shop settings row the demo mark (so test payments work and the "Demo event" badge shows); a row the organiser already set is never touched. New events get £15.00 entry prices so the test payment page can be shown; existing events keep their prices, so set a price on a section to demonstrate it. It never runs during normal API startup. Dates are relative to the day the events are first created. Today's event is timed from the moment the command runs, so its running session is live now.

To refresh stale demo data, run `npm run db:reseed-review`. It deletes the eight seeder-named events ("Demo Meadow Cup" and so on, the names in `ReviewCompetitionSeeder`) with everything under them, but only those that carry the demo mark; any other event, including one that merely shares a name, is left alone and reported. It then creates all eight again from the current time. Back up or branch the database first if you are unsure; the deletes run in one transaction.

## Clear the demo data (one-off)

The owner asked for all demo data to go from production, keeping the one real event, West Mids Pairs (competition 44). `--clear-demo-data` does that (`api/Services/DemoDataCleaner.cs`; what it keeps and deletes is in `docs/decisions.md`, 28 October). Without `--apply` it is a dry run: it runs every delete inside a transaction, prints the counts and rolls back, so nothing is saved and the counts are exactly what `--apply` would remove. It prints which database it is on (host and database name, never credentials), counts per table, competition ids and names, and the names of the clubs it would delete; never a person's name or address. `--expect-name` must match the kept competition's name exactly, so a mistyped id stops the run.

1. Take a backup branch of production first, and keep it until the site has been checked:

   ```sh
   neon branches create --name backup-before-demo-clear --parent production
   ```

2. Dry run against production. The command starts the API in Production mode, so it needs a JWT key of at least 32 bytes (a throwaway one is fine, nothing is signed) and an empty `Admin__Key` so the development value in `appsettings.json` isn't picked up:

   ```sh
   NEON_ENV_FILE=.env.production.local Jwt__Key="$(openssl rand -base64 48)" Admin__Key= \
     node scripts/api.mjs --clear-demo-data --keep-competition 44 --expect-name "West Mids Pairs" --venue-postcode "<postcode>"
   ```

   Check the first line names the production host and database. Check that it keeps competition 44 "West Mids Pairs" with its 32 teams, that the list of competitions to delete is what you expect, the account counts, and the list of clubs to delete. The postcode is looked up in the dry run too (it only reads), so a postcode that can't be found shows up here.

3. Apply with the same arguments plus `--apply` (`--venue-postcode` is optional; a postcode that can't be found stops the run before anything is deleted):

   ```sh
   NEON_ENV_FILE=.env.production.local Jwt__Key="$(openssl rand -base64 48)" Admin__Key= \
     node scripts/api.mjs --clear-demo-data --keep-competition 44 --expect-name "West Mids Pairs" --venue-postcode "<postcode>" --apply
   ```

   Everything goes in one transaction. Before committing, it checks that competition 44 still has every session, team, result, entry and so on that it had, and that no row points at something deleted; if either check fails it rolls back and says why. Run it when nobody is using the site: a write to a demo event during the run makes it fail (safely), and the deletes briefly lock those rows.

4. Check the live site (`/api/competitions`, the West Mids Pairs page, signing in). To undo, restore production from the backup branch (`neon branches restore production backup-before-demo-clear`).

The command refuses to run without `--keep-competition` and `--expect-name`, for an id that doesn't exist or whose name doesn't match, or for an event carrying the demo mark. Any unexpected error is reported by its kind only (no database detail) and rolls back. It doesn't run the startup seeding, and it refuses a database with pending migrations. After it, production holds only the real event; `npm run db:seed-review` and `db:seed-history` can still fill a separate review branch.

## Run locally

Install dependencies in the repository root and in `web`, then build:

```sh
npm ci
npm ci --prefix web
npm run build
```

Pull the linked branch's variables if needed (`neon connection-string`, saved to an ignored env file). Apply migrations with the direct connection, then start the API:

```sh
npm run db:migrate
npm start
```

In another terminal, start the frontend:

```sh
npm run dev
```

Open <http://localhost:5173>. Vite forwards `/api` and `/hubs` to the API on port 5050.

`npm start` loads `.env` if it exists, otherwise `.env.local`. Set `NEON_ENV_FILE` to use a different file. The server uses pooled `DATABASE_URL` for requests and direct `DATABASE_URL_UNPOOLED` for migrations. TLS certificate verification is enabled. Missing PostgreSQL configuration fails at startup when `Database__Provider=postgres` is set.

PostgreSQL startup seeds the club list, race library and Identity roles. It does not create demo competitions or accounts. If `Admin__Key` is configured on the API server, startup creates a passwordless shared organiser account for the existing organiser sign-in. It does not change existing accounts. SQLite development keeps its existing demo behaviour.

## Verify changes

```sh
npm test
```

For the end-to-end database check, use an isolated branch named `setup-verification-…`. Pull its variables into an ignored file, migrate it, and run the check:

```sh
neon env pull --branch setup-verification-d0609171 --file .env.verification.local --services postgres
NEON_ENV_FILE=.env.verification.local npm run db:migrate
NEON_ENV_FILE=.env.verification.local npm run test:neon
```

The check starts the API on port 5051, signs in, creates a fake competition and timetable, checks UTC dates, restarts the API, checks persistence, updates the competition and removes the test records. It refuses to write to a branch without the verification prefix. The verification branch created during setup expires on 16 October 2026; create a new one after that date.

New migrations are generated from `AppDbContextFactory`, which needs no credentials. Review and test each migration on an isolated branch before applying it to production. The API checks for pending PostgreSQL migrations at startup and refuses to start until they are applied.

## Move the live API

For any future move with data to retain, take and verify a consistent backup before restarting or replacing its host. This deployment starts from the Neon demo data with the owner's explicit agreement.

After the data is ready, configure these variables on the **API host**:

- `DATABASE_URL`: pooled Neon connection.
- `DATABASE_URL_UNPOOLED`: direct connection on the machine running migrations; the API host only needs the pooled URL.
- `Database__Provider=postgres` and `Database__SeedDemoData=false`.
- Keep the existing `Jwt__Key` and `Admin__Key` values.

Deploy the updated API after its migration has been applied. In the Docker image, the migration command is `dotnet MountedGames.Api.dll --migrate-database`. The existing SQLite connection setting can then be removed. Recheck the public site's sign-in, competition picker, timetable and scoring before considering the switch complete.

### The 30 October 2026 move to Vercel billing

1. Created `mounted-games-db` from the API project's Storage tab (Neon, Cleveland `cle1`, Auth and Realtime off), without connecting it.
2. Copied with `pg_dump --no-owner --no-acl -Fc` and `pg_restore --no-owner --no-acl --exit-on-error` from a `postgres:18` container, using the direct (non `-pooler`) URLs of both, typed at hidden prompts so they never reached a log or chat. The script first refused a target that already had tables.
3. Compared both sides with one read-only query, run in each SQL editor; the switch is good when tables, total rows and fingerprint match (they did: 116 tables, 935 rows):

   ```sql
   select count(*) as tables, sum(n) as total_rows, md5(string_agg(t || ':' || n, ',' order by t)) as fingerprint
   from (select table_name t, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::bigint n
         from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') s;
   ```

4. Deleted the API's hand-set `DATABASE_URL`, connected the store for Production with prefix `DATABASE`, redeployed production, checked `/api/competitions`, re-ran the fingerprint on both, and confirmed in `pg_stat_activity` on the new database that `mounted-games-api` was connected.

To go back: in the old Neon project copy the pooled connection string, disconnect the store from `mounted-games-api`, add it as `DATABASE_URL` (Production, sensitive) and redeploy. Anything written to the new database since the switch would need copying back.

For driver and connection guidance, see [Npgsql's EF Core documentation](https://www.npgsql.org/efcore/) and the [Neon PostgreSQL skill](https://github.com/neondatabase/agent-skills/tree/main/skills/neon-postgres).
